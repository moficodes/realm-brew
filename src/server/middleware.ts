import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { TilesetCatalogResponse } from '../domain/types';
import { discoverTilesets } from './bundleDiscovery';

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

export function createApiHandler(options: ApiHandlerOptions): ConnectMiddleware {
  return (req, res, next) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      next();
      return;
    }

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

    sendJson(res, 404, { error: 'Not found' });
  };
}
