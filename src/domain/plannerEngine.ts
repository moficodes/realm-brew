import { axialKey } from './hexGeometry';
import type { Collection, Placement, PlacementKey, Tileset } from './types';

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

export function tileStockKey(tilesetId: string, tileId: string): string {
  return `${tilesetId}:${tileId}`;
}

export function placeTile(placements: readonly Placement[], nextPlacement: Placement): Placement[] {
  const remaining = placements.filter(
    (p) => !(p.q === nextPlacement.q && p.r === nextPlacement.r),
  );
  return [...remaining, { ...nextPlacement }];
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

  // Account for Placements whose Tileset or Tile is missing from the live catalog
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
