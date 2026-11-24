import {
  OVERLAY_CALLOUT_HEIGHT,
  layoutAssemblyCallouts,
} from '../domain/calloutLayout';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  axialKey,
  axialToWorld,
  hexCorners,
  rotationToRadians,
  screenToWorld,
  worldToAxial,
  type Camera,
  type Point2D,
} from '../domain/hexGeometry';
import {
  MIN_OVERLAY_HIT_SIZE,
  MISSING_OVERLAY_HEIGHT,
  MISSING_OVERLAY_WIDTH,
  clampWorldPointToHostHex,
  getOverlayDialGeometry,
  getOverlayWorldSize,
  overlayLocalToWorld,
  type OverlayHit,
} from '../domain/overlayGeometry';
import {
  findOverlayById,
  findPlacementAt,
  resolveOverlayAsset,
  resolvePlacementAsset,
  type PullListHighlight,
} from '../domain/plannerEngine';
import {
  padFaceNumber,
  type ActiveBrush,
  type AxialCoord,
  type OverlayPack,
  type OverlayPlacement,
  type Placement,
  type PlacementKey,
  type RotationStep,
  type Tileset,
} from '../domain/types';

export const MAP_CANVAS_BG = '#221f1c';

export interface ImageLookup {
  get: (url: string) => HTMLImageElement | null;
  isError: (url: string) => boolean;
}

export interface DragMovePreview {
  from: AxialCoord;
  to: AxialCoord | null;
}

export interface OverlayDragPreview {
  fromHostCoord: AxialCoord;
  overlayId: string;
  overlay: Pick<OverlayPlacement, 'overlayPackId' | 'overlayId'>;
  worldX: number;
  worldY: number;
  worldDeg: number;
  worldRad: number;
  targetHostCoord: AxialCoord;
  reparenting: boolean;
  hoveredEmptyCoord: AxialCoord | null;
}

export interface OverlayRotationPreview {
  hostCoord: AxialCoord;
  overlayId: string;
  worldDeg: number;
  source: 'dial' | 'slider';
}

export interface ViewportRenderParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  camera: Camera;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache: ImageLookup;
  showGrid: boolean;
  showLabels: boolean;
  hoveredCoord: AxialCoord | null;
  hoveredWorldPos?: Point2D | null;
  selectedCoord: AxialCoord | null;
  focusedOverlayId?: string | null;
  hoveredOverlayHit?: OverlayHit | null;
  hoveredInspectorOverlayId?: string | null;
  pullListHighlight?: PullListHighlight | null;
  activeBrush: ActiveBrush | null;
  overBudgetCoords: ReadonlySet<PlacementKey>;
  overBudgetOverlayIds?: ReadonlySet<string>;
  showOverBudgetCues?: boolean;
  dragMove: DragMovePreview | null;
  overlayDrag?: OverlayDragPreview | null;
  overlayRotationPreview?: OverlayRotationPreview | null;
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

  const paddedFace = padFaceNumber(faceNumber);
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

function drawMissingOverlayPlaceholder(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  worldRad: number,
  overlayId: string,
  alpha = 1,
): void {
  const w = MISSING_OVERLAY_WIDTH;
  const h = MISSING_OVERLAY_HEIGHT;

  // Rotated 72x44 dashed amber rounded-rectangle placeholder
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;
  drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fillStyle = 'rgba(41, 33, 35, 0.92)';
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Upright amber warning badge + truncated <overlayId> label
  const truncatedId = overlayId.length > 10 ? `${overlayId.slice(0, 9)}…` : overlayId;
  ctx.save();
  ctx.translate(wx, wy);
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.arc(0, -9, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#f59e0b';
  ctx.fill();
  ctx.fillStyle = '#161412';
  ctx.font = '800 9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, -8.5);

  ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  const textWidth = ctx.measureText(truncatedId).width;
  const pillW = Math.max(textWidth + 8, 28);
  drawRoundedRect(ctx, -pillW / 2, 2, pillW, 15, 4);
  ctx.fillStyle = 'rgba(22, 20, 18, 0.88)';
  ctx.fill();
  ctx.fillStyle = '#fde68a';
  ctx.fillText(truncatedId, 0, 10);
  ctx.restore();
}

function drawLoadingOverlayBox(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  worldRad: number,
  alpha = 1,
): void {
  const w = MISSING_OVERLAY_WIDTH;
  const h = MISSING_OVERLAY_HEIGHT;
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;
  drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fillStyle = '#2d2823';
  ctx.fill();
  ctx.strokeStyle = 'rgba(168, 162, 158, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawOverlayPlacementGraphic(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  worldRad: number,
  overlay: Pick<OverlayPlacement, 'overlayPackId' | 'overlayId'>,
  overlayPacksById: ReadonlyMap<string, OverlayPack>,
  imageCache: ImageLookup,
  alpha = 1,
): void {
  const asset = resolveOverlayAsset(overlay, overlayPacksById);
  if (asset.status !== 'ok' || imageCache.isError(asset.url)) {
    drawMissingOverlayPlaceholder(ctx, wx, wy, worldRad, overlay.overlayId, alpha);
    return;
  }

  const img = imageCache.get(asset.url);
  if (!img) {
    drawLoadingOverlayBox(ctx, wx, wy, worldRad, alpha);
    return;
  }
  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    drawMissingOverlayPlaceholder(ctx, wx, wy, worldRad, overlay.overlayId, alpha);
    return;
  }

  const { width, height } = getOverlayWorldSize({
    width: img.naturalWidth,
    height: img.naturalHeight,
  });
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -width / 2, -height / 2, width, height);
  ctx.restore();
}

/** Resolve the rendered world dimensions of an Overlay Placement (1:1 image or 72x44 fallback). */
export function resolveOverlayRenderWorldSize(
  overlay: Pick<OverlayPlacement, 'overlayPackId' | 'overlayId'>,
  overlayPacksById: ReadonlyMap<string, OverlayPack>,
  imageCache: ImageLookup,
): { width: number; height: number } {
  const asset = resolveOverlayAsset(overlay, overlayPacksById);
  if (asset.status !== 'ok' || imageCache.isError(asset.url)) {
    return getOverlayWorldSize(null);
  }
  const img = imageCache.get(asset.url);
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return getOverlayWorldSize(null);
  }
  return getOverlayWorldSize({ width: img.naturalWidth, height: img.naturalHeight });
}

/** Pass 3: Render all Overlay Placements globally above all Tiles in deterministic host/stack order. */
export function drawGlobalOverlaysPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly Placement[];
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache: ImageLookup;
  dragMove?: DragMovePreview | null;
  skipOverlayId?: string | null;
  overlayRotationPreview?: OverlayRotationPreview | null;
}): void {
  const {
    ctx,
    placements,
    overlayPacksById,
    imageCache,
    dragMove = null,
    skipOverlayId = null,
    overlayRotationPreview = null,
  } = params;

  for (const host of placements) {
    const isDragOrigin =
      dragMove !== null && host.q === dragMove.from.q && host.r === dragMove.from.r;
    if (isDragOrigin && dragMove.to) {
      continue;
    }

    const alpha = isDragOrigin ? 0.28 : 1;
    for (const ov of host.overlays ?? []) {
      if (skipOverlayId && ov.id === skipOverlayId) {
        continue;
      }
      const t = overlayLocalToWorld(host, ov);
      const worldRad =
        overlayRotationPreview && overlayRotationPreview.overlayId === ov.id
          ? (overlayRotationPreview.worldDeg * Math.PI) / 180
          : t.worldRad;
      drawOverlayPlacementGraphic(ctx, t.x, t.y, worldRad, ov, overlayPacksById, imageCache, alpha);
    }
  }

  if (dragMove && dragMove.to) {
    const movingHost = findPlacementAt(placements, dragMove.from);
    if (movingHost && movingHost.overlays && movingHost.overlays.length > 0) {
      const previewHost: Placement = {
        ...movingHost,
        q: dragMove.to.q,
        r: dragMove.to.r,
      };
      for (const ov of movingHost.overlays) {
        if (skipOverlayId && ov.id === skipOverlayId) {
          continue;
        }
        const t = overlayLocalToWorld(previewHost, ov);
        drawOverlayPlacementGraphic(ctx, t.x, t.y, t.worldRad, ov, overlayPacksById, imageCache, 0.72);
      }
    }
  }
}

function drawOverlayOBB(
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
  const boxW = Math.max(width, MIN_OVERLAY_HIT_SIZE);
  const boxH = Math.max(height, MIN_OVERLAY_HIT_SIZE);
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

function drawHostTether(
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

function drawWorldBadge(
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
  drawRoundedRect(ctx, -pw / 2, -ph / 2, pw, ph, 6);
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

function drawInvalidEmptyHexFeedback(
  ctx: CanvasRenderingContext2D,
  coord: AxialCoord,
  zoom: number,
  message: string,
): void {
  const hexCenter = axialToWorld(coord.q, coord.r, HEX_RADIUS);
  ctx.save();
  traceHexPath(ctx, hexCenter.x, hexCenter.y, HEX_RADIUS - 1.5);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
  ctx.fill();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
  ctx.lineWidth = Math.max(2, 2.5 / zoom);
  ctx.stroke();
  ctx.restore();

  drawWorldBadge(
    ctx,
    hexCenter.x,
    hexCenter.y + 42,
    message,
    'rgba(69, 10, 10, 0.92)',
    'rgba(239, 68, 68, 0.75)',
    '#fecaca',
    zoom,
  );
}

function drawOverlayBrushGhost(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  wx: number,
  wy: number,
  worldDeg: number,
  alpha: number,
  tintInvalid: boolean,
): void {
  const { width, height } =
    img && img.naturalWidth > 0 && img.naturalHeight > 0
      ? getOverlayWorldSize({ width: img.naturalWidth, height: img.naturalHeight })
      : getOverlayWorldSize(null);
  const worldRad = (worldDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(worldRad);
  ctx.globalAlpha = alpha;

  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    if (tintInvalid) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fillRect(-width / 2, -height / 2, width, height);
    }
  } else {
    drawRoundedRect(ctx, -width / 2, -height / 2, width, height, 6);
    ctx.fillStyle = tintInvalid ? 'rgba(239, 68, 68, 0.22)' : 'rgba(56, 189, 248, 0.2)';
    ctx.fill();
  }

  ctx.strokeStyle = tintInvalid ? '#ef4444' : '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

const TILE_CALLOUT_FONT = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
const OVERLAY_CALLOUT_FONT = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';

function drawOverBudgetOverlayCue(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  width: number,
  height: number,
  worldRad: number,
  zoom: number,
): void {
  const boxW = Math.max(width, MIN_OVERLAY_HIT_SIZE);
  const boxH = Math.max(height, MIN_OVERLAY_HIT_SIZE);
  drawOverlayOBB(
    ctx,
    wx,
    wy,
    boxW,
    boxH,
    worldRad,
    'rgba(239, 68, 68, 0.8)',
    Math.max(1.5, 1.75 / zoom),
    true,
  );

  // Small red `!` badge anchored at the rotated top-right corner of the OBB
  const cos = Math.cos(worldRad);
  const sin = Math.sin(worldRad);
  const localX = boxW / 2;
  const localY = -boxH / 2;
  const badgeX = wx + localX * cos - localY * sin;
  const badgeY = wy + localX * sin + localY * cos;

  ctx.save();
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#161412';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', badgeX, badgeY + 0.5);
  ctx.restore();
}

function drawPullListHighlightPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache: ImageLookup;
  highlight: PullListHighlight;
  zoom: number;
  dragMove: DragMovePreview | null;
}): void {
  const {
    ctx,
    placements,
    tilesetsById,
    overlayPacksById,
    imageCache,
    highlight,
    zoom,
    dragMove,
  } = params;

  for (const host of placements) {
    const isDragOrigin =
      dragMove !== null && host.q === dragMove.from.q && host.r === dragMove.from.r;
    if (isDragOrigin) continue;

    if (
      highlight.kind === 'tile-group' ||
      highlight.kind === 'missing-tile' ||
      highlight.kind === 'host-placement'
    ) {
      let match = false;
      if (highlight.kind === 'host-placement') {
        match = host.q === highlight.coord.q && host.r === highlight.coord.r;
      } else if (highlight.kind === 'missing-tile') {
        match =
          host.tilesetId === highlight.tilesetId &&
          host.tileId === highlight.tileId &&
          host.faceNumber === highlight.faceNumber;
      } else {
        const resolved = resolvePlacementAsset(host, tilesetsById);
        match =
          host.tilesetId === highlight.tilesetId &&
          (resolved.status === 'ok'
            ? resolved.tile.tileId === highlight.tileId
            : host.tileId === highlight.tileId);
      }

      if (match) {
        const { x, y } = axialToWorld(host.q, host.r, HEX_RADIUS);
        ctx.save();
        traceHexPath(ctx, x, y, HEX_RADIUS - 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = Math.max(3, 3.5 / zoom);
        ctx.stroke();
        ctx.restore();
      }
      continue;
    }

    for (const ov of host.overlays ?? []) {
      let match = false;
      if (highlight.kind === 'overlay-placement') {
        match = ov.id === highlight.overlayId;
      } else {
        match =
          ov.overlayPackId === highlight.overlayPackId &&
          ov.overlayId === highlight.overlayId;
      }
      if (!match) continue;

      const t = overlayLocalToWorld(host, ov);
      const { width: ow, height: oh } = resolveOverlayRenderWorldSize(
        ov,
        overlayPacksById,
        imageCache,
      );
      drawOverlayOBB(ctx, t.x, t.y, ow, oh, t.worldRad, '#fbbf24', Math.max(2, 2.5 / zoom), true);
    }
  }
}

/** Pass 5: Render deterministic Tile + Overlay world-space Assembly Callouts and overhang tethers. */
export function drawAssemblyCalloutsPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache: ImageLookup;
  overBudgetCoords?: ReadonlySet<PlacementKey>;
  overBudgetOverlayIds?: ReadonlySet<string>;
  skipHostCoord?: AxialCoord | null;
  skipOverlayId?: string | null;
  hiddenHostCoords?: ReadonlySet<PlacementKey>;
}): void {
  const {
    ctx,
    placements,
    tilesetsById,
    overlayPacksById,
    imageCache,
    overBudgetCoords,
    overBudgetOverlayIds,
    skipHostCoord = null,
    skipOverlayId = null,
    hiddenHostCoords,
  } = params;

  const measureText = (text: string, variant: 'tile' | 'overlay'): number => {
    ctx.font = variant === 'tile' ? TILE_CALLOUT_FONT : OVERLAY_CALLOUT_FONT;
    return ctx.measureText(text).width;
  };

  const getOverlayPixelSize = (ov: OverlayPlacement) => {
    const asset = resolveOverlayAsset(ov, overlayPacksById);
    if (asset.status !== 'ok' || imageCache.isError(asset.url)) {
      return null;
    }
    const img = imageCache.get(asset.url);
    if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return null;
    }
    return { width: img.naturalWidth, height: img.naturalHeight };
  };

  const layout = layoutAssemblyCallouts({
    placements,
    tilesetsById,
    overlayPacksById,
    overBudgetCoords,
    overBudgetOverlayIds,
    getOverlayPixelSize,
    skipHostCoord,
    skipOverlayId,
    hiddenHostCoords,
    measureText,
  });

  // 5a: Subtle amber dashed host tethers only for overhanging Overlays
  for (const ov of layout.overlayCallouts) {
    if (!ov.showHostTether) continue;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(ov.hostCenterX, ov.hostCenterY);
    ctx.lineTo(ov.anchorX, ov.anchorY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(245, 158, 11, 0.78)';
    ctx.beginPath();
    ctx.arc(ov.anchorX, ov.anchorY, 2.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5b: Thin cyan leader lines connecting displaced Overlay pills back to their anchor
  for (const ov of layout.overlayCallouts) {
    if (!ov.displaced) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(ov.leaderStart.x, ov.leaderStart.y);
    ctx.lineTo(ov.leaderEnd.x, ov.leaderEnd.y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    ctx.arc(ov.anchorX, ov.anchorY, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5c: Host Tile pills & gold 0° orientation arrows
  for (const tile of layout.tileCallouts) {
    drawAssemblyLabel(
      ctx,
      tile.centerX,
      tile.centerY,
      tile.rotation,
      tile.label,
      tile.isOverBudget,
    );
  }

  // 5d: World-space Overlay Placement pills (no orientation tick)
  for (const ov of layout.overlayCallouts) {
    const rx = ov.pillX - ov.pillWidth / 2;
    const ry = ov.pillY - OVERLAY_CALLOUT_HEIGHT / 2;

    ctx.save();
    drawRoundedRect(ctx, rx, ry, ov.pillWidth, OVERLAY_CALLOUT_HEIGHT, 4.5);
    if (ov.isOverBudget) {
      ctx.fillStyle = 'rgba(69, 10, 10, 0.90)';
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.92)';
    } else if (ov.isMissing) {
      ctx.fillStyle = 'rgba(41, 28, 14, 0.90)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
    } else {
      ctx.fillStyle = 'rgba(12, 34, 48, 0.90)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.80)';
    }
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = OVERLAY_CALLOUT_FONT;
    ctx.fillStyle = ov.isOverBudget ? '#fecaca' : ov.isMissing ? '#fde68a' : '#bae6fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ov.label, ov.pillX, ov.pillY + 0.5);
    ctx.restore();
  }
}

export function renderMapViewport({
  ctx,
  width,
  height,
  camera,
  placements,
  tilesetsById,
  overlayPacksById,
  imageCache,
  showGrid,
  showLabels,
  hoveredCoord,
  hoveredWorldPos = null,
  selectedCoord,
  focusedOverlayId = null,
  hoveredOverlayHit = null,
  hoveredInspectorOverlayId = null,
  pullListHighlight = null,
  activeBrush,
  overBudgetCoords,
  overBudgetOverlayIds = new Set<string>(),
  showOverBudgetCues = true,
  dragMove,
  overlayDrag = null,
  overlayRotationPreview = null,
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

  // Pass 2: Base Tiles & missing-Tile placeholders
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
  }

  // Dragged Tile destination preview belongs in Pass 2 beneath Pass 3 Overlays
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

  // Selected host Placement amber outline (drawn beneath Pass 3 Overlays so props stay crisp)
  if (selectedCoord && !dragMove) {
    const selectedPlacement = findPlacementAt(placements, selectedCoord);
    if (selectedPlacement) {
      const { x, y } = axialToWorld(selectedPlacement.q, selectedPlacement.r, HEX_RADIUS);
      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(3, 3.5 / camera.zoom);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Emerald reparent target highlight while dragging an Overlay onto another occupied Placement
  if (overlayDrag && overlayDrag.reparenting) {
    const { x, y } = axialToWorld(
      overlayDrag.targetHostCoord.q,
      overlayDrag.targetHostCoord.r,
      HEX_RADIUS,
    );
    ctx.save();
    traceHexPath(ctx, x, y, HEX_RADIUS - 1.5);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = Math.max(2.5, 3 / camera.zoom);
    ctx.stroke();
    ctx.restore();
  }

  // Pass 3: Global Overlay Placements above all Tiles
  drawGlobalOverlaysPass({
    ctx,
    placements,
    overlayPacksById,
    imageCache,
    dragMove,
    skipOverlayId: overlayDrag?.overlayId ?? null,
    overlayRotationPreview,
  });

  // GM over-budget Overlay cues when Labels is OFF (subtle red dashed rotated OBB + small red `!` badge)
  if (!showLabels && showOverBudgetCues && overBudgetOverlayIds.size > 0) {
    for (const host of placements) {
      const isDragOrigin =
        dragMove !== null && host.q === dragMove.from.q && host.r === dragMove.from.r;
      if (isDragOrigin) continue;

      for (const ov of host.overlays ?? []) {
        if (overlayDrag && overlayDrag.overlayId === ov.id) continue;
        if (!overBudgetOverlayIds.has(ov.id)) continue;

        const t = overlayLocalToWorld(host, ov);
        const worldRad =
          overlayRotationPreview && overlayRotationPreview.overlayId === ov.id
            ? (overlayRotationPreview.worldDeg * Math.PI) / 180
            : t.worldRad;
        const { width: ow, height: oh } = resolveOverlayRenderWorldSize(
          ov,
          overlayPacksById,
          imageCache,
        );
        drawOverBudgetOverlayCue(ctx, t.x, t.y, ow, oh, worldRad, camera.zoom);
      }
    }
  }

  // Pull List hover cross-highlighting (By Pack multi-piece or By Tile single piece)
  if (pullListHighlight && !overlayDrag && !dragMove) {
    drawPullListHighlightPass({
      ctx,
      placements,
      tilesetsById,
      overlayPacksById,
      imageCache,
      highlight: pullListHighlight,
      zoom: camera.zoom,
      dragMove,
    });
  }

  // Inspector hover amber dashed OBB or Canvas hover cyan dashed OBB
  if (hoveredInspectorOverlayId && !overlayDrag) {
    const match = findOverlayById(placements, hoveredInspectorOverlayId);
    if (match) {
      const t = overlayLocalToWorld(match.host, match.overlay);
      const worldRad =
        overlayRotationPreview && overlayRotationPreview.overlayId === match.overlay.id
          ? (overlayRotationPreview.worldDeg * Math.PI) / 180
          : t.worldRad;
      const { width: ow, height: oh } = resolveOverlayRenderWorldSize(
        match.overlay,
        overlayPacksById,
        imageCache,
      );
      drawOverlayOBB(ctx, t.x, t.y, ow, oh, worldRad, '#fbbf24', 2 / camera.zoom, true);
    }
  } else if (
    !overlayDrag &&
    !overlayRotationPreview &&
    !dragMove &&
    !activeBrush &&
    hoveredOverlayHit &&
    hoveredOverlayHit.overlay.id !== focusedOverlayId
  ) {
    drawOverlayOBB(
      ctx,
      hoveredOverlayHit.worldX,
      hoveredOverlayHit.worldY,
      hoveredOverlayHit.width,
      hoveredOverlayHit.height,
      hoveredOverlayHit.worldRad,
      'rgba(56, 189, 248, 0.7)',
      1.5 / camera.zoom,
      true,
    );
  }

  // Focused Overlay child: amber tether + cyan OBB + minimal radial dial ring
  if (focusedOverlayId && !overlayDrag && !dragMove) {
    const focusedMatch = findOverlayById(placements, focusedOverlayId);
    if (focusedMatch) {
      const t = overlayLocalToWorld(focusedMatch.host, focusedMatch.overlay);
      const worldDeg =
        overlayRotationPreview && overlayRotationPreview.overlayId === focusedMatch.overlay.id
          ? overlayRotationPreview.worldDeg
          : t.worldDeg;
      const worldRad = (worldDeg * Math.PI) / 180;
      const { width: ow, height: oh } = resolveOverlayRenderWorldSize(
        focusedMatch.overlay,
        overlayPacksById,
        imageCache,
      );
      const dial = getOverlayDialGeometry(t.x, t.y, ow, oh, worldDeg);

      drawHostTether(ctx, focusedMatch.host, t.x, t.y, '#f59e0b', camera.zoom);
      drawOverlayOBB(ctx, t.x, t.y, ow, oh, worldRad, '#38bdf8', 1.75 / camera.zoom);

      ctx.save();
      ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.beginPath();
      ctx.arc(dial.centerX, dial.centerY, dial.ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(dial.knobX, dial.knobY, 6 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#0ea5e9';
      ctx.fill();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.stroke();
      ctx.restore();

      if (
        overlayRotationPreview &&
        overlayRotationPreview.overlayId === focusedMatch.overlay.id &&
        overlayRotationPreview.source === 'dial'
      ) {
        drawWorldBadge(
          ctx,
          dial.knobX,
          dial.knobY - 18 / camera.zoom,
          `${Math.round(dial.worldDeg) % 360}°`,
          'rgba(12, 74, 110, 0.95)',
          '#38bdf8',
          '#e0f2fe',
          camera.zoom,
        );
      }
    }
  }

  // Active Overlay drag/reparent preview
  if (overlayDrag) {
    drawOverlayPlacementGraphic(
      ctx,
      overlayDrag.worldX,
      overlayDrag.worldY,
      overlayDrag.worldRad,
      overlayDrag.overlay,
      overlayPacksById,
      imageCache,
      0.9,
    );
    const { width: ow, height: oh } = resolveOverlayRenderWorldSize(
      overlayDrag.overlay,
      overlayPacksById,
      imageCache,
    );
    drawHostTether(
      ctx,
      overlayDrag.targetHostCoord,
      overlayDrag.worldX,
      overlayDrag.worldY,
      overlayDrag.reparenting ? '#10b981' : '#f59e0b',
      camera.zoom,
    );
    drawOverlayOBB(
      ctx,
      overlayDrag.worldX,
      overlayDrag.worldY,
      ow,
      oh,
      overlayDrag.worldRad,
      overlayDrag.reparenting ? '#10b981' : '#38bdf8',
      2 / camera.zoom,
    );

    if (overlayDrag.reparenting) {
      drawWorldBadge(
        ctx,
        overlayDrag.worldX,
        overlayDrag.worldY - Math.max(oh, MIN_OVERLAY_HIT_SIZE) / 2 - 18 / camera.zoom,
        `Reparent to (${overlayDrag.targetHostCoord.q}, ${overlayDrag.targetHostCoord.r})`,
        'rgba(6, 78, 59, 0.95)',
        '#10b981',
        '#d1fae5',
        camera.zoom,
      );
    }

    if (overlayDrag.hoveredEmptyCoord) {
      drawInvalidEmptyHexFeedback(
        ctx,
        overlayDrag.hoveredEmptyCoord,
        camera.zoom,
        'Clamped to host hex',
      );
    }
  }

  if (!dragMove && !overlayDrag) {
    if (activeBrush?.kind === 'tile' && hoveredCoord) {
      const { x, y } = axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS);
      drawPlacementGraphic(ctx, x, y, activeBrush, tilesetsById, imageCache, 0.55);

      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.stroke();
      ctx.restore();
    } else if (activeBrush?.kind === 'overlay') {
      const pointerWorld =
        hoveredWorldPos ?? (hoveredCoord ? axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS) : null);
      const targetCoord =
        hoveredCoord ?? (pointerWorld ? worldToAxial(pointerWorld.x, pointerWorld.y, HEX_RADIUS) : null);

      if (pointerWorld && targetCoord) {
        const host = findPlacementAt(placements, targetCoord);
        const brushImg = imageCache.isError(activeBrush.url) ? null : imageCache.get(activeBrush.url);
        const hexCenter = axialToWorld(targetCoord.q, targetCoord.r, HEX_RADIUS);

        if (host) {
          const { point } = clampWorldPointToHostHex(
            pointerWorld.x,
            pointerWorld.y,
            targetCoord,
            HEX_RADIUS,
          );
          ctx.save();
          traceHexPath(ctx, hexCenter.x, hexCenter.y, HEX_RADIUS - 1.5);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
          ctx.lineWidth = Math.max(1.5, 2 / camera.zoom);
          ctx.stroke();
          ctx.restore();

          drawOverlayBrushGhost(
            ctx,
            brushImg,
            point.x,
            point.y,
            activeBrush.rotationDeg,
            0.68,
            false,
          );
        } else {
          drawInvalidEmptyHexFeedback(ctx, targetCoord, camera.zoom, 'Place a Tile first');

          drawOverlayBrushGhost(
            ctx,
            brushImg,
            pointerWorld.x,
            pointerWorld.y,
            activeBrush.rotationDeg,
            0.55,
            true,
          );
        }
      }
    } else if (hoveredCoord && !hoveredOverlayHit) {
      const { x, y } = axialToWorld(hoveredCoord.q, hoveredCoord.r, HEX_RADIUS);
      ctx.save();
      traceHexPath(ctx, x, y, HEX_RADIUS - 1);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Pass 5: Assembly Labels above Tiles & Overlays
  if (showLabels) {
    drawAssemblyCalloutsPass({
      ctx,
      placements,
      tilesetsById,
      overlayPacksById,
      imageCache,
      overBudgetCoords,
      overBudgetOverlayIds: showOverBudgetCues ? overBudgetOverlayIds : undefined,
      skipHostCoord: dragMove?.from ?? null,
      skipOverlayId: overlayDrag?.overlayId ?? null,
    });
  }

  ctx.restore();
}
