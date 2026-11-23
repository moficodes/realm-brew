import { describe, expect, it } from 'vitest';
import { HEX_RADIUS, axialToWorld } from '../src/domain/hexGeometry';
import { overlayLocalToWorld } from '../src/domain/overlayGeometry';
import {
  attachOverlayAtWorld,
  buildOverlayPaletteSections,
  canFlipTarget,
  clearMap,
  commitHistory,
  compactPlacement,
  computeCollectionUsage,
  computePullList,
  createHistory,
  extractOverlayPrefix,
  flipBrush,
  flipPlacement,
  formatActiveBrushLabel,
  formatAssemblyLabel,
  formatMapSummaryCounts,
  formatPullListText,
  groupOverlaysByPrefix,
  mergeCollectionDefaults,
  moveOrSwapPlacement,
  normalizeCollection,
  overlayCollectionKey,
  placeTile,
  redoHistory,
  removePlacement,
  resolveOverlayAsset,
  resolvePlacementAsset,
  rotatePlacement,
  rotateStep,
  sortOverlayPacksPairedFirst,
  toMapSummary,
  undoHistory,
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
          { id: 'ov-missing-piece', overlayPackId: 'red-dragons-lair', overlayId: 'nonexistent', offsetX: 0, offsetY: 0, rotationDeg: 0 },
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
    expect(usage.overBudgetOverlayIds.has('ov-missing-piece')).toBe(false);
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
});
