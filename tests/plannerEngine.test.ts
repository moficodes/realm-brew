import { describe, expect, it } from 'vitest';
import { HEX_RADIUS, axialToWorld } from '../src/domain/hexGeometry';
import { overlayLocalToWorld } from '../src/domain/overlayGeometry';
import {
  applyFogStroke,
  attachOverlayAtWorld,
  buildOverlayPaletteSections,
  canFlipTarget,
  canRedoWithFence,
  canUndoWithFence,
  centerOverlayOnHost,
  clearMap,
  commitHistory,
  commitWithFence,
  compactPlacement,
  computeCollectionUsage,
  computePullList,
  countCoveredPlacements,
  coverAllPlacements,
  createHistory,
  enterPlayerViewSession,
  extractOverlayPrefix,
  findOverlayById,
  findOverlayOnHost,
  flipBrush,
  flipPlacement,
  formatActiveBrushLabel,
  formatAssemblyLabel,
  formatClearMapDescription,
  formatMapSummaryCounts,
  formatPullListText,
  groupOverlaysByPrefix,
  mergeCollectionDefaults,
  moveOrReparentOverlay,
  moveOrSwapPlacement,
  normalizeCollection,
  overlayCollectionKey,
  placeTile,
  reconcileSelectionAfterHistory,
  redoHistory,
  redoWithFence,
  removeOverlay,
  removePlacement,
  reorderOverlayZ,
  resolveFogTileFaceUrl,
  resolveOverlayAsset,
  resolvePlacementAsset,
  revealAllPlacements,
  rotateOverlayByDelta,
  rotatePlacement,
  rotateStep,
  setOverlayLocalRotation,
  setOverlayWorldRotation,
  setPlacementCovered,
  sortOverlayPacksPairedFirst,
  toMapSummary,
  togglePlacementFog,
  undoHistory,
  undoWithFence,
  validateAndParseMapJson,
  validateCollection,
  validatePlacements,
} from '../src/domain/plannerEngine';
import type {
  ActiveBrush,
  BrushSelection,
  Collection,
  Overlay,
  OverlayPack,
  Placement,
  Tileset,
} from '../src/domain/types';

function makeTestTileset(id: string, shortCode: string): Tileset {
  return {
    id,
    name: id,
    shortCode,
    tiles: [
      {
        tileId: '01-02',
        tilesetId: id,
        isSymmetric: false,
        faceA: { faceNumber: 1, label: '01', filename: `${id}_01.png`, url: `/api/assets/${id}/01.png` },
        faceB: { faceNumber: 2, label: '02', filename: `${id}_02.png`, url: `/api/assets/${id}/02.png` },
      },
      {
        tileId: '03-04',
        tilesetId: id,
        isSymmetric: false,
        faceA: { faceNumber: 3, label: '03', filename: `${id}_03.png`, url: `/api/assets/${id}/03.png` },
        faceB: { faceNumber: 4, label: '04', filename: `${id}_04.png`, url: `/api/assets/${id}/04.png` },
      },
      {
        tileId: '37-37',
        tilesetId: id,
        isSymmetric: true,
        faceA: { faceNumber: 37, label: '37', filename: `${id}_37.png`, url: `/api/assets/${id}/37.png` },
        faceB: { faceNumber: 37, label: '37', filename: `${id}_37.png`, url: `/api/assets/${id}/37.png` },
      },
    ],
  };
}

describe('Planner engine Placement & Collection usage (Seam 2)', () => {
  it('places a new Placement at an empty hex coordinate', () => {
    const placements = placeTile([], {
      q: 1,
      r: -1,
      tilesetId: 'man-hewn-dungeons',
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
    });
    expect(placements).toEqual([
      {
        q: 1,
        r: -1,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
      },
    ]);
  });

  it('replaces an existing Placement when placed on an occupied hex coordinate', () => {
    const initial: Placement[] = [
      { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: 'subterranean-rivers', tileId: '03-04', faceNumber: 3, rotation: 2 },
    ];
    const next = placeTile(initial, {
      q: 0,
      r: 0,
      tilesetId: 'underdark-caverns',
      tileId: '05-06',
      faceNumber: 6,
      rotation: 4,
    });
    expect(next).toHaveLength(2);
    expect(next.find((p) => p.q === 0 && p.r === 0)).toEqual({
      q: 0,
      r: 0,
      tilesetId: 'underdark-caverns',
      tileId: '05-06',
      faceNumber: 6,
      rotation: 4,
    });
  });

  it('tracks shared physical Tile availability across Side A & Side B and soft-warns when exceeding Collection', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const collection: Collection = { version: 2, tilesets: { 'man-hewn-dungeons': 2 }, overlayPacks: {} };

    let placements: Placement[] = [];
    placements = placeTile(placements, { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 });
    let usage = computeCollectionUsage(placements, [mhd], collection);
    expect(usage.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 1,
      remaining: 1,
      isOverBudget: false,
    });

    placements = placeTile(placements, { q: 1, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 });
    usage = computeCollectionUsage(placements, [mhd], collection);
    expect(usage.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 2,
      remaining: 0,
      isOverBudget: false,
    });
    expect(usage.overBudgetCoords.size).toBe(0);

    // 3rd Placement uses Face 02 of the same physical Tile -> remaining becomes -1 & flags Placements
    placements = placeTile(placements, { q: 2, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 0 });
    usage = computeCollectionUsage(placements, [mhd], collection);
    expect(usage.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 3,
      remaining: -1,
      isOverBudget: true,
    });
    expect(usage.overBudgetCoords.has('0,0')).toBe(true);
    expect(usage.overBudgetCoords.has('1,0')).toBe(true);
    expect(usage.overBudgetCoords.has('2,0')).toBe(true);
  });

  it('restores old physical Tile availability on replace, isolates _37 per Tileset, and ignores missing assets in over-budget flags', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');
    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2, 'subterranean-rivers': 0 },
      overlayPacks: {},
    };

    let placements: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '37-37', faceNumber: 37, rotation: 0 },
      { q: 1, r: 0, tilesetId: sr.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 2, r: 0, tilesetId: 'missing-set', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    let usage = computeCollectionUsage(placements, [mhd, sr], collection);

    // _37 is strictly isolated per Tileset
    expect(usage.byTileKey.get('man-hewn-dungeons:37-37')?.remaining).toBe(1);
    expect(usage.byTileKey.get('subterranean-rivers:37-37')?.remaining).toBe(0);

    // 0-copy digital-only Tileset soft-warns on first Placement
    expect(usage.byTileKey.get('subterranean-rivers:01-02')).toMatchObject({
      owned: 0,
      used: 1,
      remaining: -1,
      isOverBudget: true,
    });
    expect(usage.overBudgetCoords.has('1,0')).toBe(true);
    expect(usage.overBudgetCoords.has('0,0')).toBe(false);
    // Missing-asset Placement is surfaced as placeholder, not falsely flagged over-budget
    expect(usage.overBudgetCoords.has('2,0')).toBe(false);

    // Replacing (0,0) with 03-04 restores 37-37 back to 2
    placements = placeTile(placements, { q: 0, r: 0, tilesetId: mhd.id, tileId: '03-04', faceNumber: 3, rotation: 0 });
    usage = computeCollectionUsage(placements, [mhd, sr], collection);
    expect(usage.byTileKey.get('man-hewn-dungeons:37-37')?.remaining).toBe(2);
    expect(usage.byTileKey.get('man-hewn-dungeons:03-04')?.remaining).toBe(1);
  });

  it('rotates Placements and steps 60 degrees clockwise and counter-clockwise with wraparound', () => {
    expect(rotateStep(5, 1)).toBe(0);
    expect(rotateStep(0, -1)).toBe(5);
    expect(rotateStep(2, 1)).toBe(3);

    const initial: Placement[] = [
      { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    const ccw = rotatePlacement(initial, { q: 0, r: 0 }, -1);
    expect(ccw[0].rotation).toBe(5);
    const cw = rotatePlacement(ccw, { q: 0, r: 0 }, 1);
    expect(cw[0].rotation).toBe(0);
  });

  it('flips between Side A and Side B with zero net stock change and leaves symmetric Tiles unchanged', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const collection: Collection = { version: 2, tilesets: { 'man-hewn-dungeons': 2 }, overlayPacks: {} };

    const initial: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 2 },
      { q: 1, r: 0, tilesetId: mhd.id, tileId: '37-37', faceNumber: 37, rotation: 1 },
    ];

    const flippedA = flipPlacement(initial, { q: 0, r: 0 }, [mhd]);
    expect(flippedA.find((p) => p.q === 0 && p.r === 0)?.faceNumber).toBe(2);
    // Availability stays unchanged on flip
    expect(computeCollectionUsage(flippedA, [mhd], collection).byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(1);

    const flippedBack = flipPlacement(flippedA, { q: 0, r: 0 }, [mhd]);
    expect(flippedBack.find((p) => p.q === 0 && p.r === 0)?.faceNumber).toBe(1);

    // Symmetric _37 stays unchanged and reports canFlipTarget=false
    const flippedDark = flipPlacement(flippedBack, { q: 1, r: 0 }, [mhd]);
    expect(flippedDark.find((p) => p.q === 1 && p.r === 0)?.faceNumber).toBe(37);
    const byId = new Map([[mhd.id, mhd]]);
    expect(canFlipTarget(initial[0], byId)).toBe(true);
    expect(canFlipTarget(initial[1], byId)).toBe(false);

    // Brush flip works identically
    const brush: BrushSelection = { tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 3 };
    expect(flipBrush(brush, [mhd])).toEqual({
      tilesetId: mhd.id,
      tileId: '01-02',
      faceNumber: 2,
      rotation: 3,
    });
  });

  it('moves Placements to empty hexes, swaps occupied hexes, removes Placements, and clears Map', () => {
    const a: Placement = { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 };
    const b: Placement = { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 4, rotation: 3 };

    const moved = moveOrSwapPlacement([a, b], { q: 0, r: 0 }, { q: 2, r: -1 });
    expect(moved.find((p) => p.q === 0 && p.r === 0)).toBeUndefined();
    expect(moved.find((p) => p.q === 2 && p.r === -1)).toMatchObject({ tileId: '01-02', faceNumber: 1, rotation: 0 });

    const swapped = moveOrSwapPlacement(moved, { q: 2, r: -1 }, { q: 1, r: 0 });
    expect(swapped.find((p) => p.q === 2 && p.r === -1)).toMatchObject({ tileId: '03-04', faceNumber: 4, rotation: 3 });
    expect(swapped.find((p) => p.q === 1 && p.r === 0)).toMatchObject({ tileId: '01-02', faceNumber: 1, rotation: 0 });

    const removed = removePlacement(swapped, { q: 1, r: 0 });
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ q: 2, r: -1, tileId: '03-04' });

    expect(clearMap()).toEqual([]);
  });

  it('tracks Undo/Redo history across place, edit, and Clear Map and discards redo branch on new edits', () => {
    const p1: Placement = { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 };
    const p2: Placement = { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 };

    let h = createHistory<Placement[]>([]);
    h = commitHistory(h, placeTile(h.present, p1));
    h = commitHistory(h, placeTile(h.present, p2));
    h = commitHistory(h, clearMap());
    expect(h.present).toEqual([]);
    expect(h.past).toHaveLength(3);

    // Undo Clear Map
    h = undoHistory(h);
    expect(h.present).toHaveLength(2);
    expect(h.future).toHaveLength(1);

    // Redo Clear Map
    h = redoHistory(h);
    expect(h.present).toEqual([]);

    // Undo back to 1 placement and branch with a new edit
    h = undoHistory(h);
    h = undoHistory(h);
    expect(h.present).toEqual([p1]);
    expect(h.future).toHaveLength(2);

    h = commitHistory(h, rotatePlacement(h.present, { q: 0, r: 0 }, 1));
    expect(h.future).toEqual([]);
    expect(h.present[0].rotation).toBe(1);
  });

  it('validates Map JSON while preserving missing-asset Placements and rejects malformed payloads', () => {
    const valid = validateAndParseMapJson(
      JSON.stringify({
        version: 1,
        id: 'imported-1',
        name: 'Old Dungeon',
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        placements: [
          { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
          { q: 1, r: 0, tilesetId: 'future-expansion', tileId: '05-06', faceNumber: 5, rotation: 3 },
          { q: 2, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '99-100', faceNumber: 99, rotation: 1 },
        ],
      }),
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.map.placements).toHaveLength(3);

      const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
      const byId = new Map([[mhd.id, mhd]]);
      expect(resolvePlacementAsset(valid.map.placements[0], byId).status).toBe('ok');
      expect(resolvePlacementAsset(valid.map.placements[1], byId).status).toBe('missing-tileset');
      expect(resolvePlacementAsset(valid.map.placements[2], byId).status).toBe('missing-face');
    }

    expect(validateAndParseMapJson('{not json')).toMatchObject({ ok: false });
    expect(validateAndParseMapJson(JSON.stringify({ version: 99, placements: [] }))).toMatchObject({ ok: false });
    expect(
      validateAndParseMapJson(
        JSON.stringify({
          version: 1,
          name: 'Bad Rot',
          placements: [{ q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 7 }],
        }),
      ),
    ).toMatchObject({ ok: false });

    // Rejects duplicate (q, r) coordinates
    expect(
      validateAndParseMapJson(
        JSON.stringify({
          version: 1,
          name: 'Duplicate Coord',
          placements: [
            { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
            { q: -0, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 1 },
          ],
        }),
      ),
    ).toMatchObject({ ok: false });
  });

  it('evaluates Collection availability independently per active Map', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const collection: Collection = { version: 2, tilesets: { 'man-hewn-dungeons': 2 }, overlayPacks: {} };

    const mapA: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 0 },
    ];
    const mapB: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];

    const usageA = computeCollectionUsage(mapA, [mhd], collection);
    const usageB = computeCollectionUsage(mapB, [mhd], collection);
    expect(usageA.byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(0);
    expect(usageB.byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(1);
  });

  it('derives grouped Pull List with Face breakdowns, symmetric _37, over-budget flags, missing assets, and text export', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');
    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2, 'subterranean-rivers': 2 },
      overlayPacks: {},
    };

    const placements: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 1 },
      { q: 2, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 2 },
      { q: 3, r: 0, tilesetId: mhd.id, tileId: '37-37', faceNumber: 37, rotation: 0 },
      { q: 0, r: 1, tilesetId: sr.id, tileId: '03-04', faceNumber: 4, rotation: 3 },
      { q: 1, r: 1, tilesetId: 'lost-pack', tileId: '09-10', faceNumber: 9, rotation: 0 },
    ];

    const pullList = computePullList(placements, [mhd, sr], collection);
    expect(pullList.totalPlacements).toBe(6);
    expect(pullList.groups).toHaveLength(2);

    const mhdGroup = pullList.groups[0];
    expect(mhdGroup.tilesetId).toBe('man-hewn-dungeons');
    expect(mhdGroup.items).toHaveLength(2);
    expect(mhdGroup.items[0]).toMatchObject({
      tileId: '01-02',
      needed: 3,
      owned: 2,
      isOverBudget: true,
      faces: [
        { faceNumber: 1, label: '01', count: 1 },
        { faceNumber: 2, label: '02', count: 2 },
      ],
    });
    expect(mhdGroup.items[1]).toMatchObject({
      tileId: '37-37',
      needed: 1,
      owned: 2,
      isOverBudget: false,
      isSymmetric: true,
      faces: [{ faceNumber: 37, label: '37', count: 1 }],
    });

    expect(pullList.missing).toEqual([
      { tilesetId: 'lost-pack', tileId: '09-10', faceNumber: 9, label: '09', count: 1 },
    ]);

    const byId = new Map([
      [mhd.id, mhd],
      [sr.id, sr],
    ]);
    expect(formatAssemblyLabel(placements[0], byId)).toBe('MHD #01');
    expect(formatAssemblyLabel(placements[3], byId)).toBe('MHD #37');
    expect(formatAssemblyLabel(placements[5], byId)).toBe('?lost-pack #09');

    const text = formatPullListText('Session 4 Crypt', pullList);
    expect(text).toContain('Session 4 Crypt');
    expect(text).toContain('01/02');
    expect(text).toContain('#01 x1');
    expect(text).toContain('#02 x2');
    expect(text).toContain('OVER BUDGET');
    expect(text).toContain('lost-pack #09');
  });

  it('validates v2 Collection payloads, auto-migrates flat v1 collections, and merges defaults while preserving unknown keys', () => {
    expect(
      validateCollection({
        version: 2,
        tilesets: { 'man-hewn-dungeons': 0 },
        overlayPacks: { 'alchemists-workshop': 3 },
      }),
    ).toEqual({
      version: 2,
      tilesets: { 'man-hewn-dungeons': 0 },
      overlayPacks: { 'alchemists-workshop': 3 },
    });

    expect(validateCollection({ 'man-hewn-dungeons': 2 })).toBeNull();
    expect(validateCollection({ version: 2, tilesets: { a: -1 }, overlayPacks: {} })).toBeNull();
    expect(validateCollection({ version: 2, tilesets: {}, overlayPacks: { b: 1.25 } })).toBeNull();
    expect(validateCollection({ version: 2, tilesets: {} })).toBeNull();
    expect(validateCollection({ version: 1, tilesets: {}, overlayPacks: {} })).toBeNull();

    const migrated = normalizeCollection({ 'man-hewn-dungeons': 1, 'absent-set': 5 });
    expect(migrated).toEqual({
      version: 2,
      tilesets: { 'man-hewn-dungeons': 1, 'absent-set': 5 },
      overlayPacks: {},
    });
    expect(normalizeCollection({ version: 2 })).toBeNull();

    const merged = mergeCollectionDefaults(
      {
        version: 2,
        tilesets: { 'man-hewn-dungeons': 1, 'absent-set': 5 },
        overlayPacks: { 'absent-pack': 4 },
      },
      ['man-hewn-dungeons', 'underdark-caverns'],
      ['alchemists-workshop', 'red-dragons-lair'],
    );
    expect(merged).toEqual({
      version: 2,
      tilesets: {
        'man-hewn-dungeons': 1,
        'absent-set': 5,
        'underdark-caverns': 2,
      },
      overlayPacks: {
        'absent-pack': 4,
        'alchemists-workshop': 2,
        'red-dragons-lair': 2,
      },
    });
  });

  it('auto-normalizes v1 Maps to v2, clamps/wraps Overlay geometry, compacts defaults, and strictly rejects invalid v2 fields', () => {
    const v1Parsed = validateAndParseMapJson(
      JSON.stringify({
        version: 1,
        name: 'Legacy Map',
        placements: [
          { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
        ],
      }),
    );
    expect(v1Parsed.ok).toBe(true);
    if (v1Parsed.ok) {
      expect(v1Parsed.map.version).toBe(2);
      expect(v1Parsed.map.placements[0]).toEqual({
        q: 0,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: false,
        overlays: [],
      });
      expect(compactPlacement(v1Parsed.map.placements[0])).toEqual({
        q: 0,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
      });
      expect('covered' in compactPlacement(v1Parsed.map.placements[0])).toBe(false);
      expect('overlays' in compactPlacement(v1Parsed.map.placements[0])).toBe(false);
    }

    const v2Parsed = validateAndParseMapJson(
      JSON.stringify({
        version: 2,
        name: 'V2 Crypt',
        placements: [
          {
            q: 0,
            r: 0,
            tilesetId: 'man-hewn-dungeons',
            tileId: '01-02',
            faceNumber: 1,
            rotation: 2,
            covered: true,
            overlays: [
              {
                id: 'ov-1',
                overlayPackId: 'alchemists-workshop',
                overlayId: 'table-1',
                offsetX: 2,
                offsetY: 0,
                rotationDeg: -45,
              },
              {
                id: 'ov-2',
                overlayPackId: 'alchemists-workshop',
                overlayId: 'door-1',
                offsetX: 0.1,
                offsetY: -0.2,
                rotationDeg: 725,
              },
            ],
          },
        ],
      }),
    );
    expect(v2Parsed.ok).toBe(true);
    if (v2Parsed.ok) {
      expect(v2Parsed.map.version).toBe(2);
      expect(v2Parsed.map.placements[0].covered).toBe(true);
      expect(v2Parsed.map.placements[0].overlays).toEqual([
        {
          id: 'ov-1',
          overlayPackId: 'alchemists-workshop',
          overlayId: 'table-1',
          offsetX: 1,
          offsetY: 0,
          rotationDeg: 315,
        },
        {
          id: 'ov-2',
          overlayPackId: 'alchemists-workshop',
          overlayId: 'door-1',
          offsetX: 0.1,
          offsetY: -0.2,
          rotationDeg: 5,
        },
      ]);
      expect(compactPlacement(v2Parsed.map.placements[0])).toMatchObject({
        covered: true,
        overlays: v2Parsed.map.placements[0].overlays,
      });
    }

    // Reject malformed covered / overlays
    expect(
      validateAndParseMapJson(
        JSON.stringify({
          version: 2,
          name: 'Bad Covered',
          placements: [
            { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0, covered: 'yes' },
          ],
        }),
      ),
    ).toMatchObject({ ok: false });

    expect(
      validateAndParseMapJson(
        JSON.stringify({
          version: 2,
          name: 'Bad Overlays',
          placements: [
            { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0, overlays: {} },
          ],
        }),
      ),
    ).toMatchObject({ ok: false });

    // Reject empty IDs
    expect(
      validatePlacements([
        {
          q: 0,
          r: 0,
          tilesetId: 'mhd',
          tileId: '01-02',
          faceNumber: 1,
          rotation: 0,
          overlays: [
            { id: '  ', overlayPackId: 'aw', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          ],
        },
      ]),
    ).toBeNull();

    // Reject duplicate OverlayPlacement.id across different host Placements
    expect(
      validateAndParseMapJson(
        JSON.stringify({
          version: 2,
          name: 'Dup Overlay ID',
          placements: [
            {
              q: 0,
              r: 0,
              tilesetId: 'mhd',
              tileId: '01-02',
              faceNumber: 1,
              rotation: 0,
              overlays: [
                { id: 'dup-id', overlayPackId: 'aw', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
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
                { id: 'dup-id', overlayPackId: 'aw', overlayId: 'door-2', offsetX: 0, offsetY: 0, rotationDeg: 0 },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false });

    // Reject non-finite numeric fields
    expect(
      validatePlacements([
        {
          q: 0,
          r: 0,
          tilesetId: 'mhd',
          tileId: '01-02',
          faceNumber: 1,
          rotation: 0,
          overlays: [
            { id: 'ov-nan', overlayPackId: 'aw', overlayId: 'door-1', offsetX: Number.NaN, offsetY: 0, rotationDeg: 0 },
          ],
        },
      ]),
    ).toBeNull();

    expect(
      validatePlacements([
        {
          q: 0,
          r: 0,
          tilesetId: 'mhd',
          tileId: '01-02',
          faceNumber: 1,
          rotation: 0,
          overlays: [
            {
              id: 'ov-inf',
              overlayPackId: 'aw',
              overlayId: 'door-1',
              offsetX: 0,
              offsetY: 0,
              rotationDeg: Number.POSITIVE_INFINITY,
            },
          ],
        },
      ]),
    ).toBeNull();

    expect(formatMapSummaryCounts(0, 0)).toBe('0 Tiles');
    expect(formatMapSummaryCounts(1, 0)).toBe('1 Tile');
    expect(formatMapSummaryCounts(3, 1)).toBe('3 Tiles · 1 Overlay');
    expect(formatMapSummaryCounts(3, 4)).toBe('3 Tiles · 4 Overlays');
    if (v2Parsed.ok) {
      expect(toMapSummary(v2Parsed.map)).toEqual({
        id: v2Parsed.map.id,
        name: 'V2 Crypt',
        placementCount: 1,
        overlayCount: 2,
        updatedAt: v2Parsed.map.updatedAt,
      });
    }
  });

  it('tracks per-Map Overlay Collection accounting, soft-warns over-budget & 0-copy packs, and excludes missing Overlay assets', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const awPack: OverlayPack = {
      id: 'alchemists-workshop',
      name: "Alchemists' Workshop",
      shortCode: 'AW',
      pairedTilesetId: null,
      overlays: [
        {
          overlayId: 'door-1',
          overlayPackId: 'alchemists-workshop',
          label: 'Door 1',
          filename: 'Door 1.png',
          url: '/api/overlay-assets/alchemists-workshop/Door%201.png',
        },
        {
          overlayId: 'door-2',
          overlayPackId: 'alchemists-workshop',
          label: 'Door 2',
          filename: 'Door 2.png',
          url: '/api/overlay-assets/alchemists-workshop/Door%202.png',
        },
      ],
    };
    const rdlPack: OverlayPack = {
      id: 'red-dragons-lair',
      name: "Red Dragon's Lair",
      shortCode: 'RDL',
      pairedTilesetId: null,
      overlays: [
        {
          overlayId: 'dragon-nest',
          overlayPackId: 'red-dragons-lair',
          label: 'Dragon Nest',
          filename: 'Dragon Nest.png',
          url: '/api/overlay-assets/red-dragons-lair/Dragon%20Nest.png',
        },
      ],
    };

    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2 },
      overlayPacks: { 'alchemists-workshop': 2, 'red-dragons-lair': 0 },
    };

    const placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        overlays: [
          { id: 'ov-1', overlayPackId: 'alchemists-workshop', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-2', overlayPackId: 'alchemists-workshop', overlayId: 'door-1', offsetX: 0.2, offsetY: 0, rotationDeg: 90 },
          { id: 'ov-3', overlayPackId: 'alchemists-workshop', overlayId: 'door-2', offsetX: -0.2, offsetY: 0, rotationDeg: 45 },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: 'missing-tileset',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: true,
        overlays: [
          { id: 'ov-4', overlayPackId: 'alchemists-workshop', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-5', overlayPackId: 'red-dragons-lair', overlayId: 'dragon-nest', offsetX: 0, offsetY: 0, rotationDeg: 15 },
          { id: 'ov-missing-pack', overlayPackId: 'future-pack', overlayId: 'table', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-missing-overlay', overlayPackId: 'red-dragons-lair', overlayId: 'nonexistent', offsetX: 0, offsetY: 0, rotationDeg: 0 },
        ],
      },
    ];

    const packsById = new Map([
      [awPack.id, awPack],
      [rdlPack.id, rdlPack],
    ]);
    expect(resolveOverlayAsset(placements[0].overlays![0], packsById).status).toBe('ok');
    expect(resolveOverlayAsset(placements[1].overlays![2], packsById).status).toBe('missing-pack');
    expect(resolveOverlayAsset(placements[1].overlays![3], packsById).status).toBe('missing-overlay');

    const usage = computeCollectionUsage(placements, [mhd], collection, [awPack, rdlPack]);

    expect(usage.byOverlayKey.get(overlayCollectionKey('alchemists-workshop', 'door-1'))).toEqual({
      overlayPackId: 'alchemists-workshop',
      overlayId: 'door-1',
      owned: 2,
      used: 3,
      remaining: -1,
      isOverBudget: true,
    });
    expect(usage.byOverlayKey.get(overlayCollectionKey('alchemists-workshop', 'door-2'))).toEqual({
      overlayPackId: 'alchemists-workshop',
      overlayId: 'door-2',
      owned: 2,
      used: 1,
      remaining: 1,
      isOverBudget: false,
    });
    // 0-copy digital-only pack soft-warns on first Overlay Placement
    expect(usage.byOverlayKey.get(overlayCollectionKey('red-dragons-lair', 'dragon-nest'))).toEqual({
      overlayPackId: 'red-dragons-lair',
      overlayId: 'dragon-nest',
      owned: 0,
      used: 1,
      remaining: -1,
      isOverBudget: true,
    });

    expect(usage.overBudgetOverlayIds).toEqual(new Set(['ov-1', 'ov-2', 'ov-4', 'ov-5']));
    expect(usage.overBudgetOverlayIds.has('ov-3')).toBe(false);
    expect(usage.overBudgetOverlayIds.has('ov-missing-pack')).toBe(false);
    expect(usage.overBudgetOverlayIds.has('ov-missing-overlay')).toBe(false);
  });

  it('groups Overlays with natural sorting, (...) & number stripping, singular/plural merge, Other bucket, and single-group header omission', () => {
    const mkOverlay = (label: string, packId = 'gh'): Overlay => ({
      overlayId: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      overlayPackId: packId,
      label,
      filename: `${label}.png`,
      url: `/api/overlay-assets/${packId}/${encodeURIComponent(label)}.png`,
    });

    expect(extractOverlayPrefix('Bridge (Broken) 1')).toBe('Bridge');
    expect(extractOverlayPrefix('Traps (Poison Gas 2)')).toBe('Traps');
    expect(extractOverlayPrefix('Niche (Head Statue)')).toBe('Niche');
    expect(extractOverlayPrefix('Door 10')).toBe('Door');

    // Multi-group pack: natural numeric sort, case-insensitive singular/plural merge, singleton Other at bottom
    const mixed: Overlay[] = [
      mkOverlay('Wardrums'),
      mkOverlay('Door 10'),
      mkOverlay('Door 2'),
      mkOverlay('door 1'),
      mkOverlay('Bridge (Broken) 10'),
      mkOverlay('Bridge (Broken) 2'),
      mkOverlay('Bridge 1'),
      mkOverlay('Trap (Spring Pull Snare)'),
      mkOverlay('Traps (Pit Fall)'),
      mkOverlay('traps (Snare)'),
      mkOverlay('Cage'),
    ];
    const grouped = groupOverlaysByPrefix(mixed);
    expect(grouped.map((g) => ({ heading: g.heading, labels: g.overlays.map((o) => o.label) }))).toEqual([
      {
        heading: 'Bridge',
        labels: ['Bridge (Broken) 2', 'Bridge (Broken) 10', 'Bridge 1'],
      },
      {
        heading: 'Door',
        labels: ['door 1', 'Door 2', 'Door 10'],
      },
      {
        heading: 'Traps',
        labels: ['Trap (Spring Pull Snare)', 'Traps (Pit Fall)', 'traps (Snare)'],
      },
      {
        heading: 'Other',
        labels: ['Cage', 'Wardrums'],
      },
    ]);

    // Single multi-item prefix resolves to one group -> heading omitted (null), natural sort preserved
    const singlePrefix = groupOverlaysByPrefix([
      mkOverlay('Door 10', 'aw'),
      mkOverlay('Door 2', 'aw'),
      mkOverlay('Door 1', 'aw'),
    ]);
    expect(singlePrefix).toHaveLength(1);
    expect(singlePrefix[0].heading).toBeNull();
    expect(singlePrefix[0].overlays.map((o) => o.label)).toEqual(['Door 1', 'Door 2', 'Door 10']);

    // All singletons resolve to one Other group -> heading omitted (null)
    const allSingletons = groupOverlaysByPrefix([mkOverlay('Wardrums'), mkOverlay('Cage')]);
    expect(allSingletons).toHaveLength(1);
    expect(allSingletons[0].heading).toBeNull();
    expect(allSingletons[0].overlays.map((o) => o.label)).toEqual(['Cage', 'Wardrums']);

    expect(groupOverlaysByPrefix([])).toEqual([]);

    // Paired-first then standalone alphabetical pack ordering
    const tilesets = [
      makeTestTileset('man-hewn-dungeons', 'MHD'),
      makeTestTileset('subterranean-rivers', 'SR'),
      makeTestTileset('underdark-caverns', 'UC'),
    ];
    const shuffledPacks: OverlayPack[] = [
      { id: 'red-dragons-lair', name: "Red Dragon's Lair", shortCode: 'RDL', pairedTilesetId: null, overlays: [] },
      { id: 'underdark-caverns', name: 'Underdark Caverns', shortCode: 'UC', pairedTilesetId: 'underdark-caverns', overlays: [] },
      { id: 'alchemists-workshop', name: "Alchemists' Workshop", shortCode: 'AW', pairedTilesetId: null, overlays: [] },
      { id: 'man-hewn-dungeons', name: 'Man Hewn Dungeons', shortCode: 'MHD', pairedTilesetId: 'man-hewn-dungeons', overlays: [] },
      { id: 'goblins-hideout', name: "Goblins' Hideout", shortCode: 'GH', pairedTilesetId: null, overlays: [] },
      { id: 'subterranean-rivers', name: 'Subterranean Rivers', shortCode: 'SR', pairedTilesetId: 'subterranean-rivers', overlays: [] },
    ];
    expect(sortOverlayPacksPairedFirst(shuffledPacks, tilesets).map((p) => p.shortCode)).toEqual([
      'MHD',
      'SR',
      'UC',
      'AW',
      'GH',
      'RDL',
    ]);

    const tileBrush: ActiveBrush = {
      kind: 'tile',
      tilesetId: 'man-hewn-dungeons',
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
    };
    const overlayBrush: ActiveBrush = {
      kind: 'overlay',
      overlayPackId: 'alchemists-workshop',
      overlayId: 'laboratory-lab-bench',
      label: 'Laboratory (Lab Bench)',
      shortCode: 'AW',
      url: '/api/overlay-assets/alchemists-workshop/Laboratory%20(Lab%20Bench).png',
      rotationDeg: 0,
    };
    const tilesetsById = new Map(tilesets.map((t) => [t.id, t]));
    expect(formatActiveBrushLabel(tileBrush, tilesetsById)).toBe('MHD #01');
    expect(formatActiveBrushLabel(overlayBrush, tilesetsById)).toBe('AW Laboratory (Lab Bench)');
    expect(flipBrush(tileBrush, tilesets).kind).toBe('tile');

    // In-stock only + scoped search filtering across Overlay Packs and prefix groups
    const awOverlays: OverlayPack = {
      id: 'alchemists-workshop',
      name: "Alchemists' Workshop",
      shortCode: 'AW',
      pairedTilesetId: null,
      overlays: [
        mkOverlay('Door 1', 'alchemists-workshop'),
        mkOverlay('Door 2', 'alchemists-workshop'),
        mkOverlay('Bridge 1', 'alchemists-workshop'),
        mkOverlay('Bridge 2', 'alchemists-workshop'),
      ],
    };
    const rdlOverlays: OverlayPack = {
      id: 'red-dragons-lair',
      name: "Red Dragon's Lair",
      shortCode: 'RDL',
      pairedTilesetId: null,
      overlays: [mkOverlay('Dragon Nest', 'red-dragons-lair')],
    };
    const col: Collection = {
      version: 2,
      tilesets: {},
      overlayPacks: { 'alchemists-workshop': 1, 'red-dragons-lair': 0 },
    };
    const usage = computeCollectionUsage(
      [
        {
          q: 0,
          r: 0,
          tilesetId: 'mhd',
          tileId: '01-02',
          faceNumber: 1,
          rotation: 0,
          overlays: [
            { id: 'u1', overlayPackId: 'alchemists-workshop', overlayId: 'door-1', offsetX: 0, offsetY: 0, rotationDeg: 0 },
            { id: 'u2', overlayPackId: 'alchemists-workshop', overlayId: 'door-2', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          ],
        },
      ],
      [],
      col,
      [awOverlays, rdlOverlays],
    );
    const groupedMap = new Map([
      [awOverlays.id, groupOverlaysByPrefix(awOverlays.overlays)],
      [rdlOverlays.id, groupOverlaysByPrefix(rdlOverlays.overlays)],
    ]);

    // In-stock only omits 0-copy RDL pack and exhausted Door group in AW, leaving only Bridge -> 1 group (heading: null)
    const inStockResult = buildOverlayPaletteSections({
      orderedPacks: [awOverlays, rdlOverlays],
      groupedByPackId: groupedMap,
      selectedPackId: 'all',
      searchQuery: '',
      inStockOnly: true,
      availabilityByOverlayKey: usage.byOverlayKey,
    });
    expect(inStockResult.sections).toHaveLength(1);
    expect(inStockResult.sections[0].pack.id).toBe('alchemists-workshop');
    expect(inStockResult.sections[0].groups).toHaveLength(1);
    expect(inStockResult.sections[0].groups[0].heading).toBeNull();
    expect(inStockResult.sections[0].groups[0].overlays.map((o) => o.label)).toEqual(['Bridge 1', 'Bridge 2']);

    // Searching "Dragon" while scoped to AW yields 0 in AW, 1 match across all packs when not inStockOnly, 0 when inStockOnly
    const scopedAllStock = buildOverlayPaletteSections({
      orderedPacks: [awOverlays, rdlOverlays],
      groupedByPackId: groupedMap,
      selectedPackId: 'alchemists-workshop',
      searchQuery: 'dragon',
      inStockOnly: false,
      availabilityByOverlayKey: usage.byOverlayKey,
    });
    expect(scopedAllStock.sections).toHaveLength(0);
    expect(scopedAllStock.totalMatchesAllPacks).toBe(1);

    const scopedInStockOnly = buildOverlayPaletteSections({
      orderedPacks: [awOverlays, rdlOverlays],
      groupedByPackId: groupedMap,
      selectedPackId: 'alchemists-workshop',
      searchQuery: 'dragon',
      inStockOnly: true,
      availabilityByOverlayKey: usage.byOverlayKey,
    });
    expect(scopedInStockOnly.sections).toHaveLength(0);
    expect(scopedInStockOnly.totalMatchesAllPacks).toBe(0);
  });
});

describe('Overlay attach & host-Tile lifecycle engine commands (Seam 2)', () => {
  const makeOverlayPack = (): OverlayPack => ({
    id: 'man-hewn-dungeons',
    name: 'Man Hewn Dungeons',
    shortCode: 'MHD',
    pairedTilesetId: 'man-hewn-dungeons',
    overlays: [
      {
        overlayId: 'bridge-1',
        overlayPackId: 'man-hewn-dungeons',
        label: 'Bridge 1',
        filename: 'Bridge 1.png',
        url: '/api/overlay-assets/man-hewn-dungeons/Bridge%201.png',
      },
      {
        overlayId: 'door-1',
        overlayPackId: 'man-hewn-dungeons',
        label: 'Door 1',
        filename: 'Door 1.png',
        url: '/api/overlay-assets/man-hewn-dungeons/Door%201.png',
      },
    ],
  });

  it('attaches Overlays freeform onto occupied hexes, clamps to unit hex, stacks in order, updates Collection usage, and blocks empty hexes', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const pack = makeOverlayPack();
    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2 },
      overlayPacks: { 'man-hewn-dungeons': 1 },
    };

    const initial: Placement[] = [
      { q: 1, r: -1, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 2 },
    ];

    // Empty hex space is blocked without mutating Map
    const emptyCenter = axialToWorld(0, 0, HEX_RADIUS);
    const blocked = attachOverlayAtWorld(
      initial,
      { q: 0, r: 0 },
      { overlayPackId: pack.id, overlayId: 'bridge-1', rotationDeg: 35 },
      emptyCenter.x,
      emptyCenter.y,
    );
    expect(blocked.createdOverlay).toBeNull();
    expect(blocked.placements).toEqual(initial);

    // Occupied hex freeform placement (exact pointer world pos, no center/spoke snap)
    const hostCenter = axialToWorld(1, -1, HEX_RADIUS);
    const first = attachOverlayAtWorld(
      initial,
      { q: 1, r: -1 },
      { overlayPackId: pack.id, overlayId: 'bridge-1', rotationDeg: 22.5 },
      hostCenter.x + 17,
      hostCenter.y - 29,
    );
    expect(first.createdOverlay).not.toBeNull();
    const firstOv = first.createdOverlay!;
    const firstWorld = overlayLocalToWorld(first.placements[0], firstOv);
    expect(firstWorld.x).toBeCloseTo(hostCenter.x + 17, 10);
    expect(firstWorld.y).toBeCloseTo(hostCenter.y - 29, 10);
    expect(firstWorld.worldDeg).toBeCloseTo(22.5, 10);

    // Second placement of the same Overlay outside rim clamps anchor to unit hex, appends on top, generates unique ID, and triggers over-budget
    const second = attachOverlayAtWorld(
      first.placements,
      { q: 1, r: -1 },
      { overlayPackId: pack.id, overlayId: 'bridge-1', rotationDeg: 90 },
      hostCenter.x + 300,
      hostCenter.y,
    );
    expect(second.createdOverlay).not.toBeNull();
    const secondOv = second.createdOverlay!;
    expect(secondOv.id).not.toBe(firstOv.id);
    const hostOverlays = second.placements[0].overlays ?? [];
    expect(hostOverlays).toHaveLength(2);
    expect(hostOverlays[0].id).toBe(firstOv.id);
    expect(hostOverlays[1].id).toBe(secondOv.id);

    const clampedWorld = overlayLocalToWorld(second.placements[0], secondOv);
    expect(clampedWorld.x).toBeCloseTo(hostCenter.x + HEX_RADIUS, 10);
    expect(clampedWorld.y).toBeCloseTo(hostCenter.y, 10);

    const usage = computeCollectionUsage(second.placements, [mhd], collection, [pack]);
    expect(usage.byOverlayKey.get(overlayCollectionKey(pack.id, 'bridge-1'))).toMatchObject({
      owned: 1,
      used: 2,
      remaining: -1,
      isOverBudget: true,
    });
    expect(usage.overBudgetOverlayIds).toEqual(new Set([firstOv.id, secondOv.id]));
  });

  it('carries Overlays on move/swap, orbits+rotates on host rotate, keeps on flip, re-projects on replace, and removes atomically with Undo', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');

    const initial: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: true,
        overlays: [
          {
            id: 'ov-a',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'bridge-1',
            offsetX: 0.5,
            offsetY: 0,
            rotationDeg: 15,
          },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: sr.id,
        tileId: '03-04',
        faceNumber: 3,
        rotation: 1,
        overlays: [
          {
            id: 'ov-b',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'door-1',
            offsetX: -0.25,
            offsetY: 0.25,
            rotationDeg: 90,
          },
        ],
      },
    ];

    // 1. Rotate host Placement (+60°): rotates & orbits Overlay together with Tile artwork
    const rotated = rotatePlacement(initial, { q: 0, r: 0 }, 1);
    const rotatedHost = rotated.find((p) => p.q === 0 && p.r === 0)!;
    expect(rotatedHost.rotation).toBe(1);
    const rotatedWorld = overlayLocalToWorld(rotatedHost, rotatedHost.overlays![0]);
    expect(rotatedWorld.x).toBeCloseTo(25, 10);
    expect(rotatedWorld.y).toBeCloseTo(25 * Math.sqrt(3), 10);
    expect(rotatedWorld.worldDeg).toBeCloseTo(75, 10);

    // 2. Flip host Tile: leaves attached Overlays intact
    const flipped = flipPlacement(rotated, { q: 0, r: 0 }, [mhd, sr]);
    const flippedHost = flipped.find((p) => p.q === 0 && p.r === 0)!;
    expect(flippedHost.faceNumber).toBe(2);
    expect(flippedHost.overlays).toEqual(rotatedHost.overlays);

    // 3. Overwrite / replace host Tile with different Tile and different rotation:
    // preserves attached Overlays at exact visual world position & angle, preserves covered, preserves draw slot
    const worldBeforeReplace = overlayLocalToWorld(flippedHost, flippedHost.overlays![0]);
    const replaced = placeTile(flipped, {
      q: 0,
      r: 0,
      tilesetId: sr.id,
      tileId: '01-02',
      faceNumber: 1,
      rotation: 4,
    });
    expect(replaced[0].q).toBe(0);
    expect(replaced[0].r).toBe(0);
    expect(replaced[0].tilesetId).toBe(sr.id);
    expect(replaced[0].rotation).toBe(4);
    expect(replaced[0].covered).toBe(true);
    expect(replaced[0].overlays).toHaveLength(1);
    const worldAfterReplace = overlayLocalToWorld(replaced[0], replaced[0].overlays![0]);
    expect(worldAfterReplace.x).toBeCloseTo(worldBeforeReplace.x, 10);
    expect(worldAfterReplace.y).toBeCloseTo(worldBeforeReplace.y, 10);
    expect(worldAfterReplace.worldDeg).toBeCloseTo(worldBeforeReplace.worldDeg, 10);

    // 4. Move to empty hex & swap occupied hexes carries attached Overlays
    const movedToEmpty = moveOrSwapPlacement(replaced, { q: 0, r: 0 }, { q: 0, r: 2 });
    expect(movedToEmpty.find((p) => p.q === 0 && p.r === 2)?.overlays?.[0].id).toBe('ov-a');
    const swapped = moveOrSwapPlacement(movedToEmpty, { q: 0, r: 2 }, { q: 1, r: 0 });
    expect(swapped.find((p) => p.q === 1 && p.r === 0)?.overlays?.[0].id).toBe('ov-a');
    expect(swapped.find((p) => p.q === 0 && p.r === 2)?.overlays?.[0].id).toBe('ov-b');

    // 5. Deleting a host Placement deletes attached Overlays atomically in one Undo step
    let history = createHistory(swapped);
    history = commitHistory(history, removePlacement(history.present, { q: 1, r: 0 }));
    expect(history.present).toHaveLength(1);
    expect(history.present.find((p) => p.q === 1 && p.r === 0)).toBeUndefined();

    history = undoHistory(history);
    expect(history.present).toHaveLength(2);
    expect(history.present.find((p) => p.q === 1 && p.r === 0)?.overlays?.[0].id).toBe('ov-a');

    // 6. Clearing Map deletes all hosts & Overlays atomically in one Undo step
    history = commitHistory(history, clearMap());
    expect(history.present).toEqual([]);
    history = undoHistory(history);
    expect(history.present).toHaveLength(2);
    expect(history.present.find((p) => p.q === 1 && p.r === 0)?.overlays?.[0].id).toBe('ov-a');
    expect(history.present.find((p) => p.q === 0 && p.r === 2)?.overlays?.[0].id).toBe('ov-b');
  });

  it('moves and reparents Overlays preserving world angle, appends to new host top, reorders z-order, centers, rotates, and deletes atomically with Undo selection reconciliation', () => {
    const initial: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 1, // +60°
        overlays: [
          {
            id: 'ov-1',
            overlayPackId: 'missing-pack', // unresolved missing asset remains losslessly editable!
            overlayId: 'missing-bridge',
            offsetX: 0.3,
            offsetY: -0.2,
            rotationDeg: 25, // world 85°
          },
          {
            id: 'ov-2',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'door-1',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 0,
          },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '03-04',
        faceNumber: 3,
        rotation: 4, // +240°
        overlays: [
          {
            id: 'ov-existing',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'door-1',
            offsetX: -0.1,
            offsetY: 0.1,
            rotationDeg: 10,
          },
        ],
      },
    ];

    expect(findOverlayById(initial, 'ov-1')?.host).toMatchObject({ q: 0, r: 0 });
    expect(findOverlayOnHost(initial, { q: 0, r: 0 }, 'ov-2')?.index).toBe(1);
    expect(findOverlayOnHost(initial, { q: 1, r: 0 }, 'ov-2')).toBeNull();

    // 1. Move within same host (preserves z-order index 0 and local rotationDeg; clamps outside hex)
    const host0Center = axialToWorld(0, 0, HEX_RADIUS);
    const sameMove = moveOrReparentOverlay(
      initial,
      { q: 0, r: 0 },
      'ov-1',
      { q: 0, r: 0 },
      host0Center.x + 250,
      host0Center.y,
    );
    expect(sameMove.reparented).toBe(false);
    expect(sameMove.changed).toBe(true);
    const movedOv1 = sameMove.placements[0].overlays![0];
    expect(movedOv1.id).toBe('ov-1');
    expect(movedOv1.rotationDeg).toBe(25);
    const movedWorld = overlayLocalToWorld(sameMove.placements[0], movedOv1);
    expect(movedWorld.x).toBeCloseTo(host0Center.x + HEX_RADIUS, 10);
    expect(movedWorld.y).toBeCloseTo(host0Center.y, 10);

    // No-op move at exact same world position reports changed: false
    const noopMove = moveOrReparentOverlay(
      sameMove.placements,
      { q: 0, r: 0 },
      'ov-1',
      { q: 0, r: 0 },
      movedWorld.x,
      movedWorld.y,
    );
    expect(noopMove.changed).toBe(false);

    // 2. Z-order reorder: move bottom ov-1 up, then back down; boundaries are no-op (same reference)
    const reorderedUp = reorderOverlayZ(sameMove.placements, { q: 0, r: 0 }, 'ov-1', 'up');
    expect(reorderedUp[0].overlays!.map((o) => o.id)).toEqual(['ov-2', 'ov-1']);
    expect(reorderOverlayZ(reorderedUp, { q: 0, r: 0 }, 'ov-1', 'up')).toBe(reorderedUp); // already top

    const reorderedDown = reorderOverlayZ(reorderedUp, { q: 0, r: 0 }, 'ov-1', 'down');
    expect(reorderedDown[0].overlays!.map((o) => o.id)).toEqual(['ov-1', 'ov-2']);
    expect(reorderOverlayZ(reorderedDown, { q: 0, r: 0 }, 'ov-1', 'down')).toBe(reorderedDown); // already bottom

    // 3. Center on host & no-op when already centered
    const centered = centerOverlayOnHost(reorderedDown, { q: 0, r: 0 }, 'ov-1');
    expect(centered[0].overlays![0]).toMatchObject({ offsetX: 0, offsetY: 0, rotationDeg: 25 });
    expect(centerOverlayOnHost(centered, { q: 0, r: 0 }, 'ov-1')).toBe(centered);

    // 4. Local, delta, and world rotation + no-op suppression
    const deltaRotated = rotateOverlayByDelta(centered, { q: 0, r: 0 }, 'ov-1', -40);
    expect(deltaRotated[0].overlays![0].rotationDeg).toBeCloseTo(345, 10); // (25 - 40) mod 360 = 345
    const worldRotated = setOverlayWorldRotation(deltaRotated, { q: 0, r: 0 }, 'ov-1', 15);
    // host rotation = 1 (60°), so local = (15 - 60) mod 360 = 315°
    expect(worldRotated[0].overlays![0].rotationDeg).toBeCloseTo(315, 10);
    expect(setOverlayLocalRotation(worldRotated, { q: 0, r: 0 }, 'ov-1', 315)).toBe(worldRotated);

    // 5. Reparent from (0,0) to (1,0): preserves world position & world angle, appends to top of target host stack
    const host1Center = axialToWorld(1, 0, HEX_RADIUS);
    const worldBeforeReparent = overlayLocalToWorld(worldRotated[0], worldRotated[0].overlays![0]);
    let history = createHistory(worldRotated);
    const reparented = moveOrReparentOverlay(
      history.present,
      { q: 0, r: 0 },
      'ov-1',
      { q: 1, r: 0 },
      host1Center.x + 15,
      host1Center.y - 10,
    );
    expect(reparented.reparented).toBe(true);
    expect(reparented.changed).toBe(true);
    expect(reparented.placements[0].overlays!.map((o) => o.id)).toEqual(['ov-2']);
    expect(reparented.placements[1].overlays!.map((o) => o.id)).toEqual(['ov-existing', 'ov-1']);
    const reparentedOv1 = reparented.placements[1].overlays![1];
    const worldAfterReparent = overlayLocalToWorld(reparented.placements[1], reparentedOv1);
    expect(worldAfterReparent.x).toBeCloseTo(host1Center.x + 15, 10);
    expect(worldAfterReparent.y).toBeCloseTo(host1Center.y - 10, 10);
    expect(worldAfterReparent.worldDeg).toBeCloseTo(worldBeforeReparent.worldDeg, 10);

    // Undo/Redo reconciles selectedCoord + focusedOverlayId following reparented Overlay across hosts
    history = commitHistory(history, reparented.placements);
    let selection = reconcileSelectionAfterHistory(history.present, { q: 1, r: 0 }, 'ov-1');
    expect(selection).toEqual({ selectedCoord: { q: 1, r: 0 }, focusedOverlayId: 'ov-1' });

    history = undoHistory(history);
    selection = reconcileSelectionAfterHistory(history.present, selection.selectedCoord, selection.focusedOverlayId);
    expect(selection).toEqual({ selectedCoord: { q: 0, r: 0 }, focusedOverlayId: 'ov-1' });

    history = redoHistory(history);
    selection = reconcileSelectionAfterHistory(history.present, selection.selectedCoord, selection.focusedOverlayId);
    expect(selection).toEqual({ selectedCoord: { q: 1, r: 0 }, focusedOverlayId: 'ov-1' });

    // 6. Focused-Overlay deletion removes only that Overlay, leaving host Placement and sibling intact
    const afterDelete = removeOverlay(history.present, { q: 1, r: 0 }, 'ov-1');
    expect(afterDelete[1].overlays!.map((o) => o.id)).toEqual(['ov-existing']);
    expect(removeOverlay(afterDelete, { q: 1, r: 0 }, 'ov-1')).toBe(afterDelete); // no-op when missing
    history = commitHistory(history, afterDelete);
    selection = reconcileSelectionAfterHistory(history.present, { q: 1, r: 0 }, 'ov-1');
    expect(selection).toEqual({ selectedCoord: { q: 1, r: 0 }, focusedOverlayId: null });
  });
});

describe('Fog of War commands & Player View session fence (Seam 2)', () => {
  it('toggles and sets Placement covered state with no-op suppression while keeping Collection and Pull List totals unchanged', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');
    const pack: OverlayPack = {
      id: 'man-hewn-dungeons',
      name: 'Man Hewn Dungeons',
      shortCode: 'MHD',
      pairedTilesetId: 'man-hewn-dungeons',
      overlays: [
        {
          overlayId: 'bridge-1',
          overlayPackId: 'man-hewn-dungeons',
          label: 'Bridge 1',
          filename: 'Bridge 1.png',
          url: '/api/overlay-assets/man-hewn-dungeons/Bridge%201.png',
        },
      ],
    };
    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2, 'subterranean-rivers': 2 },
      overlayPacks: { 'man-hewn-dungeons': 1 },
    };

    let placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        overlays: [
          {
            id: 'ov-1',
            overlayPackId: pack.id,
            overlayId: 'bridge-1',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 0,
          },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: sr.id,
        tileId: '37-37',
        faceNumber: 37,
        rotation: 2,
      },
    ];

    expect(countCoveredPlacements(placements)).toBe(0);

    // No-op on empty hex and no-op when setting same state
    expect(togglePlacementFog(placements, { q: 9, r: 9 })).toBe(placements);
    expect(setPlacementCovered(placements, { q: 0, r: 0 }, false)).toBe(placements);

    // Toggle (0, 0) to covered
    placements = togglePlacementFog(placements, { q: 0, r: 0 });
    expect(placements[0].covered).toBe(true);
    expect(countCoveredPlacements(placements)).toBe(1);
    expect(setPlacementCovered(placements, { q: 0, r: 0 }, true)).toBe(placements);

    // Digital Fog on MHD (0,0) does NOT consume MHD #37 or add MHD #37 to Pull List,
    // while covered Placements stay included in Collection usage and Pull List totals,
    // and physical SR #37 at (1,0) remains tracked normally.
    const usage = computeCollectionUsage(placements, [mhd, sr], collection, [pack]);
    expect(usage.byTileKey.get('man-hewn-dungeons:37-37')?.used).toBe(0);
    expect(usage.byTileKey.get('man-hewn-dungeons:01-02')?.used).toBe(1);
    expect(usage.byOverlayKey.get('man-hewn-dungeons:bridge-1')?.used).toBe(1);
    expect(usage.byTileKey.get('subterranean-rivers:37-37')?.used).toBe(1);

    const pullList = computePullList(placements, [mhd, sr], collection);
    expect(pullList.totalPlacements).toBe(2);
    expect(pullList.groups.find((g) => g.tilesetId === mhd.id)?.items).toHaveLength(1);
    expect(pullList.groups.find((g) => g.tilesetId === sr.id)?.items[0].tileId).toBe('37-37');

    // Reveal (0, 0) removes covered flag cleanly
    placements = togglePlacementFog(placements, { q: 0, r: 0 });
    expect(Boolean(placements[0].covered)).toBe(false);
    expect(countCoveredPlacements(placements)).toBe(0);
  });

  it('resolves #37 Fog artwork from host Tileset, falling back to first discovered Tileset and then null (#1c1a18)', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');
    const noFogTileset: Tileset = {
      id: 'no-fog',
      name: 'No Fog',
      shortCode: 'NF',
      tiles: [
        {
          tileId: '01-02',
          tilesetId: 'no-fog',
          isSymmetric: false,
          faceA: { faceNumber: 1, label: '01', filename: '01.png', url: '/api/assets/no-fog/01.png' },
          faceB: { faceNumber: 2, label: '02', filename: '02.png', url: '/api/assets/no-fog/02.png' },
        },
      ],
    };

    const byId = new Map<string, Tileset>([
      [mhd.id, mhd],
      [sr.id, sr],
      [noFogTileset.id, noFogTileset],
    ]);

    // Host Tileset #37
    expect(resolveFogTileFaceUrl(sr.id, byId)).toBe('/api/assets/subterranean-rivers/37.png');
    // Missing Tileset or Tileset without #37 falls back silently to first discovered Tileset #37
    expect(resolveFogTileFaceUrl('missing-tileset', byId)).toBe('/api/assets/man-hewn-dungeons/37.png');
    expect(resolveFogTileFaceUrl('no-fog', byId)).toBe('/api/assets/man-hewn-dungeons/37.png');
    // Failed host #37 URL falls back to first working #37 URL
    expect(
      resolveFogTileFaceUrl(sr.id, byId, (url) => url === '/api/assets/subterranean-rivers/37.png'),
    ).toBe('/api/assets/man-hewn-dungeons/37.png');
    // All #37 URLs unavailable returns null (solid charcoal #1c1a18 fallback)
    expect(resolveFogTileFaceUrl('missing-tileset', new Map([[noFogTileset.id, noFogTileset]]))).toBeNull();
    expect(resolveFogTileFaceUrl('missing-tileset', new Map())).toBeNull();
  });

  it('applies drag-paint Fog strokes and bulk Cover all / Reveal all atomically with no-op suppression', () => {
    const base: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 2, rotation: 1, covered: true },
      { q: 2, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 2 },
    ];

    // No-op when empty map or only empty hexes visited or target state already matches
    expect(coverAllPlacements([])).toBeInstanceOf(Array);
    expect(revealAllPlacements([])).toHaveLength(0);
    expect(applyFogStroke(base, [{ q: 9, r: 9 }], true)).toBe(base);
    expect(applyFogStroke(base, [{ q: 1, r: 0 }], true)).toBe(base);

    // Drag-paint stroke from (0,0) across empty (5,5) to (1,0) and (2,0) with targetCovered=true
    let history = createHistory(base);
    const stroked = applyFogStroke(
      history.present,
      [
        { q: 0, r: 0 },
        { q: 5, r: 5 }, // empty hex ignored
        { q: 1, r: 0 }, // already covered
        { q: 2, r: 0 },
        { q: 0, r: 0 }, // duplicate coord
      ],
      true,
    );
    expect(stroked.map((p) => Boolean(p.covered))).toEqual([true, true, true]);
    history = commitHistory(history, stroked);

    // 1 atomic Undo reverts the entire multi-hex drag-paint stroke
    history = undoHistory(history);
    expect(history.present.map((p) => Boolean(p.covered))).toEqual([false, true, false]);

    // Bulk Cover all -> no-op if already all covered -> Reveal all -> no-op if already all revealed
    const allCovered = coverAllPlacements(history.present);
    expect(allCovered.map((p) => Boolean(p.covered))).toEqual([true, true, true]);
    expect(coverAllPlacements(allCovered)).toBe(allCovered);

    const allRevealed = revealAllPlacements(allCovered);
    expect(allRevealed.map((p) => Boolean(p.covered))).toEqual([false, false, false]);
    expect(revealAllPlacements(allRevealed)).toBe(allRevealed);
  });

  it('preserves covered across host move, swap, rotate, flip, and replace, and deletes covered atomically on remove/clear', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');

    // Newly placed Tiles default to revealed (no covered flag)
    let placements = placeTile([], {
      q: 0,
      r: 0,
      tilesetId: mhd.id,
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
    });
    placements = placeTile(placements, {
      q: 1,
      r: 0,
      tilesetId: sr.id,
      tileId: '03-04',
      faceNumber: 3,
      rotation: 0,
    });
    expect(Boolean(placements[0].covered)).toBe(false);
    expect(Boolean(placements[1].covered)).toBe(false);

    // Cover (0, 0), keep (1, 0) revealed
    placements = setPlacementCovered(placements, { q: 0, r: 0 }, true);

    // Rotate & Flip preserve covered
    placements = rotatePlacement(placements, { q: 0, r: 0 }, 1);
    expect(placements.find((p) => p.q === 0 && p.r === 0)?.covered).toBe(true);
    placements = flipPlacement(placements, { q: 0, r: 0 }, [mhd, sr]);
    expect(placements.find((p) => p.q === 0 && p.r === 0)?.covered).toBe(true);

    // Tile replacement preserves covered
    placements = placeTile(placements, {
      q: 0,
      r: 0,
      tilesetId: sr.id,
      tileId: '01-02',
      faceNumber: 1,
      rotation: 3,
    });
    expect(placements.find((p) => p.q === 0 && p.r === 0)?.covered).toBe(true);

    // Move to empty hex & swap with revealed hex carry covered with the moving Placement
    placements = moveOrSwapPlacement(placements, { q: 0, r: 0 }, { q: 0, r: 1 });
    expect(placements.find((p) => p.q === 0 && p.r === 1)?.covered).toBe(true);
    placements = moveOrSwapPlacement(placements, { q: 0, r: 1 }, { q: 1, r: 0 });
    expect(placements.find((p) => p.q === 1 && p.r === 0)?.covered).toBe(true);
    expect(Boolean(placements.find((p) => p.q === 0 && p.r === 1)?.covered)).toBe(false);

    // Remove & Clear Map delete covered atomically and restore on Undo
    let history = createHistory(placements);
    history = commitHistory(history, removePlacement(history.present, { q: 1, r: 0 }));
    expect(countCoveredPlacements(history.present)).toBe(0);
    history = undoHistory(history);
    expect(history.present.find((p) => p.q === 1 && p.r === 0)?.covered).toBe(true);

    history = commitHistory(history, clearMap());
    expect(history.present).toEqual([]);
    history = undoHistory(history);
    expect(countCoveredPlacements(history.present)).toBe(1);
    expect(history.present.find((p) => p.q === 1 && p.r === 0)?.covered).toBe(true);
  });

  it('enforces Player View session fence (undoFloor, playerRedoCount) on unified stack and lifts fence on return to GM View', () => {
    const s0: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    const s1 = placeTile(s0, { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 });
    const s2 = rotatePlacement(s1, { q: 1, r: 0 }, 1);
    const s3 = flipPlacement(s2, { q: 0, r: 0 }, [makeTestTileset('mhd', 'MHD')]);

    // GM made 3 edits and undid s3, leaving future=[s3]
    let history = createHistory(s0);
    history = commitHistory(history, s1);
    history = commitHistory(history, s2);
    history = commitHistory(history, s3);
    history = undoHistory(history);
    expect(history.past).toHaveLength(2);
    expect(history.present).toBe(s2);
    expect(history.future).toEqual([s3]);

    // 1. Entering Player View with no Player edits: cannot undo GM past, cannot redo undone GM s3
    let fence = enterPlayerViewSession(history);
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 0 });
    expect(canUndoWithFence(history, fence)).toBe(false);
    expect(canRedoWithFence(history, fence)).toBe(false);
    expect(undoWithFence(history, fence).changed).toBe(false);
    expect(redoWithFence(history, fence).changed).toBe(false);

    // Leaving Player View without edits restores full GM Undo/Redo (including undone s3)
    expect(canUndoWithFence(history, null)).toBe(true);
    expect(canRedoWithFence(history, null)).toBe(true);

    // 2. Re-enter Player View and perform two Fog edits (P1, P2)
    fence = enterPlayerViewSession(history);
    const p1 = togglePlacementFog(history.present, { q: 0, r: 0 });
    const p2 = togglePlacementFog(p1, { q: 1, r: 0 });

    // No-op commit leaves fence & future untouched
    const noopCommit = commitWithFence(history, fence, history.present);
    expect(noopCommit.history).toBe(history);

    ({ history, fence } = commitWithFence(history, fence!, p1));
    ({ history, fence } = commitWithFence(history, fence!, p2));
    expect(history.past).toHaveLength(4);
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 0 });
    expect(canUndoWithFence(history, fence)).toBe(true);
    expect(canRedoWithFence(history, fence)).toBe(false);

    // Undo twice back to s2, then 3rd Undo is blocked at undoFloor
    let undoRes = undoWithFence(history, fence);
    expect(undoRes.changed).toBe(true);
    history = undoRes.history;
    fence = undoRes.fence!;
    expect(history.present).toBe(p1);
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 1 });

    undoRes = undoWithFence(history, fence);
    expect(undoRes.changed).toBe(true);
    history = undoRes.history;
    fence = undoRes.fence!;
    expect(history.present).toBe(s2);
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 2 });

    expect(canUndoWithFence(history, fence)).toBe(false);
    expect(undoWithFence(history, fence).changed).toBe(false);

    // Redo once to p1, then new Player edit p3 resets playerRedoCount to 0
    const redoRes = redoWithFence(history, fence);
    expect(redoRes.changed).toBe(true);
    history = redoRes.history;
    fence = redoRes.fence!;
    expect(history.present).toBe(p1);
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 1 });

    const p3 = setPlacementCovered(p1, { q: 1, r: 0 }, true);
    ({ history, fence } = commitWithFence(history, fence, p3));
    expect(fence).toEqual({ undoFloor: 2, playerRedoCount: 0 });
    expect(canRedoWithFence(history, fence)).toBe(false);

    // 3. Returning to GM View lifts fence; GM can undo across Player edits back into GM edits
    expect(canUndoWithFence(history, null)).toBe(true);
    let gmUndo = undoWithFence(history, null); // back to p1
    expect(gmUndo.history.present).toBe(p1);
    gmUndo = undoWithFence(gmUndo.history, null); // back to s2
    expect(gmUndo.history.present).toBe(s2);
    gmUndo = undoWithFence(gmUndo.history, null); // back to s1
    expect(gmUndo.history.present).toBe(s1);
    gmUndo = undoWithFence(gmUndo.history, null); // back to s0
    expect(gmUndo.history.present).toBe(s0);
  });
});

describe('Pull List v2: By Pack, By Tile, Missing Overlays, and Copy text (Seam 2)', () => {
  const makeOverlayPack = (
    id: string,
    name: string,
    shortCode: string,
    pairedTilesetId: string | null,
    labels: string[],
  ): OverlayPack => ({
    id,
    name,
    shortCode,
    pairedTilesetId,
    overlays: labels.map((label) => {
      const overlayId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return {
        overlayId,
        overlayPackId: id,
        label,
        filename: `${label}.png`,
        url: `/api/overlay-assets/${id}/${encodeURIComponent(label)}.png`,
      };
    }),
  });

  it('groups placed Overlays By Pack in paired-first order, natural-sorts items, flags over-budget, omits 0-placed packs, and includes covered Fog hosts', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const uc = makeTestTileset('underdark-caverns', 'UC');
    const packAw = makeOverlayPack('alchemists-workshop', "Alchemists' Workshop", 'AW', null, [
      'Potion Rack 10',
      'Potion Rack 2',
    ]);
    const packUc = makeOverlayPack('underdark-caverns-overlays', 'Underdark Caverns Overlays', 'UC', uc.id, [
      'Mushroom Patch',
    ]);
    const packMhd = makeOverlayPack('man-hewn-dungeons-overlays', 'Man Hewn Dungeons Overlays', 'MHD', mhd.id, [
      'Door 10',
      'Door 2',
    ]);
    const packUnused = makeOverlayPack('red-dragons-lair', "Red Dragon's Lair", 'RDL', null, ['Egg']);

    const collection: Collection = {
      version: 2,
      tilesets: { [mhd.id]: 2, [uc.id]: 2 },
      overlayPacks: {
        [packMhd.id]: 1,
        [packUc.id]: 0, // digital-only 0 copies -> any placed item is over-budget
        [packAw.id]: 2,
        [packUnused.id]: 2,
      },
    };

    const placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        overlays: [
          { id: 'ov-1', overlayPackId: packMhd.id, overlayId: 'door-10', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-2', overlayPackId: packMhd.id, overlayId: 'door-2', offsetX: 0.2, offsetY: 0, rotationDeg: 15 },
          { id: 'ov-3', overlayPackId: packMhd.id, overlayId: 'door-2', offsetX: -0.2, offsetY: 0, rotationDeg: 30 },
          { id: 'ov-4', overlayPackId: packAw.id, overlayId: 'potion-rack-10', offsetX: 0, offsetY: 0.2, rotationDeg: 0 },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: uc.id,
        tileId: '03-04',
        faceNumber: 3,
        rotation: 2,
        covered: true, // Fog of War covered Placements MUST still count in Pull List
        overlays: [
          { id: 'ov-5', overlayPackId: packUc.id, overlayId: 'mushroom-patch', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-6', overlayPackId: packAw.id, overlayId: 'potion-rack-2', offsetX: 0, offsetY: 0, rotationDeg: 45 },
        ],
      },
    ];

    // Intentionally pass overlayPacks unsorted to verify paired-first sorting (MHD, UC -> AW)
    const pullList = computePullList(
      placements,
      [mhd, uc],
      collection,
      [packAw, packUnused, packUc, packMhd],
    );

    expect(pullList.totalPlacements).toBe(2);
    expect(pullList.totalOverlays).toBe(6);
    expect(pullList.overlayGroups.map((g) => g.shortCode)).toEqual(['MHD', 'UC', 'AW']);

    const mhdOvGroup = pullList.overlayGroups[0];
    expect(mhdOvGroup.totalNeeded).toBe(3);
    expect(mhdOvGroup.owned).toBe(1);
    expect(mhdOvGroup.items.map((i) => ({ label: i.label, needed: i.needed, isOverBudget: i.isOverBudget }))).toEqual([
      { label: 'Door 2', needed: 2, isOverBudget: true },
      { label: 'Door 10', needed: 1, isOverBudget: false },
    ]);

    const ucOvGroup = pullList.overlayGroups[1];
    expect(ucOvGroup.owned).toBe(0);
    expect(ucOvGroup.items[0]).toMatchObject({
      label: 'Mushroom Patch',
      needed: 1,
      owned: 0,
      isOverBudget: true,
    });

    const awOvGroup = pullList.overlayGroups[2];
    expect(awOvGroup.items.map((i) => i.label)).toEqual(['Potion Rack 2', 'Potion Rack 10']);
    expect(awOvGroup.items.every((i) => !i.isOverBudget)).toBe(true);
  });

  it('collects unresolved Overlay Placements into missingOverlays without dropping valid or covered Overlays', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const packMhd = makeOverlayPack('man-hewn-dungeons-overlays', 'Man Hewn Dungeons Overlays', 'MHD', mhd.id, [
      'Door 2',
    ]);
    const collection: Collection = {
      version: 2,
      tilesets: { [mhd.id]: 2 },
      overlayPacks: { [packMhd.id]: 2 },
    };

    const placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'lost-tileset',
        tileId: '05-06',
        faceNumber: 5,
        rotation: 0,
        covered: true,
        overlays: [
          { id: 'ov-valid', overlayPackId: packMhd.id, overlayId: 'door-2', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-miss-1', overlayPackId: packMhd.id, overlayId: 'missing-door', offsetX: 0.1, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-miss-2', overlayPackId: 'ghost-pack', overlayId: 'altar', offsetX: -0.1, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-miss-3', overlayPackId: 'ghost-pack', overlayId: 'altar', offsetX: 0.2, offsetY: 0, rotationDeg: 90 },
        ],
      },
    ];

    const pullList = computePullList(placements, [mhd], collection, [packMhd]);
    expect(pullList.totalPlacements).toBe(1);
    expect(pullList.totalOverlays).toBe(4);
    expect(pullList.missing).toEqual([
      { tilesetId: 'lost-tileset', tileId: '05-06', faceNumber: 5, label: '05', count: 1 },
    ]);
    expect(pullList.missingOverlays).toEqual([
      { overlayPackId: 'ghost-pack', overlayId: 'altar', count: 2 },
      { overlayPackId: packMhd.id, overlayId: 'missing-door', count: 1 },
    ]);
    expect(pullList.overlayGroups[0].items).toHaveLength(1);
    expect(pullList.overlayGroups[0].items[0].label).toBe('Door 2');
  });

  it('builds By Tile host cards in visual reading order (y then x) with top-to-bottom Overlay stacks, Fog badge flag, and cues', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const packMhd = makeOverlayPack('man-hewn-dungeons-overlays', 'Man Hewn Dungeons Overlays', 'MHD', mhd.id, [
      'Bridge',
      'Crate',
    ]);
    const collection: Collection = {
      version: 2,
      tilesets: { [mhd.id]: 2 },
      overlayPacks: { [packMhd.id]: 1 },
    };

    const placements: Placement[] = [
      // Bottom-right (worldY = sqrt(3)*R, worldX = 300)
      {
        q: 2,
        r: 0,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 2,
        rotation: 0,
        overlays: [
          { id: 'ov-br', overlayPackId: packMhd.id, overlayId: 'bridge', offsetX: 0, offsetY: 0, rotationDeg: 0 },
        ],
      },
      // Bare host with 0 overlays -> excluded from byTile
      {
        q: -1,
        r: 0,
        tilesetId: mhd.id,
        tileId: '03-04',
        faceNumber: 3,
        rotation: 0,
      },
      // Bottom-left (same worldY = sqrt(3)*R as (2,0), worldX = 0) -> must come BEFORE (2,0)
      {
        q: 0,
        r: 1,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: true,
        overlays: [
          { id: 'ov-bot', overlayPackId: packMhd.id, overlayId: 'crate', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-mid', overlayPackId: 'missing-pack', overlayId: 'lost-overlay', offsetX: 0.2, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-top', overlayPackId: packMhd.id, overlayId: 'crate', offsetX: -0.2, offsetY: 0, rotationDeg: 45 },
        ],
      },
      // Top-most (worldY = -0.5*sqrt(3)*R, worldX = 150) -> must come FIRST
      {
        q: 1,
        r: -1,
        tilesetId: 'missing-ts',
        tileId: '09-10',
        faceNumber: 9,
        rotation: 0,
        overlays: [
          { id: 'ov-topmost', overlayPackId: packMhd.id, overlayId: 'bridge', offsetX: 0, offsetY: 0, rotationDeg: 0 },
        ],
      },
    ];

    const pullList = computePullList(placements, [mhd], collection, [packMhd]);
    expect(pullList.byTile).toHaveLength(3);
    expect(pullList.byTile.map((h) => [h.q, h.r])).toEqual([
      [1, -1],
      [0, 1],
      [2, 0],
    ]);

    expect(pullList.byTile[0]).toMatchObject({
      displayLabel: '?missing-ts #09',
      isMissingHost: true,
      covered: false,
    });
    expect(pullList.byTile[1]).toMatchObject({
      displayLabel: 'MHD #01',
      isMissingHost: false,
      covered: true,
    });
    // Top-to-bottom stack order: index 2 -> 1 -> 0
    expect(pullList.byTile[1].overlays.map((o) => o.id)).toEqual(['ov-top', 'ov-mid', 'ov-bot']);
    expect(pullList.byTile[1].overlays[0]).toMatchObject({
      shortCode: 'MHD',
      label: 'Crate',
      isOverBudget: true, // 2 crates needed, 1 owned
      isMissing: false,
      stackIndex: 2,
      stackCount: 3,
    });
    expect(pullList.byTile[1].overlays[1]).toMatchObject({
      shortCode: '?missing-pack',
      label: 'lost-overlay',
      url: null,
      isOverBudget: false,
      isMissing: true,
      stackIndex: 1,
      stackCount: 3,
    });
    // Bridge is used twice across (1,-1) and (2,0) with 1 owned -> over-budget
    expect(pullList.byTile[2].overlays[0].isOverBudget).toBe(true);
  });

  it('formats complete plain-text Copy checklist with Tiles, Overlays, Tile -> Overlay Assembly (aggregated top-to-bottom), and Missing Assets, omitting empty sections', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const packMhd = makeOverlayPack('man-hewn-dungeons-overlays', 'Man Hewn Dungeons Overlays', 'MHD', mhd.id, [
      'Bridge',
      'Crate',
      'Torch',
    ]);
    const collection: Collection = {
      version: 2,
      tilesets: { [mhd.id]: 2 },
      overlayPacks: { [packMhd.id]: 2 },
    };

    // Case A: 0 Overlays and 0 Missing -> omits Overlays, Tile -> Overlay Assembly, and Missing Assets
    const tilesOnly = computePullList(
      [{ q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 }],
      [mhd],
      collection,
      [packMhd],
    );
    const tilesOnlyText = formatPullListText('Solo Room', tilesOnly);
    expect(tilesOnlyText).toContain('Solo Room — Pull List (1 Tile)');
    expect(tilesOnlyText).toContain('Tiles');
    expect(tilesOnlyText).not.toContain('Overlays');
    expect(tilesOnlyText).not.toContain('Tile -> Overlay Assembly');
    expect(tilesOnlyText).not.toContain('Missing Assets');

    // Case B: Full checklist with duplicate Overlays in stack, visual reading order, and missing Tile + missing Overlay
    const placements: Placement[] = [
      // Bottom row (q=0, r=1) -> comes SECOND in visual reading order
      {
        q: 0,
        r: 1,
        tilesetId: mhd.id,
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: true,
        overlays: [
          // Stack bottom -> top: [Torch (0), Crate (1), Bridge (2), Crate (3)]
          // Top-to-bottom first-seen order: Crate x2, Bridge x1, Torch x1
          { id: 'b0', overlayPackId: packMhd.id, overlayId: 'torch', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'b1', overlayPackId: packMhd.id, overlayId: 'crate', offsetX: 0.1, offsetY: 0, rotationDeg: 0 },
          { id: 'b2', overlayPackId: packMhd.id, overlayId: 'bridge', offsetX: 0, offsetY: 0.1, rotationDeg: 0 },
          { id: 'b3', overlayPackId: packMhd.id, overlayId: 'crate', offsetX: -0.1, offsetY: 0, rotationDeg: 90 },
        ],
      },
      // Top row (q=0, r=0) -> comes FIRST in visual reading order
      {
        q: 0,
        r: 0,
        tilesetId: 'lost-ts',
        tileId: '07-08',
        faceNumber: 7,
        rotation: 0,
        overlays: [
          { id: 't0', overlayPackId: 'lost-pack', overlayId: 'brazier', offsetX: 0, offsetY: 0, rotationDeg: 0 },
        ],
      },
    ];

    const fullPull = computePullList(placements, [mhd], collection, [packMhd]);
    const fullText = formatPullListText('Crypt Depth', fullPull);

    expect(fullText).toContain('Crypt Depth — Pull List (2 Tiles · 5 Overlays)');
    expect(fullText).toContain('\nTiles\n');
    expect(fullText).toContain('\nOverlays\n');
    expect(fullText).toContain('Crate x2');
    expect(fullText).toContain('\nTile -> Overlay Assembly\n');
    expect(fullText).toContain('\nMissing Assets\n');
    expect(fullText).toContain('[Tile] lost-ts #07 x1');
    expect(fullText).toContain('[Overlay] lost-pack brazier x1');

    // Visual reading order: (0, 0) appears before (0, 1) in Tile -> Overlay Assembly
    const assemblySection = fullText.split('Tile -> Overlay Assembly')[1].split('Missing Assets')[0];
    const idxTop = assemblySection.indexOf('?lost-ts #07 (0, 0)');
    const idxBottom = assemblySection.indexOf('MHD #01 (0, 1)');
    expect(idxTop).toBeGreaterThan(-1);
    expect(idxBottom).toBeGreaterThan(idxTop);

    // Top-to-bottom first-seen aggregation order on (0, 1): Crate x2 before Bridge x1 before Torch x1
    const bottomLine = assemblySection.slice(idxBottom).split('\n')[0];
    const cratePos = bottomLine.indexOf('[MHD] Crate x2');
    const bridgePos = bottomLine.indexOf('[MHD] Bridge x1');
    const torchPos = bottomLine.indexOf('[MHD] Torch x1');
    expect(cratePos).toBeGreaterThan(-1);
    expect(bridgePos).toBeGreaterThan(cratePos);
    expect(torchPos).toBeGreaterThan(bridgePos);
  });
});

describe('No-op Undo suppression & GM selection reconciliation (Seam 2)', () => {
  it('returns identical references and skips history on all no-op Tile, Overlay, and Fog mutations', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    let placements: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        overlays: [
          {
            id: 'ov-bottom',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'crate',
            offsetX: 0,
            offsetY: 0,
            rotationDeg: 0,
          },
          {
            id: 'ov-top',
            overlayPackId: 'man-hewn-dungeons',
            overlayId: 'torch',
            offsetX: 0.25,
            offsetY: -0.2,
            rotationDeg: 45,
          },
        ],
      },
      {
        q: 1,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '37-37',
        faceNumber: 37,
        rotation: 2,
      },
    ];

    let history = createHistory(placements);

    const assertSkipped = (candidate: Placement[]) => {
      expect(candidate).toBe(history.present);
      const committed = commitWithFence(history, null, candidate);
      expect(committed.history).toBe(history);
      expect(committed.history.past).toHaveLength(0);
    };

    // 1. Tile no-ops: identical re-stamp, missing rotate/remove, symmetric flip, zero-delta move, empty clear
    assertSkipped(
      placeTile(history.present, {
        q: 0,
        r: 0,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
      }),
    );
    assertSkipped(rotatePlacement(history.present, { q: 9, r: 9 }, 1));
    assertSkipped(flipPlacement(history.present, { q: 1, r: 0 }, [mhd]));
    assertSkipped(flipPlacement(history.present, { q: 9, r: 9 }, [mhd]));
    assertSkipped(moveOrSwapPlacement(history.present, { q: 0, r: 0 }, { q: 0, r: 0 }));
    assertSkipped(moveOrSwapPlacement(history.present, { q: 9, r: 9 }, { q: 2, r: 0 }));
    assertSkipped(removePlacement(history.present, { q: 9, r: 9 }));

    const emptyPlacements: Placement[] = [];
    expect(clearMap(emptyPlacements)).toBe(emptyPlacements);

    // 2. Overlay no-ops: 0° at 0°, near-360° wraparound, Center at (0,0), stack bounds, zero-delta drag, empty attach
    assertSkipped(setOverlayLocalRotation(history.present, { q: 0, r: 0 }, 'ov-bottom', 0));
    assertSkipped(
      setOverlayLocalRotation(history.present, { q: 0, r: 0 }, 'ov-bottom', 359.99999999),
    );
    assertSkipped(centerOverlayOnHost(history.present, { q: 0, r: 0 }, 'ov-bottom'));
    assertSkipped(reorderOverlayZ(history.present, { q: 0, r: 0 }, 'ov-bottom', 'down'));
    assertSkipped(reorderOverlayZ(history.present, { q: 0, r: 0 }, 'ov-top', 'up'));
    assertSkipped(removeOverlay(history.present, { q: 0, r: 0 }, 'missing-ov'));

    const attachEmpty = attachOverlayAtWorld(
      history.present,
      { q: 9, r: 9 },
      { overlayPackId: 'man-hewn-dungeons', overlayId: 'crate' },
      0,
      0,
    );
    expect(attachEmpty.createdOverlay).toBeNull();
    expect(attachEmpty.placements).toBe(history.present);

    const centerWorld = axialToWorld(0, 0, HEX_RADIUS);
    const noopDrag = moveOrReparentOverlay(
      history.present,
      { q: 0, r: 0 },
      'ov-bottom',
      { q: 0, r: 0 },
      centerWorld.x,
      centerWorld.y,
    );
    expect(noopDrag.changed).toBe(false);
    expect(noopDrag.placements).toBe(history.present);

    // 3. Fog no-ops: revealAll when none covered; coverAll when all covered
    assertSkipped(revealAllPlacements(history.present));
    assertSkipped(applyFogStroke(history.present, [{ q: 0, r: 0 }, { q: 1, r: 0 }], false));

    const allCovered = coverAllPlacements(history.present);
    history = commitHistory(history, allCovered);
    expect(coverAllPlacements(history.present)).toBe(history.present);
    expect(applyFogStroke(history.present, [{ q: 0, r: 0 }], true)).toBe(history.present);
  });

  it('reconciles GM selection across attach, reparent, host-swap, and host-delete Undo/Redo', () => {
    const host0: Placement = {
      q: 0,
      r: 0,
      tilesetId: 'mhd',
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
    };
    const host1: Placement = {
      q: 1,
      r: 0,
      tilesetId: 'mhd',
      tileId: '03-04',
      faceNumber: 3,
      rotation: 1,
    };

    // s0: two hosts
    const s0 = placeTile(placeTile([], host0), host1);
    let history = createHistory(s0);

    // s1: attach ov-new onto host (0, 0)
    const attached = attachOverlayAtWorld(
      history.present,
      { q: 0, r: 0 },
      { overlayPackId: 'aw', overlayId: 'table' },
      0,
      0,
      { id: 'ov-new' },
    );
    history = commitHistory(history, attached.placements);

    // s2: reparent ov-new from (0, 0) to (1, 0)
    const host1World = axialToWorld(1, 0, HEX_RADIUS);
    const reparented = moveOrReparentOverlay(
      history.present,
      { q: 0, r: 0 },
      'ov-new',
      { q: 1, r: 0 },
      host1World.x,
      host1World.y,
    );
    history = commitHistory(history, reparented.placements);

    // s3: delete host (1, 0) together with ov-new
    const deletedHost = removePlacement(history.present, { q: 1, r: 0 });
    history = commitHistory(history, deletedHost);

    // Starting at s2 with (1, 0) + ov-new focused, undo to s1 follows ov-new back to (0, 0)
    let sel = { selectedCoord: { q: 1, r: 0 } as { q: number; r: number } | null, focusedOverlayId: 'ov-new' as string | null };
    history = undoHistory(history); // s3 -> s2
    sel = reconcileSelectionAfterHistory(history.present, null, null);
    expect(sel).toEqual({ selectedCoord: null, focusedOverlayId: null });

    // From s2 focused on ov-new, undo reparent -> follows ov-new back to (0, 0)
    sel = { selectedCoord: { q: 1, r: 0 }, focusedOverlayId: 'ov-new' };
    history = undoHistory(history); // s2 -> s1
    sel = reconcileSelectionAfterHistory(history.present, sel.selectedCoord, sel.focusedOverlayId);
    expect(sel).toEqual({ selectedCoord: { q: 0, r: 0 }, focusedOverlayId: 'ov-new' });

    // Undo attach -> clears focusedOverlayId while preserving host selectedCoord (0, 0)
    history = undoHistory(history); // s1 -> s0
    sel = reconcileSelectionAfterHistory(history.present, sel.selectedCoord, sel.focusedOverlayId);
    expect(sel).toEqual({ selectedCoord: { q: 0, r: 0 }, focusedOverlayId: null });

    // Redo attach & reparent: host-only selection stays on (0, 0) when ov-new isn't focused,
    // and when ov-new IS focused before redo reparent, redo follows ov-new to (1, 0)
    history = redoHistory(history); // s0 -> s1
    sel = { selectedCoord: { q: 0, r: 0 }, focusedOverlayId: 'ov-new' };
    history = redoHistory(history); // s1 -> s2
    sel = reconcileSelectionAfterHistory(history.present, sel.selectedCoord, sel.focusedOverlayId);
    expect(sel).toEqual({ selectedCoord: { q: 1, r: 0 }, focusedOverlayId: 'ov-new' });

    // Redo host deletion -> clears both selectedCoord and focusedOverlayId
    history = redoHistory(history); // s2 -> s3
    sel = reconcileSelectionAfterHistory(history.present, sel.selectedCoord, sel.focusedOverlayId);
    expect(sel).toEqual({ selectedCoord: null, focusedOverlayId: null });
  });

  it('formats dynamic Clear Map confirmation copy using GLOSSARY terms while omitting zero-count clauses', () => {
    expect(formatClearMapDescription([])).toBe('The active Map is already empty.');

    const singleTileOnly: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    const singleCopy = formatClearMapDescription(singleTileOnly);
    expect(singleCopy).toBe(
      'This removes 1 Placement from the active Map. You can undo this action afterward with Cmd/Ctrl+Z.',
    );
    expect(singleCopy).not.toContain('Overlay Placement');
    expect(singleCopy).not.toContain('Fog of War');

    const withOverlaysNoFog: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'mhd',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        overlays: [
          { id: 'ov-1', overlayPackId: 'aw', overlayId: 'orb', offsetX: 0, offsetY: 0, rotationDeg: 0 },
          { id: 'ov-2', overlayPackId: 'aw', overlayId: 'orb', offsetX: 0.2, offsetY: 0, rotationDeg: 0 },
        ],
      },
      { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 },
    ];
    const overlaysCopy = formatClearMapDescription(withOverlaysNoFog);
    expect(overlaysCopy).toBe(
      'This removes 2 Placements and 2 Overlay Placements from the active Map. You can undo this action afterward with Cmd/Ctrl+Z.',
    );
    expect(overlaysCopy).not.toContain('Fog of War');

    const withFogNoOverlays: Placement[] = [
      { q: 0, r: 0, tilesetId: 'mhd', tileId: '01-02', faceNumber: 1, rotation: 0, covered: true },
      { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0 },
    ];
    const fogOnlyCopy = formatClearMapDescription(withFogNoOverlays);
    expect(fogOnlyCopy).toBe(
      'This removes 2 Placements from the active Map and clears Fog of War on 1 Placement. You can undo this action afterward with Cmd/Ctrl+Z.',
    );
    expect(fogOnlyCopy).not.toContain('Overlay Placement');

    const allThree: Placement[] = [
      {
        q: 0,
        r: 0,
        tilesetId: 'mhd',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
        covered: true,
        overlays: [
          { id: 'ov-1', overlayPackId: 'aw', overlayId: 'orb', offsetX: 0, offsetY: 0, rotationDeg: 0 },
        ],
      },
      { q: 1, r: 0, tilesetId: 'mhd', tileId: '03-04', faceNumber: 3, rotation: 0, covered: true },
      { q: 0, r: 1, tilesetId: 'mhd', tileId: '03-04', faceNumber: 4, rotation: 0 },
    ];
    expect(formatClearMapDescription(allThree)).toBe(
      'This removes 3 Placements and 1 Overlay Placement from the active Map and clears Fog of War on 2 Placements. You can undo this action afterward with Cmd/Ctrl+Z.',
    );
  });
});
