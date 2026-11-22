import { axialKey } from './hexGeometry';
import {
  DEFAULT_TILESET_COPIES,
  padFaceNumber,
  type AxialCoord,
  type BrushSelection,
  type Collection,
  type MapDocument,
  type Placement,
  type PlacementKey,
  type RotationStep,
  type Tile,
  type TileFace,
  type Tileset,
} from './types';

export { DEFAULT_TILESET_COPIES };

export interface TileAvailability {
  tilesetId: string;
  tileId: string;
  owned: number;
  used: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface CollectionUsage {
  byTileKey: Map<string, TileAvailability>;
  overBudgetCoords: Set<PlacementKey>;
}

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function tileCollectionKey(tilesetId: string, tileId: string): string {
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

export function canFlipTarget(
  target: Pick<Placement, 'tilesetId' | 'tileId' | 'faceNumber'>,
  tilesetsById: ReadonlyMap<string, Tileset>,
): boolean {
  const tileset = tilesetsById.get(target.tilesetId);
  if (!tileset) return false;
  const tile = tileset.tiles.find(
    (t) =>
      t.tileId === target.tileId ||
      t.faceA.faceNumber === target.faceNumber ||
      t.faceB.faceNumber === target.faceNumber,
  );
  return Boolean(tile && !tile.isSymmetric);
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

export function clearMap(): Placement[] {
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

export function computeCollectionUsage(
  placements: readonly Placement[],
  tilesets: readonly Tileset[],
  collection: Collection,
): CollectionUsage {
  const tilesetsById = new Map<string, Tileset>(tilesets.map((t) => [t.id, t]));
  const usedCounts = new Map<string, number>();
  const resolvedPlacements = new Map<PlacementKey, string>();

  for (const p of placements) {
    const resolved = resolvePlacementAsset(p, tilesetsById);
    if (resolved.status !== 'ok') {
      continue;
    }
    const key = tileCollectionKey(p.tilesetId, resolved.tile.tileId);
    usedCounts.set(key, (usedCounts.get(key) ?? 0) + 1);
    resolvedPlacements.set(axialKey(p.q, p.r), key);
  }

  const byTileKey = new Map<string, TileAvailability>();

  for (const tileset of tilesets) {
    const owned = collection[tileset.id] ?? DEFAULT_TILESET_COPIES;
    for (const tile of tileset.tiles) {
      const key = tileCollectionKey(tileset.id, tile.tileId);
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

  const overBudgetCoords = new Set<PlacementKey>();
  for (const [coordKey, key] of resolvedPlacements.entries()) {
    const entry = byTileKey.get(key);
    if (entry?.isOverBudget) {
      overBudgetCoords.add(coordKey);
    }
  }

  return { byTileKey, overBudgetCoords };
}

export function validatePlacements(input: unknown): Placement[] | null {
  if (!Array.isArray(input)) return null;
  const result: Placement[] = [];
  const seenCoords = new Set<PlacementKey>();

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

    const q = raw.q === 0 ? 0 : raw.q;
    const r = raw.r === 0 ? 0 : raw.r;
    const coordKey = axialKey(q, r);
    if (seenCoords.has(coordKey)) {
      return null;
    }
    seenCoords.add(coordKey);

    result.push({
      q,
      r,
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
    return { ok: false, error: 'Map JSON contains invalid or duplicate Placements.' };
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

export interface PullListFaceUsage {
  faceNumber: number;
  label: string;
  count: number;
}

export interface PullListItem {
  tileId: string;
  displayLabel: string;
  isSymmetric: boolean;
  needed: number;
  owned: number;
  isOverBudget: boolean;
  faces: PullListFaceUsage[];
}

export interface PullListGroup {
  tilesetId: string;
  tilesetName: string;
  shortCode: string;
  owned: number;
  totalNeeded: number;
  items: PullListItem[];
}

export interface MissingPullListEntry {
  tilesetId: string;
  tileId: string;
  faceNumber: number;
  label: string;
  count: number;
}

export interface PullListSummary {
  totalPlacements: number;
  groups: PullListGroup[];
  missing: MissingPullListEntry[];
}

export function formatAssemblyLabel(
  placement: Pick<Placement, 'tilesetId' | 'faceNumber'>,
  tilesetsById: ReadonlyMap<string, Tileset>,
): string {
  const padded = padFaceNumber(placement.faceNumber);
  const tileset = tilesetsById.get(placement.tilesetId);
  if (!tileset) {
    return `?${placement.tilesetId} #${padded}`;
  }
  return `${tileset.shortCode} #${padded}`;
}

export function computePullList(
  placements: readonly Placement[],
  tilesets: readonly Tileset[],
  collection: Collection,
): PullListSummary {
  const tilesetsById = new Map<string, Tileset>(tilesets.map((t) => [t.id, t]));
  const tileFaceCounts = new Map<string, Map<number, number>>();
  const missingCounts = new Map<string, MissingPullListEntry>();

  for (const p of placements) {
    const resolved = resolvePlacementAsset(p, tilesetsById);
    if (resolved.status !== 'ok') {
      const mKey = `${p.tilesetId}:${p.tileId}:${p.faceNumber}`;
      const existing = missingCounts.get(mKey);
      if (existing) {
        existing.count += 1;
      } else {
        missingCounts.set(mKey, {
          tilesetId: p.tilesetId,
          tileId: p.tileId,
          faceNumber: p.faceNumber,
          label: padFaceNumber(p.faceNumber),
          count: 1,
        });
      }
      continue;
    }

    const key = tileCollectionKey(p.tilesetId, resolved.tile.tileId);
    let faceMap = tileFaceCounts.get(key);
    if (!faceMap) {
      faceMap = new Map<number, number>();
      tileFaceCounts.set(key, faceMap);
    }
    faceMap.set(p.faceNumber, (faceMap.get(p.faceNumber) ?? 0) + 1);
  }

  const groups: PullListGroup[] = [];
  for (const tileset of tilesets) {
    const owned = collection[tileset.id] ?? DEFAULT_TILESET_COPIES;
    const items: PullListItem[] = [];
    let totalNeeded = 0;

    for (const tile of tileset.tiles) {
      const faceMap = tileFaceCounts.get(tileCollectionKey(tileset.id, tile.tileId));
      if (!faceMap) continue;

      const faces: PullListFaceUsage[] = [];
      let needed = 0;
      const orderedFaces = tile.isSymmetric ? [tile.faceA] : [tile.faceA, tile.faceB];
      for (const f of orderedFaces) {
        const count = faceMap.get(f.faceNumber) ?? 0;
        if (count > 0) {
          faces.push({ faceNumber: f.faceNumber, label: f.label, count });
          needed += count;
        }
      }

      if (needed > 0) {
        totalNeeded += needed;
        items.push({
          tileId: tile.tileId,
          displayLabel: tile.isSymmetric ? `#${tile.faceA.label}` : `${tile.faceA.label}/${tile.faceB.label}`,
          isSymmetric: tile.isSymmetric,
          needed,
          owned,
          isOverBudget: needed > owned,
          faces,
        });
      }
    }

    if (items.length > 0) {
      groups.push({
        tilesetId: tileset.id,
        tilesetName: tileset.name,
        shortCode: tileset.shortCode,
        owned,
        totalNeeded,
        items,
      });
    }
  }

  const missing = Array.from(missingCounts.values()).sort(
    (a, b) => a.tilesetId.localeCompare(b.tilesetId) || a.faceNumber - b.faceNumber,
  );

  return {
    totalPlacements: placements.length,
    groups,
    missing,
  };
}

export function formatPullListText(mapName: string, pullList: PullListSummary): string {
  const lines: string[] = [`${mapName} — Pull List (${pullList.totalPlacements} Placements)`];

  for (const group of pullList.groups) {
    lines.push('');
    lines.push(`${group.tilesetName} (${group.shortCode}) — ${group.totalNeeded} tiles (${group.owned} owned copies)`);
    for (const item of group.items) {
      const faceDetails = item.faces.map((f) => `#${f.label} x${f.count}`).join(', ');
      const warn = item.isOverBudget ? ` [OVER BUDGET: own ${item.owned}]` : '';
      lines.push(`  - Tile ${item.displayLabel} x${item.needed} (${faceDetails})${warn}`);
    }
  }

  if (pullList.missing.length > 0) {
    lines.push('');
    lines.push('Missing Assets');
    for (const m of pullList.missing) {
      lines.push(`  - ${m.tilesetId} #${m.label} x${m.count}`);
    }
  }

  return lines.join('\n');
}
