import type { AxialCoord, Placement, RotationStep } from './types';

export const HEX_RADIUS = 100;
export const HEX_WIDTH = 2 * HEX_RADIUS;
export const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3.0;

export interface Point2D {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function axialKey(q: number, r: number): `${number},${number}` {
  return `${normalizeZero(q)},${normalizeZero(r)}`;
}

export function axialToWorld(q: number, r: number, radius = HEX_RADIUS): Point2D {
  const x = radius * 1.5 * q;
  const y = radius * Math.sqrt(3) * (r + q / 2);
  return { x: normalizeZero(x), y: normalizeZero(y) };
}

export function worldToAxial(x: number, y: number, radius = HEX_RADIUS): AxialCoord {
  const qf = ((2 / 3) * x) / radius;
  const rf = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / radius;
  return cubeRound(qf, rf);
}

function cubeRound(qf: number, rf: number): AxialCoord {
  const sf = -qf - rf;
  let rq = Math.round(qf);
  let rr = Math.round(rf);
  const rs = Math.round(sf);

  const qDiff = Math.abs(rq - qf);
  const rDiff = Math.abs(rr - rf);
  const sDiff = Math.abs(rs - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: normalizeZero(rq), r: normalizeZero(rr) };
}

export function hexCorners(cx: number, cy: number, radius = HEX_RADIUS): Point2D[] {
  const corners: Point2D[] = [];
  for (let i = 0; i < 6; i++) {
    const angleRad = (Math.PI / 3) * i;
    corners.push({
      x: cx + radius * Math.cos(angleRad),
      y: cy + radius * Math.sin(angleRad),
    });
  }
  return corners;
}

export function rotationToRadians(rotation: RotationStep): number {
  return rotation * (Math.PI / 3);
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(
  wx: number,
  wy: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: Camera,
): Point2D {
  return {
    x: (wx - camera.x) * camera.zoom + viewportWidth / 2,
    y: (wy - camera.y) * camera.zoom + viewportHeight / 2,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: Camera,
): Point2D {
  return {
    x: (sx - viewportWidth / 2) / camera.zoom + camera.x,
    y: (sy - viewportHeight / 2) / camera.zoom + camera.y,
  };
}

export function screenToAxial(
  sx: number,
  sy: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: Camera,
  radius = HEX_RADIUS,
): AxialCoord {
  const world = screenToWorld(sx, sy, viewportWidth, viewportHeight, camera);
  return worldToAxial(world.x, world.y, radius);
}

export function zoomCameraAtScreenPoint(
  camera: Camera,
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  targetZoom: number,
): Camera {
  const nextZoom = clampZoom(targetZoom);
  const worldUnderCursor = screenToWorld(screenX, screenY, viewportWidth, viewportHeight, camera);
  return {
    x: worldUnderCursor.x - (screenX - viewportWidth / 2) / nextZoom,
    y: worldUnderCursor.y - (screenY - viewportHeight / 2) / nextZoom,
    zoom: nextZoom,
  };
}

export function computePlacementsWorldBounds(
  placements: readonly Pick<Placement, 'q' | 'r'>[],
  radius = HEX_RADIUS,
): WorldBounds | null {
  if (placements.length === 0) return null;

  const halfHeight = (Math.sqrt(3) / 2) * radius;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of placements) {
    const center = axialToWorld(p.q, p.r, radius);
    minX = Math.min(minX, center.x - radius);
    maxX = Math.max(maxX, center.x + radius);
    minY = Math.min(minY, center.y - halfHeight);
    maxY = Math.max(maxY, center.y + halfHeight);
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

export function computeFitCamera(
  placements: readonly Pick<Placement, 'q' | 'r'>[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
  radius = HEX_RADIUS,
): Camera {
  const bounds = computePlacementsWorldBounds(placements, radius);
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
    return { ...DEFAULT_CAMERA };
  }

  const availW = Math.max(1, viewportWidth - padding * 2);
  const availH = Math.max(1, viewportHeight - padding * 2);
  const fitZoom = Math.min(availW / bounds.width, availH / bounds.height);

  return {
    x: bounds.centerX,
    y: bounds.centerY,
    zoom: clampZoom(fitZoom),
  };
}

export function computeExportBounds(
  placements: readonly Pick<Placement, 'q' | 'r'>[],
  paddingWorld = 24,
  radius = HEX_RADIUS,
): WorldBounds | null {
  const bounds = computePlacementsWorldBounds(placements, radius);
  if (!bounds) return null;

  const minX = bounds.minX - paddingWorld;
  const minY = bounds.minY - paddingWorld;
  const maxX = bounds.maxX + paddingWorld;
  const maxY = bounds.maxY + paddingWorld;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  };
}
