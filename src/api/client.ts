import type {
  Collection,
  MapDocument,
  MapSummary,
  Placement,
  TilesetListResponse,
} from '../domain/types';
import {
  createBrowserStorage,
  type BrowserStorage,
  type ImportedPackInput,
  type StoredPackSummary,
} from '../storage/browserStorage';
import {
  preparePacksFromDataTransfer,
  preparePacksFromFileList,
  type ImportBundleResult,
  type ImportProgress,
} from '../storage/bundleImporter';

export type StorageMode = 'server' | 'browser';
export type { ImportBundleResult, ImportProgress, StoredPackSummary };

let resolvedMode: StorageMode | null = null;
let modePromise: Promise<StorageMode> | null = null;
let cachedInitialServerTilesets: TilesetListResponse | null = null;
let browserStorageInstance: BrowserStorage | null = null;

function getBrowserStorage(): BrowserStorage {
  if (!browserStorageInstance) {
    browserStorageInstance = createBrowserStorage();
  }
  return browserStorageInstance;
}

export function getStorageMode(): StorageMode | null {
  return resolvedMode;
}

async function resolveStorageMode(): Promise<StorageMode> {
  const configured = import.meta.env.VITE_STORAGE_MODE;
  if (configured === 'browser') {
    resolvedMode = 'browser';
    return 'browser';
  }
  if (configured === 'server') {
    resolvedMode = 'server';
    return 'server';
  }

  try {
    const res = await fetch('/api/tilesets');
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (res.ok && contentType.includes('application/json')) {
      const payload = (await res.json()) as TilesetListResponse;
      if (payload && Array.isArray(payload.tilesets)) {
        cachedInitialServerTilesets = payload;
        resolvedMode = 'server';
        return 'server';
      }
    }
  } catch {
    // No API middleware reachable; fall back to browser-local storage.
  }

  resolvedMode = 'browser';
  return 'browser';
}

export function initStorageMode(): Promise<StorageMode> {
  if (resolvedMode !== null) {
    return Promise.resolve(resolvedMode);
  }
  if (!modePromise) {
    modePromise = resolveStorageMode();
  }
  return modePromise;
}

export async function fetchTilesets(): Promise<TilesetListResponse> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().fetchTilesets();
  }
  if (cachedInitialServerTilesets !== null) {
    const cached = cachedInitialServerTilesets;
    cachedInitialServerTilesets = null;
    return cached;
  }
  const res = await fetch('/api/tilesets');
  if (!res.ok) {
    throw new Error(`Failed to fetch tilesets (${res.status})`);
  }
  return res.json() as Promise<TilesetListResponse>;
}

export async function fetchCollection(): Promise<Collection> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().fetchCollection();
  }
  const res = await fetch('/api/collection');
  if (!res.ok) {
    throw new Error(`Failed to fetch collection (${res.status})`);
  }
  const body = (await res.json()) as { collection: Collection };
  return body.collection;
}

export async function saveCollection(collection: Collection): Promise<Collection> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().saveCollection(collection);
  }
  const res = await fetch('/api/collection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save collection (${res.status})`);
  }
  const body = (await res.json()) as { collection: Collection };
  return body.collection;
}

export async function fetchMaps(): Promise<MapSummary[]> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().fetchMaps();
  }
  const res = await fetch('/api/maps');
  if (!res.ok) {
    throw new Error(`Failed to list maps (${res.status})`);
  }
  const body = (await res.json()) as { maps: MapSummary[] };
  return body.maps;
}

export async function fetchMap(id: string): Promise<MapDocument> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    const doc = await getBrowserStorage().fetchMap(id);
    if (!doc) {
      throw new Error('Failed to load map (404)');
    }
    return doc;
  }
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to load map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function createMap(
  name: string,
  placements: readonly Placement[] = [],
): Promise<MapDocument> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().createMap(name, placements);
  }
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, placements }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function saveMap(
  id: string,
  name: string,
  placements: readonly Placement[],
): Promise<MapDocument> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    return getBrowserStorage().saveMap(id, name, placements);
  }
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, placements }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function deleteMap(id: string): Promise<void> {
  const mode = await initStorageMode();
  if (mode === 'browser') {
    const deleted = await getBrowserStorage().deleteMap(id);
    if (!deleted) {
      throw new Error('Failed to delete map (404)');
    }
    return;
  }
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete map (${res.status})`);
  }
}

export async function listStoredPacks(): Promise<StoredPackSummary[]> {
  const mode = await initStorageMode();
  if (mode !== 'browser') return [];
  return getBrowserStorage().listStoredPacks();
}

async function savePreparedPacks(
  packs: readonly ImportedPackInput[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportBundleResult> {
  return getBrowserStorage().saveImportedPacks(packs, (progress) => {
    onProgress?.({
      phase: 'storing',
      message: `Saving ${progress.packName} (${progress.current} / ${progress.total})…`,
      current: progress.current,
      total: progress.total,
    });
  });
}

export async function importBundleFromFiles(
  files: FileList | readonly File[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportBundleResult> {
  const packs = await preparePacksFromFileList(files, onProgress);
  return savePreparedPacks(packs, onProgress);
}

export async function importBundleFromDataTransfer(
  dataTransfer: DataTransfer,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportBundleResult> {
  const packs = await preparePacksFromDataTransfer(dataTransfer, onProgress);
  return savePreparedPacks(packs, onProgress);
}

export async function deleteStoredPack(packKey: string): Promise<void> {
  const mode = await initStorageMode();
  if (mode !== 'browser') return;
  await getBrowserStorage().deleteStoredPack(packKey);
}

export async function clearStoredBundle(): Promise<void> {
  const mode = await initStorageMode();
  if (mode !== 'browser') return;
  await getBrowserStorage().clearAllStoredPacks();
}
