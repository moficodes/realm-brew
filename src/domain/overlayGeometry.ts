import type { MapViewMode } from './fogOfWar';
import {
  DEFAULT_CAMERA,
  HEX_RADIUS,
  HEX_WIDTH,
  axialToWorld,
  clampOffsetToUnitHex,
  clampZoom,
  computePlacementsWorldBounds,
  normalizeRotationDeg,
  rotationToRadians,
  type BoundingBox,
  type Camera,
  type Point2D,
  type WorldBounds,
} from './hexGeometry';
import type { AxialCoord, OverlayPlacement, Placement } from './types';

export const OVERLAY_WORLD_PER_PIXEL = HEX_WIDTH / 1200;
export const MISSING_OVERLAY_WIDTH = 72;
export const MISSING_OVERLAY_HEIGHT = 44;
export const MIN_OVERLAY_HIT_SIZE = 32;

export interface OverlayWorldTransform {
  x: number;
  y: number;
  worldDeg: number;
  worldRad: number;
}

export interface OverlayLocalCoords {
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
}

export interface WorldDimensions {
  width: number;
  height: number;
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Return 1:1 physical world dimensions for an Overlay image, or the 72x44 fallback box. */
export function getOverlayWorldSize(
  pixelSize?: { width: number; height: number } | null,
): WorldDimensions {
  if (!pixelSize || pixelSize.width <= 0 || pixelSize.height <= 0) {
    return {
      width: MISSING_OVERLAY_WIDTH,
      height: MISSING_OVERLAY_HEIGHT,
    };
  }
  return {
    width: pixelSize.width * OVERLAY_WORLD_PER_PIXEL,
    height: pixelSize.height * OVERLAY_WORLD_PER_PIXEL,
  };
}

/** Project host-local normalized coordinates and rotation into world space. */
export function overlayLocalToWorld(
  host: Pick<Placement, 'q' | 'r' | 'rotation'>,
  overlay: Pick<OverlayPlacement, 'offsetX' | 'offsetY' | 'rotationDeg'>,
  radius = HEX_RADIUS,
): OverlayWorldTransform {
  const center = axialToWorld(host.q, host.r, radius);
  const hostRad = rotationToRadians(host.rotation);
  const lx = overlay.offsetX * radius;
  const ly = overlay.offsetY * radius;
  const cos = Math.cos(hostRad);
  const sin = Math.sin(hostRad);

  const worldDeg = normalizeRotationDeg(host.rotation * 60 + overlay.rotationDeg);
  return {
    x: normalizeZero(center.x + lx * cos - ly * sin),
    y: normalizeZero(center.y + lx * sin + ly * cos),
    worldDeg,
    worldRad: normalizeZero((worldDeg * Math.PI) / 180),
  };
}

/** Convert a world-space anchor and angle into a host Placement's local frame. */
export function worldToOverlayLocal(
  host: Pick<Placement, 'q' | 'r' | 'rotation'>,
  worldX: number,
  worldY: number,
  worldDeg: number,
  radius = HEX_RADIUS,
): OverlayLocalCoords {
  const center = axialToWorld(host.q, host.r, radius);
  const dx = worldX - center.x;
  const dy = worldY - center.y;
  const hostRad = -rotationToRadians(host.rotation);
  const cos = Math.cos(hostRad);
  const sin = Math.sin(hostRad);

  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  return {
    offsetX: normalizeZero(lx / radius),
    offsetY: normalizeZero(ly / radius),
    rotationDeg: normalizeRotationDeg(worldDeg - host.rotation * 60),
  };
}

/** Clamp a world-space point inside the unit flat-top hex centered at hostCoord. */
export function clampWorldPointToHostHex(
  worldX: number,
  worldY: number,
  hostCoord: AxialCoord,
  radius = HEX_RADIUS,
): { point: Point2D; clamped: boolean } {
  const center = axialToWorld(hostCoord.q, hostCoord.r, radius);
  const rawX = (worldX - center.x) / radius;
  const rawY = (worldY - center.y) / radius;
  const clampedOffsets = clampOffsetToUnitHex(rawX, rawY);
  const clamped = Math.hypot(clampedOffsets.offsetX - rawX, clampedOffsets.offsetY - rawY) > 1e-9;

  return {
    point: {
      x: normalizeZero(center.x + clampedOffsets.offsetX * radius),
      y: normalizeZero(center.y + clampedOffsets.offsetY * radius),
    },
    clamped,
  };
}

/** Convert a world-space point and angle to host-local coords clamped inside the unit hex. */
export function worldToClampedOverlayLocal(
  host: Pick<Placement, 'q' | 'r' | 'rotation'>,
  worldX: number,
  worldY: number,
  worldDeg: number,
  radius = HEX_RADIUS,
): OverlayLocalCoords & { clamped: boolean } {
  const local = worldToOverlayLocal(host, worldX, worldY, worldDeg, radius);
  const clampedOffsets = clampOffsetToUnitHex(local.offsetX, local.offsetY);
  const clamped =
    Math.hypot(clampedOffsets.offsetX - local.offsetX, clampedOffsets.offsetY - local.offsetY) > 1e-9;

  return {
    offsetX: clampedOffsets.offsetX,
    offsetY: clampedOffsets.offsetY,
    rotationDeg: local.rotationDeg,
    clamped,
  };
}

/** Re-project an Overlay Placement from one host frame into another preserving world position/angle. */
export function reprojectOverlayToHost(
  fromHost: Pick<Placement, 'q' | 'r' | 'rotation'>,
  overlay: Pick<OverlayPlacement, 'offsetX' | 'offsetY' | 'rotationDeg'>,
  toHost: Pick<Placement, 'q' | 'r' | 'rotation'>,
  radius = HEX_RADIUS,
): OverlayLocalCoords {
  const world = overlayLocalToWorld(fromHost, overlay, radius);
  const clamped = worldToClampedOverlayLocal(toHost, world.x, world.y, world.worldDeg, radius);
  return {
    offsetX: clamped.offsetX,
    offsetY: clamped.offsetY,
    rotationDeg: clamped.rotationDeg,
  };
}

export interface OverlayHitTestLookup {
  /** Pixel dimensions of a loaded Overlay image, or null when missing/unloaded (72x44 OBB, no alpha check). */
  getPixelSize: (overlay: OverlayPlacement) => { width: number; height: number } | null;
  /** Optional forgiving alpha check at normalized [0, 1] UV coords inside raw image bounds. */
  isOpaqueAt?: (overlay: OverlayPlacement, u: number, v: number) => boolean;
}

export interface OverlayHit {
  hostCoord: AxialCoord;
  overlay: OverlayPlacement;
  worldX: number;
  worldY: number;
  worldDeg: number;
  worldRad: number;
  width: number;
  height: number;
  hitWidth: number;
  hitHeight: number;
  isMissingAsset: boolean;
  index: number;
  stackCount: number;
}

/**
 * Hit-test Overlay Placements top-to-bottom in global draw order using padded rotated OBBs
 * combined with an optional forgiving transparent-pixel alpha check (skipped for missing assets).
 */
export function hitTestOverlaysAtWorld(
  placements: readonly Placement[],
  worldX: number,
  worldY: number,
  lookup: OverlayHitTestLookup,
  radius = HEX_RADIUS,
): OverlayHit[] {
  const hits: OverlayHit[] = [];

  for (let pIdx = placements.length - 1; pIdx >= 0; pIdx--) {
    const host = placements[pIdx];
    const overlays = host.overlays ?? [];
    const stackCount = overlays.length;

    for (let oIdx = stackCount - 1; oIdx >= 0; oIdx--) {
      const overlay = overlays[oIdx];
      const pixelSize = lookup.getPixelSize(overlay);
      const isMissingAsset = !pixelSize || pixelSize.width <= 0 || pixelSize.height <= 0;
      const { width, height } = getOverlayWorldSize(isMissingAsset ? null : pixelSize);
      const hitWidth = Math.max(width, MIN_OVERLAY_HIT_SIZE);
      const hitHeight = Math.max(height, MIN_OVERLAY_HIT_SIZE);

      const t = overlayLocalToWorld(host, overlay, radius);
      const dx = worldX - t.x;
      const dy = worldY - t.y;
      const cos = Math.cos(-t.worldRad);
      const sin = Math.sin(-t.worldRad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;

      if (Math.abs(lx) > hitWidth / 2 || Math.abs(ly) > hitHeight / 2) {
        continue;
      }

      if (!isMissingAsset && lookup.isOpaqueAt) {
        const insideRawBounds = Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
        if (insideRawBounds) {
          const u = Math.min(1, Math.max(0, (lx + width / 2) / width));
          const v = Math.min(1, Math.max(0, (ly + height / 2) / height));
          if (!lookup.isOpaqueAt(overlay, u, v)) {
            continue;
          }
        }
      }

      hits.push({
        hostCoord: { q: host.q === 0 ? 0 : host.q, r: host.r === 0 ? 0 : host.r },
        overlay,
        worldX: t.x,
        worldY: t.y,
        worldDeg: t.worldDeg,
        worldRad: t.worldRad,
        width,
        height,
        hitWidth,
        hitHeight,
        isMissingAsset,
        index: oIdx,
        stackCount,
      });
    }
  }

  return hits;
}

export interface OverlayDialGeometry {
  centerX: number;
  centerY: number;
  ringRadius: number;
  knobX: number;
  knobY: number;
  worldDeg: number;
  worldRad: number;
}

/** Compute the minimal radial dial ring and handle knob position for a focused Overlay. */
export function getOverlayDialGeometry(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  worldDeg: number,
): OverlayDialGeometry {
  const normalizedDeg = normalizeRotationDeg(worldDeg);
  const worldRad = normalizeZero((normalizedDeg * Math.PI) / 180);
  const ringRadius = Math.max(36, Math.min(82, Math.hypot(width, height) * 0.44));
  const knobAngle = worldRad - Math.PI / 2;
  return {
    centerX: worldX,
    centerY: worldY,
    ringRadius,
    knobX: normalizeZero(worldX + ringRadius * Math.cos(knobAngle)),
    knobY: normalizeZero(worldY + ringRadius * Math.sin(knobAngle)),
    worldDeg: normalizedDeg,
    worldRad,
  };
}

/** Check whether a world point falls within the interactive hit radius of a radial dial knob. */
export function isPointOnDialKnob(
  worldX: number,
  worldY: number,
  dial: Pick<OverlayDialGeometry, 'knobX' | 'knobY'>,
  zoom: number,
): boolean {
  const hitRadius = Math.max(11 / Math.max(0.1, zoom), 9);
  return Math.hypot(worldX - dial.knobX, worldY - dial.knobY) <= hitRadius;
}

const HEX_SQRT3 = Math.sqrt(3);
const HEX_UNIT_APOTHEM = HEX_SQRT3 / 2;

/** Return true if a world-space point lies inside or on the boundary of a flat-top hex. */
export function isPointInFlatTopHex(
  worldX: number,
  worldY: number,
  hostCoord: AxialCoord,
  radius = HEX_RADIUS,
  epsilon = 1e-6,
): boolean {
  const center = axialToWorld(hostCoord.q, hostCoord.r, radius);
  const dx = Math.abs(worldX - center.x) / radius;
  const dy = Math.abs(worldY - center.y) / radius;
  const t1 = dy / HEX_UNIT_APOTHEM;
  const t2 = dx + dy / HEX_SQRT3;
  return Math.max(t1, t2) <= 1 + epsilon;
}

/** Compute the 4 world-space corner points of a rotated Overlay bounding box. */
export function getOverlayOBBCorners(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  worldRad: number,
): [Point2D, Point2D, Point2D, Point2D] {
  const hw = width / 2;
  const hh = height / 2;
  const cos = Math.cos(worldRad);
  const sin = Math.sin(worldRad);

  const rotate = (lx: number, ly: number): Point2D => ({
    x: normalizeZero(worldX + lx * cos - ly * sin),
    y: normalizeZero(worldY + lx * sin + ly * cos),
  });

  return [
    rotate(-hw, -hh),
    rotate(hw, -hh),
    rotate(hw, hh),
    rotate(-hw, hh),
  ];
}

/** Compute the world-space axis-aligned bounding box of a rotated Overlay OBB. */
export function computeOverlayWorldBounds(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  worldRad: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = getOverlayOBBCorners(worldX, worldY, width, height, worldRad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of corners) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Return true if any corner of an Overlay's world OBB extends past its host flat-top hex boundary. */
export function doesOverlayBoxOverhangHostHex(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  worldRad: number,
  hostCoord: AxialCoord,
  radius = HEX_RADIUS,
): boolean {
  const corners = getOverlayOBBCorners(worldX, worldY, width, height, worldRad);
  return corners.some((corner) => !isPointInFlatTopHex(corner.x, corner.y, hostCoord, radius));
}

/** Return true if an Overlay Placement's rotated world box overhangs past its host hex boundary. */
export function doesOverlayOverhangHostHex(
  host: Pick<Placement, 'q' | 'r' | 'rotation'>,
  overlay: Pick<OverlayPlacement, 'offsetX' | 'offsetY' | 'rotationDeg'>,
  pixelSize?: { width: number; height: number } | null,
  radius = HEX_RADIUS,
): boolean {
  const t = overlayLocalToWorld(host, overlay, radius);
  const { width, height } = getOverlayWorldSize(pixelSize);
  return doesOverlayBoxOverhangHostHex(t.x, t.y, width, height, t.worldRad, host, radius);
}

export type OverlayFitAssetState =
  | { status: 'loaded'; width: number; height: number }
  | { status: 'missing' }
  | { status: 'loading' };

export interface FitWorldBoundsOptions {
  viewMode?: MapViewMode;
  getOverlayAssetState?: (overlay: OverlayPlacement) => OverlayFitAssetState;
  radius?: number;
}

/**
 * Synchronously compute Map world bounds for Fit framing by unioning host hexes with
 * rotated world boxes of visible loaded Overlays (72x44 for missing, host hex fallback
 * for still-loading images, and excluding Overlays on covered hosts in Player View).
 */
export function computeFitWorldBounds(
  placements: readonly Placement[],
  options?: FitWorldBoundsOptions,
): WorldBounds | null {
  const radius = options?.radius ?? HEX_RADIUS;
  const baseBounds = computePlacementsWorldBounds(placements, radius);
  if (!baseBounds) return null;

  const viewMode = options?.viewMode ?? 'gm';
  const getOverlayAssetState = options?.getOverlayAssetState;
  let { minX, minY, maxX, maxY } = baseBounds;

  for (const host of placements) {
    if (viewMode === 'player' && host.covered) {
      continue;
    }
    for (const ov of host.overlays ?? []) {
      const state = getOverlayAssetState?.(ov) ?? { status: 'loading' as const };
      if (state.status === 'loading') {
        continue;
      }
      const dims =
        state.status === 'loaded'
          ? getOverlayWorldSize({ width: state.width, height: state.height })
          : getOverlayWorldSize(null);
      const t = overlayLocalToWorld(host, ov, radius);
      const ovBounds = computeOverlayWorldBounds(t.x, t.y, dims.width, dims.height, t.worldRad);
      if (ovBounds.minX < minX) minX = ovBounds.minX;
      if (ovBounds.minY < minY) minY = ovBounds.minY;
      if (ovBounds.maxX > maxX) maxX = ovBounds.maxX;
      if (ovBounds.maxY > maxY) maxY = ovBounds.maxY;
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/** Compute overhang-aware and Player-View-filtered Fit camera synchronously. */
export function computeFitCameraWithOverlays(
  placements: readonly Placement[],
  viewportWidth: number,
  viewportHeight: number,
  options?: FitWorldBoundsOptions & { padding?: number },
): Camera {
  const bounds = computeFitWorldBounds(placements, options);
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
    return { ...DEFAULT_CAMERA };
  }

  const padding = options?.padding ?? 48;
  const availW = Math.max(1, viewportWidth - padding * 2);
  const availH = Math.max(1, viewportHeight - padding * 2);
  const fitZoom = Math.min(availW / bounds.width, availH / bounds.height);

  return {
    x: bounds.centerX,
    y: bounds.centerY,
    zoom: clampZoom(fitZoom),
  };
}

export interface VisibleOverlayBoundsOptions {
  getOverlayPixelSize?: (overlay: OverlayPlacement) => { width: number; height: number } | null;
  excludeCoveredHosts?: boolean;
  radius?: number;
}

/**
 * Compute the union world bounding box across all visible Overlay Placements' exact rotated
 * OBBs (1:1 HEX_WIDTH/1200 scale or 72x44 missing fallback), or null when none are visible.
 */
export function computeVisibleOverlaysWorldBounds(
  placements: readonly Placement[],
  options: VisibleOverlayBoundsOptions = {},
): BoundingBox | null {
  const { getOverlayPixelSize, excludeCoveredHosts = false, radius = HEX_RADIUS } = options;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasAny = false;

  for (const host of placements) {
    if (excludeCoveredHosts && host.covered) continue;
    for (const overlay of host.overlays ?? []) {
      const t = overlayLocalToWorld(host, overlay, radius);
      const pixelSize = getOverlayPixelSize ? getOverlayPixelSize(overlay) : null;
      const { width, height } = getOverlayWorldSize(pixelSize);
      const box = computeOverlayWorldBounds(t.x, t.y, width, height, t.worldRad);
      hasAny = true;
      if (box.minX < minX) minX = box.minX;
      if (box.minY < minY) minY = box.minY;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.maxY > maxY) maxY = box.maxY;
    }
  }

  return hasAny ? { minX, minY, maxX, maxY } : null;
}
