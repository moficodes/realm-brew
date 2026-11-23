import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApiHandler } from '../src/server/middleware';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startTestServer(bundleDir: string | undefined, dataDir: string): Promise<RunningServer> {
  const handler = createApiHandler({ bundleDir, dataDir });
  const server = http.createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function populateTilesetFolder(
  bundleDir: string,
  folderName: string,
  filePrefix: string,
  count: number,
): void {
  const dir = path.join(bundleDir, folderName);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const padded = String(i).padStart(2, '0');
    fs.writeFileSync(path.join(dir, `${filePrefix}_${padded}.png`), TINY_PNG);
  }
}

describe('Middleware HTTP API (Seam 1 - Tilesets & Assets)', () => {
  const cleanupDirs: string[] = [];
  const openServers: RunningServer[] = [];

  afterEach(async () => {
    while (openServers.length > 0) {
      await openServers.pop()!.close();
    }
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('discovers *Tiles folders, ignores *Overlays, normalizes slugs & shortCodes, and pairs odd/even + odd tail', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'RB Man Hewn Dungeons - Digital Tiles', 37);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Subterranean Rivers - Digital Tiles', 'Subterranean Rivers - Digital Tiles', 4);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Underdark Caverns - Digital Tiles', 'Realm Brew Underdark Caverns - Digital Tiles', 2);
    // Should also match folders ending in Tiles without space, while ignoring Overlays
    populateTilesetFolder(bundleDir, 'CaveTiles', 'Cave', 2);
    const overlaysDir = path.join(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Overlays');
    fs.mkdirSync(overlaysDir, { recursive: true });
    fs.writeFileSync(path.join(overlaysDir, 'Bridge 1.png'), TINY_PNG);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bundleConfigured).toBe(true);
    expect(body.tilesets.map((t: { id: string; name: string; shortCode: string }) => ({
      id: t.id,
      name: t.name,
      shortCode: t.shortCode,
    }))).toEqual([
      { id: 'cave', name: 'Cave', shortCode: 'CAV' },
      { id: 'man-hewn-dungeons', name: 'Man Hewn Dungeons', shortCode: 'MHD' },
      { id: 'subterranean-rivers', name: 'Subterranean Rivers', shortCode: 'SR' },
      { id: 'underdark-caverns', name: 'Underdark Caverns', shortCode: 'UC' },
    ]);

    const mhd = body.tilesets[1];
    expect(mhd.tiles).toHaveLength(19);
    expect(mhd.tiles[0]).toMatchObject({
      tileId: '01-02',
      tilesetId: 'man-hewn-dungeons',
      isSymmetric: false,
      faceA: { faceNumber: 1, label: '01' },
      faceB: { faceNumber: 2, label: '02' },
    });
    expect(mhd.tiles[18]).toMatchObject({
      tileId: '37-37',
      tilesetId: 'man-hewn-dungeons',
      isSymmetric: true,
      faceA: { faceNumber: 37, label: '37' },
      faceB: { faceNumber: 37, label: '37' },
    });
  });

  it('disambiguates colliding shortCodes deterministically', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '1 • Realm Brew - Deep Caves Tiles', 'Deep Caves', 2);
    populateTilesetFolder(bundleDir, '2 • Realm Brew - Dark Crypts Tiles', 'Dark Crypts', 2);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    const body = await res.json();
    expect(body.tilesets.map((t: { shortCode: string }) => t.shortCode)).toEqual(['DC', 'DC2']);
  });

  it('streams Tile Face PNGs safely and rejects path traversal or unknown files with 404', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'RB Man Hewn Dungeons - Digital Tiles', 2);
    fs.writeFileSync(path.join(bundleDir, 'secret.png'), Buffer.from('not-allowed'));

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const manifestRes = await fetch(`${srv.baseUrl}/api/tilesets`);
    const manifest = await manifestRes.json();
    const faceUrl: string = manifest.tilesets[0].tiles[0].faceA.url;

    const pngRes = await fetch(`${srv.baseUrl}${faceUrl}`);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await pngRes.arrayBuffer());
    expect(buf.equals(TINY_PNG)).toBe(true);

    const missingRes = await fetch(`${srv.baseUrl}/api/assets/man-hewn-dungeons/does-not-exist.png`);
    expect(missingRes.status).toBe(404);

    const traversalRes = await fetch(`${srv.baseUrl}/api/assets/man-hewn-dungeons/..%2Fsecret.png`);
    expect(traversalRes.status).toBe(404);
  });

  it('reports bundleConfigured=false cleanly when bundle directory is missing', async () => {
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(dataDir);

    const srv = await startTestServer(path.join(dataDir, 'missing-bundle'), dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bundleConfigured).toBe(false);
    expect(body.tilesets).toEqual([]);
    expect(body.overlayPacks).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});

function populateOverlayFolder(
  bundleDir: string,
  folderName: string,
  filenames: readonly string[],
): void {
  const dir = path.join(bundleDir, folderName);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of filenames) {
    fs.writeFileSync(path.join(dir, name), TINY_PNG);
  }
}

describe('Middleware HTTP API (Seam 1 - Overlay Packs & Overlay Assets)', () => {
  const cleanupDirs: string[] = [];
  const openServers: RunningServer[] = [];

  afterEach(async () => {
    while (openServers.length > 0) {
      await openServers.pop()!.close();
    }
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('returns overlayPacks: [] cleanly on a Tiles-only bundle', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 2);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bundleConfigured).toBe(true);
    expect(body.tilesets).toHaveLength(1);
    expect(body.overlayPacks).toEqual([]);
  });

  it('discovers *Overlays folders with apostrophe-free slugs, unique short codes, paired hints, and paired-first ordering without altering v1 Tileset slugs', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 2);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Subterranean Rivers - Digital Tiles', 'SR', 2);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Underdark Caverns - Digital Tiles', 'UC', 2);
    populateTilesetFolder(bundleDir, "0 • Wizard's Keep Tiles", 'WK', 2);

    populateOverlayFolder(bundleDir, '0 • Realm Brew Underdark Caverns - Digital Overlays', ['Chasm 1.png']);
    populateOverlayFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Overlays', ['Bridge 1.png']);
    populateOverlayFolder(bundleDir, '0 • Realm Brew Subterranean Rivers - Digital Overlays', ['Raft 1.png']);
    populateOverlayFolder(bundleDir, "3 • Realm Brew - Red Dragon's Lair - Digital Overlays", ['Hoard 1.png']);
    populateOverlayFolder(bundleDir, '2 • Realm Brew - Goblins’ Hideout Overlays', ['Cage 1.png']);
    populateOverlayFolder(bundleDir, "1 • Realm Brew - Alchemists' Workshop Overlays", ['Table 1.png']);
    populateOverlayFolder(bundleDir, '4 • Dark Crypts Overlays', ['Coffin 1.png']);
    populateOverlayFolder(bundleDir, '5 • Deep Caves Overlays', ['Stalagmite 1.png']);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // v1 Tileset slug keeps apostrophe split behavior untouched
    expect(body.tilesets.map((t: { id: string }) => t.id)).toEqual([
      'man-hewn-dungeons',
      'subterranean-rivers',
      'underdark-caverns',
      'wizard-s-keep',
    ]);

    // Paired packs first matching Tileset order, then standalone alphabetically
    expect(
      body.overlayPacks.map((p: { id: string; name: string; shortCode: string; pairedTilesetId: string | null }) => ({
        id: p.id,
        name: p.name,
        shortCode: p.shortCode,
        pairedTilesetId: p.pairedTilesetId,
      })),
    ).toEqual([
      {
        id: 'man-hewn-dungeons',
        name: 'Man Hewn Dungeons',
        shortCode: 'MHD',
        pairedTilesetId: 'man-hewn-dungeons',
      },
      {
        id: 'subterranean-rivers',
        name: 'Subterranean Rivers',
        shortCode: 'SR',
        pairedTilesetId: 'subterranean-rivers',
      },
      {
        id: 'underdark-caverns',
        name: 'Underdark Caverns',
        shortCode: 'UC',
        pairedTilesetId: 'underdark-caverns',
      },
      {
        id: 'alchemists-workshop',
        name: "Alchemists' Workshop",
        shortCode: 'AW',
        pairedTilesetId: null,
      },
      {
        id: 'dark-crypts',
        name: 'Dark Crypts',
        shortCode: 'DC',
        pairedTilesetId: null,
      },
      {
        id: 'deep-caves',
        name: 'Deep Caves',
        shortCode: 'DC2',
        pairedTilesetId: null,
      },
      {
        id: 'goblins-hideout',
        name: 'Goblins’ Hideout',
        shortCode: 'GH',
        pairedTilesetId: null,
      },
      {
        id: 'red-dragons-lair',
        name: "Red Dragon's Lair",
        shortCode: 'RDL',
        pairedTilesetId: null,
      },
    ]);
  });

  it('natural-sorts Overlays, handles collision-safe overlayIds, and streams /api/overlay-assets with traversal 404 guards', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateOverlayFolder(bundleDir, "1 • Realm Brew - Alchemists' Workshop Overlays", [
      'Door 10.png',
      'Door 2.png',
      'Door 2 (Open).png',
      "Altar's Flame.png",
      'Altars Flame.png',
    ]);
    fs.writeFileSync(
      path.join(bundleDir, "1 • Realm Brew - Alchemists' Workshop Overlays", 'readme.txt'),
      'ignore me',
    );
    fs.writeFileSync(path.join(bundleDir, 'secret.png'), Buffer.from('not-allowed'));

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const res = await fetch(`${srv.baseUrl}/api/tilesets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overlayPacks).toHaveLength(1);

    const pack = body.overlayPacks[0];
    expect(pack.overlays.map((o: { overlayId: string; label: string; filename: string }) => ({
      overlayId: o.overlayId,
      label: o.label,
      filename: o.filename,
    }))).toEqual([
      { overlayId: 'altars-flame', label: "Altar's Flame", filename: "Altar's Flame.png" },
      { overlayId: 'altars-flame-2', label: 'Altars Flame', filename: 'Altars Flame.png' },
      { overlayId: 'door-2', label: 'Door 2', filename: 'Door 2.png' },
      { overlayId: 'door-2-open', label: 'Door 2 (Open)', filename: 'Door 2 (Open).png' },
      { overlayId: 'door-10', label: 'Door 10', filename: 'Door 10.png' },
    ]);

    const door2Res = await fetch(`${srv.baseUrl}${pack.overlays[2].url}`);
    expect(door2Res.status).toBe(200);
    expect(door2Res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await door2Res.arrayBuffer()).equals(TINY_PNG)).toBe(true);

    const altarRes = await fetch(`${srv.baseUrl}${pack.overlays[0].url}`);
    expect(altarRes.status).toBe(200);

    expect((await fetch(`${srv.baseUrl}/api/overlay-assets/alchemists-workshop/readme.txt`)).status).toBe(404);
    expect((await fetch(`${srv.baseUrl}/api/overlay-assets/alchemists-workshop/missing.png`)).status).toBe(404);
    expect((await fetch(`${srv.baseUrl}/api/overlay-assets/alchemists-workshop/..%2Fsecret.png`)).status).toBe(404);
    expect((await fetch(`${srv.baseUrl}/api/overlay-assets/unknown-pack/Door%202.png`)).status).toBe(404);
  });
});

describe('Middleware HTTP API (Seam 1 - Collection Persistence)', () => {
  const cleanupDirs: string[] = [];
  const openServers: RunningServer[] = [];

  afterEach(async () => {
    while (openServers.length > 0) {
      await openServers.pop()!.close();
    }
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('bootstraps newly discovered Tilesets and Overlay Packs to 2 copies and persists v2 PUT updates to collection.json', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 4);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Subterranean Rivers - Digital Tiles', 'SR', 2);
    populateOverlayFolder(bundleDir, "1 • Realm Brew - Alchemists' Workshop Overlays", ['Table 1.png']);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const getInitial = await fetch(`${srv.baseUrl}/api/collection`);
    expect(getInitial.status).toBe(200);
    expect(await getInitial.json()).toEqual({
      collection: {
        version: 2,
        tilesets: {
          'man-hewn-dungeons': 2,
          'subterranean-rivers': 2,
        },
        overlayPacks: {
          'alchemists-workshop': 2,
        },
      },
    });

    const putRes = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: {
          version: 2,
          tilesets: {
            'man-hewn-dungeons': 1,
            'subterranean-rivers': 0,
          },
          overlayPacks: {
            'alchemists-workshop': 0,
          },
        },
      }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      collection: {
        version: 2,
        tilesets: {
          'man-hewn-dungeons': 1,
          'subterranean-rivers': 0,
        },
        overlayPacks: {
          'alchemists-workshop': 0,
        },
      },
    });

    // Verify structured v2 JSON file exists on disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'collection.json'), 'utf8'));
    expect(onDisk).toEqual({
      version: 2,
      tilesets: {
        'man-hewn-dungeons': 1,
        'subterranean-rivers': 0,
      },
      overlayPacks: {
        'alchemists-workshop': 0,
      },
    });

    // Adding a new Tileset and Overlay Pack later defaults only the new ones to 2
    populateTilesetFolder(bundleDir, '0 • Realm Brew Underdark Caverns - Digital Tiles', 'UC', 2);
    populateOverlayFolder(bundleDir, "3 • Realm Brew - Red Dragon's Lair Overlays", ['Hoard 1.png']);
    const getAfterNew = await fetch(`${srv.baseUrl}/api/collection`);
    expect(await getAfterNew.json()).toEqual({
      collection: {
        version: 2,
        tilesets: {
          'man-hewn-dungeons': 1,
          'subterranean-rivers': 0,
          'underdark-caverns': 2,
        },
        overlayPacks: {
          'alchemists-workshop': 0,
          'red-dragons-lair': 2,
        },
      },
    });
  });

  it('auto-migrates flat v1 collection.json on read and preserves unknown pack keys across absent bundles', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 2);
    populateOverlayFolder(bundleDir, "1 • Realm Brew - Alchemists' Workshop Overlays", ['Table 1.png']);

    const flatV1Raw = JSON.stringify({
      'man-hewn-dungeons': 1,
      'absent-tileset': 4,
    });
    fs.writeFileSync(path.join(dataDir, 'collection.json'), flatV1Raw, 'utf8');

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const migratedRes = await fetch(`${srv.baseUrl}/api/collection`);
    expect(migratedRes.status).toBe(200);
    expect(await migratedRes.json()).toEqual({
      collection: {
        version: 2,
        tilesets: {
          'man-hewn-dungeons': 1,
          'absent-tileset': 4,
        },
        overlayPacks: {
          'alchemists-workshop': 2,
        },
      },
    });
    // Read must not rewrite existing v1 collection.json on disk
    expect(fs.readFileSync(path.join(dataDir, 'collection.json'), 'utf8')).toBe(flatV1Raw);

    // Writing v2 with an absent overlayPack preserves both absent tileset and absent overlayPack keys
    const putRes = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: {
          version: 2,
          tilesets: {
            'man-hewn-dungeons': 1,
            'absent-tileset': 4,
          },
          overlayPacks: {
            'alchemists-workshop': 3,
            'absent-overlay-pack': 5,
          },
        },
      }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      collection: {
        version: 2,
        tilesets: {
          'man-hewn-dungeons': 1,
          'absent-tileset': 4,
        },
        overlayPacks: {
          'alchemists-workshop': 3,
          'absent-overlay-pack': 5,
        },
      },
    });
  });

  it('rejects flat v1, negative, fractional, or malformed Collection payloads on PUT with 400', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);
    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 2);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const flatPayload = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: { 'man-hewn-dungeons': 1 } }),
    });
    expect(flatPayload.status).toBe(400);

    const missingOverlayPacks = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: { version: 2, tilesets: { 'man-hewn-dungeons': 1 } } }),
    });
    expect(missingOverlayPacks.status).toBe(400);

    const neg = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: { version: 2, tilesets: { 'man-hewn-dungeons': -1 }, overlayPacks: {} },
      }),
    });
    expect(neg.status).toBe(400);

    const floatRes = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: { version: 2, tilesets: {}, overlayPacks: { aw: 1.5 } },
      }),
    });
    expect(floatRes.status).toBe(400);

    const badShape = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'nope' }),
    });
    expect(badShape.status).toBe(400);
  });
});

describe('Middleware HTTP API (Seam 1 - Map CRUD Persistence)', () => {
  const cleanupDirs: string[] = [];
  const openServers: RunningServer[] = [];

  afterEach(async () => {
    while (openServers.length > 0) {
      await openServers.pop()!.close();
    }
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('creates, lists, reads, updates, and deletes Map JSON documents on disk', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const listEmpty = await fetch(`${srv.baseUrl}/api/maps`);
    expect(listEmpty.status).toBe(200);
    expect(await listEmpty.json()).toEqual({ maps: [] });

    const createRes = await fetch(`${srv.baseUrl}/api/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Session 4 Crypt',
        placements: [
          { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 2 },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.version).toBe(2);
    expect(created.name).toBe('Session 4 Crypt');
    expect(created.placements).toHaveLength(1);
    expect(fs.existsSync(path.join(dataDir, 'maps', `${created.id}.json`))).toBe(true);

    const listOne = await fetch(`${srv.baseUrl}/api/maps`);
    const listBody = await listOne.json();
    expect(listBody.maps).toHaveLength(1);
    expect(listBody.maps[0]).toMatchObject({
      id: created.id,
      name: 'Session 4 Crypt',
      placementCount: 1,
      overlayCount: 0,
    });

    const getOne = await fetch(`${srv.baseUrl}/api/maps/${created.id}`);
    expect(getOne.status).toBe(200);
    expect((await getOne.json()).name).toBe('Session 4 Crypt');

    const putRes = await fetch(`${srv.baseUrl}/api/maps/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...created,
        name: 'Session 4 Crypt (Revised)',
        placements: [
          ...created.placements,
          { q: 1, r: 0, tilesetId: 'missing-set', tileId: '99-100', faceNumber: 99, rotation: 0 },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.name).toBe('Session 4 Crypt (Revised)');
    expect(updated.placements).toHaveLength(2);

    const delRes = await fetch(`${srv.baseUrl}/api/maps/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);
    expect(fs.existsSync(path.join(dataDir, 'maps', `${created.id}.json`))).toBe(false);
    expect((await fetch(`${srv.baseUrl}/api/maps/${created.id}`)).status).toBe(404);
  });

  it('rejects unsafe Map IDs and invalid Map payloads', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const unsafeGet = await fetch(`${srv.baseUrl}/api/maps/..%2Fcollection`);
    expect(unsafeGet.status).toBe(400);

    const badCharsGet = await fetch(`${srv.baseUrl}/api/maps/bad$id!`);
    expect(badCharsGet.status).toBe(400);

    const createRes = await fetch(`${srv.baseUrl}/api/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Valid Map' }),
    });
    const created = await createRes.json();

    const invalidPut = await fetch(`${srv.baseUrl}/api/maps/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        id: created.id,
        name: 'Valid Map',
        placements: [{ q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 9 }],
      }),
    });
    expect(invalidPut.status).toBe(400);

    const dupOverlayPost = await fetch(`${srv.baseUrl}/api/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dup Overlays',
        placements: [
          {
            q: 0,
            r: 0,
            tilesetId: 'mhd',
            tileId: '01-02',
            faceNumber: 1,
            rotation: 0,
            overlays: [
              { id: 'dup', overlayPackId: 'aw', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
            ],
          },
          {
            q: 1,
            r: 0,
            tilesetId: 'mhd',
            tileId: '03-04',
            faceNumber: 3,
            rotation: 0,
            overlays: [
              { id: 'dup', overlayPackId: 'aw', overlayId: 'door-2', offsetX: 0, offsetY: 0, rotationDeg: 0 },
            ],
          },
        ],
      }),
    });
    expect(dupOverlayPost.status).toBe(400);

    const badCoveredPut = await fetch(`${srv.baseUrl}/api/maps/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Valid Map',
        placements: [
          { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0, covered: 'true' },
        ],
      }),
    });
    expect(badCoveredPut.status).toBe(400);

    const nullOffsetPut = await fetch(`${srv.baseUrl}/api/maps/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Valid Map',
        placements: [
          {
            q: 0,
            r: 0,
            tilesetId: 'mhd',
            tileId: '01-02',
            faceNumber: 1,
            rotation: 0,
            overlays: [
              { id: 'ov-1', overlayPackId: 'aw', overlayId: 'door-1', offsetX: null, offsetY: 0, rotationDeg: 0 },
            ],
          },
        ],
      }),
    });
    expect(nullOffsetPut.status).toBe(400);
  });

  it('auto-normalizes v1 Maps on read without rewriting disk, lazily upgrades to v2 on write omitting defaults, clamps/wraps Overlay geometry, and exposes overlayCount', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    const mapsDir = path.join(dataDir, 'maps');
    fs.mkdirSync(mapsDir, { recursive: true });
    const legacyRaw = JSON.stringify(
      {
        version: 1,
        id: 'legacy-map-1',
        name: 'Legacy Crypt',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        placements: [
          { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
        ],
      },
      null,
      2,
    );
    const legacyPath = path.join(mapsDir, 'legacy-map-1.json');
    fs.writeFileSync(legacyPath, legacyRaw, 'utf8');

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const listRes = await fetch(`${srv.baseUrl}/api/maps`);
    expect(await listRes.json()).toEqual({
      maps: [
        {
          id: 'legacy-map-1',
          name: 'Legacy Crypt',
          placementCount: 1,
          overlayCount: 0,
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    });

    const readRes = await fetch(`${srv.baseUrl}/api/maps/legacy-map-1`);
    expect(readRes.status).toBe(200);
    const readDoc = await readRes.json();
    expect(readDoc.version).toBe(2);
    expect(readDoc.placements[0]).toEqual({
      q: 0,
      r: 0,
      tilesetId: 'man-hewn-dungeons',
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
      covered: false,
      overlays: [],
    });
    // Reading v1 file must not rewrite it on disk
    expect(fs.readFileSync(legacyPath, 'utf8')).toBe(legacyRaw);

    // Updating lazily upgrades to version: 2, clamps/wraps overlays, and omits defaults on disk
    const putRes = await fetch(`${srv.baseUrl}/api/maps/legacy-map-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Legacy Crypt Upgraded',
        placements: [
          {
            q: 0,
            r: 0,
            tilesetId: 'man-hewn-dungeons',
            tileId: '01-02',
            faceNumber: 1,
            rotation: 0,
            covered: false,
            overlays: [],
          },
          {
            q: 1,
            r: 0,
            tilesetId: 'man-hewn-dungeons',
            tileId: '03-04',
            faceNumber: 3,
            rotation: 1,
            covered: true,
            overlays: [
              {
                id: 'ov-a',
                overlayPackId: 'alchemists-workshop',
                overlayId: 'table-1',
                offsetX: 3,
                offsetY: 0,
                rotationDeg: -30,
              },
              {
                id: 'ov-b',
                overlayPackId: 'alchemists-workshop',
                overlayId: 'door-1',
                offsetX: 0.25,
                offsetY: -0.25,
                rotationDeg: 360,
              },
            ],
          },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const updatedDoc = await putRes.json();
    expect(updatedDoc.version).toBe(2);
    expect(updatedDoc.placements[1].overlays).toEqual([
      {
        id: 'ov-a',
        overlayPackId: 'alchemists-workshop',
        overlayId: 'table-1',
        offsetX: 1,
        offsetY: 0,
        rotationDeg: 330,
      },
      {
        id: 'ov-b',
        overlayPackId: 'alchemists-workshop',
        overlayId: 'door-1',
        offsetX: 0.25,
        offsetY: -0.25,
        rotationDeg: 0,
      },
    ]);

    const onDisk = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    expect(onDisk.version).toBe(2);
    expect('covered' in onDisk.placements[0]).toBe(false);
    expect('overlays' in onDisk.placements[0]).toBe(false);
    expect(onDisk.placements[1].covered).toBe(true);
    expect(onDisk.placements[1].overlays).toHaveLength(2);

    const listAfter = await fetch(`${srv.baseUrl}/api/maps`);
    const listAfterBody = await listAfter.json();
    expect(listAfterBody.maps[0]).toMatchObject({
      id: 'legacy-map-1',
      placementCount: 2,
      overlayCount: 2,
    });

    // Corrupted Map file on disk with duplicate OverlayPlacement.id is rejected on read (404) & omitted from list
    fs.writeFileSync(
      path.join(mapsDir, 'corrupt-dup.json'),
      JSON.stringify({
        version: 2,
        id: 'corrupt-dup',
        name: 'Corrupt Dup',
        placements: [
          {
            q: 0,
            r: 0,
            tilesetId: 'mhd',
            tileId: '01-02',
            faceNumber: 1,
            rotation: 0,
            overlays: [
              { id: 'same-id', overlayPackId: 'aw', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
            ],
          },
          {
            q: 1,
            r: 0,
            tilesetId: 'mhd',
            tileId: '03-04',
            faceNumber: 3,
            rotation: 0,
            overlays: [
              { id: 'same-id', overlayPackId: 'aw', overlayId: 'door-2', offsetX: 0, offsetY: 0, rotationDeg: 0 },
            ],
          },
        ],
      }),
      'utf8',
    );
    expect((await fetch(`${srv.baseUrl}/api/maps/corrupt-dup`)).status).toBe(404);
    const listWithoutCorrupt = await (await fetch(`${srv.baseUrl}/api/maps`)).json();
    expect(listWithoutCorrupt.maps.map((m: { id: string }) => m.id)).toEqual(['legacy-map-1']);
  });
});
