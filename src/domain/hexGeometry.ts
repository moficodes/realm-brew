import type { AxialCoord, RotationStep } from './types';

export const HEX_RADIUS = 100;
export const HEX_WIDTH = 2 * HEX_RADIUS;
export const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;

export interface Point2D {
  x: number;
  y: number;
}

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
