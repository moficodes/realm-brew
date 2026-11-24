import fs from 'node:fs';
import path from 'node:path';
import {
  padFaceNumber,
  type Overlay,
  type OverlayPack,
  type Tile,
  type TileFace,
  type Tileset,
} from '../domain/types';

export interface DiscoveredTileset extends Tileset {
  dirPath: string;
  faceFiles: Map<string, string>;
}

export interface DiscoveredOverlayPack extends OverlayPack {
  dirPath: string;
  overlayFiles: Map<string, string>;
}

export interface BundleDiscoveryResult {
  tilesets: DiscoveredTileset[];
  overlayPacks: DiscoveredOverlayPack[];
  bundleConfigured: boolean;
  error?: string;
}

const TILES_FOLDER_RE = /tiles$/i;
const OVERLAYS_FOLDER_RE = /overlays$/i;
const PNG_FACE_RE = /_(\d+)\.png$/i;
const PNG_EXT_RE = /\.png$/i;

function normalizePackName(folderName: string, suffixRe: RegExp): string {
  return folderName
    .trim()
    .replace(/^\d+\s*[•·\-–—.]\s*/, '')
    .replace(/^(?:Realm\s+Brew|RB)\s*[-–—]?\s*/i, '')
    .replace(suffixRe, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTilesetName(folderName: string): string {
  return normalizePackName(folderName, /(?:\s*[-–—]?\s*Digital)?\s*Tiles$/i);
}

export function normalizeOverlayPackName(folderName: string): string {
  return normalizePackName(folderName, /(?:\s*[-–—]?\s*Digital)?\s*Overlays$/i);
}

export function toTilesetSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'tileset';
}

export function toCleanSlug(name: string, fallback = 'item'): string {
  const slug = name
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function baseShortCode(name: string, fallback: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return fallback;
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.map((w) => w[0].toUpperCase()).join('');
}

function nextUniqueId(used: Map<string, number>, baseId: string, separator = '-'): string {
  const count = (used.get(baseId) ?? 0) + 1;
  used.set(baseId, count);
  return count === 1 ? baseId : `${baseId}${separator}${count}`;
}

function pairFaces(tilesetId: string, faces: TileFace[]): Tile[] {
  const tiles: Tile[] = [];
  let index = 0;
  while (index < faces.length) {
    const faceA = faces[index];
    const nextFace = faces[index + 1];
    const isConsecutiveOddEven =
      nextFace !== undefined &&
      faceA.faceNumber % 2 === 1 &&
      nextFace.faceNumber === faceA.faceNumber + 1;

    if (isConsecutiveOddEven) {
      tiles.push({
        tileId: `${faceA.label}-${nextFace.label}`,
        tilesetId,
        faceA,
        faceB: nextFace,
        isSymmetric: false,
      });
      index += 2;
    } else {
      tiles.push({
        tileId: `${faceA.label}-${faceA.label}`,
        tilesetId,
        faceA,
        faceB: faceA,
        isSymmetric: true,
      });
      index += 1;
    }
  }
  return tiles;
}

function naturalCompareOverlayFilename(a: string, b: string): number {
  const stemA = a.replace(PNG_EXT_RE, '');
  const stemB = b.replace(PNG_EXT_RE, '');
  return (
    stemA.localeCompare(stemB, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.localeCompare(b)
  );
}

export function discoverBundle(bundleDir: string | undefined): BundleDiscoveryResult {
  const trimmedDir = bundleDir?.trim();
  if (!trimmedDir) {
    return {
      tilesets: [],
      overlayPacks: [],
      bundleConfigured: false,
      error: 'REALM_BREW_BUNDLE_DIR is not configured. Set it in .env.local to your Realm Brew bundle folder.',
    };
  }

  const resolvedBundle = path.resolve(trimmedDir);
  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return {
      tilesets: [],
      overlayPacks: [],
      bundleConfigured: false,
      error: `Bundle directory not found: ${resolvedBundle}`,
    };
  }

  const tilesetFolders: Array<{ folderName: string; dirPath: string; name: string; baseId: string }> = [];
  const overlayFolders: Array<{ folderName: string; dirPath: string; name: string; baseId: string }> = [];

  for (const entry of fs.readdirSync(resolvedBundle, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const trimmed = entry.name.trim();
    const dirPath = path.join(resolvedBundle, entry.name);
    if (OVERLAYS_FOLDER_RE.test(trimmed)) {
      const name = normalizeOverlayPackName(entry.name) || trimmed;
      overlayFolders.push({
        folderName: entry.name,
        dirPath,
        name,
        baseId: toCleanSlug(name, 'overlay-pack'),
      });
    } else if (TILES_FOLDER_RE.test(trimmed)) {
      const name = normalizeTilesetName(entry.name) || trimmed;
      tilesetFolders.push({
        folderName: entry.name,
        dirPath,
        name,
        baseId: toTilesetSlug(name),
      });
    }
  }

  tilesetFolders.sort((a, b) => a.name.localeCompare(b.name));

  const usedTilesetIds = new Map<string, number>();
  const usedTilesetShortCodes = new Map<string, number>();
  const tilesets: DiscoveredTileset[] = [];

  for (const item of tilesetFolders) {
    const id = nextUniqueId(usedTilesetIds, item.baseId, '-');
    const shortCode = nextUniqueId(usedTilesetShortCodes, baseShortCode(item.name, 'TS'), '');

    const pngEntries = fs
      .readdirSync(item.dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const match = entry.name.match(PNG_FACE_RE);
        if (!match) return null;
        return {
          filename: entry.name,
          faceNumber: Number.parseInt(match[1], 10),
        };
      })
      .filter((x): x is { filename: string; faceNumber: number } => x !== null)
      .sort((a, b) => a.faceNumber - b.faceNumber || a.filename.localeCompare(b.filename));

    const faceFiles = new Map<string, string>();
    const faces: TileFace[] = pngEntries.map((png) => {
      const label = padFaceNumber(png.faceNumber);
      faceFiles.set(png.filename, path.join(item.dirPath, png.filename));
      return {
        faceNumber: png.faceNumber,
        label,
        filename: png.filename,
        url: `/api/assets/${encodeURIComponent(id)}/${encodeURIComponent(png.filename)}`,
      };
    });

    tilesets.push({
      id,
      name: item.name,
      shortCode,
      tiles: pairFaces(id, faces),
      dirPath: item.dirPath,
      faceFiles,
    });
  }

  const tilesetOrder = new Map<string, number>();
  const tilesetIdByCleanSlug = new Map<string, string>();
  tilesets.forEach((ts, index) => {
    tilesetOrder.set(ts.id, index);
    const clean = toCleanSlug(ts.name, 'tileset');
    if (!tilesetIdByCleanSlug.has(clean)) {
      tilesetIdByCleanSlug.set(clean, ts.id);
    }
  });

  const preliminaryOverlays = overlayFolders
    .map((item) => {
      const pairedTilesetId = tilesetOrder.has(item.baseId)
        ? item.baseId
        : (tilesetIdByCleanSlug.get(item.baseId) ?? null);
      return { ...item, pairedTilesetId };
    })
    .sort((a, b) => {
      const aOrder =
        a.pairedTilesetId !== null
          ? (tilesetOrder.get(a.pairedTilesetId) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const bOrder =
        b.pairedTilesetId !== null
          ? (tilesetOrder.get(b.pairedTilesetId) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });

  const usedOverlayPackIds = new Map<string, number>();
  const usedOverlayShortCodes = new Map<string, number>();
  const overlayPacks: DiscoveredOverlayPack[] = [];

  for (const item of preliminaryOverlays) {
    const id = nextUniqueId(usedOverlayPackIds, item.baseId, '-');
    const shortCode = nextUniqueId(usedOverlayShortCodes, baseShortCode(item.name, 'OV'), '');

    const pngFiles = fs
      .readdirSync(item.dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('._') && PNG_EXT_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort(naturalCompareOverlayFilename);

    const overlayFiles = new Map<string, string>();
    const usedOverlayIds = new Map<string, number>();
    const overlays: Overlay[] = pngFiles.map((filename) => {
      const label = filename.replace(PNG_EXT_RE, '');
      const overlayId = nextUniqueId(usedOverlayIds, toCleanSlug(label, 'overlay'), '-');
      overlayFiles.set(filename, path.join(item.dirPath, filename));
      return {
        overlayId,
        overlayPackId: id,
        label,
        filename,
        url: `/api/overlay-assets/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`,
      };
    });

    overlayPacks.push({
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
    tilesets,
    overlayPacks,
    bundleConfigured: true,
  };
}
