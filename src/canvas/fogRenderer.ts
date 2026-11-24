import {
  FOG_FALLBACK_FILL,
  resolveFogTileFaceUrl,
} from '../domain/fogOfWar';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  axialToWorld,
  rotationToRadians,
} from '../domain/hexGeometry';
import { findPlacementAt } from '../domain/plannerEngine';
import type { AxialCoord, Placement, RotationStep, Tileset } from '../domain/types';
import { traceHexPath } from './mapRenderer';

export interface FogImageLookup {
  get: (url: string) => HTMLImageElement | null;
  isError: (url: string) => boolean;
}

export interface FogDragMovePreview {
  from: AxialCoord;
  to: AxialCoord | null;
}

function drawFogBadgeIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  alpha = 1,
): void {
  const badgeX = cx - HEX_RADIUS * 0.42;
  const badgeY = cy - HEX_RADIUS * 0.58;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(22, 20, 18, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.72)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Minimal cloud + mist icon
  ctx.translate(badgeX, badgeY - 1);
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(-2.5, 0.5, 2.7, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(0, -1.5, 3.1, Math.PI, 0);
  ctx.arc(3, 0.5, 2.3, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.25;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-4, 4.5);
  ctx.lineTo(4, 4.5);
  ctx.stroke();
  ctx.restore();
}

function drawSingleFogCover(params: {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  rotation: RotationStep;
  fogImg: HTMLImageElement | null;
  mode: 'gm' | 'player';
  zoom: number;
  gmAlpha: number;
}): void {
  const { ctx, cx, cy, rotation, fogImg, mode, zoom, gmAlpha } = params;
  const hasImage = Boolean(fogImg && fogImg.naturalWidth > 0 && fogImg.naturalHeight > 0);

  if (mode === 'player') {
    // Opaque hex-clipped #1c1a18 base + #37 artwork cleanly clips revealed neighbors' overhangs
    ctx.save();
    traceHexPath(ctx, cx, cy, HEX_RADIUS);
    ctx.clip();
    ctx.fillStyle = FOG_FALLBACK_FILL;
    ctx.fill();
    if (hasImage && fogImg) {
      ctx.translate(cx, cy);
      ctx.rotate(rotationToRadians(rotation));
      ctx.drawImage(fogImg, -HEX_WIDTH / 2, -HEX_HEIGHT / 2, HEX_WIDTH, HEX_HEIGHT);
    }
    ctx.restore();
    return;
  }

  // GM View: semi-transparent ~60% #37 cover + dashed border + subtle Fog badge
  ctx.save();
  traceHexPath(ctx, cx, cy, HEX_RADIUS);
  ctx.clip();
  ctx.globalAlpha = gmAlpha;
  if (hasImage && fogImg) {
    ctx.translate(cx, cy);
    ctx.rotate(rotationToRadians(rotation));
    ctx.drawImage(fogImg, -HEX_WIDTH / 2, -HEX_HEIGHT / 2, HEX_WIDTH, HEX_HEIGHT);
  } else {
    ctx.fillStyle = FOG_FALLBACK_FILL;
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.min(1, gmAlpha / 0.6);
  traceHexPath(ctx, cx, cy, HEX_RADIUS - 3);
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.72)';
  ctx.lineWidth = Math.max(1.5, 2 / zoom);
  ctx.stroke();
  ctx.restore();

  drawFogBadgeIcon(ctx, cx, cy, Math.min(1, gmAlpha / 0.6));
}

/** Pass 4: Render Fog of War #37 covers above the global Overlay pass. */
export function drawFogOfWarPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  imageCache: FogImageLookup;
  mode: 'gm' | 'player';
  zoom?: number;
  dragMove?: FogDragMovePreview | null;
}): void {
  const {
    ctx,
    placements,
    tilesetsById,
    imageCache,
    mode,
    zoom = 1,
    dragMove = null,
  } = params;

  const resolveFogImg = (tilesetId: string): HTMLImageElement | null => {
    const url = resolveFogTileFaceUrl(tilesetId, tilesetsById, (u) => imageCache.isError(u));
    return url ? imageCache.get(url) : null;
  };

  for (const placement of placements) {
    if (!placement.covered) continue;

    const isDragOrigin =
      mode === 'gm' &&
      dragMove !== null &&
      placement.q === dragMove.from.q &&
      placement.r === dragMove.from.r;
    if (isDragOrigin && dragMove?.to) {
      continue;
    }

    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);
    drawSingleFogCover({
      ctx,
      cx: x,
      cy: y,
      rotation: placement.rotation,
      fogImg: resolveFogImg(placement.tilesetId),
      mode,
      zoom,
      gmAlpha: isDragOrigin ? 0.22 : 0.6,
    });
  }

  if (mode === 'gm' && dragMove && dragMove.to) {
    const moving = findPlacementAt(placements, dragMove.from);
    if (moving && moving.covered) {
      const { x, y } = axialToWorld(dragMove.to.q, dragMove.to.r, HEX_RADIUS);
      drawSingleFogCover({
        ctx,
        cx: x,
        cy: y,
        rotation: moving.rotation,
        fogImg: resolveFogImg(moving.tilesetId),
        mode: 'gm',
        zoom,
        gmAlpha: 0.43,
      });
    }
  }
}
