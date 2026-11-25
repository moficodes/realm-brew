import { describe, expect, it } from 'vitest';
import { HEX_HEIGHT, HEX_RADIUS, axialKey, axialToWorld } from '../src/domain/hexGeometry';
import {
  countAvailablePlayableTiles,
  generateSeamlessMap,
} from '../src/domain/mapGenerator';
import { computeCollectionUsage } from '../src/domain/plannerEngine';
import {
  HEX_EDGE_SEGMENTS,
  HEX_NEIGHBOR_DELTAS,
  analyzeTileFaceRgba,
  buildTileFaceEdgeProfile,
  canonicalEdgeSignature,
  classifyEdgeSamplePixel,
  getNeighborCoord,
  getRotatedEdgeAt,
  getRotatedEdges,
  groupTileFacesByEdgeCategory,
  oppositeEdgeDirection,
  tileFaceEdgeKey,
  validateMapSeams,
  type EdgeDirection,
  type EdgeTuple,
  type TileEdgeIndex,
  type TileFaceEdgeProfile,
} from '../src/domain/tileEdges';
import {
  padFaceNumber,
  type Collection,
  type Placement,
  type Tile,
  type Tileset,
} from '../src/domain/types';

function makeSyntheticHexRgba(width: number, height: number, edges: EdgeTuple): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  // Fill interior with warm charcoal void (32, 29, 24, 255)
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = 32;
    buf[i * 4 + 1] = 29;
    buf[i * 4 + 2] = 24;
    buf[i * 4 + 3] = 255;
  }

  const paintSample = (sx: number, sy: number, r: number, g: number, b: number) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = Math.max(0, Math.min(width - 1, sx + dx));
        const py = Math.max(0, Math.min(height - 1, sy + dy));
        const off = (py * width + px) * 4;
        buf[off] = r;
        buf[off + 1] = g;
        buf[off + 2] = b;
        buf[off + 3] = 255;
      }
    }
  };

  const cx = width / 2;
  const cy = height / 2;
  for (let d = 0; d < 6; d++) {
    const seg = HEX_EDGE_SEGMENTS[d];
    const edgeType = edges[d];
    if (edgeType === 'V') continue;

    // Narrow corridor only paints middle portion (t in [0.22, 0.78]), leaving corner ends void.
    const tMin = edgeType === 'N' ? 0.22 : 0.02;
    const tMax = edgeType === 'N' ? 0.78 : 0.98;
    const color: [number, number, number] =
      edgeType === 'W' ? [30, 52, 92] : [215, 208, 195];

    for (let step = 0; step <= 60; step++) {
      const t = tMin + (tMax - tMin) * (step / 60);
      const ex = (seg.x0 + (seg.x1 - seg.x0) * t) * width;
      const ey = (seg.y0 + (seg.y1 - seg.y0) * t) * height;
      const sx = Math.round(ex + (cx - ex) * 0.03);
      const sy = Math.round(ey + (cy - ey) * 0.03);
      paintSample(sx, sy, color[0], color[1], color[2]);
    }
  }

  return buf;
}

const UNDERDARK_PATTERNS: readonly string[] = [
  'FFFFFF'.slice(0, 1) + 'VVVVV', // 01: FVVVVV
  'FVVVVV', // 02
  'FVVVVV', // 03
  'FVVVVV', // 04
  'FVVVVV', // 05
  'FVVVVV', // 06
  'FVVVVF', // 07
  'FFVVVV', // 08
  'FVVVVF', // 09
  'FFVVVV', // 10
  'FFFVVV', // 11
  'FVVVFF', // 12
  'FVVFVV', // 13
  'FVVFVV', // 14
  'FVVFVV', // 15
  'FVVFVV', // 16
  'VVFFFF', // 17
  'VFFFFV', // 18
  'VFVVVF', // 19
  'VFVVVF', // 20
  'VFVVVF', // 21
  'VFVVVF', // 22
  'VFVFVF', // 23
  'VFVFVF', // 24
  'FVFFFV', // 25
  'FVFFFV', // 26
  'VFFVFF', // 27
  'VFFVFF', // 28
  'VFFVVF', // 29
  'VFVVFF', // 30
  'VFFVVF', // 31
  'VFVVFF', // 32
  'VFFFFF', // 33
  'FFFFFF', // 34
  'FFFFFF', // 35
  'VFFFFF', // 36
  'VVVVVV', // 37
];

const MAN_HEWN_PATTERNS: readonly string[] = [
  'FVVVVV', // 01
  'FVVVVV', // 02
  'FVVNVV', // 03
  'FVVNVV', // 04
  'VFNVNF', // 05
  'FVNVNV', // 06
  'FVVNVF', // 07
  'FFVNVV', // 08
  'NFFNVV', // 09
  'NVVNVF', // 10
  'FNVFNV', // 11
  'FVNFVN', // 12
  'NFVNVF', // 13
  'NFVNVF', // 14
  'NVVVVV', // 15
  'NVVVVV', // 16
  'NVVVVV', // 17
  'NVVVVV', // 18
  'NVVVVV', // 19
  'NVVVVV', // 20
  'NVVNVV', // 21
  'NVVNVV', // 22
  'NVVNVV', // 23
  'NVVNVV', // 24
  'NVVNVV', // 25
  'NVVNVV', // 26
  'NVNVVV', // 27
  'NVVVNV', // 28
  'NVNVNV', // 29
  'NVNVNV', // 30
  'NNVVVV', // 31
  'NVVVVN', // 32
  'NNNVVV', // 33
  'NVVVNN', // 34
  'FVVFVV', // 35
  'NVVNVV', // 36
  'VVVVVV', // 37
];

const RIVERS_PATTERNS: readonly string[] = [
  'WVVVVV', // 01
  'WVVVVV', // 02
  'VWVVVF', // 03
  'VFVVVW', // 04
  'WVVFVV', // 05
  'WVVFVV', // 06
  'WVVWVV', // 07
  'WVVWVV', // 08
  'WVFVFV', // 09
  'WFVFVV', // 10
  'WVFWFV', // 11
  'WVFWFV', // 12
  'VWVWVV', // 13
  'VVVWVW', // 14
  'WFVWFV', // 15
  'WVFWVF', // 16
  'WVVVVF', // 17
  'WFVVVV', // 18
  'WVWVVF', // 19
  'WFVVWV', // 20
  'WVWFVF', // 21
  'WFVFWV', // 22
  'WFWVVV', // 23
  'WVVWWV', // 24
  'WWVVFV', // 25
  'WVFVVW', // 26
  'WWVFVF', // 27
  'WFVFVW', // 28
  'WWFVVV', // 29
  'WFFVVW', // 30
  'WWWVVV', // 31
  'WVFVWW', // 32
  'WWWFFF', // 33
  'WFVWWW', // 34
  'WWWWFF', // 35
  'WWWWWW', // 36
  'VVVVVV', // 37
];

function parsePattern(pattern: string): EdgeTuple {
  return pattern.split('') as unknown as EdgeTuple;
}

function buildTilesetFixture(
  id: string,
  name: string,
  shortCode: string,
  patterns: readonly string[],
): { tileset: Tileset; profiles: TileFaceEdgeProfile[] } {
  const tiles: Tile[] = [];
  const profiles: TileFaceEdgeProfile[] = [];

  const makeFace = (num: number) => {
    const label = padFaceNumber(num);
    return {
      faceNumber: num,
      label,
      filename: `${id}_${label}.png`,
      url: `/api/assets/${id}/${label}.png`,
    };
  };

  let idx = 1;
  while (idx <= patterns.length) {
    if (idx < patterns.length) {
      const faceA = makeFace(idx);
      const faceB = makeFace(idx + 1);
      const tileId = `${faceA.label}-${faceB.label}`;
      tiles.push({ tileId, tilesetId: id, faceA, faceB, isSymmetric: false });
      profiles.push(
        buildTileFaceEdgeProfile(id, tileId, idx, parsePattern(patterns[idx - 1])),
        buildTileFaceEdgeProfile(id, tileId, idx + 1, parsePattern(patterns[idx])),
      );
      idx += 2;
    } else {
      const faceA = makeFace(idx);
      const tileId = `${faceA.label}-${faceA.label}`;
      tiles.push({ tileId, tilesetId: id, faceA, faceB: faceA, isSymmetric: true });
      profiles.push(
        buildTileFaceEdgeProfile(id, tileId, idx, parsePattern(patterns[idx - 1])),
      );
      idx += 1;
    }
  }

  return {
    tileset: { id, name, shortCode, tiles },
    profiles,
  };
}

function buildBundleFixture(): { tilesets: Tileset[]; edgeIndex: TileEdgeIndex } {
  const uc = buildTilesetFixture('underdark-caverns', 'Underdark Caverns', 'UC', UNDERDARK_PATTERNS);
  const mhd = buildTilesetFixture('man-hewn-dungeons', 'Man Hewn Dungeons', 'MHD', MAN_HEWN_PATTERNS);
  const sr = buildTilesetFixture('subterranean-rivers', 'Subterranean Rivers', 'SR', RIVERS_PATTERNS);

  const edgeIndex = new Map<string, TileFaceEdgeProfile>();
  for (const p of [...uc.profiles, ...mhd.profiles, ...sr.profiles]) {
    edgeIndex.set(tileFaceEdgeKey(p.tilesetId, p.faceNumber), p);
  }
  return {
    tilesets: [uc.tileset, mhd.tileset, sr.tileset],
    edgeIndex,
  };
}

function isSingleConnectedComponent(
  placements: readonly Placement[],
  edgeIndex: TileEdgeIndex,
): boolean {
  if (placements.length <= 1) return true;
  const byCoord = new Map(placements.map((p) => [axialKey(p.q, p.r), p]));
  const visited = new Set<string>();
  const queue: Placement[] = [placements[0]];
  visited.add(axialKey(placements[0].q, placements[0].r));

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const profile = edgeIndex.get(tileFaceEdgeKey(curr.tilesetId, curr.faceNumber))!;
    const rotEdges = getRotatedEdges(profile.edges, curr.rotation);
    for (let d = 0; d < 6; d++) {
      const dir = d as EdgeDirection;
      if (rotEdges[dir] === 'V') continue;
      const nCoord = getNeighborCoord(curr, dir);
      const nKey = axialKey(nCoord.q, nCoord.r);
      const neighbor = byCoord.get(nKey);
      if (!neighbor || visited.has(nKey)) continue;
      const nProfile = edgeIndex.get(tileFaceEdgeKey(neighbor.tilesetId, neighbor.faceNumber))!;
      const nEdge = getRotatedEdgeAt(nProfile.edges, neighbor.rotation, oppositeEdgeDirection(dir));
      if (nEdge === rotEdges[dir]) {
        visited.add(nKey);
        queue.push(neighbor);
      }
    }
  }

  return visited.size === placements.length;
}

describe('Tile edge classification & geometry (Wayfinder)', () => {
  it('classifies warm dark charcoal void, deep navy water, stone floor, and transparent pixels', () => {
    expect(classifyEdgeSamplePixel(32, 29, 24, 255)).toBe('.');
    expect(classifyEdgeSamplePixel(45, 42, 38, 255)).toBe('.');
    // Deep navy river water has low luminance (~39) but clear blue chroma (b - r >= 12)
    expect(classifyEdgeSamplePixel(25, 40, 75, 255)).toBe('~');
    expect(classifyEdgeSamplePixel(75, 98, 145, 255)).toBe('~');
    // Stone floor
    expect(classifyEdgeSamplePixel(210, 205, 195, 255)).toBe('#');
    // Transparent corner
    expect(classifyEdgeSamplePixel(255, 255, 255, 0)).toBe('T');
  });

  it('analyzes 240x208 flat-top hex RGBA buffers accurately across all 4 edge types', () => {
    const expected: EdgeTuple = ['F', 'N', 'W', 'V', 'N', 'F'];
    const rgba = makeSyntheticHexRgba(240, 208, expected);
    expect(analyzeTileFaceRgba(rgba, 240, 208)).toEqual(expected);

    const allVoid: EdgeTuple = ['V', 'V', 'V', 'V', 'V', 'V'];
    expect(analyzeTileFaceRgba(makeSyntheticHexRgba(240, 208, allVoid), 240, 208)).toEqual(
      allVoid,
    );

    const allWater: EdgeTuple = ['W', 'W', 'W', 'W', 'W', 'W'];
    expect(analyzeTileFaceRgba(makeSyntheticHexRgba(240, 208, allWater), 240, 208)).toEqual(
      allWater,
    );
  });

  it('aligns axial neighbor deltas with world geometry and rotates edges clockwise', () => {
    const origin = axialToWorld(0, 0, HEX_RADIUS);
    for (let d = 0; d < 6; d++) {
      const dir = d as EdgeDirection;
      const nCoord = getNeighborCoord({ q: 0, r: 0 }, dir);
      expect(nCoord).toEqual(HEX_NEIGHBOR_DELTAS[dir]);
      const nWorld = axialToWorld(nCoord.q, nCoord.r, HEX_RADIUS);
      const dist = Math.hypot(nWorld.x - origin.x, nWorld.y - origin.y);
      expect(dist).toBeCloseTo(HEX_HEIGHT, 6);
    }

    const base: EdgeTuple = ['F', 'N', 'W', 'V', 'V', 'V'];
    // Rotation +1 (+60° CW): native N(0)->NE(1), NE(1)->SE(2), SE(2)->S(3)
    expect(getRotatedEdges(base, 1)).toEqual(['V', 'F', 'N', 'W', 'V', 'V']);
    expect(getRotatedEdgeAt(base, 1, 1)).toBe('F');
    expect(getRotatedEdgeAt(base, 2, 2)).toBe('F');
    expect(getRotatedEdges(base, 0)).toEqual(base);
  });

  it('preserves physical chirality in canonicalEdgeSignature and groups categories accurately', () => {
    const base: EdgeTuple = ['F', 'F', 'V', 'V', 'F', 'V'];
    const rotated = getRotatedEdges(base, 3);
    expect(canonicalEdgeSignature(base).signature).toBe(canonicalEdgeSignature(rotated).signature);

    // Chiral mirror pair (Underdark #29 VFFVVF vs #30 VFVVFF) must stay distinct
    const leftHanded = canonicalEdgeSignature(parsePattern('VFFVVF')).signature;
    const rightHanded = canonicalEdgeSignature(parsePattern('VFVVFF')).signature;
    expect(leftHanded).not.toBe(rightHanded);

    const { tilesets, edgeIndex } = buildBundleFixture();
    const bySet = (id: string) =>
      Array.from(edgeIndex.values()).filter((p) => p.tilesetId === id);

    expect(groupTileFacesByEdgeCategory(bySet(tilesets[0].id))).toHaveLength(14);
    expect(groupTileFacesByEdgeCategory(bySet(tilesets[1].id))).toHaveLength(19);
    expect(groupTileFacesByEdgeCategory(bySet(tilesets[2].id))).toHaveLength(31);
  });
});

describe('Seamless Random Map Generator', () => {
  const { tilesets, edgeIndex } = buildBundleFixture();

  it('counts playable physical Tile copies excluding all-void dark Tiles', () => {
    const col: Collection = {
      version: 2,
      tilesets: {
        'underdark-caverns': 2,
        'man-hewn-dungeons': 1,
        'subterranean-rivers': 0,
      },
      overlayPacks: {},
    };
    const inv = countAvailablePlayableTiles(
      tilesets,
      ['underdark-caverns', 'man-hewn-dungeons', 'subterranean-rivers'],
      col,
      edgeIndex,
    );
    // Each tileset has 18 double-sided playable tiles + 1 all-void #37 tile
    expect(inv.byTilesetId.get('underdark-caverns')).toBe(36);
    expect(inv.byTilesetId.get('man-hewn-dungeons')).toBe(18);
    expect(inv.byTilesetId.get('subterranean-rivers')).toBe(0);
    expect(inv.totalPlayableCopies).toBe(54);
  });

  it('generates connected, zero-mismatch, budget-valid maps across all tileset combinations and seeds', () => {
    const configs: Array<{ ids: string[]; copies: number; target: number }> = [
      { ids: ['underdark-caverns'], copies: 1, target: 18 },
      { ids: ['underdark-caverns'], copies: 2, target: 28 },
      { ids: ['man-hewn-dungeons'], copies: 2, target: 24 },
      { ids: ['subterranean-rivers'], copies: 2, target: 20 },
      { ids: ['underdark-caverns', 'man-hewn-dungeons'], copies: 2, target: 36 },
      {
        ids: ['underdark-caverns', 'man-hewn-dungeons', 'subterranean-rivers'],
        copies: 3,
        target: 48,
      },
    ];

    for (const cfg of configs) {
      const collection: Collection = {
        version: 2,
        tilesets: Object.fromEntries(tilesets.map((ts) => [ts.id, cfg.copies])),
        overlayPacks: {},
      };

      for (const seed of [101, 2026, 99991]) {
        const result = generateSeamlessMap({
          tilesets,
          selectedTilesetIds: cfg.ids,
          collection,
          edgeIndex,
          targetTileCount: cfg.target,
          seed,
        });

        expect(result.placedCount).toBeGreaterThan(0);
        expect(result.mismatchedSeams).toBe(0);
        const seamCheck = validateMapSeams(result.placements, edgeIndex);
        expect(seamCheck.mismatchedSeams).toBe(0);
        expect(seamCheck.unanalyzedCount).toBe(0);

        // Connected graph via matching open edges
        expect(isSingleConnectedComponent(result.placements, edgeIndex)).toBe(true);

        // Strictly respects physical Collection copies and double-sided exclusion
        const usage = computeCollectionUsage(result.placements, tilesets, collection);
        expect(usage.overBudgetCoords.size).toBe(0);
      }
    }
  });

  it('strictly separates F (wide floor) from N (narrow corridor) seams while bridging across F', () => {
    const collection: Collection = {
      version: 2,
      tilesets: {
        'underdark-caverns': 2,
        'man-hewn-dungeons': 2,
        'subterranean-rivers': 0,
      },
      overlayPacks: {},
    };

    const result = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['underdark-caverns', 'man-hewn-dungeons'],
      collection,
      edgeIndex,
      targetTileCount: 36,
      seed: 4242,
    });

    const byCoord = new Map(result.placements.map((p) => [axialKey(p.q, p.r), p]));
    for (const p of result.placements) {
      const prof = edgeIndex.get(tileFaceEdgeKey(p.tilesetId, p.faceNumber))!;
      const edges = getRotatedEdges(prof.edges, p.rotation);
      for (let d = 0; d < 6; d++) {
        const dir = d as EdgeDirection;
        const nCoord = getNeighborCoord(p, dir);
        const neighbor = byCoord.get(axialKey(nCoord.q, nCoord.r));
        if (!neighbor) continue;
        const nProf = edgeIndex.get(tileFaceEdgeKey(neighbor.tilesetId, neighbor.faceNumber))!;
        const nEdge = getRotatedEdgeAt(nProf.edges, neighbor.rotation, oppositeEdgeDirection(dir));
        expect(edges[dir]).toBe(nEdge);
        expect((edges[dir] === 'F' && nEdge === 'N') || (edges[dir] === 'N' && nEdge === 'F')).toBe(
          false,
        );
      }
    }
  });

  it('prefers closed perimeters on dungeon sets while gracefully allowing open exits', () => {
    const collection: Collection = {
      version: 2,
      tilesets: {
        'underdark-caverns': 2,
        'man-hewn-dungeons': 2,
        'subterranean-rivers': 1,
      },
      overlayPacks: {},
    };

    const ucResult = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['underdark-caverns'],
      collection,
      edgeIndex,
      targetTileCount: 20,
      seed: 777,
    });
    expect(ucResult.mismatchedSeams).toBe(0);
    expect(ucResult.openPerimeterEdges).toBeLessThanOrEqual(4);

    // Subterranean Rivers with 1 copy has many asymmetric water/land exits; should still succeed cleanly.
    const riverResult = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['subterranean-rivers'],
      collection,
      edgeIndex,
      targetTileCount: 14,
      seed: 777,
    });
    expect(riverResult.placedCount).toBeGreaterThanOrEqual(6);
    expect(riverResult.mismatchedSeams).toBe(0);
  });

  it('is deterministic for identical seeds and produces variation across different seeds', () => {
    const collection: Collection = {
      version: 2,
      tilesets: { 'man-hewn-dungeons': 2 },
      overlayPacks: {},
    };

    const runA = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['man-hewn-dungeons'],
      collection,
      edgeIndex,
      targetTileCount: 20,
      seed: 12345,
    });
    const runB = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['man-hewn-dungeons'],
      collection,
      edgeIndex,
      targetTileCount: 20,
      seed: 12345,
    });
    const runC = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: ['man-hewn-dungeons'],
      collection,
      edgeIndex,
      targetTileCount: 20,
      seed: 67890,
    });

    expect(runA.placements).toEqual(runB.placements);
    expect(runA.placements).not.toEqual(runC.placements);
  });
});
