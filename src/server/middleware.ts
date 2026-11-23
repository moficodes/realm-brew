import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { validatePlacements } from '../domain/plannerEngine';
import type { TilesetListResponse } from '../domain/types';
import { discoverBundle } from './bundleDiscovery';
import {
  createMap,
  deleteMap,
  isSafeMapId,
  listMaps,
  readCollection,
  readMap,
  updateMap,
  validateCollection,
  writeCollection,
} from './persistence';

export interface ApiHandlerOptions {
  bundleDir?: string;
  dataDir: string;
}

export type MiddlewareNext = (err?: unknown) => void;
export type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: MiddlewareNext) => void;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

async function parseJsonOr400(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return undefined;
  }
}

function serveAllowedPngAsset(
  res: ServerResponse,
  restPath: string,
  notFoundLabel: string,
  resolvePack: (packId: string) => { dirPath: string; files: Map<string, string> } | null,
): void {
  const parts = restPath.split('/');
  if (parts.length !== 2) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  const packId = safeDecode(parts[0]);
  const filename = safeDecode(parts[1]);
  if (!packId || !filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  const pack = resolvePack(packId);
  if (!pack) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  const expectedFile = pack.files.get(filename);
  if (!expectedFile) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  const resolvedBase = path.resolve(pack.dirPath);
  const resolvedFile = path.resolve(expectedFile);
  if (!resolvedFile.startsWith(resolvedBase + path.sep) || !fs.existsSync(resolvedFile)) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  const stat = fs.statSync(resolvedFile);
  if (!stat.isFile()) {
    sendText(res, 404, notFoundLabel);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(resolvedFile).pipe(res);
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ApiHandlerOptions,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, 'http://localhost');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/tilesets') {
    const discovery = discoverBundle(options.bundleDir);
    const response: TilesetListResponse = {
      tilesets: discovery.tilesets.map(({ id, name, shortCode, tiles }) => ({
        id,
        name,
        shortCode,
        tiles,
      })),
      overlayPacks: discovery.overlayPacks.map(({ id, name, shortCode, pairedTilesetId, overlays }) => ({
        id,
        name,
        shortCode,
        pairedTilesetId,
        overlays,
      })),
      bundleConfigured: discovery.bundleConfigured,
      ...(discovery.error ? { error: discovery.error } : {}),
    };
    sendJson(res, 200, response);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/assets/')) {
    const discovery = discoverBundle(options.bundleDir);
    serveAllowedPngAsset(res, pathname.slice('/api/assets/'.length), 'Asset not found', (tilesetId) => {
      const tileset = discovery.tilesets.find((t) => t.id === tilesetId);
      return tileset ? { dirPath: tileset.dirPath, files: tileset.faceFiles } : null;
    });
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/overlay-assets/')) {
    const discovery = discoverBundle(options.bundleDir);
    serveAllowedPngAsset(
      res,
      pathname.slice('/api/overlay-assets/'.length),
      'Overlay asset not found',
      (packId) => {
        const pack = discovery.overlayPacks.find((p) => p.id === packId);
        return pack ? { dirPath: pack.dirPath, files: pack.overlayFiles } : null;
      },
    );
    return;
  }

  if (pathname === '/api/collection') {
    const discovery = discoverBundle(options.bundleDir);
    const discoveredTilesetIds = discovery.tilesets.map((t) => t.id);
    const discoveredOverlayPackIds = discovery.overlayPacks.map((p) => p.id);

    if (method === 'GET') {
      const collection = readCollection(
        options.dataDir,
        discoveredTilesetIds,
        discoveredOverlayPackIds,
      );
      sendJson(res, 200, { collection });
      return;
    }

    if (method === 'PUT') {
      const body = await parseJsonOr400(req, res);
      if (body === undefined) return;
      const rawCollection =
        body && typeof body === 'object' && !Array.isArray(body) && 'collection' in body
          ? (body as { collection: unknown }).collection
          : null;
      const validated = validateCollection(rawCollection);
      if (!validated) {
        sendJson(res, 400, {
          error:
            'Collection must be a v2 object with version: 2, tilesets, and overlayPacks mapping IDs to non-negative integers',
        });
        return;
      }
      writeCollection(options.dataDir, validated);
      const collection = readCollection(
        options.dataDir,
        discoveredTilesetIds,
        discoveredOverlayPackIds,
      );
      sendJson(res, 200, { collection });
      return;
    }
  }

  if (pathname === '/api/maps') {
    if (method === 'GET') {
      sendJson(res, 200, { maps: listMaps(options.dataDir) });
      return;
    }

    if (method === 'POST') {
      const body = await parseJsonOr400(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'Invalid Map payload' });
        return;
      }
      const raw = body as Record<string, unknown>;
      if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) {
        sendJson(res, 400, { error: 'Unsupported Map version' });
        return;
      }
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled Map';
      let placements = [] as ReturnType<typeof validatePlacements>;
      if (raw.placements !== undefined) {
        placements = validatePlacements(raw.placements);
        if (!placements) {
          sendJson(res, 400, { error: 'Invalid Placements array' });
          return;
        }
      } else {
        placements = [];
      }
      const created = createMap(options.dataDir, { name, placements });
      sendJson(res, 201, created);
      return;
    }
  }

  if (pathname.startsWith('/api/maps/')) {
    const rawId = pathname.slice('/api/maps/'.length);
    const id = safeDecode(rawId);
    if (!id || rawId.includes('/') || !isSafeMapId(id)) {
      sendJson(res, 400, { error: 'Invalid Map ID' });
      return;
    }

    if (method === 'GET') {
      const doc = readMap(options.dataDir, id);
      if (!doc) {
        sendJson(res, 404, { error: 'Map not found' });
        return;
      }
      sendJson(res, 200, doc);
      return;
    }

    if (method === 'PUT') {
      const body = await parseJsonOr400(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'Invalid Map payload' });
        return;
      }
      const raw = body as Record<string, unknown>;
      if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) {
        sendJson(res, 400, { error: 'Unsupported Map version' });
        return;
      }
      if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
        sendJson(res, 400, { error: 'Map name is required' });
        return;
      }
      const placements = validatePlacements(raw.placements);
      if (!placements) {
        sendJson(res, 400, { error: 'Invalid Placements array' });
        return;
      }
      const updated = updateMap(options.dataDir, id, { name: raw.name, placements });
      if (!updated) {
        sendJson(res, 404, { error: 'Map not found' });
        return;
      }
      sendJson(res, 200, updated);
      return;
    }

    if (method === 'DELETE') {
      const deleted = deleteMap(options.dataDir, id);
      if (!deleted) {
        sendJson(res, 404, { error: 'Map not found' });
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
}

export function createApiHandler(options: ApiHandlerOptions): ConnectMiddleware {
  return (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }

    void handleApiRequest(req, res, options).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : 'Internal server error',
        });
      }
    });
  };
}
