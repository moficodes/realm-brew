import { describe, expect, it } from 'vitest';
import {
  canFlipTarget,
  clearMap,
  commitHistory,
  compactPlacement,
  computeCollectionUsage,
  computePullList,
  createHistory,
  flipBrush,
  flipPlacement,
  formatAssemblyLabel,
  formatMapSummaryCounts,
  formatPullListText,
  mergeCollectionDefaults,
  moveOrSwapPlacement,
  normalizeCollection,
  placeTile,
  redoHistory,
  removePlacement,
  resolvePlacementAsset,
  rotatePlacement,
  rotateStep,
  toMapSummary,
  undoHistory,
  validateAndParseMapJson,
  validateCollection,
  validatePlacements,
} from '../src/domain/plannerEngine';
import type { BrushSelection, Collection, Placement, Tileset } from '../src/domain/types';

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
});
