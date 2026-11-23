// THROWAWAY PROTOTYPE RENDER HELPERS for Wayfinder #13

import {
  drawAssemblyLabel,
  drawPlacementGraphic,
  MAP_CANVAS_BG,
  traceHexPath,
  type DragMovePreview,
  type ImageLookup,
} from '../canvas/mapRenderer';
import {
  axialToWorld,
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  screenToWorld,
  type Camera,
} from '../domain/hexGeometry';
import { findPlacementAt, formatAssemblyLabel } from '../domain/plannerEngine';
import type { AxialCoord, Tileset } from '../domain/types';
import {
  getOverlayWorldSize,
  overlayLocalToWorld,
  type ProtoOverlayPlacement,
  type ProtoPlacement,
} from './overlayPrototypeModel';

export function drawProtoHexGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
): void {
  const topLeft = screenToWorld(0, 0, width, height, camera);
  const bottomRight = screenToWorld(width, height, width, height, camera);
  const minX = topLeft.x - HEX_WIDTH;
  const maxX = bottomRight.x + HEX_WIDTH;
  const minY = topLeft.y - HEX_HEIGHT;
  const maxY = bottomRight.y + HEX_HEIGHT;

  const qMin = Math.floor(minX / (1.5 * HEX_RADIUS)) - 1;
  const qMax = Math.ceil(maxX / (1.5 * HEX_RADIUS)) + 1;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1 / camera.zoom;

  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor(minY / HEX_HEIGHT - q / 2) - 1;
    const rMax = Math.ceil(maxY / HEX_HEIGHT - q / 2) + 1;
    for (let r = rMin; r <= rMax; r++) {
      const { x, y } = axialToWorld(q, r, HEX_RADIUS);
      traceHexPath(ctx, x, y, HEX_RADIUS);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawBaseMapTiles(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  camera: Camera;
  placements: readonly ProtoPlacement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  imageCache: ImageLookup;
  showGrid: boolean;
  showLabels?: boolean;
  dragMove?: DragMovePreview | null;
  tileAlpha?: number;
}): void {
  const {
    ctx,
    width,
    height,
    camera,
    placements,
    tilesetsById,
    imageCache,
    showGrid,
    showLabels = false,
    dragMove = null,
    tileAlpha = 1,
  } = params;

  ctx.fillStyle = MAP_CANVAS_BG;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  if (showGrid) {
    drawProtoHexGrid(ctx, width, height, camera);
  }

  for (const placement of placements) {
    const isDragOrigin =
      dragMove !== null &&
      placement.q === dragMove.from.q &&
      placement.r === dragMove.from.r;
    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);

    drawPlacementGraphic(
      ctx,
      x,
      y,
      placement,
      tilesetsById,
      imageCache,
      isDragOrigin ? 0.28 : tileAlpha,
    );

    if (!isDragOrigin && showLabels) {
      drawAssemblyLabel(
        ctx,
        x,
        y,
        placement.rotation,
        formatAssemblyLabel(placement, tilesetsById),
        false,
      );
    }
  }

  if (dragMove && dragMove.to) {
    const moving = findPlacementAt(placements, dragMove.from);
    if (moving) {
      const { x, y } = axialToWorld(dragMove.to.q, dragMove.to.r, HEX_RADIUS);
      const isOccupiedTarget =
        (dragMove.to.q !== dragMove.from.q || dragMove.to.r !== dragMove.from.r) &&
        Boolean(findPlacementAt(placements, dragMove.to));

      drawPlacementGraphic(ctx, x, y, moving, tilesetsById, imageCache, 0.72);
      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
      ctx.strokeStyle = isOccupiedTarget ? '#38bdf8' : '#fbbf24';
      ctx.lineWidth = Math.max(2.5, 3 / camera.zoom);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawSingleOverlayGraphic(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  wx: number,
  wy: number,
  worldRad: number,
  alpha: number,
  labelFallback: string,
): void {
  const { width, height } = getOverlayWorldSize(img);
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;

  if (img) {
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.fillStyle = '#e0f2fe';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelFallback.slice(0, 10), 0, 0);
  }
  ctx.restore();
}

export function drawGlobalOverlaysPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly ProtoPlacement[];
  imageCache: ImageLookup;
  skipOverlayId?: string | null;
  dimOverlayId?: string | null;
  dragMove?: DragMovePreview | null;
  defaultAlpha?: number;
}): void {
  const {
    ctx,
    placements,
    imageCache,
    skipOverlayId = null,
    dimOverlayId = null,
    dragMove = null,
    defaultAlpha = 1,
  } = params;

  for (const host of placements) {
    const isDragOrigin =
      dragMove !== null &&
      host.q === dragMove.from.q &&
      host.r === dragMove.from.r;
    if (isDragOrigin && dragMove.to) {
      continue;
    }

    for (const ov of host.overlays) {
      if (skipOverlayId && ov.id === skipOverlayId) continue;
      const t = overlayLocalToWorld(host, ov);
      const img = imageCache.get(ov.url);
      const alpha =
        dimOverlayId && ov.id === dimOverlayId
          ? 0.25
          : isDragOrigin
            ? 0.28
            : defaultAlpha;
      drawSingleOverlayGraphic(ctx, img, t.x, t.y, t.worldRad, alpha, ov.label);
    }
  }

  // Draw moving host Tile's overlays at destination preview
  if (dragMove && dragMove.to) {
    const movingHost = placements.find(
      (p) => p.q === dragMove.from.q && p.r === dragMove.from.r,
    );
    if (movingHost) {
      const ghostHost: ProtoPlacement = {
        ...movingHost,
        q: dragMove.to.q,
        r: dragMove.to.r,
      };
      for (const ov of movingHost.overlays) {
        const t = overlayLocalToWorld(ghostHost, ov);
        const img = imageCache.get(ov.url);
        drawSingleOverlayGraphic(ctx, img, t.x, t.y, t.worldRad, 0.72, ov.label);
      }
    }
  }
}

export function drawOverlayOBB(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  width: number,
  height: number,
  worldRad: number,
  strokeColor: string,
  lineWidth: number,
  dashed = false,
): void {
  const boxW = Math.max(width, 28);
  const boxH = Math.max(height, 28);
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  if (dashed) {
    ctx.setLineDash([5, 4]);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.restore();
}

export function drawHostTether(
  ctx: CanvasRenderingContext2D,
  hostCoord: AxialCoord,
  wx: number,
  wy: number,
  color: string,
  zoom: number,
): void {
  const hostCenter = axialToWorld(hostCoord.q, hostCoord.r, HEX_RADIUS);
  ctx.save();
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, 1.5 / zoom);
  ctx.beginPath();
  ctx.moveTo(hostCenter.x, hostCenter.y);
  ctx.lineTo(wx, wy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(hostCenter.x, hostCenter.y, Math.max(3, 4 / zoom), 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(wx, wy, Math.max(2.5, 3 / zoom), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawHexOutline(
  ctx: CanvasRenderingContext2D,
  coord: AxialCoord,
  strokeColor: string,
  lineWidth: number,
  dashed = false,
  fillColor?: string,
): void {
  const { x, y } = axialToWorld(coord.q, coord.r, HEX_RADIUS);
  ctx.save();
  traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (dashed) {
    ctx.setLineDash([7, 5]);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

export function drawWorldBadge(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  text: string,
  bgColor: string,
  borderColor: string,
  textColor: string,
  zoom: number,
): void {
  ctx.save();
  ctx.translate(wx, wy);
  ctx.scale(1 / zoom, 1 / zoom);
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const pw = tw + 14;
  const ph = 22;
  ctx.beginPath();
  ctx.roundRect(-pw / 2, -ph / 2, pw, ph, 6);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

export function drawInvalidEmptyHexFeedback(
  ctx: CanvasRenderingContext2D,
  coord: AxialCoord,
  zoom: number,
  message = 'Needs a host Tile',
): void {
  const { x, y } = axialToWorld(coord.q, coord.r, HEX_RADIUS);
  drawHexOutline(
    ctx,
    coord,
    'rgba(239, 68, 68, 0.9)',
    Math.max(2, 2.5 / zoom),
    true,
    'rgba(239, 68, 68, 0.12)',
  );
  drawWorldBadge(
    ctx,
    x,
    y + 42,
    message,
    'rgba(69, 10, 10, 0.92)',
    'rgba(239, 68, 68, 0.75)',
    '#fecaca',
    zoom,
  );
}

export function drawOverlayGhost(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  wx: number,
  wy: number,
  worldRad: number,
  alpha: number,
  tintInvalid = false,
  labelFallback = 'Overlay',
): void {
  const { width, height } = getOverlayWorldSize(img);
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;

  if (img) {
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    if (tintInvalid) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fillRect(-width / 2, -height / 2, width, height);
    }
  } else {
    ctx.fillStyle = tintInvalid ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.2)';
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.fillStyle = '#e7e5e4';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelFallback.slice(0, 12), 0, 0);
  }

  ctx.strokeStyle = tintInvalid ? '#ef4444' : '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

export function getOverlayAnchorWorld(
  host: ProtoPlacement,
  ov: ProtoOverlayPlacement,
): { x: number; y: number; worldDeg: number; worldRad: number } {
  return overlayLocalToWorld(host, ov);
}
