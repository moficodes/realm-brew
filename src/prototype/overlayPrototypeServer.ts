// THROWAWAY PROTOTYPE SERVER MIDDLEWARE for Wayfinder #13
// Dev-only Vite plugin serving Bundle *Overlays directories without modifying production server code.

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { discoverTilesets } from '../server/bundleDiscovery';

export interface PrototypeOverlay {
  overlayId: string;
  overlayPackId: string;
  label: string;
  filename: string;
  url: string;
}

export interface PrototypeOverlayPack {
  id: string;
  name: string;
  shortCode: string;
  pairedTilesetId: string | null;
  overlays: PrototypeOverlay[];
}

export interface PrototypeOverlayDiscoveryResponse {
  overlayPacks: PrototypeOverlayPack[];
  bundleConfigured: boolean;
  error?: string;
}

interface DiscoveredOverlayPack extends PrototypeOverlayPack {
  dirPath: string;
  overlayFiles: Map<string, string>;
}

const OVERLAYS_FOLDER_RE = /overlays$/i;

function normalizeOverlayPackName(folderName: string): string {
  return folderName
    .trim()
    .replace(/^\d+\s*[•·\-–—.]\s*/, '')
    .replace(/^(?:Realm\s+Brew|RB)\s*[-–—]?\s*/i, '')
    .replace(/(?:\s*[-–—]?\s*Digital)?\s*Overlays$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCleanSlug(name: string, fallback = 'item'): string {
  const slug = name
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function baseShortCode(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'OV';
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.map((w) => w[0].toUpperCase()).join('');
}

function discoverOverlayPacks(bundleDir: string | undefined): {
  packs: DiscoveredOverlayPack[];
  bundleConfigured: boolean;
  error?: string;
} {
  const trimmedDir = bundleDir?.trim();
  if (!trimmedDir) {
    return {
      packs: [],
      bundleConfigured: false,
      error: 'REALM_BREW_BUNDLE_DIR is not configured.',
    };
  }

  const resolvedBundle = path.resolve(trimmedDir);
  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return {
      packs: [],
      bundleConfigured: false,
      error: `Bundle directory not found: ${resolvedBundle}`,
    };
  }

  const tilesetDiscovery = discoverTilesets(bundleDir);
  const tilesetBySlug = new Map(tilesetDiscovery.tilesets.map((t) => [t.id, t]));

  const entries = fs.readdirSync(resolvedBundle, { withFileTypes: true });
  const rawFolders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => OVERLAYS_FOLDER_RE.test(name.trim()));

  const preliminary = rawFolders.map((folderName) => {
    const dirPath = path.join(resolvedBundle, folderName);
    const name = normalizeOverlayPackName(folderName) || folderName.trim();
    const baseId = toCleanSlug(name, 'overlay-pack');
    const pairedTilesetId = tilesetBySlug.has(baseId) ? baseId : null;
    return { folderName, dirPath, name, baseId, pairedTilesetId };
  });

  // Order paired packs first (matching Tileset order), then standalone packs alphabetically
  preliminary.sort((a, b) => {
    const aPaired = a.pairedTilesetId !== null;
    const bPaired = b.pairedTilesetId !== null;
    if (aPaired !== bPaired) return aPaired ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const usedPackIds = new Map<string, number>();
  const usedShortCodes = new Map<string, number>();
  const packs: DiscoveredOverlayPack[] = [];

  for (const item of preliminary) {
    const idCount = (usedPackIds.get(item.baseId) ?? 0) + 1;
    usedPackIds.set(item.baseId, idCount);
    const id = idCount === 1 ? item.baseId : `${item.baseId}-${idCount}`;

    const baseCode = baseShortCode(item.name);
    const codeCount = (usedShortCodes.get(baseCode) ?? 0) + 1;
    usedShortCodes.set(baseCode, codeCount);
    const shortCode = codeCount === 1 ? baseCode : `${baseCode}${codeCount}`;

    const pngFiles = fs
      .readdirSync(item.dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const overlayFiles = new Map<string, string>();
    const usedOverlayIds = new Map<string, number>();
    const overlays: PrototypeOverlay[] = pngFiles.map((filename) => {
      const label = filename.replace(/\.png$/i, '');
      const baseOverlayId = toCleanSlug(label, 'overlay');
      const count = (usedOverlayIds.get(baseOverlayId) ?? 0) + 1;
      usedOverlayIds.set(baseOverlayId, count);
      const overlayId = count === 1 ? baseOverlayId : `${baseOverlayId}-${count}`;

      overlayFiles.set(filename, path.join(item.dirPath, filename));
      return {
        overlayId,
        overlayPackId: id,
        label,
        filename,
        url: `/api/prototype/overlay-assets/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`,
      };
    });

    packs.push({
      id,
      name: item.name,
      shortCode,
      pairedTilesetId: item.pairedTilesetId,
      overlays,
      dirPath: item.dirPath,
      overlayFiles,
    });
  }

  return {
    packs,
    bundleConfigured: true,
  };
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

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

function handlePrototypeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bundleDir: string | undefined,
): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/prototype/overlays') {
    const result = discoverOverlayPacks(bundleDir);
    const payload: PrototypeOverlayDiscoveryResponse = {
      overlayPacks: result.packs.map(({ id, name, shortCode, pairedTilesetId, overlays }) => ({
        id,
        name,
        shortCode,
        pairedTilesetId,
        overlays,
      })),
      bundleConfigured: result.bundleConfigured,
      ...(result.error ? { error: result.error } : {}),
    };
    sendJson(res, 200, payload);
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/prototype/overlay-assets/')) {
    const rest = pathname.slice('/api/prototype/overlay-assets/'.length);
    const parts = rest.split('/');
    if (parts.length !== 2) {
      sendText(res, 404, 'Overlay asset not found');
      return true;
    }

    const packId = safeDecode(parts[0]);
    const filename = safeDecode(parts[1]);
    if (
      !packId ||
      !filename ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
    ) {
      sendText(res, 404, 'Overlay asset not found');
      return true;
    }

    const result = discoverOverlayPacks(bundleDir);
    const pack = result.packs.find((p) => p.id === packId);
    if (!pack) {
      sendText(res, 404, 'Overlay pack not found');
      return true;
    }

    const expectedFile = pack.overlayFiles.get(filename);
    if (!expectedFile) {
      sendText(res, 404, 'Overlay file not found');
      return true;
    }

    const resolvedBase = path.resolve(pack.dirPath);
    const resolvedFile = path.resolve(expectedFile);
    if (!resolvedFile.startsWith(resolvedBase + path.sep) || !fs.existsSync(resolvedFile)) {
      sendText(res, 404, 'Overlay asset not found');
      return true;
    }

    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile()) {
      sendText(res, 404, 'Overlay asset not found');
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(resolvedFile).pipe(res);
    return true;
  }

  return false;
}

export function overlayPrototypePlugin(options: { bundleDir?: string } = {}): Plugin {
  return {
    name: 'realm-brew-overlay-prototype',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handlePrototypeRequest(req, res, options.bundleDir)) {
          next();
        }
      });
    },
  };
}
