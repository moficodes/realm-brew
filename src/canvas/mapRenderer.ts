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
import {
  findPlacementAt,
  formatAssemblyLabel,
  resolvePlacementAsset,
} from '../domain/plannerEngine';
import type { AxialCoord, BrushSelection, Placement, PlacementKey, RotationStep, Tileset } from '../domain/types';

export const MAP_CANVAS_BG = '#221f1c';

export interface ImageLookup {
  get: (url: string) => HTMLImageElement | null;
  isError: (url: string) => boolean;
}

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
  imageCache: ImageLookup;
  showGrid: boolean;
  showLabels: boolean;
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

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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

function drawMissingPlaceholderHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilesetLabel: string,
  faceNumber: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  traceHexPath(ctx, cx, cy, HEX_RADIUS - 1);
  ctx.fillStyle = '#292123';
  ctx.fill();

  traceHexPath(ctx, cx, cy, HEX_RADIUS - 5);
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  const paddedFace = String(faceNumber).padStart(2, '0');
  const shortLabel = tilesetLabel.length > 14 ? `${tilesetLabel.slice(0, 13)}…` : tilesetLabel;

  ctx.fillStyle = '#fbbf24';
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MISSING ASSET', cx, cy - 12);

  ctx.fillStyle = '#e7e5e4';
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${shortLabel} #${paddedFace}`, cx, cy + 10);
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

export function drawAssemblyLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rotation: RotationStep,
  label: string,
  isOverBudget = false,
): void {
  // Subtle orientation arrow marking the Tile's native 0° top edge
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationToRadians(rotation));
  const tipY = -HEX_HEIGHT / 2 + 6;
  const baseY = tipY + 11;
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(-7, baseY);
  ctx.lineTo(7, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(251, 191, 36, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(22, 20, 18, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Compact centered <ShortCode> #<Face> pill badge (upright)
  ctx.save();
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  const textWidth = ctx.measureText(label).width;
  const pillWidth = Math.max(64, textWidth + 18);
  const pillHeight = 24;
  const rx = cx - pillWidth / 2;
  const ry = cy - pillHeight / 2;

  drawRoundedRect(ctx, rx, ry, pillWidth, pillHeight, 6);
  ctx.fillStyle = 'rgba(22, 20, 18, 0.86)';
  ctx.fill();
  ctx.strokeStyle = isOverBudget ? 'rgba(239, 68, 68, 0.9)' : 'rgba(245, 158, 11, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = isOverBudget ? '#fca5a5' : '#fef3c7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 0.5);
  ctx.restore();
}

export function drawPlacementGraphic(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  placement: Pick<Placement, 'tilesetId' | 'tileId' | 'faceNumber' | 'rotation'>,
  tilesetsById: ReadonlyMap<string, Tileset>,
  imageCache: ImageLookup,
  alpha = 1,
): void {
  const asset = resolvePlacementAsset(
    { ...placement, q: 0, r: 0 },
    tilesetsById,
  );
  if (asset.status !== 'ok' || imageCache.isError(asset.url)) {
    drawMissingPlaceholderHex(
      ctx,
      cx,
      cy,
      asset.shortCode ?? placement.tilesetId,
      placement.faceNumber,
      alpha,
    );
    return;
  }

  const img = imageCache.get(asset.url);
  drawTileFaceAt(ctx, cx, cy, placement.rotation, img, alpha);
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
  showLabels,
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
    const isOverBudget = overBudgetCoords.has(axialKey(placement.q, placement.r));
    const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);

    drawPlacementGraphic(
      ctx,
      x,
      y,
      placement,
      tilesetsById,
      imageCache,
      isDragOrigin ? 0.28 : 1,
    );

    if (!isDragOrigin && isOverBudget) {
      drawOverBudgetOutline(ctx, x, y, camera.zoom);
    }

    if (!isDragOrigin && showLabels) {
      drawAssemblyLabel(
        ctx,
        x,
        y,
        placement.rotation,
        formatAssemblyLabel(placement, tilesetsById),
        isOverBudget,
      );
    }
  }

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
  } else if (hoveredCoord && activeBrush) {
    const { x, y } = axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS);
    drawPlacementGraphic(ctx, x, y, activeBrush, tilesetsById, imageCache, 0.55);

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
