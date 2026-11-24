import {
  canonicalPackKey,
  normalizeOverlayPackName,
  normalizeTilesetName,
  parseBundleFolders,
  type BundleFolderKind,
} from '../domain/bundleParser';
import {
  compactPlacement,
  mergeCollectionDefaults,
  normalizeCollection,
  toMapSummary,
  validateCollection,
  validatePlacements,
} from '../domain/plannerEngine';
import type {
  Collection,
  MapDocument,
  MapSummary,
  OverlayPack,
  Placement,
  Tileset,
  TilesetListResponse,
} from '../domain/types';

export interface StoredPackRecord {
  key: string;
  kind: BundleFolderKind;
  folderName: string;
  filenames: string[];
  totalBytes: number;
  importedAt: string;
}

export interface StoredAssetRecord {
  assetKey: string;
  packKey: string;
  filename: string;
  blob: Blob;
}

export interface StoredPackSummary {
  key: string;
  kind: BundleFolderKind;
  id: string;
  name: string;
  shortCode: string;
  itemCount: number;
  fileCount: number;
  totalBytes: number;
  importedAt: string;
}

export interface ImportedPackInput {
  kind: BundleFolderKind;
  folderName: string;
  files: Array<{ filename: string; blob: Blob }>;
}

export interface SaveImportedPacksProgress {
  current: number;
  total: number;
  packName: string;
}

export interface SaveImportedPacksResult {
  tilesetCount: number;
  overlayPackCount: number;
  imageCount: number;
  totalBytes: number;
  packNames: string[];
}

export interface BrowserStorage {
  fetchTilesets: () => Promise<TilesetListResponse>;
  listStoredPacks: () => Promise<StoredPackSummary[]>;
  saveImportedPacks: (
    packs: readonly ImportedPackInput[],
    onProgress?: (progress: SaveImportedPacksProgress) => void,
  ) => Promise<SaveImportedPacksResult>;
  deleteStoredPack: (packKey: string) => Promise<void>;
  clearAllStoredPacks: () => Promise<void>;
  fetchCollection: (
    discoveredTilesetIds?: readonly string[],
    discoveredOverlayPackIds?: readonly string[],
  ) => Promise<Collection>;
  saveCollection: (
    collection: Collection,
    discoveredTilesetIds?: readonly string[],
    discoveredOverlayPackIds?: readonly string[],
  ) => Promise<Collection>;
  fetchMaps: () => Promise<MapSummary[]>;
  fetchMap: (id: string) => Promise<MapDocument | null>;
  createMap: (name: string, placements?: readonly Placement[]) => Promise<MapDocument>;
  saveMap: (id: string, name: string, placements: readonly Placement[]) => Promise<MapDocument>;
  deleteMap: (id: string) => Promise<boolean>;
  dispose: () => void;
}

const DB_VERSION = 1;
const PACKS_STORE = 'packs';
const ASSETS_STORE = 'assets';
const ASSETS_PACK_INDEX = 'byPackKey';
const META_STORE = 'meta';
const MAPS_STORE = 'maps';
const COLLECTION_META_KEY = 'collection';
const ASSET_WRITE_BATCH_SIZE = 16;
const SAFE_MAP_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

interface MetaRecord {
  key: string;
  value: unknown;
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const named = err as { name?: string; code?: number };
  return (
    named.name === 'QuotaExceededError' ||
    named.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    named.code === 22 ||
    named.code === 1014
  );
}

function wrapStorageError(err: unknown): Error {
  if (isQuotaExceededError(err)) {
    return new Error(
      'Browser storage is full. Free up disk space or clear cached packs and try again.',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(wrapStorageError(req.error));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(wrapStorageError(tx.error ?? new Error('IndexedDB transaction aborted')));
    tx.onerror = () => reject(wrapStorageError(tx.error ?? new Error('IndexedDB transaction failed')));
  });
}

function generateMapId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'map';

  let suffix: string;
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    suffix = globalThis.crypto.randomUUID().slice(0, 8);
  } else {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${slug}-${suffix}`;
}

function displayPackName(pack: Pick<ImportedPackInput, 'kind' | 'folderName'>): string {
  const trimmed = pack.folderName.trim();
  if (pack.kind === 'tileset') {
    return normalizeTilesetName(pack.folderName) || trimmed;
  }
  return normalizeOverlayPackName(pack.folderName) || trimmed;
}

function assignBatchKeys(packs: readonly ImportedPackInput[]): string[] {
  const used = new Map<string, number>();
  return packs.map((pack) => {
    const baseKey = canonicalPackKey(pack.kind, pack.folderName);
    const count = (used.get(baseKey) ?? 0) + 1;
    used.set(baseKey, count);
    return count === 1 ? baseKey : `${baseKey}-${count}`;
  });
}

export function createBrowserStorage(dbName = 'realm-brew-planner'): BrowserStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  let openDb: IDBDatabase | null = null;
  const activeObjectUrls = new Map<string, { url: string; importedAt: string }>();

  const revokeUrlEntry = (assetKey: string) => {
    const existing = activeObjectUrls.get(assetKey);
    if (existing) {
      URL.revokeObjectURL(existing.url);
      activeObjectUrls.delete(assetKey);
    }
  };

  const revokeAllUrls = () => {
    for (const entry of activeObjectUrls.values()) {
      URL.revokeObjectURL(entry.url);
    }
    activeObjectUrls.clear();
  };

  const getDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;

    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable in this browser environment.'));
    }

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PACKS_STORE)) {
          db.createObjectStore(PACKS_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(ASSETS_STORE)) {
          const assets = db.createObjectStore(ASSETS_STORE, { keyPath: 'assetKey' });
          assets.createIndex(ASSETS_PACK_INDEX, 'packKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(MAPS_STORE)) {
          db.createObjectStore(MAPS_STORE, { keyPath: 'id' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        openDb = db;
        db.onversionchange = () => {
          db.close();
          if (openDb === db) openDb = null;
          dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        dbPromise = null;
        reject(wrapStorageError(req.error));
      };
    });

    return dbPromise;
  };

  const readAllPacks = async (db: IDBDatabase): Promise<StoredPackRecord[]> => {
    const tx = db.transaction(PACKS_STORE, 'readonly');
    const store = tx.objectStore(PACKS_STORE);
    const records = (await requestToPromise(store.getAll())) as StoredPackRecord[];
    await transactionDone(tx);
    return records;
  };

  const getDiscoveredIds = async (
    db: IDBDatabase,
  ): Promise<{ tilesetIds: string[]; overlayPackIds: string[] }> => {
    const packs = await readAllPacks(db);
    const parsed = parseBundleFolders(
      packs.map((pack) => ({
        sourceId: pack.key,
        folderName: pack.folderName,
        filenames: pack.filenames,
      })),
      {
        tileFaceUrl: () => '',
        overlayUrl: () => '',
      },
    );
    return {
      tilesetIds: parsed.tilesets.map((t) => t.id),
      overlayPackIds: parsed.overlayPacks.map((p) => p.id),
    };
  };

  const deleteAssetsForPack = async (db: IDBDatabase, packKey: string): Promise<void> => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const index = tx.objectStore(ASSETS_STORE).index(ASSETS_PACK_INDEX);
    const deletedKeys: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const cursorReq = index.openCursor(IDBKeyRange.only(packKey));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as StoredAssetRecord;
        deletedKeys.push(record.assetKey);
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => reject(wrapStorageError(cursorReq.error));
    });

    await transactionDone(tx);
    for (const assetKey of deletedKeys) {
      revokeUrlEntry(assetKey);
    }
  };

  return {
    async fetchTilesets(): Promise<TilesetListResponse> {
      const db = await getDb();
      const tx = db.transaction([PACKS_STORE, ASSETS_STORE], 'readonly');
      const [packs, assets] = await Promise.all([
        requestToPromise(tx.objectStore(PACKS_STORE).getAll()) as Promise<StoredPackRecord[]>,
        requestToPromise(tx.objectStore(ASSETS_STORE).getAll()) as Promise<StoredAssetRecord[]>,
      ]);
      await transactionDone(tx);

      const packImportedAt = new Map<string, string>();
      for (const pack of packs) {
        packImportedAt.set(pack.key, pack.importedAt);
      }

      const presentAssetKeys = new Set<string>();
      for (const asset of assets) {
        presentAssetKeys.add(asset.assetKey);
        const expectedImportedAt = packImportedAt.get(asset.packKey) ?? '';
        const existing = activeObjectUrls.get(asset.assetKey);
        if (existing && existing.importedAt === expectedImportedAt) {
          continue;
        }
        if (existing) {
          URL.revokeObjectURL(existing.url);
        }
        activeObjectUrls.set(asset.assetKey, {
          url: URL.createObjectURL(asset.blob),
          importedAt: expectedImportedAt,
        });
      }

      for (const cachedKey of Array.from(activeObjectUrls.keys())) {
        if (!presentAssetKeys.has(cachedKey)) {
          revokeUrlEntry(cachedKey);
        }
      }

      const parsed = parseBundleFolders(
        packs.map((pack) => ({
          sourceId: pack.key,
          folderName: pack.folderName,
          filenames: pack.filenames,
        })),
        {
          tileFaceUrl: ({ sourceId, filename }) =>
            activeObjectUrls.get(`${sourceId}/${filename}`)?.url ?? '',
          overlayUrl: ({ sourceId, filename }) =>
            activeObjectUrls.get(`${sourceId}/${filename}`)?.url ?? '',
        },
      );

      const tilesets: Tileset[] = parsed.tilesets.map(
        ({ id, name, shortCode, tiles }) => ({ id, name, shortCode, tiles }),
      );
      const overlayPacks: OverlayPack[] = parsed.overlayPacks.map(
        ({ id, name, shortCode, pairedTilesetId, overlays }) => ({
          id,
          name,
          shortCode,
          pairedTilesetId,
          overlays,
        }),
      );

      return {
        tilesets,
        overlayPacks,
        bundleConfigured: packs.length > 0,
      };
    },

    async listStoredPacks(): Promise<StoredPackSummary[]> {
      const db = await getDb();
      const packs = await readAllPacks(db);
      const packByKey = new Map(packs.map((p) => [p.key, p]));

      const parsed = parseBundleFolders(
        packs.map((pack) => ({
          sourceId: pack.key,
          folderName: pack.folderName,
          filenames: pack.filenames,
        })),
        {
          tileFaceUrl: () => '',
          overlayUrl: () => '',
        },
      );

      const summaries: StoredPackSummary[] = [];
      for (const ts of parsed.tilesets) {
        const record = packByKey.get(ts.sourceId);
        if (!record) continue;
        summaries.push({
          key: record.key,
          kind: 'tileset',
          id: ts.id,
          name: ts.name,
          shortCode: ts.shortCode,
          itemCount: ts.tiles.length,
          fileCount: record.filenames.length,
          totalBytes: record.totalBytes,
          importedAt: record.importedAt,
        });
      }

      for (const ov of parsed.overlayPacks) {
        const record = packByKey.get(ov.sourceId);
        if (!record) continue;
        summaries.push({
          key: record.key,
          kind: 'overlayPack',
          id: ov.id,
          name: ov.name,
          shortCode: ov.shortCode,
          itemCount: ov.overlays.length,
          fileCount: record.filenames.length,
          totalBytes: record.totalBytes,
          importedAt: record.importedAt,
        });
      }

      return summaries;
    },

    async saveImportedPacks(
      packs: readonly ImportedPackInput[],
      onProgress?: (progress: SaveImportedPacksProgress) => void,
    ): Promise<SaveImportedPacksResult> {
      const db = await getDb();
      const keys = assignBatchKeys(packs);
      const total = packs.reduce((sum, pack) => sum + pack.files.length, 0);

      let written = 0;
      let tilesetCount = 0;
      let overlayPackCount = 0;
      let totalBytes = 0;
      const packNames: string[] = [];

      for (let i = 0; i < packs.length; i++) {
        const pack = packs[i];
        const packKey = keys[i];
        const packName = displayPackName(pack);
        packNames.push(packName);

        await deleteAssetsForPack(db, packKey);

        const filenames: string[] = [];
        let packBytes = 0;

        for (let offset = 0; offset < pack.files.length; offset += ASSET_WRITE_BATCH_SIZE) {
          const batch = pack.files.slice(offset, offset + ASSET_WRITE_BATCH_SIZE);
          const tx = db.transaction(ASSETS_STORE, 'readwrite');
          const store = tx.objectStore(ASSETS_STORE);
          for (const file of batch) {
            filenames.push(file.filename);
            packBytes += file.blob.size;
            const record: StoredAssetRecord = {
              assetKey: `${packKey}/${file.filename}`,
              packKey,
              filename: file.filename,
              blob: file.blob,
            };
            store.put(record);
          }
          await transactionDone(tx);
          written += batch.length;
          onProgress?.({ current: written, total, packName });
        }

        const packRecord: StoredPackRecord = {
          key: packKey,
          kind: pack.kind,
          folderName: pack.folderName,
          filenames,
          totalBytes: packBytes,
          importedAt: new Date().toISOString(),
        };
        const packTx = db.transaction(PACKS_STORE, 'readwrite');
        packTx.objectStore(PACKS_STORE).put(packRecord);
        await transactionDone(packTx);

        if (pack.kind === 'tileset') {
          tilesetCount += 1;
        } else {
          overlayPackCount += 1;
        }
        totalBytes += packBytes;
      }

      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        void navigator.storage.persist().catch(() => false);
      }

      return {
        tilesetCount,
        overlayPackCount,
        imageCount: written,
        totalBytes,
        packNames,
      };
    },

    async deleteStoredPack(packKey: string): Promise<void> {
      const db = await getDb();
      await deleteAssetsForPack(db, packKey);
      const tx = db.transaction(PACKS_STORE, 'readwrite');
      tx.objectStore(PACKS_STORE).delete(packKey);
      await transactionDone(tx);
    },

    async clearAllStoredPacks(): Promise<void> {
      const db = await getDb();
      const tx = db.transaction([PACKS_STORE, ASSETS_STORE], 'readwrite');
      tx.objectStore(PACKS_STORE).clear();
      tx.objectStore(ASSETS_STORE).clear();
      await transactionDone(tx);
      revokeAllUrls();
    },

    async fetchCollection(
      discoveredTilesetIds?: readonly string[],
      discoveredOverlayPackIds?: readonly string[],
    ): Promise<Collection> {
      const db = await getDb();
      const tx = db.transaction(META_STORE, 'readonly');
      const record = (await requestToPromise(
        tx.objectStore(META_STORE).get(COLLECTION_META_KEY),
      )) as MetaRecord | undefined;
      await transactionDone(tx);

      const normalized = record ? normalizeCollection(record.value) : null;
      const stored: Collection = normalized ?? {
        version: 2,
        tilesets: {},
        overlayPacks: {},
      };

      const ids =
        discoveredTilesetIds !== undefined && discoveredOverlayPackIds !== undefined
          ? { tilesetIds: discoveredTilesetIds, overlayPackIds: discoveredOverlayPackIds }
          : await getDiscoveredIds(db);

      return mergeCollectionDefaults(stored, ids.tilesetIds, ids.overlayPackIds);
    },

    async saveCollection(
      collection: Collection,
      discoveredTilesetIds?: readonly string[],
      discoveredOverlayPackIds?: readonly string[],
    ): Promise<Collection> {
      const validated = validateCollection(collection);
      if (!validated) {
        throw new Error(
          'Collection must be a v2 object with version: 2, tilesets, and overlayPacks mapping IDs to non-negative integers',
        );
      }

      const db = await getDb();
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put({ key: COLLECTION_META_KEY, value: validated } satisfies MetaRecord);
      await transactionDone(tx);

      const ids =
        discoveredTilesetIds !== undefined && discoveredOverlayPackIds !== undefined
          ? { tilesetIds: discoveredTilesetIds, overlayPackIds: discoveredOverlayPackIds }
          : await getDiscoveredIds(db);

      return mergeCollectionDefaults(validated, ids.tilesetIds, ids.overlayPackIds);
    },

    async fetchMaps(): Promise<MapSummary[]> {
      const db = await getDb();
      const tx = db.transaction(MAPS_STORE, 'readonly');
      const rawRecords = (await requestToPromise(
        tx.objectStore(MAPS_STORE).getAll(),
      )) as Array<Record<string, unknown>>;
      await transactionDone(tx);

      const summaries: MapSummary[] = [];
      for (const parsed of rawRecords) {
        if (!parsed || typeof parsed !== 'object') continue;
        const placements = validatePlacements(parsed.placements);
        if (
          (parsed.version === 1 || parsed.version === 2) &&
          typeof parsed.id === 'string' &&
          SAFE_MAP_ID_RE.test(parsed.id) &&
          typeof parsed.name === 'string' &&
          placements
        ) {
          summaries.push(
            toMapSummary({
              version: 2,
              id: parsed.id,
              name: parsed.name,
              createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
              updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
              placements,
            }),
          );
        }
      }

      return summaries.sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name),
      );
    },

    async fetchMap(id: string): Promise<MapDocument | null> {
      if (!SAFE_MAP_ID_RE.test(id)) return null;
      const db = await getDb();
      const tx = db.transaction(MAPS_STORE, 'readonly');
      const parsed = (await requestToPromise(
        tx.objectStore(MAPS_STORE).get(id),
      )) as Record<string, unknown> | undefined;
      await transactionDone(tx);

      if (!parsed || typeof parsed !== 'object') return null;
      const placements = validatePlacements(parsed.placements);
      if (
        (parsed.version !== 1 && parsed.version !== 2) ||
        !placements ||
        typeof parsed.name !== 'string' ||
        typeof parsed.id !== 'string'
      ) {
        return null;
      }

      return {
        version: 2,
        id: parsed.id,
        name: parsed.name,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        placements,
      };
    },

    async createMap(name: string, placements: readonly Placement[] = []): Promise<MapDocument> {
      const db = await getDb();
      const trimmedName = name.trim() || 'Untitled Map';
      const id = generateMapId(trimmedName);
      const now = new Date().toISOString();
      const normalizedPlacements = validatePlacements(placements) ?? [];
      const doc: MapDocument = {
        version: 2,
        id,
        name: trimmedName,
        createdAt: now,
        updatedAt: now,
        placements: normalizedPlacements,
      };
      const diskDoc: MapDocument = {
        ...doc,
        placements: normalizedPlacements.map(compactPlacement),
      };

      const tx = db.transaction(MAPS_STORE, 'readwrite');
      tx.objectStore(MAPS_STORE).put(diskDoc);
      await transactionDone(tx);
      return doc;
    },

    async saveMap(
      id: string,
      name: string,
      placements: readonly Placement[],
    ): Promise<MapDocument> {
      const existing = await this.fetchMap(id);
      if (!existing) {
        throw new Error('Map not found');
      }

      const normalizedPlacements = validatePlacements(placements);
      if (!normalizedPlacements) {
        throw new Error('Invalid Placements array');
      }

      const updated: MapDocument = {
        version: 2,
        id: existing.id,
        name: name.trim() || existing.name,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        placements: normalizedPlacements,
      };
      const diskDoc: MapDocument = {
        ...updated,
        placements: normalizedPlacements.map(compactPlacement),
      };

      const db = await getDb();
      const tx = db.transaction(MAPS_STORE, 'readwrite');
      tx.objectStore(MAPS_STORE).put(diskDoc);
      await transactionDone(tx);
      return updated;
    },

    async deleteMap(id: string): Promise<boolean> {
      if (!SAFE_MAP_ID_RE.test(id)) return false;
      const db = await getDb();
      const tx = db.transaction(MAPS_STORE, 'readwrite');
      const store = tx.objectStore(MAPS_STORE);
      const existing = await requestToPromise(store.getKey(id));
      if (existing === undefined) {
        await transactionDone(tx);
        return false;
      }
      store.delete(id);
      await transactionDone(tx);
      return true;
    },

    dispose(): void {
      revokeAllUrls();
      if (openDb) {
        openDb.close();
        openDb = null;
      }
      dbPromise = null;
    },
  };
}
