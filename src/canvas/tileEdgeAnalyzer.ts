import {
  analyzeTileFaceRgba,
  buildTileFaceEdgeProfile,
  tileFaceEdgeKey,
  type EdgeTuple,
  type TileEdgeIndex,
  type TileFaceEdgeProfile,
} from '../domain/tileEdges';
import type { Tileset } from '../domain/types';
import type { TileImageCache } from './imageCache';

export const EDGE_ANALYSIS_WIDTH = 240;
export const EDGE_ANALYSIS_HEIGHT = 208;
const ANALYSIS_CONCURRENCY = 8;

export interface EdgeAnalysisProgress {
  analyzed: number;
  total: number;
}

export interface AnalyzeTilesetsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: EdgeAnalysisProgress) => void;
}

interface FaceTask {
  tilesetId: string;
  tileId: string;
  faceNumber: number;
  url: string;
}

function loadImageForAnalysis(url: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  if (signal?.aborted) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve(null);
    };

    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    img.src = url;
  });
}

/**
 * Downsampled offscreen-canvas analyzer that extracts 6-edge connectivity profiles
 * for loaded Tile Face images and caches results by image URL.
 */
export class TileEdgeAnalyzer {
  private readonly urlCache = new Map<string, EdgeTuple>();

  clear(): void {
    this.urlCache.clear();
  }

  async analyzeTilesets(
    tilesets: readonly Tileset[],
    imageCache: TileImageCache,
    options?: AnalyzeTilesetsOptions,
  ): Promise<TileEdgeIndex> {
    const signal = options?.signal;
    const onProgress = options?.onProgress;

    const tasks: FaceTask[] = [];
    for (const tileset of tilesets) {
      for (const tile of tileset.tiles) {
        tasks.push({
          tilesetId: tileset.id,
          tileId: tile.tileId,
          faceNumber: tile.faceA.faceNumber,
          url: tile.faceA.url,
        });
        if (!tile.isSymmetric) {
          tasks.push({
            tilesetId: tileset.id,
            tileId: tile.tileId,
            faceNumber: tile.faceB.faceNumber,
            url: tile.faceB.url,
          });
        }
      }
    }

    const total = tasks.length;
    onProgress?.({ analyzed: 0, total });

    const profiles = new Map<string, TileFaceEdgeProfile>();
    if (total === 0 || signal?.aborted) {
      return profiles;
    }

    const canvas = document.createElement('canvas');
    canvas.width = EDGE_ANALYSIS_WIDTH;
    canvas.height = EDGE_ANALYSIS_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return profiles;
    }

    let nextIndex = 0;
    let analyzed = 0;

    const extractEdges = async (url: string): Promise<EdgeTuple | null> => {
      if (!url) return null;
      const cached = this.urlCache.get(url);
      if (cached) return cached;

      let img = imageCache.peek(url);
      if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        if (imageCache.isError(url)) {
          return null;
        }
        img = await loadImageForAnalysis(url, signal);
      }

      if (signal?.aborted || !img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        return null;
      }

      try {
        ctx.clearRect(0, 0, EDGE_ANALYSIS_WIDTH, EDGE_ANALYSIS_HEIGHT);
        ctx.drawImage(img, 0, 0, EDGE_ANALYSIS_WIDTH, EDGE_ANALYSIS_HEIGHT);
        const rgba = ctx.getImageData(0, 0, EDGE_ANALYSIS_WIDTH, EDGE_ANALYSIS_HEIGHT).data;
        const edges = analyzeTileFaceRgba(rgba, EDGE_ANALYSIS_WIDTH, EDGE_ANALYSIS_HEIGHT);
        this.urlCache.set(url, edges);
        return edges;
      } catch {
        return null;
      }
    };

    const runWorker = async () => {
      while (!signal?.aborted) {
        const idx = nextIndex++;
        if (idx >= tasks.length) break;
        const task = tasks[idx];
        const edges = await extractEdges(task.url);
        if (signal?.aborted) break;
        if (edges) {
          const profile = buildTileFaceEdgeProfile(
            task.tilesetId,
            task.tileId,
            task.faceNumber,
            edges,
          );
          profiles.set(tileFaceEdgeKey(task.tilesetId, task.faceNumber), profile);
        }
        analyzed += 1;
        onProgress?.({ analyzed, total });
      }
    };

    const workerCount = Math.min(ANALYSIS_CONCURRENCY, total);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return profiles;
  }
}
