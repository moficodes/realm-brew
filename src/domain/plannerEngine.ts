import { axialKey } from './hexGeometry';
import type {
  AxialCoord,
  BrushSelection,
  Collection,
  MapDocument,
  Placement,
  PlacementKey,
  RotationStep,
  Tile,
  TileFace,
  Tileset,
} from './types';

export const DEFAULT_TILESET_COPIES = 2;

export interface TileStockEntry {
  tilesetId: string;
  tileId: string;
  owned: number;
  used: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface StockSummary {
  byTileKey: Map<string, TileStockEntry>;
  overBudgetCoords: Set<PlacementKey>;
}

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function tileStockKey(tilesetId: string, tileId: string): string {
  return `${tilesetId}:${tileId}`;
}

export function findPlacementAt(
  placements: readonly Placement[],
  coord: AxialCoord,
): Placement | undefined {
  return placements.find((p) => p.q === coord.q && p.r === coord.r);
}

export function placeTile(placements: readonly Placement[], nextPlacement: Placement): Placement[] {
  const remaining = placements.filter(
    (p) => !(p.q === nextPlacement.q && p.r === nextPlacement.r),
  );
  return [...remaining, { ...nextPlacement }];
}

export function rotateStep(rotation: RotationStep, delta: 1 | -1): RotationStep {
  return (((rotation + delta) % 6 + 6) % 6) as RotationStep;
}

export function rotatePlacement(
  placements: readonly Placement[],
  coord: AxialCoord,
  delta: 1 | -1,
): Placement[] {
  return placements.map((p) =>
    p.q === coord.q && p.r === coord.r
      ? { ...p, rotation: rotateStep(p.rotation, delta) }
      : p,
  );
}

function resolveFlippedFaceNumber(
  tilesetId: string,
  tileId: string,
  faceNumber: number,
  tilesets: readonly Tileset[],
): number {
  const tileset = tilesets.find((t) => t.id === tilesetId);
  const tile = tileset?.tiles.find((t) => t.tileId === tileId);
  if (!tile || tile.isSymmetric) return faceNumber;
  if (faceNumber === tile.faceA.faceNumber) return tile.faceB.faceNumber;
  if (faceNumber === tile.faceB.faceNumber) return tile.faceA.faceNumber;
  return faceNumber;
}

export function flipBrush(brush: BrushSelection, tilesets: readonly Tileset[]): BrushSelection {
  const nextFace = resolveFlippedFaceNumber(
    brush.tilesetId,
    brush.tileId,
    brush.faceNumber,
    tilesets,
  );
  return nextFace === brush.faceNumber ? brush : { ...brush, faceNumber: nextFace };
}

export function flipPlacement(
  placements: readonly Placement[],
  coord: AxialCoord,
  tilesets: readonly Tileset[],
): Placement[] {
  return placements.map((p) => {
    if (p.q !== coord.q || p.r !== coord.r) return p;
    const nextFace = resolveFlippedFaceNumber(p.tilesetId, p.tileId, p.faceNumber, tilesets);
    return nextFace === p.faceNumber ? p : { ...p, faceNumber: nextFace };
  });
}

export function moveOrSwapPlacement(
  placements: readonly Placement[],
  fromCoord: AxialCoord,
  toCoord: AxialCoord,
): Placement[] {
  if (fromCoord.q === toCoord.q && fromCoord.r === toCoord.r) {
    return [...placements];
  }
  const source = findPlacementAt(placements, fromCoord);
  if (!source) return [...placements];

  const target = findPlacementAt(placements, toCoord);
  return placements.map((p) => {
    if (p.q === fromCoord.q && p.r === fromCoord.r) {
      return { ...p, q: toCoord.q, r: toCoord.r };
    }
    if (target && p.q === toCoord.q && p.r === toCoord.r) {
      return { ...p, q: fromCoord.q, r: fromCoord.r };
    }
    return p;
  });
}

export function removePlacement(
  placements: readonly Placement[],
  coord: AxialCoord,
): Placement[] {
  return placements.filter((p) => !(p.q === coord.q && p.r === coord.r));
}

export function clearMap(_placements?: readonly Placement[]): Placement[] {
  return [];
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function commitHistory<T>(history: HistoryState<T>, nextPresent: T): HistoryState<T> {
  return {
    past: [...history.past, history.present],
    present: nextPresent,
    future: [],
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export function computeStock(
  placements: readonly Placement[],
  tilesets: readonly Tileset[],
  collection: Collection,
): StockSummary {
  const usedCounts = new Map<string, number>();
  for (const p of placements) {
    const key = tileStockKey(p.tilesetId, p.tileId);
    usedCounts.set(key, (usedCounts.get(key) ?? 0) + 1);
  }

  const byTileKey = new Map<string, TileStockEntry>();

  for (const tileset of tilesets) {
    const owned = collection[tileset.id] ?? DEFAULT_TILESET_COPIES;
    for (const tile of tileset.tiles) {
      const key = tileStockKey(tileset.id, tile.tileId);
      const used = usedCounts.get(key) ?? 0;
      const remaining = owned - used;
      byTileKey.set(key, {
        tilesetId: tileset.id,
        tileId: tile.tileId,
        owned,
        used,
        remaining,
        isOverBudget: remaining < 0,
      });
    }
  }

  for (const p of placements) {
    const key = tileStockKey(p.tilesetId, p.tileId);
    if (!byTileKey.has(key)) {
      const owned = collection[p.tilesetId] ?? 0;
      const used = usedCounts.get(key) ?? 0;
      const remaining = owned - used;
      byTileKey.set(key, {
        tilesetId: p.tilesetId,
        tileId: p.tileId,
        owned,
        used,
        remaining,
        isOverBudget: remaining < 0,
      });
    }
  }

  const overBudgetCoords = new Set<PlacementKey>();
  for (const p of placements) {
    const entry = byTileKey.get(tileStockKey(p.tilesetId, p.tileId));
    if (entry?.isOverBudget) {
      overBudgetCoords.add(axialKey(p.q, p.r));
    }
  }

  return { byTileKey, overBudgetCoords };
}

export function validatePlacements(input: unknown): Placement[] | null {
  if (!Array.isArray(input)) return null;
  const result: Placement[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.q !== 'number' ||
      !Number.isInteger(raw.q) ||
      typeof raw.r !== 'number' ||
      !Number.isInteger(raw.r) ||
      typeof raw.tilesetId !== 'string' ||
      raw.tilesetId.trim().length === 0 ||
      typeof raw.tileId !== 'string' ||
      raw.tileId.trim().length === 0 ||
      typeof raw.faceNumber !== 'number' ||
      !Number.isInteger(raw.faceNumber) ||
      raw.faceNumber < 1 ||
      typeof raw.rotation !== 'number' ||
      !Number.isInteger(raw.rotation) ||
      raw.rotation < 0 ||
      raw.rotation > 5
    ) {
      return null;
    }
    result.push({
      q: raw.q === 0 ? 0 : raw.q,
      r: raw.r === 0 ? 0 : raw.r,
      tilesetId: raw.tilesetId,
      tileId: raw.tileId,
      faceNumber: raw.faceNumber,
      rotation: raw.rotation as RotationStep,
    });
  }
  return result;
}

export type MapJsonParseResult =
  | { ok: true; map: MapDocument }
  | { ok: false; error: string };

export function validateAndParseMapJson(raw: string): MapJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Map JSON must be an object.' };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    return { ok: false, error: 'Unsupported or missing Map version (expected version: 1).' };
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return { ok: false, error: 'Map JSON is missing a valid name.' };
  }

  const placements = validatePlacements(obj.placements);
  if (!placements) {
    return { ok: false, error: 'Map JSON contains invalid Placements.' };
  }

  const now = new Date().toISOString();
  const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id.trim() : 'imported-map';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : now;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : now;

  return {
    ok: true,
    map: {
      version: 1,
      id,
      name: obj.name.trim(),
      createdAt,
      updatedAt,
      placements,
    },
  };
}

export type ResolvedPlacementAsset =
  | {
      status: 'ok';
      url: string;
      shortCode: string;
      tile: Tile;
      face: TileFace;
    }
  | {
      status: 'missing-tileset' | 'missing-face';
      url: null;
      shortCode: string | null;
      tile: null;
      face: null;
    };

export function resolvePlacementAsset(
  placement: Placement,
  tilesetsById: ReadonlyMap<string, Tileset>,
): ResolvedPlacementAsset {
  const tileset = tilesetsById.get(placement.tilesetId);
  if (!tileset) {
    return {
      status: 'missing-tileset',
      url: null,
      shortCode: null,
      tile: null,
      face: null,
    };
  }

  for (const tile of tileset.tiles) {
    if (tile.faceA.faceNumber === placement.faceNumber) {
      return { status: 'ok', url: tile.faceA.url, shortCode: tileset.shortCode, tile, face: tile.faceA };
    }
    if (tile.faceB.faceNumber === placement.faceNumber) {
      return { status: 'ok', url: tile.faceB.url, shortCode: tileset.shortCode, tile, face: tile.faceB };
    }
  }

  return {
    status: 'missing-face',
    url: null,
    shortCode: tileset.shortCode,
    tile: null,
    face: null,
  };
}
