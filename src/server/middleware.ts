import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { validatePlacements } from '../domain/plannerEngine';
import type { TilesetCatalogResponse } from '../domain/types';
import { discoverTilesets } from './bundleDiscovery';
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
    const discovery = discoverTilesets(options.bundleDir);
    const response: TilesetCatalogResponse = {
      tilesets: discovery.tilesets.map(({ id, name, shortCode, tiles }) => ({
        id,
        name,
        shortCode,
        tiles,
      })),
      bundleConfigured: discovery.bundleConfigured,
      ...(discovery.error ? { error: discovery.error } : {}),
    };
    sendJson(res, 200, response);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/assets/')) {
    const rest = pathname.slice('/api/assets/'.length);
    const parts = rest.split('/');
    if (parts.length !== 2) {
      sendText(res, 404, 'Asset not found');
      return;
    }

    const tilesetId = safeDecode(parts[0]);
    const filename = safeDecode(parts[1]);
    if (!tilesetId || !filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      sendText(res, 404, 'Asset not found');
      return;
    }

    const discovery = discoverTilesets(options.bundleDir);
    const tileset = discovery.tilesets.find((t) => t.id === tilesetId);
    if (!tileset) {
      sendText(res, 404, 'Tileset not found');
      return;
    }

    const expectedFile = tileset.faceFiles.get(filename);
    if (!expectedFile) {
      sendText(res, 404, 'Tile face not found');
      return;
    }

    const resolvedBase = path.resolve(tileset.dirPath);
    const resolvedFile = path.resolve(expectedFile);
    if (!resolvedFile.startsWith(resolvedBase + path.sep) || !fs.existsSync(resolvedFile)) {
      sendText(res, 404, 'Asset not found');
      return;
    }

    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile()) {
      sendText(res, 404, 'Asset not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(resolvedFile).pipe(res);
    return;
  }

  if (pathname === '/api/collection') {
    const discovery = discoverTilesets(options.bundleDir);
    const discoveredIds = discovery.tilesets.map((t) => t.id);

    if (method === 'GET') {
      const collection = readCollection(options.dataDir, discoveredIds);
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
          error: 'Collection must be an object mapping Tileset IDs to non-negative integers',
        });
        return;
      }
      writeCollection(options.dataDir, validated);
      const collection = readCollection(options.dataDir, discoveredIds);
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
