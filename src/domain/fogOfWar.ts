import { axialKey } from './hexGeometry';
import {
  commitHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from './history';
import type { AxialCoord, Placement, PlacementKey, Tileset } from './types';

export type MapViewMode = 'gm' | 'player';

export interface PlayerViewFence {
  readonly undoFloor: number;
  readonly playerRedoCount: number;
}

export const FOG_FALLBACK_FILL = '#1c1a18';
export const FOG_TILE_FACE_NUMBER = 37;

/** Return true when a Placement is currently covered by digital Fog of War. */
export function isPlacementCovered(placement: Pick<Placement, 'covered'>): boolean {
  return Boolean(placement.covered);
}

/** Count how many Placements on a Map are currently covered by Fog of War. */
export function countCoveredPlacements(placements: readonly Pick<Placement, 'covered'>[]): number {
  let count = 0;
  for (const p of placements) {
    if (p.covered) count += 1;
  }
  return count;
}

function applyCoveredFlag(placement: Placement, covered: boolean): Placement {
  if (covered) {
    return { ...placement, covered: true };
  }
  const { covered: _ignored, ...rest } = placement;
  return rest;
}

/** Set digital Fog of War on a single occupied Placement, returning the same array on no-op. */
export function setPlacementCovered(
  placements: readonly Placement[],
  coord: AxialCoord,
  covered: boolean,
): Placement[] {
  const index = placements.findIndex((p) => p.q === coord.q && p.r === coord.r);
  if (index === -1) return placements as Placement[];

  const existing = placements[index];
  if (Boolean(existing.covered) === covered) {
    return placements as Placement[];
  }

  return placements.map((p, idx) => (idx === index ? applyCoveredFlag(p, covered) : p));
}

/** Toggle digital Fog of War on a single occupied Placement, returning the same array when unoccupied. */
export function togglePlacementFog(
  placements: readonly Placement[],
  coord: AxialCoord,
): Placement[] {
  const existing = placements.find((p) => p.q === coord.q && p.r === coord.r);
  if (!existing) return placements as Placement[];
  return setPlacementCovered(placements, coord, !Boolean(existing.covered));
}

function applyFogByPredicate(
  placements: readonly Placement[],
  shouldApply: (placement: Placement) => boolean,
  targetCovered: boolean,
): Placement[] {
  let changed = false;
  const next = placements.map((p) => {
    if (!shouldApply(p) || Boolean(p.covered) === targetCovered) {
      return p;
    }
    changed = true;
    return applyCoveredFlag(p, targetCovered);
  });
  return changed ? next : (placements as Placement[]);
}

/** Paint a uniform Fog target state across all occupied hexes visited in a stroke, skipping no-ops. */
export function applyFogStroke(
  placements: readonly Placement[],
  coords: readonly AxialCoord[],
  targetCovered: boolean,
): Placement[] {
  if (coords.length === 0 || placements.length === 0) {
    return placements as Placement[];
  }
  const visitedKeys = new Set<PlacementKey>();
  for (const coord of coords) {
    visitedKeys.add(axialKey(coord.q, coord.r));
  }
  return applyFogByPredicate(
    placements,
    (p) => visitedKeys.has(axialKey(p.q, p.r)),
    targetCovered,
  );
}

/** Cover all Placements with Fog of War, returning the same array when already all covered. */
export function coverAllPlacements(placements: readonly Placement[]): Placement[] {
  return applyFogByPredicate(placements, () => true, true);
}

/** Reveal all Placements from Fog of War, returning the same array when already all revealed. */
export function revealAllPlacements(placements: readonly Placement[]): Placement[] {
  return applyFogByPredicate(placements, () => true, false);
}

function findTilesetFogFaceUrl(tileset: Tileset): string | null {
  for (const tile of tileset.tiles) {
    if (tile.faceA.faceNumber === FOG_TILE_FACE_NUMBER) {
      return tile.faceA.url;
    }
    if (tile.faceB.faceNumber === FOG_TILE_FACE_NUMBER) {
      return tile.faceB.url;
    }
  }
  return null;
}

/**
 * Resolve #37 Fog artwork for a Placement's Tileset, falling back silently to the first
 * discovered Tileset's #37 PNG and then null (so rendering uses solid charcoal #1c1a18).
 */
export function resolveFogTileFaceUrl(
  tilesetId: string,
  tilesetsById: ReadonlyMap<string, Tileset>,
  isUrlFailed?: (url: string) => boolean,
): string | null {
  const hostTileset = tilesetsById.get(tilesetId);
  if (hostTileset) {
    const hostUrl = findTilesetFogFaceUrl(hostTileset);
    if (hostUrl && !isUrlFailed?.(hostUrl)) {
      return hostUrl;
    }
  }

  for (const tileset of tilesetsById.values()) {
    const fallbackUrl = findTilesetFogFaceUrl(tileset);
    if (fallbackUrl && !isUrlFailed?.(fallbackUrl)) {
      return fallbackUrl;
    }
  }

  return null;
}

/** Create a session fence upon entering Player View so Undo/Redo stays bounded to Player edits. */
export function enterPlayerViewSession<T>(history: HistoryState<T>): PlayerViewFence {
  return {
    undoFloor: history.past.length,
    playerRedoCount: 0,
  };
}

/** Return true if Undo is permitted given the optional Player View session fence. */
export function canUndoWithFence<T>(
  history: HistoryState<T>,
  fence: PlayerViewFence | null,
): boolean {
  if (!fence) return history.past.length > 0;
  return history.past.length > fence.undoFloor;
}

/** Return true if Redo is permitted given the optional Player View session fence. */
export function canRedoWithFence<T>(
  history: HistoryState<T>,
  fence: PlayerViewFence | null,
): boolean {
  if (!fence) return history.future.length > 0;
  return fence.playerRedoCount > 0 && history.future.length > 0;
}

/** Commit a state transition onto unified history while resetting Player View redo budget on real edits. */
export function commitWithFence<T, F extends PlayerViewFence | null>(
  history: HistoryState<T>,
  fence: F,
  nextPresent: T,
): { history: HistoryState<T>; fence: F } {
  if (nextPresent === history.present) {
    return { history, fence };
  }
  return {
    history: commitHistory(history, nextPresent),
    fence: (fence ? { undoFloor: fence.undoFloor, playerRedoCount: 0 } : null) as F,
  };
}

/** Perform Undo respecting an active Player View session fence. */
export function undoWithFence<T, F extends PlayerViewFence | null>(
  history: HistoryState<T>,
  fence: F,
): { history: HistoryState<T>; fence: F; changed: boolean } {
  if (!canUndoWithFence(history, fence)) {
    return { history, fence, changed: false };
  }
  return {
    history: undoHistory(history),
    fence: (fence
      ? { undoFloor: fence.undoFloor, playerRedoCount: fence.playerRedoCount + 1 }
      : null) as F,
    changed: true,
  };
}

/** Perform Redo respecting an active Player View session fence. */
export function redoWithFence<T, F extends PlayerViewFence | null>(
  history: HistoryState<T>,
  fence: F,
): { history: HistoryState<T>; fence: F; changed: boolean } {
  if (!canRedoWithFence(history, fence)) {
    return { history, fence, changed: false };
  }
  return {
    history: redoHistory(history),
    fence: (fence
      ? { undoFloor: fence.undoFloor, playerRedoCount: fence.playerRedoCount - 1 }
      : null) as F,
    changed: true,
  };
}

