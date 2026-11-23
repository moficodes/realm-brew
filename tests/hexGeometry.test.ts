import { describe, expect, it } from 'vitest';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  HEX_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  axialToWorld,
  clampOffsetToUnitHex,
  computeExportBounds,
  computeFitCamera,
  hexCorners,
  normalizeRotationDeg,
  screenToAxial,
  screenToWorld,
  worldToAxial,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '../src/domain/hexGeometry';
import {
  MIN_OVERLAY_HIT_SIZE,
  MISSING_OVERLAY_HEIGHT,
  MISSING_OVERLAY_WIDTH,
  OVERLAY_WORLD_PER_PIXEL,
  clampWorldPointToHostHex,
  getOverlayDialGeometry,
  getOverlayWorldSize,
  hitTestOverlaysAtWorld,
  isPointOnDialKnob,
  overlayLocalToWorld,
  reprojectOverlayToHost,
  worldToClampedOverlayLocal,
  worldToOverlayLocal,
} from '../src/domain/overlayGeometry';
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

  it('clamps finite offsets inside the unit flat-top hex and wraps finite rotationDeg into [0, 360)', () => {
    const apothem = Math.sqrt(3) / 2;

    expect(clampOffsetToUnitHex(0, 0)).toEqual({ offsetX: 0, offsetY: 0 });
    expect(clampOffsetToUnitHex(0.25, -0.3)).toEqual({ offsetX: 0.25, offsetY: -0.3 });

    const negZero = clampOffsetToUnitHex(-0, -0);
    expect(Object.is(negZero.offsetX, -0)).toBe(false);
    expect(Object.is(negZero.offsetY, -0)).toBe(false);

    expect(clampOffsetToUnitHex(2, 0)).toEqual({ offsetX: 1, offsetY: 0 });
    expect(clampOffsetToUnitHex(-3, 0)).toEqual({ offsetX: -1, offsetY: 0 });

    const topClamped = clampOffsetToUnitHex(0, 2);
    expect(topClamped.offsetX).toBe(0);
    expect(topClamped.offsetY).toBeCloseTo(apothem, 10);

    const diag = clampOffsetToUnitHex(0.8, 0.8);
    expect(Math.abs(diag.offsetX) + Math.abs(diag.offsetY) / Math.sqrt(3)).toBeCloseTo(1, 10);
    expect(Math.abs(diag.offsetY)).toBeLessThanOrEqual(apothem + 1e-12);

    expect(clampOffsetToUnitHex(1e308, 0)).toEqual({ offsetX: 1, offsetY: 0 });

    expect(normalizeRotationDeg(0)).toBe(0);
    expect(Object.is(normalizeRotationDeg(-0), -0)).toBe(false);
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(725)).toBe(5);
    expect(normalizeRotationDeg(-45)).toBe(315);
    expect(normalizeRotationDeg(-360)).toBe(0);
    expect(normalizeRotationDeg(-1e-17)).toBe(0);
    expect(normalizeRotationDeg(359.5)).toBe(359.5);
  });
});

describe('Overlay geometry & host-local transforms (Seam 3)', () => {
  it('computes fixed 1:1 physical scale (HEX_WIDTH / 1200) and 72x44 missing/loading fallback size', () => {
    expect(OVERLAY_WORLD_PER_PIXEL).toBeCloseTo(HEX_WIDTH / 1200, 12);
    expect(MISSING_OVERLAY_WIDTH).toBe(72);
    expect(MISSING_OVERLAY_HEIGHT).toBe(44);

    // Full hex-sized 1200x1039 image maps 1:1 to HEX_WIDTH x ~HEX_HEIGHT
    const fullHex = getOverlayWorldSize({ width: 1200, height: 1039 });
    expect(fullHex.width).toBeCloseTo(HEX_WIDTH, 10);
    expect(fullHex.height).toBeCloseTo(1039 * (HEX_WIDTH / 1200), 10);

    // Bridge PNG e.g. 600x300 maps 1:1 to 100x50 world units
    const bridge = getOverlayWorldSize({ width: 600, height: 300 });
    expect(bridge.width).toBeCloseTo(100, 10);
    expect(bridge.height).toBeCloseTo(50, 10);

    expect(getOverlayWorldSize(null)).toEqual({ width: 72, height: 44 });
    expect(getOverlayWorldSize({ width: 0, height: 100 })).toEqual({ width: 72, height: 44 });
  });

  it('round-trips host-local (offsetX, offsetY, rotationDeg) <-> world space across host rotations without drift', () => {
    const hosts: Array<Pick<Placement, 'q' | 'r' | 'rotation'>> = [
      { q: 0, r: 0, rotation: 0 },
      { q: 1, r: -2, rotation: 1 },
      { q: -2, r: 3, rotation: 4 },
      { q: 3, r: 1, rotation: 5 },
    ];
    const samples = [
      { offsetX: 0, offsetY: 0, rotationDeg: 0 },
      { offsetX: 0.42, offsetY: -0.31, rotationDeg: 47.25 },
      { offsetX: -0.65, offsetY: 0.25, rotationDeg: 315.75 },
      { offsetX: 0.5, offsetY: 0, rotationDeg: 359.5 },
    ];

    for (const host of hosts) {
      for (const local of samples) {
        const world = overlayLocalToWorld(host, local);
        const back = worldToOverlayLocal(host, world.x, world.y, world.worldDeg);
        expect(back.offsetX).toBeCloseTo(local.offsetX, 10);
        expect(back.offsetY).toBeCloseTo(local.offsetY, 10);
        expect(back.rotationDeg).toBeCloseTo(local.rotationDeg, 10);
      }
    }

    // Orbit + rotation check: offset (0.5, 0) on host rotation=0 sits at +50 X;
    // rotating host +1 step (+60°) orbits anchor to (25, 25*sqrt(3)) and worldDeg to 60°
    const w0 = overlayLocalToWorld({ q: 0, r: 0, rotation: 0 }, { offsetX: 0.5, offsetY: 0, rotationDeg: 15 });
    expect(w0.x).toBeCloseTo(50, 10);
    expect(w0.y).toBeCloseTo(0, 10);
    expect(w0.worldDeg).toBeCloseTo(15, 10);

    const w1 = overlayLocalToWorld({ q: 0, r: 0, rotation: 1 }, { offsetX: 0.5, offsetY: 0, rotationDeg: 15 });
    expect(w1.x).toBeCloseTo(25, 10);
    expect(w1.y).toBeCloseTo(25 * Math.sqrt(3), 10);
    expect(w1.worldDeg).toBeCloseTo(75, 10);
  });

  it('clamps world anchor points inside the unit flat-top hex while permitting visual overhang', () => {
    const host = { q: 1, r: 0, rotation: 2 as const };
    const hostCenter = axialToWorld(host.q, host.r, HEX_RADIUS);

    // Interior point is not clamped
    const inside = worldToClampedOverlayLocal(host, hostCenter.x + 25, hostCenter.y - 15, 30);
    expect(inside.clamped).toBe(false);
    const insideWorld = overlayLocalToWorld(host, inside);
    expect(insideWorld.x).toBeCloseTo(hostCenter.x + 25, 10);
    expect(insideWorld.y).toBeCloseTo(hostCenter.y - 15, 10);
    expect(insideWorld.worldDeg).toBeCloseTo(30, 10);

    // Point far to the right outside the hex clamps cleanly to right vertex (offset +HEX_RADIUS in world)
    const clampedRight = clampWorldPointToHostHex(hostCenter.x + 250, hostCenter.y, host);
    expect(clampedRight.clamped).toBe(true);
    expect(clampedRight.point.x).toBeCloseTo(hostCenter.x + HEX_RADIUS, 10);
    expect(clampedRight.point.y).toBeCloseTo(hostCenter.y, 10);

    // World point clamped via worldToClampedOverlayLocal produces valid unit-hex offsets even when host is rotated
    const clampedLocal = worldToClampedOverlayLocal(host, hostCenter.x + 250, hostCenter.y + 200, -45);
    expect(clampedLocal.clamped).toBe(true);
    expect(clampedLocal.rotationDeg).toBeCloseTo(normalizeRotationDeg(-45 - host.rotation * 60), 10);
    const apothem = Math.sqrt(3) / 2;
    expect(Math.abs(clampedLocal.offsetY)).toBeLessThanOrEqual(apothem + 1e-12);
    expect(Math.abs(clampedLocal.offsetX) + Math.abs(clampedLocal.offsetY) / Math.sqrt(3)).toBeLessThanOrEqual(
      1 + 1e-12,
    );

    // Anchor at right rim + 600px (100u) wide Overlay naturally overhangs neighbor hex by 50u
    const overhangAnchor = overlayLocalToWorld(
      { q: 0, r: 0, rotation: 0 },
      { offsetX: 1, offsetY: 0, rotationDeg: 0 },
    );
    const size = getOverlayWorldSize({ width: 600, height: 300 });
    expect(overhangAnchor.x + size.width / 2).toBeCloseTo(HEX_RADIUS + 50, 10);
  });

  it('re-projects Overlay local coordinates into a new host Tile rotation frame without visual drift', () => {
    const oldHost = { q: 2, r: -1, rotation: 1 as const };
    const newHost = { q: 2, r: -1, rotation: 4 as const };
    const original = { offsetX: 0.45, offsetY: -0.35, rotationDeg: 27.5 };

    const worldBefore = overlayLocalToWorld(oldHost, original);
    const reprojected = reprojectOverlayToHost(oldHost, original, newHost);
    const worldAfter = overlayLocalToWorld(newHost, reprojected);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 10);
    expect(worldAfter.worldDeg).toBeCloseTo(worldBefore.worldDeg, 10);

    // Boundary anchor re-projection across 60° rotations remains valid inside unit flat-top hex
    const rimOriginal = { offsetX: 1, offsetY: 0, rotationDeg: 350 };
    const rimWorldBefore = overlayLocalToWorld(oldHost, rimOriginal);
    const rimReprojected = reprojectOverlayToHost(oldHost, rimOriginal, newHost);
    const rimWorldAfter = overlayLocalToWorld(newHost, rimReprojected);
    expect(rimWorldAfter.x).toBeCloseTo(rimWorldBefore.x, 10);
    expect(rimWorldAfter.y).toBeCloseTo(rimWorldBefore.y, 10);
    expect(rimWorldAfter.worldDeg).toBeCloseTo(rimWorldBefore.worldDeg, 10);
    expect(
      Math.abs(rimReprojected.offsetX) + Math.abs(rimReprojected.offsetY) / Math.sqrt(3),
    ).toBeLessThanOrEqual(1 + 1e-12);

    // Reparent re-projection across two different hosts with different rotations preserves world pos & angle
    const sourceHost = { q: 0, r: 0, rotation: 1 as const };
    const targetHost = { q: 1, r: 0, rotation: 4 as const };
    // Point near shared right-bottom border of (0,0) and (1,0) inside (1,0)'s hex
    const sharedTargetCenter = axialToWorld(targetHost.q, targetHost.r, HEX_RADIUS);
    const localOnSource = worldToOverlayLocal(
      sourceHost,
      sharedTargetCenter.x - 10,
      sharedTargetCenter.y + 5,
      132.5,
    );
    const worldBeforeReparent = overlayLocalToWorld(sourceHost, localOnSource);
    const localOnTarget = reprojectOverlayToHost(sourceHost, localOnSource, targetHost);
    const worldAfterReparent = overlayLocalToWorld(targetHost, localOnTarget);
    expect(worldAfterReparent.x).toBeCloseTo(worldBeforeReparent.x, 10);
    expect(worldAfterReparent.y).toBeCloseTo(worldBeforeReparent.y, 10);
    expect(worldAfterReparent.worldDeg).toBeCloseTo(132.5, 10);
  });

  it('hit-tests rotated Overlay OBBs top-to-bottom in global draw order with minimum hit-box padding and alpha awareness', () => {
    expect(MIN_OVERLAY_HIT_SIZE).toBe(32);

    const placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'mhd',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 1, // +60°
        overlays: [
          {
            // Bottom overlay on host 0: 600x240 px -> 100x40 world units, world angle = 60 + 30 = 90° (vertical)
            id: 'ov-bottom-bridge',
            overlayPackId: 'mhd',
            overlayId: 'bridge',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 30,
          },
          {
            // Top overlay on host 0: tiny 96x72 px -> 16x12 world units (padded to 32x32 hit box)
            id: 'ov-tiny-gem',
            overlayPackId: 'mhd',
            overlayId: 'gem',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 300, // world 0°
          },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: 'mhd',
        tileId: '03-04',
        faceNumber: 3,
        rotation: 0,
        overlays: [
          {
            // Unresolved/missing overlay on host 1 -> 72x44 rotated OBB at 45°, NO alpha check
            id: 'ov-missing',
            overlayPackId: 'missing-pack',
            overlayId: 'missing-piece',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 45,
          },
        ],
      },
    ];

    // 1. Alpha-aware pass-through: tiny gem is transparent at (10, 0) [outside 16x12 raw bounds -> still hits padded 32x32!],
    // while bridge is 100x40 rotated 90° (so 40 wide, 100 tall).
    // Test transparent corner on bridge when gem is NOT there:
    const lookupWithTransparentCorner = {
      getPixelSize: (ov: { overlayId: string }) => {
        if (ov.overlayId === 'bridge') return { width: 600, height: 240 }; // 100x40 world
        if (ov.overlayId === 'gem') return { width: 96, height: 72 }; // 16x12 world
        return null; // missing
      },
      isOpaqueAt: (ov: { overlayId: string }, u: number, v: number) => {
        // Missing pieces must never rely on isOpaqueAt; return false here to verify it's ignored for missing
        if (ov.overlayId === 'missing-piece') return false;
        // Gem is opaque only in center 50% (u,v in [0.25, 0.75]), bridge has transparent corners
        if (ov.overlayId === 'bridge') {
          const isCorner = (u < 0.2 || u > 0.8) && (v < 0.2 || v > 0.8);
          return !isCorner;
        }
        return true;
      },
    };

    // Center (0, 0): both gem and bridge hit, gem is on top so hits[0] is gem
    const centerHits = hitTestOverlaysAtWorld(placements, 0, 0, lookupWithTransparentCorner);
    expect(centerHits.map((h) => h.overlay.id)).toEqual(['ov-tiny-gem', 'ov-bottom-bridge']);

    // Tiny piece padding: at (12, 0), outside gem's raw 16x12 (half-w=8) but inside padded 32x32 (half-w=16)
    const paddedGemHits = hitTestOverlaysAtWorld(placements, 12, 0, lookupWithTransparentCorner);
    expect(paddedGemHits[0]?.overlay.id).toBe('ov-tiny-gem');

    // Outside padded gem (x=0, y=40): bridge rotated 90° extends ±50 along Y and ±20 along X
    // At (0, 40): inside bridge (local x=40 <= 50, local y=0 <= 20), opaque -> hits bridge!
    const rotatedBridgeHits = hitTestOverlaysAtWorld(placements, 0, 40, lookupWithTransparentCorner);
    expect(rotatedBridgeHits.map((h) => h.overlay.id)).toEqual(['ov-bottom-bridge']);

    // At (40, 0): inside unrotated 100x40 AABB, but outside 90°-rotated 40x100 OBB -> misses!
    expect(hitTestOverlaysAtWorld(placements, 40, 0, lookupWithTransparentCorner)).toEqual([]);

    // Transparent corner on rotated bridge (0, 40 -> local u~0.9, v~0.1 at (16, 40)): passes through to bare Tile!
    // Bridge local x along +Y world (rotated 90°): world (x=16, y=42) -> lx=42 (u=0.92), ly=-16 (v=0.1) -> transparent corner!
    expect(hitTestOverlaysAtWorld(placements, 16, 42, lookupWithTransparentCorner)).toEqual([]);

    // Missing Overlay on (1, 0): center is (150, 50*sqrt(3)), rotated 45°, 72x44 OBB with NO alpha check
    const host1Center = axialToWorld(1, 0, HEX_RADIUS);
    // Point 30u along local +X axis at 45°: (30*cos45, 30*sin45) = (21.21, 21.21) -> inside 72/2=36, 44/2=22
    const missingHit = hitTestOverlaysAtWorld(
      placements,
      host1Center.x + 21,
      host1Center.y + 21,
      lookupWithTransparentCorner,
    );
    expect(missingHit).toHaveLength(1);
    expect(missingHit[0].overlay.id).toBe('ov-missing');
    expect(missingHit[0].isMissingAsset).toBe(true);
    expect(missingHit[0].width).toBe(MISSING_OVERLAY_WIDTH);
    expect(missingHit[0].height).toBe(MISSING_OVERLAY_HEIGHT);

    // Point 30u perpendicular (at -45° -> outside 44/2=22 half-height) misses missing 72x44 OBB
    const missingMiss = hitTestOverlaysAtWorld(
      placements,
      host1Center.x + 21,
      host1Center.y - 21,
      lookupWithTransparentCorner,
    );
    expect(missingMiss).toEqual([]);
  });

  it('computes minimal radial dial ring geometry and zoom-aware knob hit-testing', () => {
    // At 0° world angle, knob sits directly above center (0, -ringRadius)
    const smallDial = getOverlayDialGeometry(100, 50, 20, 20, 0);
    expect(smallDial.ringRadius).toBe(36); // clamped min 36
    expect(smallDial.knobX).toBeCloseTo(100, 10);
    expect(smallDial.knobY).toBeCloseTo(50 - 36, 10);

    // Huge overlay clamps max ringRadius to 82
    const hugeDial = getOverlayDialGeometry(0, 0, 200, 200, 90);
    expect(hugeDial.ringRadius).toBe(82);
    // At 90° clockwise, local up points right (+ringRadius, 0)
    expect(hugeDial.knobX).toBeCloseTo(82, 10);
    expect(hugeDial.knobY).toBeCloseTo(0, 10);

    expect(isPointOnDialKnob(82, 0, hugeDial, 1)).toBe(true);
    expect(isPointOnDialKnob(82 + 10, 0, hugeDial, 1)).toBe(true);
    expect(isPointOnDialKnob(82 + 15, 0, hugeDial, 1)).toBe(false);
    // Zoomed out (zoom = 0.5) expands world hit radius to 11 / 0.5 = 22
    expect(isPointOnDialKnob(82 + 18, 0, hugeDial, 0.5)).toBe(true);
  });
});
