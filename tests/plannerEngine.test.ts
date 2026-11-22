import { describe, expect, it } from 'vitest';
import {
  clearMap,
  commitHistory,
  computeStock,
  createHistory,
  flipBrush,
  flipPlacement,
  moveOrSwapPlacement,
  placeTile,
  redoHistory,
  removePlacement,
  resolvePlacementAsset,
  rotatePlacement,
  rotateStep,
  undoHistory,
  validateAndParseMapJson,
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

describe('Planner engine placement & inventory (Seam 2)', () => {
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

  it('tracks shared physical Tile stock across Side A & Side B and soft-warns when exceeding Collection', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const collection: Collection = { 'man-hewn-dungeons': 2 };

    let placements: Placement[] = [];
    placements = placeTile(placements, { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 });
    let stock = computeStock(placements, [mhd], collection);
    expect(stock.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 1,
      remaining: 1,
      isOverBudget: false,
    });

    placements = placeTile(placements, { q: 1, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 });
    stock = computeStock(placements, [mhd], collection);
    expect(stock.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 2,
      remaining: 0,
      isOverBudget: false,
    });
    expect(stock.overBudgetCoords.size).toBe(0);

    // 3rd placement uses Face 02 of the same physical Tile -> remaining becomes -1 & flags placements
    placements = placeTile(placements, { q: 2, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 0 });
    stock = computeStock(placements, [mhd], collection);
    expect(stock.byTileKey.get('man-hewn-dungeons:01-02')).toMatchObject({
      owned: 2,
      used: 3,
      remaining: -1,
      isOverBudget: true,
    });
    expect(stock.overBudgetCoords.has('0,0')).toBe(true);
    expect(stock.overBudgetCoords.has('1,0')).toBe(true);
    expect(stock.overBudgetCoords.has('2,0')).toBe(true);
  });

  it('restores old physical Tile stock on replace and isolates _37 per Tileset and 0-copy digital-only sets', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const sr = makeTestTileset('subterranean-rivers', 'SR');
    const collection: Collection = { 'man-hewn-dungeons': 2, 'subterranean-rivers': 0 };

    let placements: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '37-37', faceNumber: 37, rotation: 0 },
      { q: 1, r: 0, tilesetId: sr.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];
    let stock = computeStock(placements, [mhd, sr], collection);

    // _37 is strictly isolated per Tileset
    expect(stock.byTileKey.get('man-hewn-dungeons:37-37')?.remaining).toBe(1);
    expect(stock.byTileKey.get('subterranean-rivers:37-37')?.remaining).toBe(0);

    // 0-copy digital-only Tileset soft-warns on first placement
    expect(stock.byTileKey.get('subterranean-rivers:01-02')).toMatchObject({
      owned: 0,
      used: 1,
      remaining: -1,
      isOverBudget: true,
    });
    expect(stock.overBudgetCoords.has('1,0')).toBe(true);
    expect(stock.overBudgetCoords.has('0,0')).toBe(false);

    // Replacing (0,0) with 03-04 restores 37-37 back to 2
    placements = placeTile(placements, { q: 0, r: 0, tilesetId: mhd.id, tileId: '03-04', faceNumber: 3, rotation: 0 });
    stock = computeStock(placements, [mhd, sr], collection);
    expect(stock.byTileKey.get('man-hewn-dungeons:37-37')?.remaining).toBe(2);
    expect(stock.byTileKey.get('man-hewn-dungeons:03-04')?.remaining).toBe(1);
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
    const collection: Collection = { 'man-hewn-dungeons': 2 };

    const initial: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 2 },
      { q: 1, r: 0, tilesetId: mhd.id, tileId: '37-37', faceNumber: 37, rotation: 1 },
    ];

    const flippedA = flipPlacement(initial, { q: 0, r: 0 }, [mhd]);
    expect(flippedA.find((p) => p.q === 0 && p.r === 0)?.faceNumber).toBe(2);
    // Stock stays unchanged on flip
    expect(computeStock(flippedA, [mhd], collection).byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(1);

    const flippedBack = flipPlacement(flippedA, { q: 0, r: 0 }, [mhd]);
    expect(flippedBack.find((p) => p.q === 0 && p.r === 0)?.faceNumber).toBe(1);

    // Symmetric _37 stays unchanged
    const flippedDark = flipPlacement(flippedBack, { q: 1, r: 0 }, [mhd]);
    expect(flippedDark.find((p) => p.q === 1 && p.r === 0)?.faceNumber).toBe(37);

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

    expect(clearMap(swapped)).toEqual([]);
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
  });

  it('evaluates Collection availability independently per active Map', () => {
    const mhd = makeTestTileset('man-hewn-dungeons', 'MHD');
    const collection: Collection = { 'man-hewn-dungeons': 2 };

    const mapA: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 2, rotation: 0 },
    ];
    const mapB: Placement[] = [
      { q: 0, r: 0, tilesetId: mhd.id, tileId: '01-02', faceNumber: 1, rotation: 0 },
    ];

    const stockA = computeStock(mapA, [mhd], collection);
    const stockB = computeStock(mapB, [mhd], collection);
    expect(stockA.byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(0);
    expect(stockB.byTileKey.get('man-hewn-dungeons:01-02')?.remaining).toBe(1);
  });
});
