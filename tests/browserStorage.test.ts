import 'fake-indexeddb/auto';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAY_PACK_COPIES,
  DEFAULT_TILESET_COPIES,
  type Placement,
} from '../src/domain/types';
import { createBrowserStorage, type BrowserStorage } from '../src/storage/browserStorage';
import { extractPacksFromZipBlob, formatBytes } from '../src/storage/bundleImporter';

const TINY_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

function makePngBlob(extraByte = 0): Blob {
  const bytes = new Uint8Array(TINY_PNG_BYTES.length + 1);
  bytes.set(TINY_PNG_BYTES, 0);
  bytes[TINY_PNG_BYTES.length] = extraByte;
  return new Blob([bytes], { type: 'image/png' });
}

async function buildZipBlob(entries: ReadonlyArray<{ path: string; data: Uint8Array }>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  for (const entry of entries) {
    await writer.add(entry.path, new Uint8ArrayReader(entry.data));
  }
  return writer.close();
}

let dbCounter = 0;
function nextDbName(): string {
  dbCounter += 1;
  return `rb-test-db-${Date.now()}-${dbCounter}`;
}

describe('bundleImporter - zip extraction', () => {
  it('extracts Tileset and Overlay Pack folders from a nested zip while skipping __MACOSX and AppleDouble files', async () => {
    const zipBlob = await buildZipBlob([
      {
        path: 'Realm Brew v0.2/0 • Realm Brew - Man Hewn Dungeons Tiles/RB Man Hewn Dungeons - Digital Tiles_01.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: 'Realm Brew v0.2/0 • Realm Brew - Man Hewn Dungeons Tiles/RB Man Hewn Dungeons - Digital Tiles_02.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: 'Realm Brew v0.2/0 • Realm Brew - Man Hewn Dungeons Overlays/Bridge 1.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: 'Realm Brew v0.2/1 • Realm Brew - Goblins’ Hideout Overlays/Cage 1.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: '__MACOSX/Realm Brew v0.2/0 • Realm Brew - Man Hewn Dungeons Tiles/._RB Man Hewn Dungeons - Digital Tiles_01.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: 'Realm Brew v0.2/1 • Realm Brew - Goblins’ Hideout Overlays/._Cage 1.png',
        data: TINY_PNG_BYTES,
      },
      {
        path: 'Realm Brew v0.2/notes.txt',
        data: new TextEncoder().encode('ignore me'),
      },
    ]);

    const progressEvents: number[] = [];
    const packs = await extractPacksFromZipBlob(zipBlob, 'Realm Brew v0.2.zip', (p) => {
      if (p.current !== undefined) {
        progressEvents.push(p.current);
      }
    });

    expect(packs).toHaveLength(3);
    expect(packs.map((p) => ({ kind: p.kind, folderName: p.folderName, files: p.files.map((f) => f.filename) }))).toEqual([
      {
        kind: 'tileset',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
        files: [
          'RB Man Hewn Dungeons - Digital Tiles_01.png',
          'RB Man Hewn Dungeons - Digital Tiles_02.png',
        ],
      },
      {
        kind: 'overlayPack',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Overlays',
        files: ['Bridge 1.png'],
      },
      {
        kind: 'overlayPack',
        folderName: '1 • Realm Brew - Goblins’ Hideout Overlays',
        files: ['Cage 1.png'],
      },
    ]);
    expect(progressEvents).toEqual([1, 2, 3, 4]);
    expect(packs[0].files[0].blob.size).toBe(TINY_PNG_BYTES.length);
  });

  it('extracts a flat single-pack zip using its filename as fallback folder name', async () => {
    const zipBlob = await buildZipBlob([
      { path: 'Altar.png', data: TINY_PNG_BYTES },
      { path: 'Table.png', data: TINY_PNG_BYTES },
    ]);

    const packs = await extractPacksFromZipBlob(
      zipBlob,
      "1 • Realm Brew - Alchemists' Workshop Overlays.zip",
    );

    expect(packs).toHaveLength(1);
    expect(packs[0].kind).toBe('overlayPack');
    expect(packs[0].folderName).toBe("1 • Realm Brew - Alchemists' Workshop Overlays");
    expect(packs[0].files.map((f) => f.filename)).toEqual(['Altar.png', 'Table.png']);
  });

  it('formats byte sizes readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(194 * 1024 * 1024)).toBe('194.0 MB');
  });
});

describe('browserStorage - IndexedDB bundles, Collection, and Maps', () => {
  const openStorages: BrowserStorage[] = [];

  function makeStorage(): BrowserStorage {
    const storage = createBrowserStorage(nextDbName());
    openStorages.push(storage);
    return storage;
  }

  afterEach(() => {
    while (openStorages.length > 0) {
      openStorages.pop()!.dispose();
    }
  });

  it('returns unconfigured empty state initially and persists multi-batch bundle imports with blob URLs', async () => {
    const storage = makeStorage();

    const empty = await storage.fetchTilesets();
    expect(empty).toEqual({
      tilesets: [],
      overlayPacks: [],
      bundleConfigured: false,
    });

    // 20 tile faces ensures saveImportedPacks spans multiple 16-item batches
    const tileFiles = Array.from({ length: 20 }, (_, i) => ({
      filename: `MHD_${String(i + 1).padStart(2, '0')}.png`,
      blob: makePngBlob(i),
    }));

    const progressSnapshots: number[] = [];
    const importResult = await storage.saveImportedPacks(
      [
        {
          kind: 'tileset',
          folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
          files: tileFiles,
        },
        {
          kind: 'overlayPack',
          folderName: '0 • Realm Brew - Man Hewn Dungeons Overlays',
          files: [{ filename: 'Bridge 1.png', blob: makePngBlob(99) }],
        },
      ],
      (p) => progressSnapshots.push(p.current),
    );

    expect(importResult.tilesetCount).toBe(1);
    expect(importResult.overlayPackCount).toBe(1);
    expect(importResult.imageCount).toBe(21);
    expect(progressSnapshots).toEqual([16, 20, 21]);

    const loaded = await storage.fetchTilesets();
    expect(loaded.bundleConfigured).toBe(true);
    expect(loaded.tilesets).toHaveLength(1);
    expect(loaded.tilesets[0].id).toBe('man-hewn-dungeons');
    expect(loaded.tilesets[0].tiles).toHaveLength(10);
    expect(loaded.tilesets[0].tiles[0].faceA.url).toMatch(/^blob:/);
    expect(loaded.overlayPacks).toHaveLength(1);
    expect(loaded.overlayPacks[0].pairedTilesetId).toBe('man-hewn-dungeons');
    expect(loaded.overlayPacks[0].overlays[0].url).toMatch(/^blob:/);

    const summaries = await storage.listStoredPacks();
    expect(summaries.map((s) => ({ kind: s.kind, id: s.id, itemCount: s.itemCount, fileCount: s.fileCount }))).toEqual([
      { kind: 'tileset', id: 'man-hewn-dungeons', itemCount: 10, fileCount: 20 },
      { kind: 'overlayPack', id: 'man-hewn-dungeons', itemCount: 1, fileCount: 1 },
    ]);
  });

  it('merges updated packs without duplicating IDs, preserves other packs, and deletes cleanly', async () => {
    const storage = makeStorage();

    await storage.saveImportedPacks([
      {
        kind: 'tileset',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
        files: [
          { filename: 'MHD_01.png', blob: makePngBlob(1) },
          { filename: 'MHD_02.png', blob: makePngBlob(2) },
        ],
      },
    ]);

    // Re-import the same Tileset with a third face, plus a second Tileset
    await storage.saveImportedPacks([
      {
        kind: 'tileset',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
        files: [
          { filename: 'MHD_01.png', blob: makePngBlob(1) },
          { filename: 'MHD_02.png', blob: makePngBlob(2) },
          { filename: 'MHD_03.png', blob: makePngBlob(3) },
        ],
      },
      {
        kind: 'tileset',
        folderName: '0 • Realm Brew Underdark Caverns - Digital Tiles',
        files: [{ filename: 'UC_01.png', blob: makePngBlob(4) }],
      },
    ]);

    const afterMerge = await storage.fetchTilesets();
    expect(afterMerge.tilesets.map((t) => t.id)).toEqual([
      'man-hewn-dungeons',
      'underdark-caverns',
    ]);
    expect(afterMerge.tilesets[0].tiles).toHaveLength(2);

    await storage.deleteStoredPack('tileset:man-hewn-dungeons');
    const afterDelete = await storage.fetchTilesets();
    expect(afterDelete.tilesets.map((t) => t.id)).toEqual(['underdark-caverns']);
    expect(afterDelete.bundleConfigured).toBe(true);

    await storage.clearAllStoredPacks();
    const afterClear = await storage.fetchTilesets();
    expect(afterClear.tilesets).toEqual([]);
    expect(afterClear.bundleConfigured).toBe(false);
  });

  it('persists Collection defaults and performs Map CRUD with placement compaction', async () => {
    const storage = makeStorage();

    await storage.saveImportedPacks([
      {
        kind: 'tileset',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
        files: [{ filename: 'MHD_01.png', blob: makePngBlob(1) }],
      },
      {
        kind: 'overlayPack',
        folderName: "1 • Realm Brew - Alchemists' Workshop Overlays",
        files: [{ filename: 'Table.png', blob: makePngBlob(2) }],
      },
    ]);

    const defaultCollection = await storage.fetchCollection();
    expect(defaultCollection).toEqual({
      version: 2,
      tilesets: { 'man-hewn-dungeons': DEFAULT_TILESET_COPIES },
      overlayPacks: { 'alchemists-workshop': DEFAULT_OVERLAY_PACK_COPIES },
    });

    const savedCollection = await storage.saveCollection({
      version: 2,
      tilesets: { 'man-hewn-dungeons': 3 },
      overlayPacks: { 'alchemists-workshop': 1 },
    });
    expect(savedCollection).toEqual({
      version: 2,
      tilesets: { 'man-hewn-dungeons': 3 },
      overlayPacks: { 'alchemists-workshop': 1 },
    });

    const placement: Placement = {
      q: 1,
      r: -1,
      tilesetId: 'man-hewn-dungeons',
      tileId: '01-01',
      faceNumber: 1,
      rotation: 2,
      covered: true,
      overlays: [
        {
          id: 'ov-1',
          overlayPackId: 'alchemists-workshop',
          overlayId: 'table',
          offsetX: 0.25,
          offsetY: -0.15,
          rotationDeg: 45,
        },
      ],
    };

    const created = await storage.createMap('Crypt Entrance', [placement]);
    expect(created.name).toBe('Crypt Entrance');
    expect(created.placements).toEqual([placement]);

    const list = await storage.fetchMaps();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: created.id,
      name: 'Crypt Entrance',
      placementCount: 1,
      overlayCount: 1,
    });

    const loaded = await storage.fetchMap(created.id);
    expect(loaded).toEqual(created);

    const updated = await storage.saveMap(created.id, 'Crypt Level 1', []);
    expect(updated.name).toBe('Crypt Level 1');
    expect(updated.placements).toEqual([]);

    expect(await storage.deleteMap(created.id)).toBe(true);
    expect(await storage.deleteMap(created.id)).toBe(false);
    expect(await storage.fetchMap(created.id)).toBeNull();
  });
});
