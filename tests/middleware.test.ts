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
    // Should ignore Overlays folders
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
      { id: 'man-hewn-dungeons', name: 'Man Hewn Dungeons', shortCode: 'MHD' },
      { id: 'subterranean-rivers', name: 'Subterranean Rivers', shortCode: 'SR' },
      { id: 'underdark-caverns', name: 'Underdark Caverns', shortCode: 'UC' },
    ]);

    const mhd = body.tilesets[0];
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
    expect(body.error).toBeTruthy();
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

  it('bootstraps newly discovered Tilesets to 2 copies and persists PUT updates to collection.json', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);

    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 4);
    populateTilesetFolder(bundleDir, '0 • Realm Brew Subterranean Rivers - Digital Tiles', 'SR', 2);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const getInitial = await fetch(`${srv.baseUrl}/api/collection`);
    expect(getInitial.status).toBe(200);
    expect(await getInitial.json()).toEqual({
      collection: {
        'man-hewn-dungeons': 2,
        'subterranean-rivers': 2,
      },
    });

    const putRes = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: {
          'man-hewn-dungeons': 1,
          'subterranean-rivers': 0,
        },
      }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      collection: {
        'man-hewn-dungeons': 1,
        'subterranean-rivers': 0,
      },
    });

    // Verify plain JSON file exists on disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'collection.json'), 'utf8'));
    expect(onDisk).toEqual({
      'man-hewn-dungeons': 1,
      'subterranean-rivers': 0,
    });

    // Adding a new Tileset later defaults only the new one to 2
    populateTilesetFolder(bundleDir, '0 • Realm Brew Underdark Caverns - Digital Tiles', 'UC', 2);
    const getAfterNew = await fetch(`${srv.baseUrl}/api/collection`);
    expect(await getAfterNew.json()).toEqual({
      collection: {
        'man-hewn-dungeons': 1,
        'subterranean-rivers': 0,
        'underdark-caverns': 2,
      },
    });
  });

  it('rejects negative, fractional, or malformed Collection payloads with 400', async () => {
    const bundleDir = makeTempDir('rb-bundle-');
    const dataDir = makeTempDir('rb-data-');
    cleanupDirs.push(bundleDir, dataDir);
    populateTilesetFolder(bundleDir, '0 • Realm Brew - Man Hewn Dungeons Tiles', 'MHD', 2);

    const srv = await startTestServer(bundleDir, dataDir);
    openServers.push(srv);

    const neg = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: { 'man-hewn-dungeons': -1 } }),
    });
    expect(neg.status).toBe(400);

    const floatRes = await fetch(`${srv.baseUrl}/api/collection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: { 'man-hewn-dungeons': 1.5 } }),
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
