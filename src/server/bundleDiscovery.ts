import fs from 'node:fs';
import path from 'node:path';
import {
  classifyBundleFolder,
  normalizeOverlayPackName,
  normalizeTilesetName,
  parseBundleFolders,
  toCleanSlug,
  toTilesetSlug,
  type RawBundleFolder,
} from '../domain/bundleParser';
import type { OverlayPack, Tileset } from '../domain/types';

export { normalizeOverlayPackName, normalizeTilesetName, toCleanSlug, toTilesetSlug };

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

  const rawFolders: RawBundleFolder[] = [];
  for (const entry of fs.readdirSync(resolvedBundle, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!classifyBundleFolder(entry.name)) continue;

    const dirPath = path.join(resolvedBundle, entry.name);
    const filenames = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((fileEntry) => fileEntry.isFile())
      .map((fileEntry) => fileEntry.name);

    rawFolders.push({
      sourceId: dirPath,
      folderName: entry.name,
      filenames,
    });
  }

  const parsed = parseBundleFolders(rawFolders, {
    tileFaceUrl: ({ tilesetId, filename }) =>
      `/api/assets/${encodeURIComponent(tilesetId)}/${encodeURIComponent(filename)}`,
    overlayUrl: ({ overlayPackId, filename }) =>
      `/api/overlay-assets/${encodeURIComponent(overlayPackId)}/${encodeURIComponent(filename)}`,
  });

  const tilesets: DiscoveredTileset[] = parsed.tilesets.map(
    ({ sourceId, folderName: _folderName, matchedFilenames, ...tileset }) => {
      const faceFiles = new Map<string, string>();
      for (const filename of matchedFilenames) {
        faceFiles.set(filename, path.join(sourceId, filename));
      }
      return {
        ...tileset,
        dirPath: sourceId,
        faceFiles,
      };
    },
  );

  const overlayPacks: DiscoveredOverlayPack[] = parsed.overlayPacks.map(
    ({ sourceId, folderName: _folderName, matchedFilenames, ...pack }) => {
      const overlayFiles = new Map<string, string>();
      for (const filename of matchedFilenames) {
        overlayFiles.set(filename, path.join(sourceId, filename));
      }
      return {
        ...pack,
        dirPath: sourceId,
        overlayFiles,
      };
    },
  );

  return {
    tilesets,
    overlayPacks,
    bundleConfigured: true,
  };
}
