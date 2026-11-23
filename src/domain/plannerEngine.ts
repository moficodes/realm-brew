import { axialKey, clampOffsetToUnitHex, normalizeRotationDeg } from './hexGeometry';
import {
  overlayLocalToWorld,
  reprojectOverlayToHost,
  worldToClampedOverlayLocal,
} from './overlayGeometry';
import {
  DEFAULT_OVERLAY_PACK_COPIES,
  DEFAULT_TILESET_COPIES,
  padFaceNumber,
  type ActiveBrush,
  type AxialCoord,
  type BrushSelection,
  type Collection,
  type MapDocument,
  type MapSummary,
  type Overlay,
  type OverlayPack,
  type OverlayPlacement,
  type Placement,
  type PlacementKey,
  type RotationStep,
  type Tile,
  type TileFace,
  type Tileset,
} from './types';

export { DEFAULT_OVERLAY_PACK_COPIES, DEFAULT_TILESET_COPIES };

export interface TileAvailability {
  tilesetId: string;
  tileId: string;
  owned: number;
  used: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface OverlayAvailability {
  overlayPackId: string;
  overlayId: string;
  owned: number;
  used: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface CollectionUsage {
  byTileKey: Map<string, TileAvailability>;
  overBudgetCoords: Set<PlacementKey>;
  byOverlayKey: Map<string, OverlayAvailability>;
  overBudgetOverlayIds: Set<string>;
}

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function tileCollectionKey(tilesetId: string, tileId: string): string {
  return `${tilesetId}:${tileId}`;
}

/** Build the Collection lookup key for an Overlay within an Overlay Pack. */
export function overlayCollectionKey(overlayPackId: string, overlayId: string): string {
  return `${overlayPackId}:${overlayId}`;
}

export function findPlacementAt(
  placements: readonly Placement[],
  coord: AxialCoord,
): Placement | undefined {
  return placements.find((p) => p.q === coord.q && p.r === coord.r);
}

export function placeTile(placements: readonly Placement[], nextPlacement: Placement): Placement[] {
  const existing = findPlacementAt(placements, nextPlacement);
  if (!existing) {
    return [...placements, { ...nextPlacement }];
  }

  const merged: Placement = { ...nextPlacement };
  if (merged.covered === undefined && existing.covered) {
    merged.covered = true;
  }
  if (merged.overlays === undefined && existing.overlays && existing.overlays.length > 0) {
    merged.overlays = existing.overlays.map((ov) => {
      const local = reprojectOverlayToHost(existing, ov, merged);
      return {
        ...ov,
        offsetX: local.offsetX,
        offsetY: local.offsetY,
        rotationDeg: local.rotationDeg,
      };
    });
  }

  return placements.map((p) =>
    p.q === nextPlacement.q && p.r === nextPlacement.r ? merged : p,
  );
}

let overlayIdSeq = 0;

function nextOverlayPlacementId(placements: readonly Placement[]): string {
  const used = new Set<string>();
  for (const p of placements) {
    for (const ov of p.overlays ?? []) {
      used.add(ov.id);
    }
  }
  let candidate = '';
  do {
    overlayIdSeq += 1;
    const suffix =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID().slice(0, 8)
        : `${Date.now().toString(36)}-${overlayIdSeq}`;
    candidate = `ov-${suffix}-${overlayIdSeq}`;
  } while (used.has(candidate));
  return candidate;
}

export interface AttachOverlayResult {
  placements: Placement[];
  createdOverlay: OverlayPlacement | null;
}

/** Attach an Overlay Placement onto an occupied host Placement at the clamped world pointer position. */
export function attachOverlayAtWorld(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlay: Pick<OverlayPlacement, 'overlayPackId' | 'overlayId'> & { rotationDeg?: number },
  worldX: number,
  worldY: number,
  options?: { id?: string; radius?: number },
): AttachOverlayResult {
  const host = findPlacementAt(placements, hostCoord);
  if (!host) {
    return { placements: [...placements], createdOverlay: null };
  }

  const local = worldToClampedOverlayLocal(
    host,
    worldX,
    worldY,
    overlay.rotationDeg ?? 0,
    options?.radius,
  );
  const id = options?.id?.trim() ? options.id.trim() : nextOverlayPlacementId(placements);
  const createdOverlay: OverlayPlacement = {
    id,
    overlayPackId: overlay.overlayPackId,
    overlayId: overlay.overlayId,
    offsetX: local.offsetX,
    offsetY: local.offsetY,
    rotationDeg: local.rotationDeg,
  };

  return {
    createdOverlay,
    placements: placements.map((p) =>
      p.q === hostCoord.q && p.r === hostCoord.r
        ? { ...p, overlays: [...(p.overlays ?? []), createdOverlay] }
        : p,
    ),
  };
}

export interface LocatedOverlayPlacement {
  host: Placement;
  overlay: OverlayPlacement;
  index: number;
}

/** Locate an Overlay Placement anywhere on a Map by its unique instance id. */
export function findOverlayById(
  placements: readonly Placement[],
  overlayId: string | null | undefined,
): LocatedOverlayPlacement | null {
  if (!overlayId) return null;
  for (const host of placements) {
    const overlays = host.overlays ?? [];
    const index = overlays.findIndex((ov) => ov.id === overlayId);
    if (index !== -1) {
      return { host, overlay: overlays[index], index };
    }
  }
  return null;
}

/** Locate an Overlay Placement attached to a specific host Placement coordinate. */
export function findOverlayOnHost(
  placements: readonly Placement[],
  hostCoord: AxialCoord | null | undefined,
  overlayId: string | null | undefined,
): LocatedOverlayPlacement | null {
  if (!hostCoord || !overlayId) return null;
  const host = findPlacementAt(placements, hostCoord);
  if (!host) return null;
  const overlays = host.overlays ?? [];
  const index = overlays.findIndex((ov) => ov.id === overlayId);
  if (index === -1) return null;
  return { host, overlay: overlays[index], index };
}

export interface MoveOrReparentOverlayResult {
  placements: Placement[];
  reparented: boolean;
  changed: boolean;
}

/**
 * Move an Overlay Placement within its host hex or reparent it onto another occupied host,
 * preserving visual world position (clamped inside target hex) and angle, and appending
 * reparented Overlays to the top of the target host's stack.
 */
export function moveOrReparentOverlay(
  placements: readonly Placement[],
  fromHostCoord: AxialCoord,
  overlayId: string,
  targetHostCoord: AxialCoord,
  worldX: number,
  worldY: number,
  radius?: number,
): MoveOrReparentOverlayResult {
  const fromHost = findPlacementAt(placements, fromHostCoord);
  const targetHost = findPlacementAt(placements, targetHostCoord);
  if (!fromHost || !targetHost) {
    return { placements: placements as Placement[], reparented: false, changed: false };
  }

  const ov = (fromHost.overlays ?? []).find((o) => o.id === overlayId);
  if (!ov) {
    return { placements: placements as Placement[], reparented: false, changed: false };
  }

  const world = overlayLocalToWorld(fromHost, ov, radius);
  const local = worldToClampedOverlayLocal(targetHost, worldX, worldY, world.worldDeg, radius);
  const sameHost = fromHost.q === targetHost.q && fromHost.r === targetHost.r;

  if (sameHost) {
    if (
      Math.abs(local.offsetX - ov.offsetX) < 1e-6 &&
      Math.abs(local.offsetY - ov.offsetY) < 1e-6
    ) {
      return { placements: placements as Placement[], reparented: false, changed: false };
    }
    return {
      reparented: false,
      changed: true,
      placements: placements.map((p) =>
        p.q === fromHost.q && p.r === fromHost.r
          ? {
              ...p,
              overlays: (p.overlays ?? []).map((o) =>
                o.id === overlayId
                  ? { ...o, offsetX: local.offsetX, offsetY: local.offsetY }
                  : o,
              ),
            }
          : p,
      ),
    };
  }

  const movedOverlay: OverlayPlacement = {
    ...ov,
    offsetX: local.offsetX,
    offsetY: local.offsetY,
    rotationDeg: local.rotationDeg,
  };

  return {
    reparented: true,
    changed: true,
    placements: placements.map((p) => {
      if (p.q === fromHost.q && p.r === fromHost.r) {
        return {
          ...p,
          overlays: (p.overlays ?? []).filter((o) => o.id !== overlayId),
        };
      }
      if (p.q === targetHost.q && p.r === targetHost.r) {
        return {
          ...p,
          overlays: [...(p.overlays ?? []), movedOverlay],
        };
      }
      return p;
    }),
  };
}

/** Set an Overlay Placement's host-local rotation angle in [0, 360), returning the same array on no-op. */
export function setOverlayLocalRotation(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
  localDeg: number,
): Placement[] {
  const match = findOverlayOnHost(placements, hostCoord, overlayId);
  if (!match) return placements as Placement[];

  const normalized = normalizeRotationDeg(localDeg);
  if (Math.abs(match.overlay.rotationDeg - normalized) < 1e-6) {
    return placements as Placement[];
  }

  return placements.map((p) =>
    p.q === hostCoord.q && p.r === hostCoord.r
      ? {
          ...p,
          overlays: (p.overlays ?? []).map((o) =>
            o.id === overlayId ? { ...o, rotationDeg: normalized } : o,
          ),
        }
      : p,
  );
}

/** Set an Overlay Placement's angle from a world-space angle [0, 360), preserving world alignment. */
export function setOverlayWorldRotation(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
  worldDeg: number,
): Placement[] {
  const host = findPlacementAt(placements, hostCoord);
  if (!host) return placements as Placement[];
  const localDeg = normalizeRotationDeg(worldDeg - host.rotation * 60);
  return setOverlayLocalRotation(placements, hostCoord, overlayId, localDeg);
}

/** Rotate an Overlay Placement by a relative degree delta, returning the same array on no-op. */
export function rotateOverlayByDelta(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
  deltaDeg: number,
): Placement[] {
  const match = findOverlayOnHost(placements, hostCoord, overlayId);
  if (!match) return placements as Placement[];
  return setOverlayLocalRotation(
    placements,
    hostCoord,
    overlayId,
    match.overlay.rotationDeg + deltaDeg,
  );
}

/** Reset an Overlay Placement's host-local offset to (0, 0), returning the same array on no-op. */
export function centerOverlayOnHost(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
): Placement[] {
  const match = findOverlayOnHost(placements, hostCoord, overlayId);
  if (!match) return placements as Placement[];
  if (match.overlay.offsetX === 0 && match.overlay.offsetY === 0) {
    return placements as Placement[];
  }

  return placements.map((p) =>
    p.q === hostCoord.q && p.r === hostCoord.r
      ? {
          ...p,
          overlays: (p.overlays ?? []).map((o) =>
            o.id === overlayId ? { ...o, offsetX: 0, offsetY: 0 } : o,
          ),
        }
      : p,
  );
}

/** Move an Overlay Placement one slot up (toward top) or down (toward bottom) in its host stack. */
export function reorderOverlayZ(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
  direction: 'up' | 'down',
): Placement[] {
  const match = findOverlayOnHost(placements, hostCoord, overlayId);
  if (!match) return placements as Placement[];

  const overlays = match.host.overlays ?? [];
  const nextIndex = direction === 'up' ? match.index + 1 : match.index - 1;
  if (nextIndex < 0 || nextIndex >= overlays.length) {
    return placements as Placement[];
  }

  const nextOverlays = [...overlays];
  const [item] = nextOverlays.splice(match.index, 1);
  nextOverlays.splice(nextIndex, 0, item);

  return placements.map((p) =>
    p.q === hostCoord.q && p.r === hostCoord.r ? { ...p, overlays: nextOverlays } : p,
  );
}

/** Remove a single Overlay Placement from its host without altering the host Placement. */
export function removeOverlay(
  placements: readonly Placement[],
  hostCoord: AxialCoord,
  overlayId: string,
): Placement[] {
  const match = findOverlayOnHost(placements, hostCoord, overlayId);
  if (!match) return placements as Placement[];

  return placements.map((p) =>
    p.q === hostCoord.q && p.r === hostCoord.r
      ? {
          ...p,
          overlays: (p.overlays ?? []).filter((o) => o.id !== overlayId),
        }
      : p,
  );
}

/** Reconcile host selection and focused Overlay ID after Undo/Redo, following reparented Overlays. */
export function reconcileSelectionAfterHistory(
  placements: readonly Placement[],
  selectedCoord: AxialCoord | null,
  focusedOverlayId: string | null,
): { selectedCoord: AxialCoord | null; focusedOverlayId: string | null } {
  if (focusedOverlayId) {
    const match = findOverlayById(placements, focusedOverlayId);
    if (match) {
      return {
        selectedCoord: {
          q: match.host.q === 0 ? 0 : match.host.q,
          r: match.host.r === 0 ? 0 : match.host.r,
        },
        focusedOverlayId,
      };
    }
  }

  if (selectedCoord && findPlacementAt(placements, selectedCoord)) {
    return {
      selectedCoord: {
        q: selectedCoord.q === 0 ? 0 : selectedCoord.q,
        r: selectedCoord.r === 0 ? 0 : selectedCoord.r,
      },
      focusedOverlayId: null,
    };
  }

  return { selectedCoord: null, focusedOverlayId: null };
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

export function flipBrush<T extends BrushSelection>(brush: T, tilesets: readonly Tileset[]): T {
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
  overlayPacks: readonly OverlayPack[] = [],
): CollectionUsage {
  const tilesetsById = new Map<string, Tileset>(tilesets.map((t) => [t.id, t]));
  const overlayPacksById = new Map<string, OverlayPack>(overlayPacks.map((p) => [p.id, p]));
  const usedCounts = new Map<string, number>();
  const resolvedPlacements = new Map<PlacementKey, string>();
  const usedOverlayCounts = new Map<string, number>();
  const resolvedOverlays = new Map<string, string>();

  for (const p of placements) {
    const resolved = resolvePlacementAsset(p, tilesetsById);
    if (resolved.status === 'ok') {
      const key = tileCollectionKey(p.tilesetId, resolved.tile.tileId);
      usedCounts.set(key, (usedCounts.get(key) ?? 0) + 1);
      resolvedPlacements.set(axialKey(p.q, p.r), key);
    }

    for (const ov of p.overlays ?? []) {
      const resolvedOv = resolveOverlayAsset(ov, overlayPacksById);
      if (resolvedOv.status !== 'ok') {
        continue;
      }
      const ovKey = overlayCollectionKey(ov.overlayPackId, resolvedOv.overlay.overlayId);
      usedOverlayCounts.set(ovKey, (usedOverlayCounts.get(ovKey) ?? 0) + 1);
      resolvedOverlays.set(ov.id, ovKey);
    }
  }

  const byTileKey = new Map<string, TileAvailability>();

  for (const tileset of tilesets) {
    const owned = collection.tilesets[tileset.id] ?? DEFAULT_TILESET_COPIES;
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

  const byOverlayKey = new Map<string, OverlayAvailability>();

  for (const pack of overlayPacks) {
    const owned = collection.overlayPacks[pack.id] ?? DEFAULT_OVERLAY_PACK_COPIES;
    for (const overlay of pack.overlays) {
      const key = overlayCollectionKey(pack.id, overlay.overlayId);
      const used = usedOverlayCounts.get(key) ?? 0;
      const remaining = owned - used;
      byOverlayKey.set(key, {
        overlayPackId: pack.id,
        overlayId: overlay.overlayId,
        owned,
        used,
        remaining,
        isOverBudget: remaining < 0,
      });
    }
  }

  const overBudgetOverlayIds = new Set<string>();
  for (const [instanceId, key] of resolvedOverlays.entries()) {
    const entry = byOverlayKey.get(key);
    if (entry?.isOverBudget) {
      overBudgetOverlayIds.add(instanceId);
    }
  }

  return { byTileKey, overBudgetCoords, byOverlayKey, overBudgetOverlayIds };
}

function validateCountMap(input: unknown): Record<string, number> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

export function validateCollection(input: unknown): Collection | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    obj.version !== 2 ||
    !keys.every((k) => k === 'version' || k === 'tilesets' || k === 'overlayPacks')
  ) {
    return null;
  }
  const tilesets = validateCountMap(obj.tilesets);
  const overlayPacks = validateCountMap(obj.overlayPacks);
  if (!tilesets || !overlayPacks) {
    return null;
  }
  return {
    version: 2,
    tilesets,
    overlayPacks,
  };
}

export function normalizeCollection(input: unknown): Collection | null {
  const structured = validateCollection(input);
  if (structured) {
    return structured;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const obj = input as Record<string, unknown>;
  if ('version' in obj || 'tilesets' in obj || 'overlayPacks' in obj) {
    return null;
  }
  const flatTilesets = validateCountMap(obj);
  if (!flatTilesets) {
    return null;
  }
  return {
    version: 2,
    tilesets: flatTilesets,
    overlayPacks: {},
  };
}

export function mergeCollectionDefaults(
  stored: Collection,
  discoveredTilesetIds: readonly string[],
  discoveredOverlayPackIds: readonly string[],
): Collection {
  const tilesets: Record<string, number> = { ...stored.tilesets };
  for (const id of discoveredTilesetIds) {
    if (!(id in tilesets)) {
      tilesets[id] = DEFAULT_TILESET_COPIES;
    }
  }

  const overlayPacks: Record<string, number> = { ...stored.overlayPacks };
  for (const id of discoveredOverlayPackIds) {
    if (!(id in overlayPacks)) {
      overlayPacks[id] = DEFAULT_OVERLAY_PACK_COPIES;
    }
  }

  return {
    version: 2,
    tilesets,
    overlayPacks,
  };
}

export function compactPlacement(placement: Placement): Placement {
  const out: Placement = {
    q: placement.q === 0 ? 0 : placement.q,
    r: placement.r === 0 ? 0 : placement.r,
    tilesetId: placement.tilesetId,
    tileId: placement.tileId,
    faceNumber: placement.faceNumber,
    rotation: placement.rotation,
  };
  if (placement.covered) {
    out.covered = true;
  }
  if (placement.overlays && placement.overlays.length > 0) {
    out.overlays = placement.overlays.map((ov) => ({ ...ov }));
  }
  return out;
}

export function countMapOverlays(placements: readonly Placement[]): number {
  return placements.reduce((sum, p) => sum + (p.overlays?.length ?? 0), 0);
}

export function toMapSummary(doc: MapDocument): MapSummary {
  return {
    id: doc.id,
    name: doc.name,
    placementCount: doc.placements.length,
    overlayCount: countMapOverlays(doc.placements),
    updatedAt: doc.updatedAt,
  };
}

export function formatMapSummaryCounts(placementCount: number, overlayCount: number): string {
  const tileLabel = `${placementCount} ${placementCount === 1 ? 'Tile' : 'Tiles'}`;
  if (overlayCount <= 0) {
    return tileLabel;
  }
  const overlayLabel = `${overlayCount} ${overlayCount === 1 ? 'Overlay' : 'Overlays'}`;
  return `${tileLabel} · ${overlayLabel}`;
}

function validateOverlayPlacements(
  input: unknown,
  seenOverlayIds: Set<string>,
): OverlayPlacement[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;

  const overlays: OverlayPlacement[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.id !== 'string' ||
      raw.id.trim().length === 0 ||
      typeof raw.overlayPackId !== 'string' ||
      raw.overlayPackId.trim().length === 0 ||
      typeof raw.overlayId !== 'string' ||
      raw.overlayId.trim().length === 0 ||
      typeof raw.offsetX !== 'number' ||
      !Number.isFinite(raw.offsetX) ||
      typeof raw.offsetY !== 'number' ||
      !Number.isFinite(raw.offsetY) ||
      typeof raw.rotationDeg !== 'number' ||
      !Number.isFinite(raw.rotationDeg)
    ) {
      return null;
    }

    if (seenOverlayIds.has(raw.id)) {
      return null;
    }
    seenOverlayIds.add(raw.id);

    const clamped = clampOffsetToUnitHex(raw.offsetX, raw.offsetY);
    overlays.push({
      id: raw.id,
      overlayPackId: raw.overlayPackId,
      overlayId: raw.overlayId,
      offsetX: clamped.offsetX,
      offsetY: clamped.offsetY,
      rotationDeg: normalizeRotationDeg(raw.rotationDeg),
    });
  }
  return overlays;
}

export function validatePlacements(input: unknown): Placement[] | null {
  if (!Array.isArray(input)) return null;
  const result: Placement[] = [];
  const seenCoords = new Set<PlacementKey>();
  const seenOverlayIds = new Set<string>();

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
      raw.rotation > 5 ||
      (raw.covered !== undefined && typeof raw.covered !== 'boolean')
    ) {
      return null;
    }

    const overlays = validateOverlayPlacements(raw.overlays, seenOverlayIds);
    if (!overlays) {
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
      covered: Boolean(raw.covered),
      overlays,
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
  if (obj.version !== 1 && obj.version !== 2) {
    return { ok: false, error: 'Unsupported or missing Map version (expected version: 1 or 2).' };
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
      version: 2,
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

export type ResolvedOverlayAsset =
  | {
      status: 'ok';
      url: string;
      shortCode: string;
      pack: OverlayPack;
      overlay: Overlay;
    }
  | {
      status: 'missing-pack' | 'missing-overlay';
      url: null;
      shortCode: string | null;
      pack: OverlayPack | null;
      overlay: null;
    };

/** Resolve an Overlay Placement against discovered Overlay Packs without dropping missing references. */
export function resolveOverlayAsset(
  overlayPlacement: Pick<OverlayPlacement, 'overlayPackId' | 'overlayId'>,
  overlayPacksById: ReadonlyMap<string, OverlayPack>,
): ResolvedOverlayAsset {
  const pack = overlayPacksById.get(overlayPlacement.overlayPackId);
  if (!pack) {
    return {
      status: 'missing-pack',
      url: null,
      shortCode: null,
      pack: null,
      overlay: null,
    };
  }

  const overlay = pack.overlays.find((o) => o.overlayId === overlayPlacement.overlayId);
  if (!overlay) {
    return {
      status: 'missing-overlay',
      url: null,
      shortCode: pack.shortCode,
      pack,
      overlay: null,
    };
  }

  return {
    status: 'ok',
    url: overlay.url,
    shortCode: pack.shortCode,
    pack,
    overlay,
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

/** Format the active Tile or Overlay brush pill label for the Toolbar. */
export function formatActiveBrushLabel(
  brush: ActiveBrush,
  tilesetsById: ReadonlyMap<string, Tileset>,
  overlayPacksById?: ReadonlyMap<string, OverlayPack>,
): string {
  if (brush.kind === 'tile') {
    return formatAssemblyLabel(brush, tilesetsById);
  }
  const pack = overlayPacksById?.get(brush.overlayPackId);
  const shortCode = pack?.shortCode ?? brush.shortCode;
  const label = pack?.overlays.find((o) => o.overlayId === brush.overlayId)?.label ?? brush.label;
  return `${shortCode} ${label}`;
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
    const owned = collection.tilesets[tileset.id] ?? DEFAULT_TILESET_COPIES;
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

export interface OverlayPrefixGroup {
  heading: string | null;
  name: string;
  isOther: boolean;
  overlays: Overlay[];
}

/** Compare labels in natural numeric order (e.g., Door 2 before Door 10). */
export function naturalCompareLabels(a: string, b: string): number {
  return (
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.localeCompare(b)
  );
}

/** Derive a grouping prefix from an Overlay label by stripping (...) and trailing numbers. */
export function extractOverlayPrefix(label: string): string {
  const withoutParens = label.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutNumbers = withoutParens.replace(/(?:\s*\d+)+$/, '').trim();
  return withoutNumbers || withoutParens || label.trim() || 'Other';
}

function singularCandidates(pluralLower: string): string[] {
  const candidates: string[] = [];
  if (pluralLower.endsWith('ies') && pluralLower.length > 3) {
    candidates.push(`${pluralLower.slice(0, -3)}y`);
  }
  if (pluralLower.endsWith('ves') && pluralLower.length > 3) {
    candidates.push(`${pluralLower.slice(0, -3)}f`);
    candidates.push(`${pluralLower.slice(0, -3)}fe`);
  }
  if (pluralLower.endsWith('es') && pluralLower.length > 2) {
    const stem = pluralLower.slice(0, -2);
    if (/(?:s|x|z|ch|sh)$/.test(stem)) {
      candidates.push(stem);
    }
  }
  if (pluralLower.endsWith('s') && !pluralLower.endsWith('ss') && pluralLower.length > 1) {
    candidates.push(pluralLower.slice(0, -1));
  }
  return candidates;
}

function pickPreferredPrefixLabel(labels: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const candidates = Array.from(counts.keys());
  candidates.sort((a, b) => {
    const aUpper = /^[A-Z]/.test(a) ? 0 : 1;
    const bUpper = /^[A-Z]/.test(b) ? 0 : 1;
    if (aUpper !== bUpper) return aUpper - bUpper;
    const countDiff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (countDiff !== 0) return countDiff;
    return a.localeCompare(b);
  });
  return candidates[0] ?? 'Other';
}

/**
 * Group an Overlay Pack's pieces under natural-sorted filename-prefix subheadings,
 * merging case-insensitive singular/plural pairs, collecting singletons under a bottom
 * Other group, and omitting headings when a pack resolves to a single group.
 */
export function groupOverlaysByPrefix(overlays: readonly Overlay[]): OverlayPrefixGroup[] {
  if (overlays.length === 0) return [];

  const buckets = new Map<string, { labels: string[]; overlays: Overlay[] }>();
  for (const overlay of overlays) {
    const prefix = extractOverlayPrefix(overlay.label);
    const key = prefix.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { labels: [], overlays: [] };
      buckets.set(key, bucket);
    }
    bucket.labels.push(prefix);
    bucket.overlays.push(overlay);
  }

  for (const pluralKey of Array.from(buckets.keys())) {
    const pluralBucket = buckets.get(pluralKey);
    if (!pluralBucket) continue;
    for (const singKey of singularCandidates(pluralKey)) {
      if (singKey === pluralKey) continue;
      const singBucket = buckets.get(singKey);
      if (!singBucket) continue;
      pluralBucket.overlays.push(...singBucket.overlays);
      buckets.delete(singKey);
    }
  }

  const multiGroups: OverlayPrefixGroup[] = [];
  const otherOverlays: Overlay[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.overlays.length === 1) {
      otherOverlays.push(bucket.overlays[0]);
      continue;
    }
    const name = pickPreferredPrefixLabel(bucket.labels);
    const sorted = [...bucket.overlays].sort((a, b) => naturalCompareLabels(a.label, b.label));
    multiGroups.push({
      heading: name,
      name,
      isOther: false,
      overlays: sorted,
    });
  }

  multiGroups.sort((a, b) => naturalCompareLabels(a.name, b.name));

  if (otherOverlays.length > 0) {
    otherOverlays.sort((a, b) => naturalCompareLabels(a.label, b.label));
    multiGroups.push({
      heading: 'Other',
      name: 'Other',
      isOther: true,
      overlays: otherOverlays,
    });
  }

  if (multiGroups.length === 1) {
    multiGroups[0].heading = null;
  }

  return multiGroups;
}

/** Order Overlay Packs with Tileset-paired packs first (in Tileset order), then standalone alphabetically. */
export function sortOverlayPacksPairedFirst(
  overlayPacks: readonly OverlayPack[],
  tilesets: readonly Tileset[],
): OverlayPack[] {
  const tilesetOrder = new Map<string, number>();
  tilesets.forEach((ts, idx) => {
    tilesetOrder.set(ts.id, idx);
  });

  return [...overlayPacks].sort((a, b) => {
    const aPaired = a.pairedTilesetId !== null;
    const bPaired = b.pairedTilesetId !== null;
    if (aPaired !== bPaired) return aPaired ? -1 : 1;
    if (aPaired && bPaired) {
      const aOrder = tilesetOrder.get(a.pairedTilesetId!) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = tilesetOrder.get(b.pairedTilesetId!) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface OverlayPaletteSection {
  pack: OverlayPack;
  groups: OverlayPrefixGroup[];
  totalCount: number;
}

export interface OverlayPaletteFilterResult {
  sections: OverlayPaletteSection[];
  totalMatchesAllPacks: number;
}

/** Filter grouped Overlay Packs by selected pack, live search query, and In-stock only toggle. */
export function buildOverlayPaletteSections(params: {
  orderedPacks: readonly OverlayPack[];
  groupedByPackId: ReadonlyMap<string, readonly OverlayPrefixGroup[]>;
  selectedPackId: string | 'all';
  searchQuery: string;
  inStockOnly: boolean;
  availabilityByOverlayKey: ReadonlyMap<string, OverlayAvailability>;
}): OverlayPaletteFilterResult {
  const { orderedPacks, groupedByPackId, selectedPackId, searchQuery, inStockOnly, availabilityByOverlayKey } = params;
  const q = searchQuery.trim().toLowerCase();

  const matchesOverlay = (pack: OverlayPack, overlay: Overlay): boolean => {
    if (inStockOnly) {
      const avail = availabilityByOverlayKey.get(overlayCollectionKey(pack.id, overlay.overlayId));
      if ((avail?.remaining ?? 0) <= 0) {
        return false;
      }
    }
    if (!q) return true;
    return (
      overlay.label.toLowerCase().includes(q) ||
      pack.name.toLowerCase().includes(q) ||
      pack.shortCode.toLowerCase().includes(q)
    );
  };

  let totalMatchesAllPacks = 0;
  if (q) {
    for (const pack of orderedPacks) {
      for (const overlay of pack.overlays) {
        if (matchesOverlay(pack, overlay)) {
          totalMatchesAllPacks += 1;
        }
      }
    }
  }

  const sections: OverlayPaletteSection[] = [];
  for (const pack of orderedPacks) {
    if (selectedPackId !== 'all' && pack.id !== selectedPackId) continue;

    const baseGroups = groupedByPackId.get(pack.id) ?? groupOverlaysByPrefix(pack.overlays);
    const filteredGroups: OverlayPrefixGroup[] = [];
    let totalCount = 0;

    for (const group of baseGroups) {
      const overlays = group.overlays.filter((ov) => matchesOverlay(pack, ov));
      if (overlays.length === 0) continue;
      totalCount += overlays.length;
      filteredGroups.push({
        heading: group.name,
        name: group.name,
        isOther: group.isOther,
        overlays,
      });
    }

    if (filteredGroups.length === 0) continue;
    if (filteredGroups.length === 1) {
      filteredGroups[0].heading = null;
    }

    sections.push({
      pack,
      groups: filteredGroups,
      totalCount,
    });
  }

  return { sections, totalMatchesAllPacks };
}
