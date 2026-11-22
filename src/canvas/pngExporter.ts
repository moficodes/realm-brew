import {
  HEX_RADIUS,
  axialKey,
  axialToWorld,
  computeExportBounds,
} from '../domain/hexGeometry';
import { formatAssemblyLabel, resolvePlacementAsset } from '../domain/plannerEngine';
import type { Placement, PlacementKey, Tileset } from '../domain/types';
import {
  MAP_CANVAS_BG,
  drawAssemblyLabel,
  drawPlacementGraphic,
  type ImageLookup,
} from './mapRenderer';

export type ExportBackground = 'dark' | 'transparent';

export interface ExportPngOptions {
  mapName: string;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overBudgetCoords: ReadonlySet<PlacementKey>;
  background: ExportBackground;
  includeLabels: boolean;
}

const MAX_EXPORT_CANVAS_PX = 8192;

function slugifyMapName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'realm-brew-map'
  );
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function exportMapAsPng({
  mapName,
  placements,
  tilesetsById,
  overBudgetCoords,
  background,
  includeLabels,
}: ExportPngOptions): Promise<void> {
  const bounds = computeExportBounds(placements, 28, HEX_RADIUS);
  if (!bounds) return;

  const urls = new Set<string>();
  for (const p of placements) {
    const resolved = resolvePlacementAsset(p, tilesetsById);
    if (resolved.status === 'ok') {
      urls.add(resolved.url);
    }
  }

  const loaded = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    Array.from(urls).map(async (url) => {
      loaded.set(url, await loadImage(url));
    }),
  );

  const imageLookup: ImageLookup = {
    get: (url) => loaded.get(url) ?? null,
    isError: (url) => loaded.has(url) && loaded.get(url) === null,
  };

  const preferredScale = 2;
  const maxDim = Math.max(bounds.width, bounds.height);
  const scale = Math.min(preferredScale, MAX_EXPORT_CANVAS_PX / maxDim);
  const pixelWidth = Math.max(1, Math.round(bounds.width * scale));
  const pixelHeight = Math.max(1, Math.round(bounds.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create offscreen 2D canvas context');
  }

  if (background === 'dark') {
    ctx.fillStyle = MAP_CANVAS_BG;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }

  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX, -bounds.minY);

  for (const placement of placements) {
    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);
    drawPlacementGraphic(ctx, x, y, placement, tilesetsById, imageLookup, 1);

    if (includeLabels) {
      drawAssemblyLabel(
        ctx,
        x,
        y,
        placement.rotation,
        formatAssemblyLabel(placement, tilesetsById),
        overBudgetCoords.has(axialKey(placement.q, placement.r)),
      );
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode PNG image'));
    }, 'image/png');
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugifyMapName(mapName)}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
