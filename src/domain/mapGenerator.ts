import { axialKey, normalizeZero } from './hexGeometry';
import { tileCollectionKey } from './plannerEngine';
import {
  getNeighborCoord,
  getRotatedEdges,
  oppositeEdgeDirection,
  tileFaceEdgeKey,
  validateMapSeams,
  type EdgeDirection,
  type EdgeTuple,
  type EdgeType,
  type TileEdgeIndex,
} from './tileEdges';
import {
  DEFAULT_TILESET_COPIES,
  type AxialCoord,
  type Collection,
  type Placement,
  type PlacementKey,
  type RotationStep,
  type Tileset,
} from './types';

export interface PlayableTileInventory {
  totalPlayableCopies: number;
  byTilesetId: ReadonlyMap<string, number>;
}

export interface GenerateMapOptions {
  tilesets: readonly Tileset[];
  selectedTilesetIds: readonly string[];
  collection: Collection;
  edgeIndex: TileEdgeIndex;
  targetTileCount: number;
  seed?: number;
  attempts?: number;
}

export interface GeneratedMapResult {
  placements: Placement[];
  seed: number;
  requestedCount: number;
  placedCount: number;
  matchedSeams: number;
  mismatchedSeams: number;
  openPerimeterEdges: number;
  closedPerimeterEdges: number;
}

interface RotatedFaceVariant {
  rotation: RotationStep;
  rotatedEdges: EdgeTuple;
  rotatedKey: string;
}

interface PlayableFaceCatalogEntry {
  tilesetId: string;
  tileId: string;
  tileKey: string;
  faceNumber: number;
  faceKey: string;
  openCount: number;
  variants: readonly RotatedFaceVariant[];
  edgeTypeMask: number;
}

interface PlacedNode {
  placement: Placement;
  rotatedEdges: EdgeTuple;
}

interface CandidateMatch {
  face: PlayableFaceCatalogEntry;
  variant: RotatedFaceVariant;
  score: number;
  newOpenEdges: number;
}

const EDGE_BIT: Record<EdgeType, number> = {
  V: 1,
  F: 2,
  N: 4,
  W: 8,
};

/** Deterministic Mulberry32 PRNG returning floats in `[0, 1)`. */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a non-negative 32-bit random seed. */
export function randomSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * Count physical playable Tile copies (Tiles with at least one non-all-void analyzed face)
 * available across the selected Tilesets under the current Collection.
 */
export function countAvailablePlayableTiles(
  tilesets: readonly Tileset[],
  selectedTilesetIds: readonly string[],
  collection: Collection,
  edgeIndex: TileEdgeIndex,
): PlayableTileInventory {
  const selectedSet = new Set(selectedTilesetIds);
  const byTilesetId = new Map<string, number>();
  let totalPlayableCopies = 0;

  for (const tileset of tilesets) {
    const copies = Math.max(0, collection.tilesets[tileset.id] ?? DEFAULT_TILESET_COPIES);
    let playableTilesInSet = 0;

    for (const tile of tileset.tiles) {
      const profileA = edgeIndex.get(tileFaceEdgeKey(tileset.id, tile.faceA.faceNumber));
      const profileB = !tile.isSymmetric
        ? edgeIndex.get(tileFaceEdgeKey(tileset.id, tile.faceB.faceNumber))
        : undefined;
      const hasPlayableFace =
        (profileA !== undefined && profileA.openCount > 0) ||
        (profileB !== undefined && profileB.openCount > 0);
      if (hasPlayableFace) {
        playableTilesInSet += 1;
      }
    }

    const totalForSet = copies * playableTilesInSet;
    byTilesetId.set(tileset.id, totalForSet);
    if (selectedSet.has(tileset.id)) {
      totalPlayableCopies += totalForSet;
    }
  }

  return { totalPlayableCopies, byTilesetId };
}

function buildCatalog(
  tilesets: readonly Tileset[],
  selectedTilesetIds: readonly string[],
  collection: Collection,
  edgeIndex: TileEdgeIndex,
): {
  faces: PlayableFaceCatalogEntry[];
  initialCopies: Map<string, number>;
} {
  const selectedSet = new Set(selectedTilesetIds);
  const faces: PlayableFaceCatalogEntry[] = [];
  const initialCopies = new Map<string, number>();

  for (const tileset of tilesets) {
    if (!selectedSet.has(tileset.id)) continue;
    const copies = Math.max(0, collection.tilesets[tileset.id] ?? DEFAULT_TILESET_COPIES);
    if (copies <= 0) continue;

    for (const tile of tileset.tiles) {
      const tileKey = tileCollectionKey(tileset.id, tile.tileId);
      const tileFaces = tile.isSymmetric ? [tile.faceA] : [tile.faceA, tile.faceB];
      let hasPlayableFace = false;

      for (const face of tileFaces) {
        const profile = edgeIndex.get(tileFaceEdgeKey(tileset.id, face.faceNumber));
        if (!profile || profile.openCount === 0) continue;
        hasPlayableFace = true;

        const variants: RotatedFaceVariant[] = [];
        for (let r = 0; r < 6; r++) {
          const rotation = r as RotationStep;
          const rotatedEdges = getRotatedEdges(profile.edges, rotation);
          variants.push({
            rotation,
            rotatedEdges,
            rotatedKey: rotatedEdges.join(''),
          });
        }

        let mask = 0;
        for (const e of profile.edges) {
          mask |= EDGE_BIT[e];
        }

        faces.push({
          tilesetId: tileset.id,
          tileId: tile.tileId,
          tileKey,
          faceNumber: face.faceNumber,
          faceKey: tileFaceEdgeKey(tileset.id, face.faceNumber),
          openCount: profile.openCount,
          variants,
          edgeTypeMask: mask,
        });
      }

      if (hasPlayableFace) {
        initialCopies.set(tileKey, copies);
      }
    }
  }

  return { faces, initialCopies };
}

function getRequiredNeighborEdges(
  coord: AxialCoord,
  placedMap: ReadonlyMap<PlacementKey, PlacedNode>,
): (EdgeType | null)[] {
  const req: (EdgeType | null)[] = [null, null, null, null, null, null];
  for (let d = 0; d < 6; d++) {
    const dir = d as EdgeDirection;
    const nCoord = getNeighborCoord(coord, dir);
    const neighbor = placedMap.get(axialKey(nCoord.q, nCoord.r));
    if (neighbor) {
      req[dir] = neighbor.rotatedEdges[oppositeEdgeDirection(dir)];
    }
  }
  return req;
}

function variantMatchesConstraints(
  rotatedEdges: EdgeTuple,
  required: readonly (EdgeType | null)[],
): boolean {
  for (let d = 0; d < 6; d++) {
    const req = required[d];
    if (req !== null && rotatedEdges[d] !== req) {
      return false;
    }
  }
  return true;
}

function canNeighborBeMatched(
  coord: AxialCoord,
  injectedDirFromNeighbor: EdgeDirection,
  injectedEdge: EdgeType,
  placedMap: ReadonlyMap<PlacementKey, PlacedNode>,
  faces: readonly PlayableFaceCatalogEntry[],
  remainingCopies: ReadonlyMap<string, number>,
  excludeTileKey: string,
): boolean {
  const req = getRequiredNeighborEdges(coord, placedMap);
  req[injectedDirFromNeighbor] = injectedEdge;
  const requiredBit = EDGE_BIT[injectedEdge];

  for (const face of faces) {
    const rem = (remainingCopies.get(face.tileKey) ?? 0) - (face.tileKey === excludeTileKey ? 1 : 0);
    if (rem <= 0) continue;
    if ((face.edgeTypeMask & requiredBit) === 0) continue;
    for (const v of face.variants) {
      if (variantMatchesConstraints(v.rotatedEdges, req)) {
        return true;
      }
    }
  }
  return false;
}

function runSingleAttempt(
  faces: readonly PlayableFaceCatalogEntry[],
  initialCopies: ReadonlyMap<string, number>,
  targetTileCount: number,
  seed: number,
): Placement[] {
  if (faces.length === 0 || targetTileCount <= 0) {
    return [];
  }

  const rng = createMulberry32(seed);
  const placedMap = new Map<PlacementKey, PlacedNode>();
  const remainingCopies = new Map<string, number>(initialCopies);
  const faceUseCount = new Map<string, number>();
  const unfillableCoords = new Set<PlacementKey>();

  // Step A: Pick a seed Tile Face at (0, 0) favoring 2-4 openings for organic branching.
  let seedPool = faces.filter((f) => f.openCount >= 2 && f.openCount <= 4);
  if (seedPool.length === 0) {
    seedPool = faces.filter((f) => f.openCount >= 2);
  }
  if (seedPool.length === 0) {
    seedPool = [...faces];
  }
  const seedFace = seedPool[Math.floor(rng() * seedPool.length)];
  const seedVariant = seedFace.variants[Math.floor(rng() * seedFace.variants.length)];

  placedMap.set(axialKey(0, 0), {
    placement: {
      q: 0,
      r: 0,
      tilesetId: seedFace.tilesetId,
      tileId: seedFace.tileId,
      faceNumber: seedFace.faceNumber,
      rotation: seedVariant.rotation,
    },
    rotatedEdges: seedVariant.rotatedEdges,
  });
  remainingCopies.set(seedFace.tileKey, (remainingCopies.get(seedFace.tileKey) ?? 1) - 1);
  faceUseCount.set(seedFace.faceKey, 1);

  // Step B: Connected frontier growth with MRV selection and prefer-closed tapering.
  while (placedMap.size < targetTileCount) {
    const frontierByKey = new Map<PlacementKey, AxialCoord>();

    for (const node of placedMap.values()) {
      for (let d = 0; d < 6; d++) {
        const dir = d as EdgeDirection;
        if (node.rotatedEdges[dir] === 'V') continue;
        const nCoord = getNeighborCoord(node.placement, dir);
        const nKey = axialKey(nCoord.q, nCoord.r);
        if (!placedMap.has(nKey) && !unfillableCoords.has(nKey)) {
          frontierByKey.set(nKey, nCoord);
        }
      }
    }

    if (frontierByKey.size === 0) {
      break;
    }

    const remainingSlots = targetTileCount - placedMap.size;
    const closingMode =
      remainingSlots <= frontierByKey.size ||
      (placedMap.size >= Math.ceil(targetTileCount * 0.72) &&
        frontierByKey.size >= Math.max(2, Math.floor(remainingSlots * 0.85)));

    let bestCoord: AxialCoord | null = null;
    let bestRequired: (EdgeType | null)[] | null = null;
    let bestUniquePatternCount = Infinity;
    let bestOpenRequiredCount = -1;
    let bestNeighborCount = -1;
    let bestTieBreaker = -1;
    let bestMatches: Array<{ face: PlayableFaceCatalogEntry; variants: RotatedFaceVariant[] }> = [];

    for (const [fKey, coord] of frontierByKey.entries()) {
      const required = getRequiredNeighborEdges(coord, placedMap);
      let openRequiredCount = 0;
      let neighborCount = 0;
      for (const req of required) {
        if (req !== null) {
          neighborCount += 1;
          if (req !== 'V') openRequiredCount += 1;
        }
      }

      const uniqueEdgeSignatures = new Set<string>();
      const validForCell: Array<{ face: PlayableFaceCatalogEntry; variants: RotatedFaceVariant[] }> = [];

      for (const face of faces) {
        if ((remainingCopies.get(face.tileKey) ?? 0) <= 0) continue;

        const matchingVariants: RotatedFaceVariant[] = [];
        for (const variant of face.variants) {
          if (variantMatchesConstraints(variant.rotatedEdges, required)) {
            matchingVariants.push(variant);
            uniqueEdgeSignatures.add(variant.rotatedKey);
          }
        }
        if (matchingVariants.length > 0) {
          validForCell.push({ face, variants: matchingVariants });
        }
      }

      const optionCount = uniqueEdgeSignatures.size;
      if (optionCount === 0) {
        unfillableCoords.add(fKey);
        continue;
      }

      const tieBreaker = rng();
      const isBetter =
        optionCount < bestUniquePatternCount ||
        (optionCount === bestUniquePatternCount &&
          (openRequiredCount > bestOpenRequiredCount ||
            (openRequiredCount === bestOpenRequiredCount &&
              (neighborCount > bestNeighborCount ||
                (neighborCount === bestNeighborCount && tieBreaker > bestTieBreaker)))));

      if (isBetter) {
        bestCoord = coord;
        bestRequired = required;
        bestUniquePatternCount = optionCount;
        bestOpenRequiredCount = openRequiredCount;
        bestNeighborCount = neighborCount;
        bestTieBreaker = tieBreaker;
        bestMatches = validForCell;
      }
    }

    if (!bestCoord || !bestRequired || bestMatches.length === 0) {
      break;
    }

    // Score deduplicated (face, rotatedKey) choices for the chosen MRV cell.
    const scoredCandidates: CandidateMatch[] = [];
    const radiusSq = bestCoord.q * bestCoord.q + bestCoord.r * bestCoord.r + bestCoord.q * bestCoord.r;
    const isEarlyPhase = placedMap.size < targetTileCount * 0.55;

    for (const { face, variants } of bestMatches) {
      const byRotatedKey = new Map<string, RotatedFaceVariant[]>();
      for (const v of variants) {
        let arr = byRotatedKey.get(v.rotatedKey);
        if (!arr) {
          arr = [];
          byRotatedKey.set(v.rotatedKey, arr);
        }
        arr.push(v);
      }

      for (const equivVariants of byRotatedKey.values()) {
        const rep = equivVariants[Math.floor(rng() * equivVariants.length)];
        let newOpenEdges = 0;
        let createsDeadEdge = false;

        for (let d = 0; d < 6; d++) {
          const dir = d as EdgeDirection;
          if (bestRequired[dir] === null && rep.rotatedEdges[dir] !== 'V') {
            newOpenEdges += 1;
            const nCoord = getNeighborCoord(bestCoord, dir);
            const ok = canNeighborBeMatched(
              nCoord,
              oppositeEdgeDirection(dir),
              rep.rotatedEdges[dir],
              placedMap,
              faces,
              remainingCopies,
              face.tileKey,
            );
            if (!ok) {
              createsDeadEdge = true;
            }
          }
        }

        let score = 0;
        if (closingMode) {
          if (newOpenEdges === 0) {
            score += 65;
          } else {
            score -= 26 * newOpenEdges;
          }
        } else if (frontierByKey.size <= 2 && placedMap.size < targetTileCount - 2) {
          score += newOpenEdges >= 1 ? 35 : -35;
        } else {
          if (newOpenEdges === 1 || newOpenEdges === 2) {
            score += 12;
          } else if (newOpenEdges === 0 && isEarlyPhase) {
            score -= 15;
          } else if (newOpenEdges >= 4) {
            score -= 8 * (newOpenEdges - 3);
          }
        }

        if (createsDeadEdge) {
          score -= 35;
        }

        score -= Math.min(18, radiusSq * 0.35);
        score -= 3 * (faceUseCount.get(face.faceKey) ?? 0);
        score += rng() * 8;

        scoredCandidates.push({ face, variant: rep, score, newOpenEdges });
      }
    }

    scoredCandidates.sort((a, b) => b.score - a.score);
    const bestScore = scoredCandidates[0].score;
    const topPool = scoredCandidates.filter((c) => c.score >= bestScore - 8);
    const chosen = topPool[Math.floor(rng() * topPool.length)];

    const q = normalizeZero(bestCoord.q);
    const r = normalizeZero(bestCoord.r);
    placedMap.set(axialKey(q, r), {
      placement: {
        q,
        r,
        tilesetId: chosen.face.tilesetId,
        tileId: chosen.face.tileId,
        faceNumber: chosen.face.faceNumber,
        rotation: chosen.variant.rotation,
      },
      rotatedEdges: chosen.variant.rotatedEdges,
    });
    remainingCopies.set(
      chosen.face.tileKey,
      (remainingCopies.get(chosen.face.tileKey) ?? 1) - 1,
    );
    faceUseCount.set(chosen.face.faceKey, (faceUseCount.get(chosen.face.faceKey) ?? 0) + 1);
  }

  return Array.from(placedMap.values(), (node) => node.placement);
}

/**
 * Generate a connected, seam-matched Map from the selected Tilesets while respecting
 * owned Collection copy counts and double-sided Tile constraints.
 * Prefers closing open perimeter edges while allowing open exits when needed.
 */
export function generateSeamlessMap(options: GenerateMapOptions): GeneratedMapResult {
  const {
    tilesets,
    selectedTilesetIds,
    collection,
    edgeIndex,
    targetTileCount,
    seed = randomSeed(),
    attempts = 10,
  } = options;

  const normalizedTarget = Math.max(0, Math.floor(targetTileCount));
  const { faces, initialCopies } = buildCatalog(
    tilesets,
    selectedTilesetIds,
    collection,
    edgeIndex,
  );

  if (faces.length === 0 || normalizedTarget <= 0) {
    return {
      placements: [],
      seed,
      requestedCount: normalizedTarget,
      placedCount: 0,
      matchedSeams: 0,
      mismatchedSeams: 0,
      openPerimeterEdges: 0,
      closedPerimeterEdges: 0,
    };
  }

  const maxPhysicalTiles = initialCopies.size
    ? Array.from(initialCopies.values()).reduce((sum, n) => sum + n, 0)
    : 0;
  const effectiveTarget = Math.min(normalizedTarget, maxPhysicalTiles);
  const numAttempts = Math.max(1, Math.min(20, attempts));

  let bestPlacements: Placement[] = [];
  let bestValidation = validateMapSeams([], edgeIndex);
  let bestScore = -Infinity;

  for (let i = 0; i < numAttempts; i++) {
    const attemptSeed = (seed + Math.imul(i, 0x9e3779b9)) >>> 0;
    const candidate = runSingleAttempt(faces, initialCopies, effectiveTarget, attemptSeed);
    const validation = validateMapSeams(candidate, edgeIndex);
    if (validation.mismatchedSeams > 0) {
      continue;
    }

    const uniqueFaces = new Set(candidate.map((p) => `${p.tilesetId}:${p.faceNumber}`)).size;
    const score =
      candidate.length * 100 -
      validation.openPerimeterEdges * 14 +
      (validation.openPerimeterEdges === 0 && candidate.length > 0 ? 80 : 0) +
      uniqueFaces * 2 -
      Math.abs(candidate.length - effectiveTarget) * 40;

    if (score > bestScore) {
      bestScore = score;
      bestPlacements = candidate;
      bestValidation = validation;
    }
  }

  return {
    placements: bestPlacements,
    seed,
    requestedCount: normalizedTarget,
    placedCount: bestPlacements.length,
    matchedSeams: bestValidation.matchedSeams,
    mismatchedSeams: bestValidation.mismatchedSeams,
    openPerimeterEdges: bestValidation.openPerimeterEdges,
    closedPerimeterEdges: bestValidation.closedPerimeterEdges,
  };
}
