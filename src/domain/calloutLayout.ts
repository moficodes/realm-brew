import {
  HEX_RADIUS,
  axialKey,
  axialToWorld,
  computeExportBounds,
  rotationToRadians,
  type Point2D,
  type WorldBounds,
} from './hexGeometry';
import {
  computeVisibleOverlaysWorldBounds,
  doesOverlayBoxOverhangHostHex,
  getOverlayWorldSize,
  overlayLocalToWorld,
} from './overlayGeometry';
import { formatAssemblyLabel, resolveOverlayAsset } from './plannerEngine';
import type {
  AxialCoord,
  OverlayPack,
  OverlayPlacement,
  Placement,
  PlacementKey,
  RotationStep,
  Tileset,
} from './types';

export const TILE_CALLOUT_HEIGHT = 24;
export const TILE_CALLOUT_MIN_WIDTH = 64;
export const TILE_CALLOUT_PAD_X = 18;

export const OVERLAY_CALLOUT_HEIGHT = 18;
export const OVERLAY_CALLOUT_MAX_WIDTH = 150;
export const OVERLAY_CALLOUT_MIN_WIDTH = 36;
export const OVERLAY_CALLOUT_PAD_X = 6;
export const CALLOUT_COLLISION_GAP = 4;

export interface CalloutBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TileCalloutItem {
  q: number;
  r: number;
  centerX: number;
  centerY: number;
  rotation: RotationStep;
  label: string;
  isOverBudget: boolean;
  pillRect: CalloutBox;
  arrowRect: CalloutBox;
}

export interface OverlayCalloutItem {
  id: string;
  hostCoord: AxialCoord;
  hostCenterX: number;
  hostCenterY: number;
  anchorX: number;
  anchorY: number;
  pillX: number;
  pillY: number;
  pillWidth: number;
  pillHeight: number;
  pillRect: CalloutBox;
  label: string;
  fullLabel: string;
  isMissing: boolean;
  isOverBudget: boolean;
  displaced: boolean;
  leaderStart: Point2D;
  leaderEnd: Point2D;
  showHostTether: boolean;
}

export interface AssemblyCalloutLayout {
  tileCallouts: TileCalloutItem[];
  overlayCallouts: OverlayCalloutItem[];
}

export interface CalloutLayoutOptions {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  overBudgetCoords?: ReadonlySet<PlacementKey>;
  overBudgetOverlayIds?: ReadonlySet<string>;
  getOverlayPixelSize?: (overlay: OverlayPlacement) => { width: number; height: number } | null;
  skipHostCoord?: AxialCoord | null;
  skipOverlayId?: string | null;
  hiddenHostCoords?: ReadonlySet<PlacementKey>;
  measureText?: (text: string, variant: 'tile' | 'overlay') => number;
  radius?: number;
}

function defaultMeasureText(text: string, variant: 'tile' | 'overlay'): number {
  return text.length * (variant === 'tile' ? 7.8 : 6.35);
}

function makeCenteredRect(cx: number, cy: number, width: number, height: number): CalloutBox {
  const hw = width / 2;
  const hh = height / 2;
  return {
    minX: cx - hw,
    minY: cy - hh,
    maxX: cx + hw,
    maxY: cy + hh,
  };
}

function rectsOverlap(a: CalloutBox, b: CalloutBox, gap = CALLOUT_COLLISION_GAP): boolean {
  return !(
    a.maxX + gap <= b.minX ||
    b.maxX + gap <= a.minX ||
    a.maxY + gap <= b.minY ||
    b.maxY + gap <= a.minY
  );
}

function hasCollision(rect: CalloutBox, obstacles: readonly CalloutBox[]): boolean {
  for (const obs of obstacles) {
    if (rectsOverlap(rect, obs, CALLOUT_COLLISION_GAP)) {
      return true;
    }
  }
  return false;
}

function closestPointOnRect(px: number, py: number, rect: CalloutBox): Point2D {
  return {
    x: Math.max(rect.minX, Math.min(rect.maxX, px)),
    y: Math.max(rect.minY, Math.min(rect.maxY, py)),
  };
}

function computeTileArrowRect(
  cx: number,
  cy: number,
  rotation: RotationStep,
  radius: number,
): CalloutBox {
  const hexHeight = Math.sqrt(3) * radius;
  const tipY = -hexHeight / 2 + 6;
  const baseY = tipY + 11;
  const rad = rotationToRadians(rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const localVerts: Point2D[] = [
    { x: 0, y: tipY },
    { x: -7, y: baseY },
    { x: 7, y: baseY },
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of localVerts) {
    const wx = cx + v.x * cos - v.y * sin;
    const wy = cy + v.x * sin + v.y * cos;
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
  }

  return {
    minX: minX - 2,
    minY: minY - 2,
    maxX: maxX + 2,
    maxY: maxY + 2,
  };
}

function formatTruncatedOverlayPill(
  fullLabel: string,
  measure: (text: string, variant: 'tile' | 'overlay') => number,
): { label: string; width: number } {
  const maxTextWidth = OVERLAY_CALLOUT_MAX_WIDTH - OVERLAY_CALLOUT_PAD_X * 2;
  const fullWidth = measure(fullLabel, 'overlay');
  if (fullWidth <= maxTextWidth) {
    return {
      label: fullLabel,
      width: Math.max(OVERLAY_CALLOUT_MIN_WIDTH, fullWidth + OVERLAY_CALLOUT_PAD_X * 2),
    };
  }

  let lo = 1;
  let hi = fullLabel.length - 1;
  let best = '…';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const trimmed = fullLabel.slice(0, mid).trimEnd();
    const candidate = `${trimmed || fullLabel.slice(0, 1)}…`;
    if (measure(candidate, 'overlay') <= maxTextWidth) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const measured = measure(best, 'overlay');
  return {
    label: best,
    width: Math.min(
      OVERLAY_CALLOUT_MAX_WIDTH,
      Math.max(OVERLAY_CALLOUT_MIN_WIDTH, measured + OVERLAY_CALLOUT_PAD_X * 2),
    ),
  };
}

function resolveDisplacedPillCenter(
  anchorX: number,
  anchorY: number,
  hostCenterX: number,
  hostCenterY: number,
  pillWidth: number,
  pillHeight: number,
  obstacles: readonly CalloutBox[],
): { pillX: number; pillY: number; pillRect: CalloutBox } {
  const direct = makeCenteredRect(anchorX, anchorY, pillWidth, pillHeight);
  if (!hasCollision(direct, obstacles)) {
    return { pillX: anchorX, pillY: anchorY, pillRect: direct };
  }

  const hw = pillWidth / 2;
  const hh = pillHeight / 2;
  const candidates: Point2D[] = [];

  // 1. Axis & diagonal grid around anchor (prioritizes short vertical clearance over wide pills)
  const dySteps = [0, 22, -22, 44, -44, 66, -66, 88, -88, 110, -110];
  const dxSteps = [0, 32, -32, 64, -64, 96, -96, 128, -128];
  for (const dy of dySteps) {
    for (const dx of dxSteps) {
      if (dx === 0 && dy === 0) continue;
      candidates.push({ x: anchorX + dx, y: anchorY + dy });
    }
  }

  // 2. Exact obstacle edge-hugging push-outs near the anchor
  for (const obs of obstacles) {
    const nearX = Math.max(obs.minX, Math.min(obs.maxX, anchorX));
    const nearY = Math.max(obs.minY, Math.min(obs.maxY, anchorY));
    if (Math.hypot(nearX - anchorX, nearY - anchorY) > 260) {
      continue;
    }
    const yAbove = obs.minY - hh - CALLOUT_COLLISION_GAP;
    const yBelow = obs.maxY + hh + CALLOUT_COLLISION_GAP;
    const xLeft = obs.minX - hw - CALLOUT_COLLISION_GAP;
    const xRight = obs.maxX + hw + CALLOUT_COLLISION_GAP;

    candidates.push(
      { x: anchorX, y: yBelow },
      { x: anchorX, y: yAbove },
      { x: xRight, y: anchorY },
      { x: xLeft, y: anchorY },
      { x: xRight, y: yBelow },
      { x: xLeft, y: yBelow },
      { x: xRight, y: yAbove },
      { x: xLeft, y: yAbove },
    );
  }

  // 3. Expanding elliptical ring fallback for very dense stacks
  for (let ring = 1; ring <= 16; ring++) {
    const ry = ring * 22;
    const rx = ring * 30;
    for (let step = 0; step < 16; step++) {
      const angle = (step * Math.PI) / 8;
      candidates.push({
        x: anchorX + Math.cos(angle) * rx,
        y: anchorY + Math.sin(angle) * ry,
      });
    }
  }

  const outDx = anchorX - hostCenterX;
  const outDy = anchorY - hostCenterY;
  const outLen = Math.hypot(outDx, outDy);
  const ux = outLen > 1e-6 ? outDx / outLen : 0;
  const uy = outLen > 1e-6 ? outDy / outLen : 1;

  let bestPoint: Point2D | null = null;
  let bestRect: CalloutBox | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const rect = makeCenteredRect(cand.x, cand.y, pillWidth, pillHeight);
    if (hasCollision(rect, obstacles)) continue;

    const dx = cand.x - anchorX;
    const dy = cand.y - anchorY;
    const dist = Math.hypot(dx, dy);
    // Tiny deterministic tie-breakers: fan away from host center, prefer below center pill over above
    const outwardDot = dx * ux + dy * uy;
    const downwardBias = dy >= 0 ? -0.02 : 0.02;
    const score = dist - outwardDot * 0.05 + downwardBias + cand.y * 1e-6 + cand.x * 1e-7;

    if (score < bestScore) {
      bestScore = score;
      bestPoint = cand;
      bestRect = rect;
    }
  }

  if (bestPoint && bestRect) {
    return { pillX: bestPoint.x, pillY: bestPoint.y, pillRect: bestRect };
  }

  // Unreachable unless hundreds of pills saturate the ring; deterministic safe fallback
  const fallbackY = anchorY + 420;
  return {
    pillX: anchorX,
    pillY: fallbackY,
    pillRect: makeCenteredRect(anchorX, fallbackY, pillWidth, pillHeight),
  };
}

/**
 * Pure deterministic Tile-priority collision solver for world-space Assembly Callouts.
 * Allocates host Tile pills and gold 0° orientation ticks first, then nudges overlapping
 * Overlay pills around obstacles while marking displaced leader lines and overhang-only tethers.
 */
export function layoutAssemblyCallouts({
  placements,
  tilesetsById,
  overlayPacksById,
  overBudgetCoords = new Set<PlacementKey>(),
  overBudgetOverlayIds = new Set<string>(),
  getOverlayPixelSize,
  skipHostCoord = null,
  skipOverlayId = null,
  hiddenHostCoords,
  measureText = defaultMeasureText,
  radius = HEX_RADIUS,
}: CalloutLayoutOptions): AssemblyCalloutLayout {
  const tileCallouts: TileCalloutItem[] = [];
  const overlayCallouts: OverlayCalloutItem[] = [];
  const obstacles: CalloutBox[] = [];

  const visibleHosts: Array<{ placement: Placement; centerX: number; centerY: number }> = [];

  for (const placement of placements) {
    if (
      skipHostCoord &&
      placement.q === skipHostCoord.q &&
      placement.r === skipHostCoord.r
    ) {
      continue;
    }
    const key = axialKey(placement.q, placement.r);
    if (hiddenHostCoords?.has(key)) {
      continue;
    }

    const { x: centerX, y: centerY } = axialToWorld(placement.q, placement.r, radius);
    const label = formatAssemblyLabel(placement, tilesetsById);
    const textWidth = measureText(label, 'tile');
    const pillWidth = Math.max(TILE_CALLOUT_MIN_WIDTH, textWidth + TILE_CALLOUT_PAD_X);
    const pillRect = makeCenteredRect(centerX, centerY, pillWidth, TILE_CALLOUT_HEIGHT);
    const arrowRect = computeTileArrowRect(centerX, centerY, placement.rotation, radius);

    tileCallouts.push({
      q: placement.q,
      r: placement.r,
      centerX,
      centerY,
      rotation: placement.rotation,
      label,
      isOverBudget: overBudgetCoords.has(key),
      pillRect,
      arrowRect,
    });

    obstacles.push(pillRect, arrowRect);
    visibleHosts.push({ placement, centerX, centerY });
  }

  // Process Overlay callouts in deterministic visual reading order (top-to-bottom, left-to-right),
  // and top-to-bottom within each host's Overlay stack so topmost pieces hold closest slots.
  visibleHosts.sort((a, b) => {
    const dy = a.centerY - b.centerY;
    if (Math.abs(dy) > 1e-6) return dy;
    const dx = a.centerX - b.centerX;
    if (Math.abs(dx) > 1e-6) return dx;
    return a.placement.q - b.placement.q || a.placement.r - b.placement.r;
  });

  for (const { placement: host, centerX: hostCenterX, centerY: hostCenterY } of visibleHosts) {
    const hostOverlays = host.overlays ?? [];
    for (let idx = hostOverlays.length - 1; idx >= 0; idx--) {
      const ov = hostOverlays[idx];
      if (skipOverlayId && ov.id === skipOverlayId) {
        continue;
      }

      const t = overlayLocalToWorld(host, ov, radius);
      const pixelSize = getOverlayPixelSize ? getOverlayPixelSize(ov) : null;
      const { width: worldW, height: worldH } = getOverlayWorldSize(pixelSize);
      const showHostTether = doesOverlayBoxOverhangHostHex(
        t.x,
        t.y,
        worldW,
        worldH,
        t.worldRad,
        host,
        radius,
      );

      const resolved = resolveOverlayAsset(ov, overlayPacksById);
      const isMissing = resolved.status !== 'ok';
      const fullLabel = isMissing
        ? `?${ov.overlayPackId} ${ov.overlayId}`
        : `${resolved.shortCode} ${resolved.overlay.label}`;
      const { label, width: pillWidth } = formatTruncatedOverlayPill(fullLabel, measureText);
      const { pillX, pillY, pillRect } = resolveDisplacedPillCenter(
        t.x,
        t.y,
        hostCenterX,
        hostCenterY,
        pillWidth,
        OVERLAY_CALLOUT_HEIGHT,
        obstacles,
      );

      obstacles.push(pillRect);

      const displaced = Math.hypot(pillX - t.x, pillY - t.y) > 0.5;
      overlayCallouts.push({
        id: ov.id,
        hostCoord: { q: host.q, r: host.r },
        hostCenterX,
        hostCenterY,
        anchorX: t.x,
        anchorY: t.y,
        pillX,
        pillY,
        pillWidth,
        pillHeight: OVERLAY_CALLOUT_HEIGHT,
        pillRect,
        label,
        fullLabel,
        isMissing,
        isOverBudget: !isMissing && overBudgetOverlayIds.has(ov.id),
        displaced,
        leaderStart: { x: t.x, y: t.y },
        leaderEnd: closestPointOnRect(t.x, t.y, pillRect),
        showHostTether,
      });
    }
  }

  return { tileCallouts, overlayCallouts };
}

/** Return the union world bounding box of all Tile & Overlay callout rects, or null when empty. */
export function getCalloutLayoutBounds(layout: AssemblyCalloutLayout): CalloutBox | null {
  if (layout.tileCallouts.length === 0 && layout.overlayCallouts.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (rect: CalloutBox) => {
    if (rect.minX < minX) minX = rect.minX;
    if (rect.minY < minY) minY = rect.minY;
    if (rect.maxX > maxX) maxX = rect.maxX;
    if (rect.maxY > maxY) maxY = rect.maxY;
  };
  for (const tile of layout.tileCallouts) {
    expand(tile.pillRect);
    expand(tile.arrowRect);
  }
  for (const ov of layout.overlayCallouts) {
    expand(ov.pillRect);
  }
  return { minX, minY, maxX, maxY };
}

export type ExportFogMode = 'gm' | 'player' | 'none';

export interface MapExportBoundsOptions {
  paddingWorld?: number;
  fogMode?: ExportFogMode;
  includeLabels?: boolean;
  tilesetsById?: ReadonlyMap<string, Tileset>;
  overlayPacksById?: ReadonlyMap<string, OverlayPack>;
  getOverlayPixelSize?: (overlay: OverlayPlacement) => { width: number; height: number } | null;
  calloutLayout?: AssemblyCalloutLayout | null;
  measureText?: (text: string, variant: 'tile' | 'overlay') => number;
  radius?: number;
}

/**
 * Compute tightly cropped PNG export bounds unioning host hexes, exact rotated world boxes
 * of visible Overlay Placements (excluding covered hosts' Overlays in Player Fog), and rendered
 * Assembly Callout pills when enabled outside Player Fog, before applying paddingWorld (28u default).
 */
export function computeMapExportBounds(
  placements: readonly Placement[],
  options: MapExportBoundsOptions = {},
): WorldBounds | null {
  if (placements.length === 0) return null;

  const {
    paddingWorld = 28,
    fogMode = 'gm',
    includeLabels = false,
    tilesetsById,
    overlayPacksById,
    getOverlayPixelSize,
    calloutLayout,
    measureText,
    radius = HEX_RADIUS,
  } = options;

  const overlayBounds = computeVisibleOverlaysWorldBounds(placements, {
    getOverlayPixelSize,
    excludeCoveredHosts: fogMode === 'player',
    radius,
  });

  let calloutBounds: CalloutBox | null = null;
  if (includeLabels && fogMode !== 'player') {
    const resolvedLayout =
      calloutLayout ??
      (tilesetsById && overlayPacksById
        ? layoutAssemblyCallouts({
            placements,
            tilesetsById,
            overlayPacksById,
            getOverlayPixelSize,
            measureText,
            radius,
          })
        : null);
    calloutBounds = resolvedLayout ? getCalloutLayoutBounds(resolvedLayout) : null;
  }

  return computeExportBounds(placements, paddingWorld, radius, [overlayBounds, calloutBounds]);
}
