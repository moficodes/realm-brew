import {
  computeMapExportBounds,
  type AssemblyCalloutLayout,
  type ExportFogMode,
} from '../domain/calloutLayout';
import { countCoveredPlacements, resolveFogTileFaceUrl } from '../domain/fogOfWar';
import { HEX_RADIUS, axialToWorld } from '../domain/hexGeometry';
import { resolveOverlayAsset, resolvePlacementAsset } from '../domain/plannerEngine';
import type { OverlayPack, Placement, Tileset } from '../domain/types';
import { downloadBlob, slugifyFilename } from '../utils/browserHelpers';
import { drawFogOfWarPass } from './fogRenderer';
import {
  MAP_CANVAS_BG,
  computeCanvasAssemblyCalloutLayout,
  drawAssemblyCalloutsPass,
  drawGlobalOverlaysPass,
  drawPlacementGraphic,
  getLoadedOverlayPixelSize,
  type ImageLookup,
} from './mapRenderer';

export type { ExportFogMode };
export type ExportBackground = 'dark' | 'transparent';

export interface ExportPngOptions {
  mapName: string;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  background: ExportBackground;
  includeLabels: boolean;
  fogMode?: ExportFogMode;
}

const MAX_EXPORT_CANVAS_PX = 8192;
const EXPORT_PADDING_WORLD = 28;
const PREFERRED_EXPORT_SCALE = 2;

export function formatExportPngFilename(
  mapName: string,
  fogMode: ExportFogMode,
  coveredCount: number,
): string {
  const slug = slugifyFilename(mapName);
  if (coveredCount <= 0 || fogMode === 'none') {
    return `${slug}.png`;
  }
  return fogMode === 'player' ? `${slug}-player.png` : `${slug}-gm.png`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function preloadExportImages(params: {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  effectiveFogMode: ExportFogMode;
}): Promise<ImageLookup> {
  const { placements, tilesetsById, overlayPacksById, effectiveFogMode } = params;
  const isPlayerFog = effectiveFogMode === 'player';

  const urls = new Set<string>();
  for (const p of placements) {
    const hiddenInPlayerFog = isPlayerFog && Boolean(p.covered);

    if (!hiddenInPlayerFog) {
      const resolvedTile = resolvePlacementAsset(p, tilesetsById);
      if (resolvedTile.status === 'ok') {
        urls.add(resolvedTile.url);
      }

      for (const ov of p.overlays ?? []) {
        const resolvedOverlay = resolveOverlayAsset(ov, overlayPacksById);
        if (resolvedOverlay.status === 'ok') {
          urls.add(resolvedOverlay.url);
        }
      }
    }

    if (effectiveFogMode !== 'none' && p.covered) {
      const fogUrl = resolveFogTileFaceUrl(p.tilesetId, tilesetsById);
      if (fogUrl) {
        urls.add(fogUrl);
      }
    }
  }

  const loaded = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    Array.from(urls).map(async (url) => {
      loaded.set(url, await loadImage(url));
    }),
  );

  // Follow the silent #37 fallback chain for any covered host whose primary #37 failed to load.
  if (effectiveFogMode !== 'none') {
    const isFailed = (url: string) => loaded.has(url) && loaded.get(url) === null;
    for (const p of placements) {
      if (!p.covered) continue;
      while (true) {
        const fallbackFogUrl = resolveFogTileFaceUrl(p.tilesetId, tilesetsById, isFailed);
        if (!fallbackFogUrl || loaded.has(fallbackFogUrl)) {
          break;
        }
        loaded.set(fallbackFogUrl, await loadImage(fallbackFogUrl));
      }
    }
  }

  return {
    get: (url) => loaded.get(url) ?? null,
    isError: (url) => loaded.has(url) && loaded.get(url) === null,
  };
}

export async function exportMapAsPng({
  mapName,
  placements,
  tilesetsById,
  overlayPacksById,
  background,
  includeLabels,
  fogMode = 'gm',
}: ExportPngOptions): Promise<void> {
  if (placements.length === 0) return;

  const coveredCount = countCoveredPlacements(placements);
  const effectiveFogMode: ExportFogMode = coveredCount > 0 ? fogMode : 'none';
  const isPlayerFog = effectiveFogMode === 'player';
  const shouldDrawLabels = includeLabels && !isPlayerFog;

  const imageLookup = await preloadExportImages({
    placements,
    tilesetsById,
    overlayPacksById,
    effectiveFogMode,
  });

  // In "No Fog (all revealed)", strip covered flags for rendering so Pass 3 Overlays are not dimmed.
  const renderPlacements: readonly Placement[] =
    effectiveFogMode === 'none' && coveredCount > 0
      ? placements.map(({ covered: _ignored, ...rest }) => rest)
      : placements;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create offscreen 2D canvas context');
  }

  const calloutLayout: AssemblyCalloutLayout | null = shouldDrawLabels
    ? computeCanvasAssemblyCalloutLayout({
        ctx,
        placements: renderPlacements,
        tilesetsById,
        overlayPacksById,
        imageCache: imageLookup,
      })
    : null;

  const bounds = computeMapExportBounds(renderPlacements, {
    paddingWorld: EXPORT_PADDING_WORLD,
    fogMode: effectiveFogMode,
    includeLabels: shouldDrawLabels,
    getOverlayPixelSize: (ov) => getLoadedOverlayPixelSize(ov, overlayPacksById, imageLookup),
    calloutLayout,
  });
  if (!bounds) return;

  const maxDim = Math.max(bounds.width, bounds.height);
  const scale = Math.min(PREFERRED_EXPORT_SCALE, MAX_EXPORT_CANVAS_PX / maxDim);
  const pixelWidth = Math.max(1, Math.round(bounds.width * scale));
  const pixelHeight = Math.max(1, Math.round(bounds.height * scale));

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  // Pass 1: Background (or transparent) — grid suppressed
  if (background === 'dark') {
    ctx.fillStyle = MAP_CANVAS_BG;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX, -bounds.minY);

  // Pass 2: Base Tiles & missing-Tile placeholders (suppressing selection & over-budget styling)
  for (const placement of renderPlacements) {
    if (isPlayerFog && placement.covered) {
      continue;
    }
    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);
    drawPlacementGraphic(ctx, x, y, placement, tilesetsById, imageLookup, 1);
  }

  // Pass 3: Global Overlay Placements above all Tiles
  drawGlobalOverlaysPass({
    ctx,
    placements: renderPlacements,
    overlayPacksById,
    imageCache: imageLookup,
    viewMode: isPlayerFog ? 'player' : 'gm',
  });

  // Pass 4: #37 Fog of War above Overlays
  if (effectiveFogMode !== 'none') {
    drawFogOfWarPass({
      ctx,
      placements: renderPlacements,
      tilesetsById,
      imageCache: imageLookup,
      mode: effectiveFogMode,
      zoom: 1,
    });
  }

  // Pass 5: Shared Assembly Callouts (when enabled and not Player Fog, isOverBudget = false)
  if (shouldDrawLabels && calloutLayout) {
    drawAssemblyCalloutsPass({
      ctx,
      placements: renderPlacements,
      tilesetsById,
      overlayPacksById,
      imageCache: imageLookup,
      layout: calloutLayout,
    });
  }

  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode PNG image'));
    }, 'image/png');
  });

  downloadBlob(blob, formatExportPngFilename(mapName, effectiveFogMode, coveredCount));
}
