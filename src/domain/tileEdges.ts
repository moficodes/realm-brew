import { axialKey, normalizeZero } from './hexGeometry';
import type { AxialCoord, Placement, PlacementKey, RotationStep } from './types';

export type EdgeType = 'V' | 'F' | 'N' | 'W';
export type EdgeDirection = 0 | 1 | 2 | 3 | 4 | 5;
export type EdgeTuple = readonly [EdgeType, EdgeType, EdgeType, EdgeType, EdgeType, EdgeType];
export type EdgeSampleClass = 'T' | '.' | '~' | '#';

export const HEX_EDGE_LABELS = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;

export const HEX_NEIGHBOR_DELTAS: readonly AxialCoord[] = [
  { q: 0, r: -1 }, // 0: N
  { q: 1, r: -1 }, // 1: NE
  { q: 1, r: 0 }, // 2: SE
  { q: 0, r: 1 }, // 3: S
  { q: -1, r: 1 }, // 4: SW
  { q: -1, r: 0 }, // 5: NW
];

export const HEX_EDGE_SEGMENTS: readonly {
  dir: EdgeDirection;
  label: (typeof HEX_EDGE_LABELS)[number];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}[] = [
  { dir: 0, label: 'N', x0: 0.25, y0: 0.0, x1: 0.75, y1: 0.0 },
  { dir: 1, label: 'NE', x0: 0.75, y0: 0.0, x1: 1.0, y1: 0.5 },
  { dir: 2, label: 'SE', x0: 1.0, y0: 0.5, x1: 0.75, y1: 1.0 },
  { dir: 3, label: 'S', x0: 0.75, y0: 1.0, x1: 0.25, y1: 1.0 },
  { dir: 4, label: 'SW', x0: 0.25, y0: 1.0, x1: 0.0, y1: 0.5 },
  { dir: 5, label: 'NW', x0: 0.0, y0: 0.5, x1: 0.25, y1: 0.0 },
];

export const EDGE_SAMPLE_COUNT = 21;
export const EDGE_T_START = 0.04;
export const EDGE_T_END = 0.96;
export const EDGE_INSET_RATIO = 0.03;

export interface TileFaceEdgeProfile {
  tilesetId: string;
  tileId: string;
  faceNumber: number;
  edges: EdgeTuple;
  canonicalSignature: string;
  canonicalEdges: EdgeTuple;
  openCount: number;
}

export interface EdgeCategoryGroup {
  canonicalSignature: string;
  canonicalEdges: EdgeTuple;
  openCount: number;
  faces: Array<{ tilesetId: string; tileId: string; faceNumber: number }>;
}

export type TileEdgeIndex = ReadonlyMap<string, TileFaceEdgeProfile>;

export interface MapSeamValidation {
  matchedSeams: number;
  mismatchedSeams: number;
  openPerimeterEdges: number;
  closedPerimeterEdges: number;
  unanalyzedCount: number;
}

/** Build the stable lookup key for a Tile Face inside a TileEdgeIndex. */
export function tileFaceEdgeKey(tilesetId: string, faceNumber: number): string {
  return `${tilesetId}:${faceNumber}`;
}

/** Return the opposing edge direction across a shared hex border. */
export function oppositeEdgeDirection(dir: EdgeDirection): EdgeDirection {
  return ((dir + 3) % 6) as EdgeDirection;
}

/** Return the adjacent flat-top axial coordinate in the given clockwise edge direction. */
export function getNeighborCoord(coord: AxialCoord, dir: EdgeDirection): AxialCoord {
  const delta = HEX_NEIGHBOR_DELTAS[dir];
  return {
    q: normalizeZero(coord.q + delta.q),
    r: normalizeZero(coord.r + delta.r),
  };
}

/** Return the world-space EdgeType facing `worldDir` after clockwise `rotation` steps. */
export function getRotatedEdgeAt(
  edges: EdgeTuple,
  rotation: RotationStep,
  worldDir: EdgeDirection,
): EdgeType {
  return edges[((worldDir - rotation) % 6 + 6) % 6];
}

/** Return all 6 world-space edge types `[N, NE, SE, S, SW, NW]` for a rotated Tile Face. */
export function getRotatedEdges(edges: EdgeTuple, rotation: RotationStep): EdgeTuple {
  return [
    getRotatedEdgeAt(edges, rotation, 0),
    getRotatedEdgeAt(edges, rotation, 1),
    getRotatedEdgeAt(edges, rotation, 2),
    getRotatedEdgeAt(edges, rotation, 3),
    getRotatedEdgeAt(edges, rotation, 4),
    getRotatedEdgeAt(edges, rotation, 5),
  ];
}

/** Return true if two adjoining hex edges match strictly (`V↔V`, `F↔F`, `N↔N`, `W↔W`). */
export function edgesMatch(a: EdgeType, b: EdgeType): boolean {
  return a === b;
}

/**
 * Compute the chirality-preserving canonical rotation signature of a 6-edge hex tuple.
 * Only cyclic shifts (0..5) are considered because physical Tiles cannot be mirrored.
 */
export function canonicalEdgeSignature(edges: EdgeTuple): {
  signature: string;
  canonicalEdges: EdgeTuple;
} {
  let bestEdges = edges;
  let bestSig = edges.join('-');

  for (let rot = 1; rot < 6; rot++) {
    const shifted: EdgeTuple = [
      edges[rot % 6],
      edges[(rot + 1) % 6],
      edges[(rot + 2) % 6],
      edges[(rot + 3) % 6],
      edges[(rot + 4) % 6],
      edges[(rot + 5) % 6],
    ];
    const sig = shifted.join('-');
    if (sig < bestSig) {
      bestSig = sig;
      bestEdges = shifted;
    }
  }

  return { signature: bestSig, canonicalEdges: bestEdges };
}

/** Classify a single straight-alpha RGBA pixel along a hex edge into transparent, void, water, or floor. */
export function classifyEdgeSamplePixel(
  r: number,
  g: number,
  b: number,
  a: number,
): EdgeSampleClass {
  if (a < 128) return 'T';
  // Check blue chroma before luminance so deep navy river water is not mistaken for dark void.
  if (b - r >= 12 && b >= 45) return '~';
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 50) return '.';
  return '#';
}

/** Classify an ordered array of pixel classes along one hex edge into `V`, `F`, `N`, or `W`. */
export function classifyEdgeSamples(samples: readonly EdgeSampleClass[]): EdgeType {
  const n = samples.length;
  const mid = samples.slice(5, Math.max(5, n - 5));
  const ends = [...samples.slice(0, 3), ...samples.slice(Math.max(0, n - 3))];

  let midWater = 0;
  let midFloor = 0;
  let midVoid = 0;
  for (const s of mid) {
    if (s === '~') midWater += 1;
    else if (s === '#') midFloor += 1;
    else if (s === '.') midVoid += 1;
  }

  let endVoid = 0;
  for (const s of ends) {
    if (s === '.') endVoid += 1;
  }

  if (midWater >= 7) return 'W';
  if (midFloor >= 7) return endVoid >= 4 ? 'N' : 'F';
  if (midVoid >= 8) return 'V';

  if (midWater >= midFloor && midWater >= midVoid) return 'W';
  if (midFloor >= midVoid) return endVoid >= 4 ? 'N' : 'F';
  return 'V';
}

/** Sample all 6 flat-top hex edges from a straight-alpha RGBA buffer and return its EdgeTuple. */
export function analyzeTileFaceRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): EdgeTuple {
  const cx = width / 2;
  const cy = height / 2;
  const result: EdgeType[] = [];

  for (const seg of HEX_EDGE_SEGMENTS) {
    const samples: EdgeSampleClass[] = [];
    for (let i = 0; i < EDGE_SAMPLE_COUNT; i++) {
      const t =
        EDGE_T_START +
        (EDGE_T_END - EDGE_T_START) * (EDGE_SAMPLE_COUNT > 1 ? i / (EDGE_SAMPLE_COUNT - 1) : 0.5);
      const ex = (seg.x0 + (seg.x1 - seg.x0) * t) * width;
      const ey = (seg.y0 + (seg.y1 - seg.y0) * t) * height;
      const sx = Math.max(0, Math.min(width - 1, Math.round(ex + (cx - ex) * EDGE_INSET_RATIO)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(ey + (cy - ey) * EDGE_INSET_RATIO)));
      const off = (sy * width + sx) * 4;
      samples.push(classifyEdgeSamplePixel(rgba[off], rgba[off + 1], rgba[off + 2], rgba[off + 3]));
    }
    result.push(classifyEdgeSamples(samples));
  }

  return [result[0], result[1], result[2], result[3], result[4], result[5]];
}

/** Construct a full TileFaceEdgeProfile from an analyzed 6-edge tuple. */
export function buildTileFaceEdgeProfile(
  tilesetId: string,
  tileId: string,
  faceNumber: number,
  edges: EdgeTuple,
): TileFaceEdgeProfile {
  const { signature, canonicalEdges } = canonicalEdgeSignature(edges);
  let openCount = 0;
  for (const e of edges) {
    if (e !== 'V') openCount += 1;
  }
  return {
    tilesetId,
    tileId,
    faceNumber,
    edges,
    canonicalSignature: signature,
    canonicalEdges,
    openCount,
  };
}

/** Group Tile Face profiles by canonical rotation-invariant edge signature. */
export function groupTileFacesByEdgeCategory(
  profiles: readonly TileFaceEdgeProfile[],
): EdgeCategoryGroup[] {
  const groups = new Map<string, EdgeCategoryGroup>();

  for (const profile of profiles) {
    let group = groups.get(profile.canonicalSignature);
    if (!group) {
      group = {
        canonicalSignature: profile.canonicalSignature,
        canonicalEdges: profile.canonicalEdges,
        openCount: profile.openCount,
        faces: [],
      };
      groups.set(profile.canonicalSignature, group);
    }
    group.faces.push({
      tilesetId: profile.tilesetId,
      tileId: profile.tileId,
      faceNumber: profile.faceNumber,
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      a.openCount - b.openCount ||
      b.faces.length - a.faces.length ||
      a.canonicalSignature.localeCompare(b.canonicalSignature),
  );
}

/** Validate all adjoining seams and perimeter edges across a list of Map Placements. */
export function validateMapSeams(
  placements: readonly Placement[],
  edgeIndex: TileEdgeIndex,
): MapSeamValidation {
  const byCoord = new Map<PlacementKey, { placement: Placement; rotatedEdges: EdgeTuple }>();
  let unanalyzedCount = 0;

  for (const p of placements) {
    const profile = edgeIndex.get(tileFaceEdgeKey(p.tilesetId, p.faceNumber));
    if (!profile) {
      unanalyzedCount += 1;
      continue;
    }
    byCoord.set(axialKey(p.q, p.r), {
      placement: p,
      rotatedEdges: getRotatedEdges(profile.edges, p.rotation),
    });
  }

  let matchedSeams = 0;
  let mismatchedSeams = 0;
  let openPerimeterEdges = 0;
  let closedPerimeterEdges = 0;

  for (const entry of byCoord.values()) {
    for (let d = 0; d < 6; d++) {
      const dir = d as EdgeDirection;
      const edge = entry.rotatedEdges[dir];
      const neighborCoord = getNeighborCoord(entry.placement, dir);
      const neighbor = byCoord.get(axialKey(neighborCoord.q, neighborCoord.r));

      if (!neighbor) {
        if (edge === 'V') {
          closedPerimeterEdges += 1;
        } else {
          openPerimeterEdges += 1;
        }
        continue;
      }

      // Count each shared border exactly once from the N/NE/SE half-circle.
      if (dir < 3) {
        const neighborEdge = neighbor.rotatedEdges[oppositeEdgeDirection(dir)];
        if (edgesMatch(edge, neighborEdge)) {
          matchedSeams += 1;
        } else {
          mismatchedSeams += 1;
        }
      }
    }
  }

  return {
    matchedSeams,
    mismatchedSeams,
    openPerimeterEdges,
    closedPerimeterEdges,
    unanalyzedCount,
  };
}
