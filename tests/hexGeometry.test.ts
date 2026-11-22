import { describe, expect, it } from 'vitest';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  axialToWorld,
  hexCorners,
  worldToAxial,
} from '../src/domain/hexGeometry';

describe('Flat-top hex geometry (Seam 2)', () => {
  it('maintains exact 2 : sqrt(3) flat-top proportions', () => {
    expect(HEX_WIDTH).toBe(2 * HEX_RADIUS);
    expect(HEX_HEIGHT).toBeCloseTo(HEX_RADIUS * Math.sqrt(3), 8);
  });

  it('projects axial coordinates to flat-top world coordinates and round-trips centers exactly', () => {
    const coords = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: -1, r: 1 },
      { q: 2, r: -3 },
      { q: -3, r: 2 },
    ];
    for (const c of coords) {
      const world = axialToWorld(c.q, c.r, HEX_RADIUS);
      expect(worldToAxial(world.x, world.y, HEX_RADIUS)).toEqual(c);
    }

    // Neighbor (1, 0) sits 1.5*R right and 0.5*sqrt(3)*R down
    const n10 = axialToWorld(1, 0, HEX_RADIUS);
    expect(n10.x).toBeCloseTo(1.5 * HEX_RADIUS, 8);
    expect(n10.y).toBeCloseTo(0.5 * HEX_HEIGHT, 8);

    // Neighbor (0, 1) sits directly below (0, 0) by HEX_HEIGHT
    const n01 = axialToWorld(0, 1, HEX_RADIUS);
    expect(n01.x).toBeCloseTo(0, 8);
    expect(n01.y).toBeCloseTo(HEX_HEIGHT, 8);
  });

  it('snaps off-center points inside a hex back to its axial coordinates without -0', () => {
    const center = axialToWorld(0, 0, HEX_RADIUS);
    const snapped = worldToAxial(center.x - 12, center.y - 8, HEX_RADIUS);
    expect(Object.is(snapped.q, -0)).toBe(false);
    expect(Object.is(snapped.r, -0)).toBe(false);
    expect(snapped).toEqual({ q: 0, r: 0 });
  });

  it('computes 6 flat-top hexagon corner vertices', () => {
    const corners = hexCorners(0, 0, 100);
    expect(corners).toHaveLength(6);
    expect(corners[0].x).toBeCloseTo(100, 6);
    expect(corners[0].y).toBeCloseTo(0, 6);
    expect(corners[1].x).toBeCloseTo(50, 6);
    expect(corners[1].y).toBeCloseTo(50 * Math.sqrt(3), 6);
  });
});
