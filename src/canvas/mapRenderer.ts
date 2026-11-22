import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  axialKey,
  axialToWorld,
  hexCorners,
  rotationToRadians,
  screenToWorld,
  type Camera,
} from '../domain/hexGeometry';
import { findPlacementAt } from '../domain/plannerEngine';
import type { AxialCoord, BrushSelection, Placement, PlacementKey, RotationStep, Tileset } from '../domain/types';
import type { TileImageCache } from './imageCache';

export const MAP_CANVAS_BG = '#221f1c';

export interface DragMovePreview {
  from: AxialCoord;
  to: AxialCoord | null;
}

export interface ViewportRenderParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  camera: Camera;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  imageCache: TileImageCache;
  showGrid: boolean;
  hoveredCoord: AxialCoord | null;
  selectedCoord: AxialCoord | null;
  activeBrush: BrushSelection | null;
  overBudgetCoords: ReadonlySet<PlacementKey>;
  dragMove: DragMovePreview | null;
}

export function traceHexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius = HEX_RADIUS,
): void {
  const corners = hexCorners(cx, cy, radius);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
}

export function resolveFaceUrl(
  tilesetsById: ReadonlyMap<string, Tileset>,
  tilesetId: string,
  faceNumber: number,
): string | null {
  const tileset = tilesetsById.get(tilesetId);
  if (!tileset) return null;
  for (const tile of tileset.tiles) {
    if (tile.faceA.faceNumber === faceNumber) return tile.faceA.url;
    if (tile.faceB.faceNumber === faceNumber) return tile.faceB.url;
  }
  return null;
}

function drawHexGrid(
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

function drawTileFaceAt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rotation: RotationStep,
  image: HTMLImageElement | null,
  alpha = 1,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationToRadians(rotation));
  ctx.globalAlpha = alpha;

  if (image) {
    ctx.drawImage(image, -HEX_WIDTH / 2, -HEX_HEIGHT / 2, HEX_WIDTH, HEX_HEIGHT);
  } else {
    traceHexPath(ctx, 0, 0, HEX_RADIUS);
    ctx.fillStyle = '#2d2823';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawOverBudgetOutline(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  zoom: number,
): void {
  ctx.save();
  traceHexPath(ctx, cx, cy, HEX_RADIUS - 2);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = Math.max(2.5, 3 / zoom);
  ctx.stroke();

  const badgeX = cx + HEX_RADIUS * 0.42;
  const badgeY = cy - HEX_RADIUS * 0.62;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#161412';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', badgeX, badgeY + 0.5);
  ctx.restore();
}

export function renderMapViewport({
  ctx,
  width,
  height,
  camera,
  placements,
  tilesetsById,
  imageCache,
  showGrid,
  hoveredCoord,
  selectedCoord,
  activeBrush,
  overBudgetCoords,
  dragMove,
}: ViewportRenderParams): void {
  ctx.save();
  ctx.fillStyle = MAP_CANVAS_BG;
  ctx.fillRect(0, 0, width, height);

  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  if (showGrid) {
    drawHexGrid(ctx, width, height, camera);
  }

  for (const placement of placements) {
    const isDragOrigin =
      dragMove !== null &&
      placement.q === dragMove.from.q &&
      placement.r === dragMove.from.r;
    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);
    const url = resolveFaceUrl(tilesetsById, placement.tilesetId, placement.faceNumber);
    const img = url ? imageCache.get(url) : null;
    drawTileFaceAt(ctx, x, y, placement.rotation, img, isDragOrigin ? 0.28 : 1);

    if (!isDragOrigin && overBudgetCoords.has(axialKey(placement.q, placement.r))) {
      drawOverBudgetOutline(ctx, x, y, camera.zoom);
    }
  }

  // Highlight selected Placement
  if (selectedCoord && !dragMove) {
    const selectedPlacement = findPlacementAt(placements, selectedCoord);
    if (selectedPlacement) {
      const { x, y } = axialToWorld(selectedPlacement.q, selectedPlacement.r, HEX_RADIUS);
      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(3, 3.5 / camera.zoom);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Preview dragging an existing Placement to empty/occupied target hex
  if (dragMove && dragMove.to) {
    const moving = findPlacementAt(placements, dragMove.from);
    if (moving) {
      const { x, y } = axialToWorld(dragMove.to.q, dragMove.to.r, HEX_RADIUS);
      const url = resolveFaceUrl(tilesetsById, moving.tilesetId, moving.faceNumber);
      const img = url ? imageCache.get(url) : null;
      const isOccupiedTarget =
        (dragMove.to.q !== dragMove.from.q || dragMove.to.r !== dragMove.from.r) &&
        Boolean(findPlacementAt(placements, dragMove.to));

      drawTileFaceAt(ctx, x, y, moving.rotation, img, 0.72);
      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
      ctx.strokeStyle = isOccupiedTarget ? '#38bdf8' : '#fbbf24';
      ctx.lineWidth = Math.max(2.5, 3 / camera.zoom);
      ctx.stroke();
      ctx.restore();
    }
  } else if (hoveredCoord && activeBrush) {
    const { x, y } = axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS);
    const url = resolveFaceUrl(tilesetsById, activeBrush.tilesetId, activeBrush.faceNumber);
    const img = url ? imageCache.get(url) : null;
    drawTileFaceAt(ctx, x, y, activeBrush.rotation, img, 0.55);

    ctx.save();
    traceHexPath(ctx, x, y, HEX_RADIUS - 1);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.stroke();
    ctx.restore();
  } else if (hoveredCoord) {
    const { x, y } = axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS);
    ctx.save();
    traceHexPath(ctx, x, y, HEX_RADIUS - 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}
