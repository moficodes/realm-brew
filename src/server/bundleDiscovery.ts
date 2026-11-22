import fs from 'node:fs';
import path from 'node:path';
import { padFaceNumber, type Tile, type TileFace, type Tileset } from '../domain/types';

export interface DiscoveredTileset extends Tileset {
  dirPath: string;
  faceFiles: Map<string, string>;
}

export interface DiscoveryResult {
  tilesets: DiscoveredTileset[];
  bundleConfigured: boolean;
  error?: string;
}

const TILES_FOLDER_RE = /tiles$/i;
const OVERLAYS_FOLDER_RE = /overlays$/i;
const PNG_FACE_RE = /_(\d+)\.png$/i;

export function normalizeTilesetName(folderName: string): string {
  return folderName
    .trim()
    .replace(/^\d+\s*[•·\-–—.]\s*/, '')
    .replace(/^(?:Realm\s+Brew|RB)\s*[-–—]?\s*/i, '')
    .replace(/(?:\s*[-–—]?\s*Digital)?\s*Tiles$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toTilesetSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'tileset';
}

function baseShortCode(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'TS';
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.map((w) => w[0].toUpperCase()).join('');
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

export function discoverTilesets(bundleDir: string | undefined): DiscoveryResult {
  const trimmedDir = bundleDir?.trim();
  if (!trimmedDir) {
    return {
      tilesets: [],
      bundleConfigured: false,
      error: 'REALM_BREW_BUNDLE_DIR is not configured. Set it in .env.local to your Realm Brew bundle folder.',
    };
  }

  const resolvedBundle = path.resolve(trimmedDir);
  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return {
      tilesets: [],
      bundleConfigured: false,
      error: `Bundle directory not found: ${resolvedBundle}`,
    };
  }

  const entries = fs.readdirSync(resolvedBundle, { withFileTypes: true });
  const rawFolders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const trimmed = name.trim();
      return TILES_FOLDER_RE.test(trimmed) && !OVERLAYS_FOLDER_RE.test(trimmed);
    });

  const preliminary = rawFolders
    .map((folderName) => {
      const dirPath = path.join(resolvedBundle, folderName);
      const name = normalizeTilesetName(folderName) || folderName.trim();
      const baseId = toTilesetSlug(name);
      return { folderName, dirPath, name, baseId };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const usedIds = new Map<string, number>();
  const usedShortCodes = new Map<string, number>();
  const tilesets: DiscoveredTileset[] = [];

  for (const item of preliminary) {
    const idCount = (usedIds.get(item.baseId) ?? 0) + 1;
    usedIds.set(item.baseId, idCount);
    const id = idCount === 1 ? item.baseId : `${item.baseId}-${idCount}`;

    const baseCode = baseShortCode(item.name);
    const codeCount = (usedShortCodes.get(baseCode) ?? 0) + 1;
    usedShortCodes.set(baseCode, codeCount);
    const shortCode = codeCount === 1 ? baseCode : `${baseCode}${codeCount}`;

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

  return {
    tilesets,
    bundleConfigured: true,
  };
}
