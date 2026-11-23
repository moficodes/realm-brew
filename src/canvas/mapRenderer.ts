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
  MISSING_OVERLAY_HEIGHT,
  MISSING_OVERLAY_WIDTH,
  clampWorldPointToHostHex,
  getOverlayWorldSize,
  overlayLocalToWorld,
} from '../domain/overlayGeometry';
import {
  findPlacementAt,
  formatAssemblyLabel,
  resolveOverlayAsset,
  resolvePlacementAsset,
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
  activeBrush: ActiveBrush | null;
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

/** Pass 3: Render all Overlay Placements globally above all Tiles in deterministic host/stack order. */
export function drawGlobalOverlaysPass(params: {
  ctx: CanvasRenderingContext2D;
  placements: readonly Placement[];
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache: ImageLookup;
  dragMove?: DragMovePreview | null;
}): void {
  const { ctx, placements, overlayPacksById, imageCache, dragMove = null } = params;

  for (const host of placements) {
    const isDragOrigin =
      dragMove !== null && host.q === dragMove.from.q && host.r === dragMove.from.r;
    if (isDragOrigin && dragMove.to) {
      continue;
    }

    const alpha = isDragOrigin ? 0.28 : 1;
    for (const ov of host.overlays ?? []) {
      const t = overlayLocalToWorld(host, ov);
      drawOverlayPlacementGraphic(ctx, t.x, t.y, t.worldRad, ov, overlayPacksById, imageCache, alpha);
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
        const t = overlayLocalToWorld(previewHost, ov);
        drawOverlayPlacementGraphic(ctx, t.x, t.y, t.worldRad, ov, overlayPacksById, imageCache, 0.72);
      }
    }
  }
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

  // Pass 3: Global Overlay Placements above all Tiles
  drawGlobalOverlaysPass({
    ctx,
    placements,
    overlayPacksById,
    imageCache,
    dragMove,
  });

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

  if (!dragMove) {
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
          ctx.save();
          traceHexPath(ctx, hexCenter.x, hexCenter.y, HEX_RADIUS - 1.5);
          ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
          ctx.fill();
          ctx.setLineDash([7, 5]);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
          ctx.lineWidth = Math.max(2, 2.5 / camera.zoom);
          ctx.stroke();
          ctx.restore();

          drawOverlayBrushGhost(
            ctx,
            brushImg,
            pointerWorld.x,
            pointerWorld.y,
            activeBrush.rotationDeg,
            0.55,
            true,
          );

          drawWorldBadge(
            ctx,
            hexCenter.x,
            hexCenter.y + 42,
            'Place a Tile first',
            'rgba(69, 10, 10, 0.92)',
            'rgba(239, 68, 68, 0.75)',
            '#fecaca',
            camera.zoom,
          );
        }
      }
    } else if (hoveredCoord) {
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
    for (const placement of placements) {
      const isDragOrigin =
        dragMove !== null &&
        placement.q === dragMove.from.q &&
        placement.r === dragMove.from.r;
      if (isDragOrigin) continue;

      const isOverBudget = overBudgetCoords.has(axialKey(placement.q, placement.r));
      const { x, y } = axialToWorld(placement.q, placement.r, HEX_RADIUS);
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

  ctx.restore();
}
