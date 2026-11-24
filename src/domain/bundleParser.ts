import {
  padFaceNumber,
  type Overlay,
  type OverlayPack,
  type Tile,
  type TileFace,
  type Tileset,
} from './types';

export const TILES_FOLDER_RE = /tiles$/i;
export const OVERLAYS_FOLDER_RE = /overlays$/i;
export const PNG_FACE_RE = /_(\d+)\.png$/i;
export const PNG_EXT_RE = /\.png$/i;

export type BundleFolderKind = 'tileset' | 'overlayPack';

export interface RawBundleFolder {
  sourceId: string;
  folderName: string;
  filenames: readonly string[];
}

export interface BundleUrlResolvers {
  tileFaceUrl: (ctx: { sourceId: string; tilesetId: string; filename: string }) => string;
  overlayUrl: (ctx: { sourceId: string; overlayPackId: string; filename: string }) => string;
}

export interface ParsedTileset extends Tileset {
  sourceId: string;
  folderName: string;
  matchedFilenames: string[];
}

export interface ParsedOverlayPack extends OverlayPack {
  sourceId: string;
  folderName: string;
  matchedFilenames: string[];
}

export interface GroupedImportFolder<T> {
  folderPathKey: string;
  kind: BundleFolderKind;
  folderName: string;
  files: Array<{ filename: string; payload: T }>;
}

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

export function classifyBundleFolder(folderName: string): BundleFolderKind | null {
  const trimmed = folderName.trim();
  if (!trimmed) return null;
  if (OVERLAYS_FOLDER_RE.test(trimmed)) return 'overlayPack';
  if (TILES_FOLDER_RE.test(trimmed)) return 'tileset';
  return null;
}

export function canonicalPackKey(kind: BundleFolderKind, folderName: string): string {
  const trimmed = folderName.trim();
  if (kind === 'tileset') {
    const name = normalizeTilesetName(folderName) || trimmed;
    return `tileset:${toTilesetSlug(name)}`;
  }
  const name = normalizeOverlayPackName(folderName) || trimmed;
  return `overlayPack:${toCleanSlug(name, 'overlay-pack')}`;
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

export function pairFaces(tilesetId: string, faces: TileFace[]): Tile[] {
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

export function naturalCompareOverlayFilename(a: string, b: string): number {
  const stemA = a.replace(PNG_EXT_RE, '');
  const stemB = b.replace(PNG_EXT_RE, '');
  return (
    stemA.localeCompare(stemB, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.localeCompare(b)
  );
}

/**
 * Parse raw discovered *Tiles and *Overlays folders into normalized Tileset and OverlayPack
 * metadata using deterministic IDs, short codes, pairing, and sorting.
 */
export function parseBundleFolders(
  folders: readonly RawBundleFolder[],
  resolvers: BundleUrlResolvers,
): { tilesets: ParsedTileset[]; overlayPacks: ParsedOverlayPack[] } {
  const tilesetFolders: Array<{
    sourceId: string;
    folderName: string;
    name: string;
    baseId: string;
    filenames: readonly string[];
  }> = [];
  const overlayFolders: Array<{
    sourceId: string;
    folderName: string;
    name: string;
    baseId: string;
    filenames: readonly string[];
  }> = [];

  for (const folder of folders) {
    const trimmed = folder.folderName.trim();
    const kind = classifyBundleFolder(trimmed);
    if (kind === 'overlayPack') {
      const name = normalizeOverlayPackName(folder.folderName) || trimmed;
      overlayFolders.push({
        sourceId: folder.sourceId,
        folderName: folder.folderName,
        name,
        baseId: toCleanSlug(name, 'overlay-pack'),
        filenames: folder.filenames,
      });
    } else if (kind === 'tileset') {
      const name = normalizeTilesetName(folder.folderName) || trimmed;
      tilesetFolders.push({
        sourceId: folder.sourceId,
        folderName: folder.folderName,
        name,
        baseId: toTilesetSlug(name),
        filenames: folder.filenames,
      });
    }
  }

  tilesetFolders.sort((a, b) => a.name.localeCompare(b.name));

  const usedTilesetIds = new Map<string, number>();
  const usedTilesetShortCodes = new Map<string, number>();
  const tilesets: ParsedTileset[] = [];

  for (const item of tilesetFolders) {
    const id = nextUniqueId(usedTilesetIds, item.baseId, '-');
    const shortCode = nextUniqueId(usedTilesetShortCodes, baseShortCode(item.name, 'TS'), '');

    const pngEntries = item.filenames
      .filter((filename) => !filename.startsWith('._'))
      .map((filename) => {
        const match = filename.match(PNG_FACE_RE);
        if (!match) return null;
        return {
          filename,
          faceNumber: Number.parseInt(match[1], 10),
        };
      })
      .filter((x): x is { filename: string; faceNumber: number } => x !== null)
      .sort((a, b) => a.faceNumber - b.faceNumber || a.filename.localeCompare(b.filename));

    const matchedFilenames: string[] = [];
    const faces: TileFace[] = pngEntries.map((png) => {
      const label = padFaceNumber(png.faceNumber);
      matchedFilenames.push(png.filename);
      return {
        faceNumber: png.faceNumber,
        label,
        filename: png.filename,
        url: resolvers.tileFaceUrl({
          sourceId: item.sourceId,
          tilesetId: id,
          filename: png.filename,
        }),
      };
    });

    tilesets.push({
      id,
      name: item.name,
      shortCode,
      tiles: pairFaces(id, faces),
      sourceId: item.sourceId,
      folderName: item.folderName,
      matchedFilenames,
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
  const overlayPacks: ParsedOverlayPack[] = [];

  for (const item of preliminaryOverlays) {
    const id = nextUniqueId(usedOverlayPackIds, item.baseId, '-');
    const shortCode = nextUniqueId(usedOverlayShortCodes, baseShortCode(item.name, 'OV'), '');

    const pngFiles = item.filenames
      .filter((filename) => !filename.startsWith('._') && PNG_EXT_RE.test(filename))
      .slice()
      .sort(naturalCompareOverlayFilename);

    const usedOverlayIds = new Map<string, number>();
    const overlays: Overlay[] = pngFiles.map((filename) => {
      const label = filename.replace(PNG_EXT_RE, '');
      const overlayId = nextUniqueId(usedOverlayIds, toCleanSlug(label, 'overlay'), '-');
      return {
        overlayId,
        overlayPackId: id,
        label,
        filename,
        url: resolvers.overlayUrl({
          sourceId: item.sourceId,
          overlayPackId: id,
          filename,
        }),
      };
    });

    overlayPacks.push({
      id,
      name: item.name,
      shortCode,
      pairedTilesetId: item.pairedTilesetId,
      overlays,
      sourceId: item.sourceId,
      folderName: item.folderName,
      matchedFilenames: pngFiles,
    });
  }

  return { tilesets, overlayPacks };
}

/**
 * Group relative PNG paths from a folder selection, dropped directory tree, or zip archive
 * into validated *Tiles and *Overlays pack buckets while filtering OS metadata and non-face files.
 */
export function groupRelativePngPaths<T>(
  entries: ReadonlyArray<{ relativePath: string; payload: T }>,
  fallbackFolderName?: string,
): GroupedImportFolder<T>[] {
  const buckets = new Map<
    string,
    {
      folderPathKey: string;
      kind: BundleFolderKind;
      folderName: string;
      filesByName: Map<string, T>;
    }
  >();

  for (const entry of entries) {
    const normalizedPath = entry.relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalizedPath) continue;

    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    if (segments.some((seg) => seg.toUpperCase() === '__MACOSX')) continue;

    const filename = segments[segments.length - 1];
    if (filename.startsWith('.')) continue;
    if (!PNG_EXT_RE.test(filename)) continue;

    let folderName: string | null = null;
    let folderPathKey: string | null = null;

    if (segments.length >= 2) {
      folderName = segments[segments.length - 2];
      folderPathKey = segments.slice(0, -1).join('/');
    } else if (fallbackFolderName) {
      const trimmedFallback = fallbackFolderName.trim();
      if (trimmedFallback) {
        folderName = trimmedFallback;
        folderPathKey = trimmedFallback;
      }
    }

    if (!folderName || !folderPathKey) continue;

    const kind = classifyBundleFolder(folderName);
    if (!kind) continue;
    if (kind === 'tileset' && !PNG_FACE_RE.test(filename)) continue;

    let bucket = buckets.get(folderPathKey);
    if (!bucket) {
      bucket = {
        folderPathKey,
        kind,
        folderName,
        filesByName: new Map<string, T>(),
      };
      buckets.set(folderPathKey, bucket);
    }
    bucket.filesByName.set(filename, entry.payload);
  }

  const result: GroupedImportFolder<T>[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.filesByName.size === 0) continue;
    const files = Array.from(bucket.filesByName.entries()).map(([filename, payload]) => ({
      filename,
      payload,
    }));
    result.push({
      folderPathKey: bucket.folderPathKey,
      kind: bucket.kind,
      folderName: bucket.folderName,
      files,
    });
  }
  return result;
}
