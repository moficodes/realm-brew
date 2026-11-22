import { describe, expect, it } from 'vitest';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  axialToWorld,
  computeExportBounds,
  computeFitCamera,
  hexCorners,
  screenToAxial,
  screenToWorld,
  worldToAxial,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '../src/domain/hexGeometry';
import type { Placement } from '../src/domain/types';

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

  it('round-trips screen <-> world <-> axial coordinates under pan and zoom', () => {
    const camera = { x: 180, y: -95, zoom: 1.75 };
    const width = 1200;
    const height = 800;
    const targetAxial = { q: 3, r: -2 };
    const world = axialToWorld(targetAxial.q, targetAxial.r, HEX_RADIUS);
    const screen = worldToScreen(world.x, world.y, width, height, camera);

    const backWorld = screenToWorld(screen.x, screen.y, width, height, camera);
    expect(backWorld.x).toBeCloseTo(world.x, 6);
    expect(backWorld.y).toBeCloseTo(world.y, 6);

    expect(screenToAxial(screen.x, screen.y, width, height, camera, HEX_RADIUS)).toEqual(targetAxial);
  });

  it('keeps the world point under the cursor fixed when zooming around a screen point', () => {
    const camera = { x: 50, y: 30, zoom: 1 };
    const width = 1000;
    const height = 700;
    const cursorX = 720;
    const cursorY = 210;

    const worldBefore = screenToWorld(cursorX, cursorY, width, height, camera);
    const nextCamera = zoomCameraAtScreenPoint(camera, cursorX, cursorY, width, height, 2.0);
    const worldAfter = screenToWorld(cursorX, cursorY, width, height, nextCamera);

    expect(nextCamera.zoom).toBe(2.0);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);

    const clampedLow = zoomCameraAtScreenPoint(camera, cursorX, cursorY, width, height, 0.01);
    expect(clampedLow.zoom).toBe(MIN_ZOOM);
    const clampedHigh = zoomCameraAtScreenPoint(camera, cursorX, cursorY, width, height, 20);
    expect(clampedHigh.zoom).toBe(MAX_ZOOM);
  });

  it('computes Fit-to-Content camera for empty, single, and multi-Placement Maps', () => {
    expect(computeFitCamera([], 1000, 800)).toEqual({ x: 0, y: 0, zoom: 1 });

    const single: Placement[] = [
      { q: 4, r: -2, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    const singleFit = computeFitCamera(single, 1000, 800, 48);
    const singleCenter = axialToWorld(4, -2, HEX_RADIUS);
    expect(singleFit.x).toBeCloseTo(singleCenter.x, 6);
    expect(singleFit.y).toBeCloseTo(singleCenter.y, 6);
    expect(singleFit.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    expect(singleFit.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);

    const spread: Placement[] = [
      { q: -4, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 4, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 },
    ];
    const spreadFit = computeFitCamera(spread, 1000, 800, 40);
    expect(spreadFit.x).toBeCloseTo(0, 6);
    // Width of -4..4 centers + 2*HEX_RADIUS = 12*HEX_RADIUS + 2*HEX_RADIUS = 1400 world units
    // Inside 1000 - 80 = 920px -> zoom = 920 / 1400
    expect(spreadFit.zoom).toBeCloseTo(920 / (14 * HEX_RADIUS), 4);
  });

  it('computes tightly cropped PNG export bounds with padding for empty, single, and multi-Placement Maps', () => {
    expect(computeExportBounds([], 24, HEX_RADIUS)).toBeNull();

    const single: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    const singleBounds = computeExportBounds(single, 24, HEX_RADIUS)!;
    expect(singleBounds.minX).toBeCloseTo(-HEX_RADIUS - 24, 6);
    expect(singleBounds.maxX).toBeCloseTo(HEX_RADIUS + 24, 6);
    expect(singleBounds.width).toBeCloseTo(HEX_WIDTH + 48, 6);
    expect(singleBounds.height).toBeCloseTo(HEX_HEIGHT + 48, 6);

    const two: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 2, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 },
    ];
    const twoBounds = computeExportBounds(two, 30, HEX_RADIUS)!;
    // q=0 center y=0 (top -0.5*H), q=2 center y=1*H (bottom 1.5*H) -> height = 2*H + 60
    expect(twoBounds.minX).toBeCloseTo(-130, 6);
    expect(twoBounds.maxX).toBeCloseTo(430, 6);
    expect(twoBounds.width).toBeCloseTo(560, 6);
    expect(twoBounds.height).toBeCloseTo(HEX_HEIGHT * 2 + 60, 6);
  });
});
