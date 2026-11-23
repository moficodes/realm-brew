// THROWAWAY PROTOTYPE MODEL for Wayfinder #13
// Question: What Canvas interaction model feels best for placing, positioning, rotating, layering,
// and selecting variable-sized Overlays on top of hex Tiles without fighting normal Tile editing?
// Assumption: 3 radically different Canvas interaction variants mounted on `/` (Sub-shape A),
// switchable via `?variant=A|B|C` and a floating bottom switcher bar, using in-memory state.

import type { ImageLookup } from '../canvas/mapRenderer';
import {
  HEX_RADIUS,
  HEX_WIDTH,
  axialToWorld,
  rotationToRadians,
  type Point2D,
} from '../domain/hexGeometry';
import { flipPlacement, rotateStep } from '../domain/plannerEngine';
import type { AxialCoord, Placement, RotationStep, Tileset } from '../domain/types';

export type VariantKey = 'A' | 'B' | 'C';

export const OVERLAY_WORLD_PER_PIXEL = HEX_WIDTH / 1200; // 1:1 physical scale with 1200×1039 Tiles
const SQRT3 = Math.sqrt(3);

export interface ProtoOverlay {
  overlayId: string;
  overlayPackId: string;
  label: string;
  filename: string;
  url: string;
}

export interface ProtoOverlayPack {
  id: string;
  name: string;
  shortCode: string;
  pairedTilesetId: string | null;
  overlays: ProtoOverlay[];
}

export interface ProtoOverlayPlacement {
  id: string;
  overlayPackId: string;
  overlayId: string;
  label: string;
  shortCode: string;
  url: string;
  /** Host-Tile-local X offset in normalized hex-radius units (1.0 = HEX_RADIUS) */
  offsetX: number;
  /** Host-Tile-local Y offset in normalized hex-radius units (1.0 = HEX_RADIUS) */
  offsetY: number;
  /** Continuous angle in degrees [0, 360) relative to host Tile's native 0° orientation */
  rotationDeg: number;
}

export interface ProtoPlacement extends Placement {
  overlays: ProtoOverlayPlacement[];
}

export type ProtoBrush =
  | {
      kind: 'tile';
      tilesetId: string;
      tileId: string;
      faceNumber: number;
      rotation: RotationStep;
    }
  | {
      kind: 'overlay';
      overlayPackId: string;
      overlayId: string;
      label: string;
      shortCode: string;
      url: string;
      rotationDeg: number;
    };

export interface OverlayRef {
  hostCoord: AxialCoord;
  overlayId: string;
}

export interface OverlayWorldTransform {
  x: number;
  y: number;
  worldDeg: number;
  worldRad: number;
}

export interface OverlayHit {
  hostCoord: AxialCoord;
  overlay: ProtoOverlayPlacement;
  worldX: number;
  worldY: number;
  worldDeg: number;
  worldRad: number;
  width: number;
  height: number;
  index: number;
  stackCount: number;
}

let overlayInstanceSeq = 1;
function nextOverlayInstanceId(): string {
  overlayInstanceSeq += 1;
  return `ov-${Date.now().toString(36)}-${overlayInstanceSeq}`;
}

export function normalizeDeg(deg: number): number {
  const mod = deg % 360;
  const normalized = mod < 0 ? mod + 360 : mod;
  return Math.abs(normalized - 360) < 1e-6 || Math.abs(normalized) < 1e-6 ? 0 : normalized;
}

export function findProtoPlacementAt(
  placements: readonly ProtoPlacement[],
  coord: AxialCoord,
): ProtoPlacement | undefined {
  return placements.find((p) => p.q === coord.q && p.r === coord.r);
}

export function findOverlayOnHost(
  placements: readonly ProtoPlacement[],
  ref: OverlayRef | null,
): { host: ProtoPlacement; overlay: ProtoOverlayPlacement; index: number } | null {
  if (!ref) return null;
  const host = findProtoPlacementAt(placements, ref.hostCoord);
  if (!host) return null;
  const index = host.overlays.findIndex((o) => o.id === ref.overlayId);
  if (index === -1) return null;
  return { host, overlay: host.overlays[index], index };
}

export function overlayLocalToWorld(
  host: Pick<ProtoPlacement, 'q' | 'r' | 'rotation'>,
  ov: Pick<ProtoOverlayPlacement, 'offsetX' | 'offsetY' | 'rotationDeg'>,
): OverlayWorldTransform {
  const center = axialToWorld(host.q, host.r, HEX_RADIUS);
  const hostRad = rotationToRadians(host.rotation);
  const lx = ov.offsetX * HEX_RADIUS;
  const ly = ov.offsetY * HEX_RADIUS;
  const cos = Math.cos(hostRad);
  const sin = Math.sin(hostRad);

  const x = center.x + lx * cos - ly * sin;
  const y = center.y + lx * sin + ly * cos;
  const worldDeg = normalizeDeg(host.rotation * 60 + ov.rotationDeg);
  return {
    x,
    y,
    worldDeg,
    worldRad: (worldDeg * Math.PI) / 180,
  };
}

export function worldToOverlayLocal(
  host: Pick<ProtoPlacement, 'q' | 'r' | 'rotation'>,
  wx: number,
  wy: number,
  worldDeg: number,
): { offsetX: number; offsetY: number; rotationDeg: number } {
  const center = axialToWorld(host.q, host.r, HEX_RADIUS);
  const dx = wx - center.x;
  const dy = wy - center.y;
  const hostRad = -rotationToRadians(host.rotation);
  const cos = Math.cos(hostRad);
  const sin = Math.sin(hostRad);

  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  return {
    offsetX: Number((lx / HEX_RADIUS).toFixed(4)),
    offsetY: Number((ly / HEX_RADIUS).toFixed(4)),
    rotationDeg: Number(normalizeDeg(worldDeg - host.rotation * 60).toFixed(2)),
  };
}

export function clampWorldPointToHex(
  wx: number,
  wy: number,
  hostCoord: AxialCoord,
  inset = 4,
): Point2D {
  const center = axialToWorld(hostCoord.q, hostCoord.r, HEX_RADIUS);
  const dx = wx - center.x;
  const dy = wy - center.y;
  const r = Math.max(8, HEX_RADIUS - inset);

  const t1 = Math.abs(dy) / ((SQRT3 / 2) * r);
  const t2 = (Math.abs(dx) + Math.abs(dy) / SQRT3) / r;
  const t = Math.max(t1, t2);

  if (t > 1) {
    return {
      x: center.x + dx / t,
      y: center.y + dy / t,
    };
  }
  return { x: wx, y: wy };
}

export function getOverlayWorldSize(img: HTMLImageElement | null): {
  width: number;
  height: number;
} {
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return { width: 64, height: 64 };
  }
  return {
    width: img.naturalWidth * OVERLAY_WORLD_PER_PIXEL,
    height: img.naturalHeight * OVERLAY_WORLD_PER_PIXEL,
  };
}

export function hexSnapPoints(hostCoord: AxialCoord): Point2D[] {
  const center = axialToWorld(hostCoord.q, hostCoord.r, HEX_RADIUS);
  const points: Point2D[] = [{ x: center.x, y: center.y }];
  const spokeRadius = HEX_RADIUS * 0.5;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push({
      x: center.x + spokeRadius * Math.cos(angle),
      y: center.y + spokeRadius * Math.sin(angle),
    });
  }
  return points;
}

interface MaskEntry {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

export class AlphaMaskCache {
  private readonly masks = new Map<string, MaskEntry | 'unavailable'>();

  private getMask(url: string, img: HTMLImageElement | null): MaskEntry | null {
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return null;
    }
    const cached = this.masks.get(url);
    if (cached === 'unavailable') return null;
    if (cached) return cached;

    try {
      const maxDim = 128;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        this.masks.set(url, 'unavailable');
        return null;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < width * height; i++) {
        alpha[i] = data[i * 4 + 3];
      }
      const entry = { width, height, alpha };
      this.masks.set(url, entry);
      return entry;
    } catch {
      this.masks.set(url, 'unavailable');
      return null;
    }
  }

  isOpaqueNear(
    url: string,
    img: HTMLImageElement | null,
    u: number,
    v: number,
    radiusPx = 5,
  ): boolean {
    const mask = this.getMask(url, img);
    if (!mask) return true;

    const cx = Math.floor(u * mask.width);
    const cy = Math.floor(v * mask.height);
    const x0 = Math.max(0, cx - radiusPx);
    const x1 = Math.min(mask.width - 1, cx + radiusPx);
    const y0 = Math.max(0, cy - radiusPx);
    const y1 = Math.min(mask.height - 1, cy + radiusPx);

    for (let y = y0; y <= y1; y++) {
      const rowOffset = y * mask.width;
      for (let x = x0; x <= x1; x++) {
        if (mask.alpha[rowOffset + x] > 20) {
          return true;
        }
      }
    }
    return false;
  }
}

export function hitTestOverlaysAtWorld(
  placements: readonly ProtoPlacement[],
  wx: number,
  wy: number,
  imageCache: ImageLookup,
  alphaCache: AlphaMaskCache,
): OverlayHit[] {
  const hits: OverlayHit[] = [];

  for (let pIdx = placements.length - 1; pIdx >= 0; pIdx--) {
    const host = placements[pIdx];
    const stackCount = host.overlays.length;
    for (let oIdx = stackCount - 1; oIdx >= 0; oIdx--) {
      const ov = host.overlays[oIdx];
      const img = imageCache.get(ov.url);
      const { width, height } = getOverlayWorldSize(img);
      const hitW = Math.max(width, 32);
      const hitH = Math.max(height, 32);

      const t = overlayLocalToWorld(host, ov);
      const dx = wx - t.x;
      const dy = wy - t.y;
      const cos = Math.cos(-t.worldRad);
      const sin = Math.sin(-t.worldRad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;

      if (Math.abs(lx) > hitW / 2 || Math.abs(ly) > hitH / 2) {
        continue;
      }

      const insideRawBounds = Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
      if (insideRawBounds) {
        const u = (lx + width / 2) / width;
        const v = (ly + height / 2) / height;
        if (!alphaCache.isOpaqueNear(ov.url, img, u, v, 5)) {
          continue;
        }
      }

      hits.push({
        hostCoord: { q: host.q, r: host.r },
        overlay: ov,
        worldX: t.x,
        worldY: t.y,
        worldDeg: t.worldDeg,
        worldRad: t.worldRad,
        width,
        height,
        index: oIdx,
        stackCount,
      });
    }
  }

  return hits;
}

export function placeOrReplaceTile(
  placements: readonly ProtoPlacement[],
  coord: AxialCoord,
  brush: Extract<ProtoBrush, { kind: 'tile' }>,
): ProtoPlacement[] {
  const existing = findProtoPlacementAt(placements, coord);
  const nextBase: ProtoPlacement = {
    q: coord.q,
    r: coord.r,
    tilesetId: brush.tilesetId,
    tileId: brush.tileId,
    faceNumber: brush.faceNumber,
    rotation: brush.rotation,
    overlays: [],
  };

  if (existing && existing.overlays.length > 0) {
    nextBase.overlays = existing.overlays.map((ov) => {
      const world = overlayLocalToWorld(existing, ov);
      const local = worldToOverlayLocal(nextBase, world.x, world.y, world.worldDeg);
      return {
        ...ov,
        offsetX: local.offsetX,
        offsetY: local.offsetY,
        rotationDeg: local.rotationDeg,
      };
    });
  }

  const remaining = placements.filter((p) => !(p.q === coord.q && p.r === coord.r));
  return [...remaining, nextBase];
}

export function rotateHostTile(
  placements: readonly ProtoPlacement[],
  coord: AxialCoord,
  delta: 1 | -1,
): ProtoPlacement[] {
  return placements.map((p) =>
    p.q === coord.q && p.r === coord.r
      ? { ...p, rotation: rotateStep(p.rotation, delta) }
      : p,
  );
}

export function flipHostTile(
  placements: readonly ProtoPlacement[],
  coord: AxialCoord,
  tilesets: readonly Tileset[],
): ProtoPlacement[] {
  const flipped = flipPlacement(placements, coord, tilesets);
  return flipped.map((p, idx) => ({
    ...p,
    overlays: placements[idx].overlays,
  }));
}

export function moveOrSwapHostTile(
  placements: readonly ProtoPlacement[],
  from: AxialCoord,
  to: AxialCoord,
): ProtoPlacement[] {
  if (from.q === to.q && from.r === to.r) return [...placements];
  const source = findProtoPlacementAt(placements, from);
  if (!source) return [...placements];
  const target = findProtoPlacementAt(placements, to);

  return placements.map((p) => {
    if (p.q === from.q && p.r === from.r) {
      return { ...p, q: to.q, r: to.r };
    }
    if (target && p.q === to.q && p.r === to.r) {
      return { ...p, q: from.q, r: from.r };
    }
    return p;
  });
}

export function removeHostTile(
  placements: readonly ProtoPlacement[],
  coord: AxialCoord,
): ProtoPlacement[] {
  return placements.filter((p) => !(p.q === coord.q && p.r === coord.r));
}

export function addOverlayAtWorld(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  brush: Extract<ProtoBrush, { kind: 'overlay' }>,
  wx: number,
  wy: number,
): { placements: ProtoPlacement[]; createdId: string | null } {
  const host = findProtoPlacementAt(placements, hostCoord);
  if (!host) {
    return { placements: [...placements], createdId: null };
  }

  const clamped = clampWorldPointToHex(wx, wy, hostCoord);
  const local = worldToOverlayLocal(host, clamped.x, clamped.y, brush.rotationDeg);
  const createdId = nextOverlayInstanceId();
  const nextOverlay: ProtoOverlayPlacement = {
    id: createdId,
    overlayPackId: brush.overlayPackId,
    overlayId: brush.overlayId,
    label: brush.label,
    shortCode: brush.shortCode,
    url: brush.url,
    offsetX: local.offsetX,
    offsetY: local.offsetY,
    rotationDeg: local.rotationDeg,
  };

  return {
    createdId,
    placements: placements.map((p) =>
      p.q === hostCoord.q && p.r === hostCoord.r
        ? { ...p, overlays: [...p.overlays, nextOverlay] }
        : p,
    ),
  };
}

export function moveOrReparentOverlay(
  placements: readonly ProtoPlacement[],
  fromHostCoord: AxialCoord,
  overlayId: string,
  targetHostCoord: AxialCoord,
  wx: number,
  wy: number,
): { placements: ProtoPlacement[]; reparented: boolean } {
  const fromHost = findProtoPlacementAt(placements, fromHostCoord);
  const targetHost = findProtoPlacementAt(placements, targetHostCoord);
  if (!fromHost || !targetHost) {
    return { placements: [...placements], reparented: false };
  }

  const ov = fromHost.overlays.find((o) => o.id === overlayId);
  if (!ov) {
    return { placements: [...placements], reparented: false };
  }

  const sameHost = fromHost.q === targetHost.q && fromHost.r === targetHost.r;
  const clamped = clampWorldPointToHex(wx, wy, targetHostCoord);
  const world = overlayLocalToWorld(fromHost, ov);
  const local = worldToOverlayLocal(targetHost, clamped.x, clamped.y, world.worldDeg);

  if (sameHost) {
    return {
      reparented: false,
      placements: placements.map((p) =>
        p.q === fromHost.q && p.r === fromHost.r
          ? {
              ...p,
              overlays: p.overlays.map((o) =>
                o.id === overlayId
                  ? { ...o, offsetX: local.offsetX, offsetY: local.offsetY }
                  : o,
              ),
            }
          : p,
      ),
    };
  }

  const movedOverlay: ProtoOverlayPlacement = {
    ...ov,
    offsetX: local.offsetX,
    offsetY: local.offsetY,
    rotationDeg: local.rotationDeg,
  };

  return {
    reparented: true,
    placements: placements.map((p) => {
      if (p.q === fromHost.q && p.r === fromHost.r) {
        return { ...p, overlays: p.overlays.filter((o) => o.id !== overlayId) };
      }
      if (p.q === targetHost.q && p.r === targetHost.r) {
        return { ...p, overlays: [...p.overlays, movedOverlay] };
      }
      return p;
    }),
  };
}

export function setOverlayLocalRotation(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
  localDeg: number,
): ProtoPlacement[] {
  const normalized = Number(normalizeDeg(localDeg).toFixed(2));
  return placements.map((p) => {
    if (p.q !== hostCoord.q || p.r !== hostCoord.r) return p;
    return {
      ...p,
      overlays: p.overlays.map((o) =>
        o.id === overlayId ? { ...o, rotationDeg: normalized } : o,
      ),
    };
  });
}

export function setOverlayWorldRotation(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
  worldDeg: number,
): ProtoPlacement[] {
  return placements.map((p) => {
    if (p.q !== hostCoord.q || p.r !== hostCoord.r) return p;
    const localDeg = Number(normalizeDeg(worldDeg - p.rotation * 60).toFixed(2));
    return {
      ...p,
      overlays: p.overlays.map((o) =>
        o.id === overlayId ? { ...o, rotationDeg: localDeg } : o,
      ),
    };
  });
}

export function rotateOverlayByDelta(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
  deltaDeg: number,
): ProtoPlacement[] {
  return placements.map((p) => {
    if (p.q !== hostCoord.q || p.r !== hostCoord.r) return p;
    return {
      ...p,
      overlays: p.overlays.map((o) =>
        o.id === overlayId
          ? { ...o, rotationDeg: Number(normalizeDeg(o.rotationDeg + deltaDeg).toFixed(2)) }
          : o,
      ),
    };
  });
}

export function centerOverlayOnHost(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
): ProtoPlacement[] {
  return placements.map((p) => {
    if (p.q !== hostCoord.q || p.r !== hostCoord.r) return p;
    return {
      ...p,
      overlays: p.overlays.map((o) =>
        o.id === overlayId ? { ...o, offsetX: 0, offsetY: 0 } : o,
      ),
    };
  });
}

export function reorderOverlayZ(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
  op: 'up' | 'down' | 'front' | 'back',
): ProtoPlacement[] {
  return placements.map((p) => {
    if (p.q !== hostCoord.q || p.r !== hostCoord.r) return p;
    const idx = p.overlays.findIndex((o) => o.id === overlayId);
    if (idx === -1) return p;
    const next = [...p.overlays];
    const [item] = next.splice(idx, 1);

    if (op === 'up') {
      next.splice(Math.min(p.overlays.length - 1, idx + 1), 0, item);
    } else if (op === 'down') {
      next.splice(Math.max(0, idx - 1), 0, item);
    } else if (op === 'front') {
      next.push(item);
    } else {
      next.unshift(item);
    }
    return { ...p, overlays: next };
  });
}

export function removeOverlay(
  placements: readonly ProtoPlacement[],
  hostCoord: AxialCoord,
  overlayId: string,
): ProtoPlacement[] {
  return placements.map((p) =>
    p.q === hostCoord.q && p.r === hostCoord.r
      ? { ...p, overlays: p.overlays.filter((o) => o.id !== overlayId) }
      : p,
  );
}

function findOverlayMatch(
  packs: readonly ProtoOverlayPack[],
  preferredPackId: string,
  patterns: readonly string[],
  fallbackIdx: number,
): { pack: ProtoOverlayPack; overlay: ProtoOverlay } | null {
  const preferred = packs.find((p) => p.id === preferredPackId);
  const searchOrder = preferred
    ? [preferred, ...packs.filter((p) => p.id !== preferredPackId)]
    : [...packs];

  for (const pattern of patterns) {
    const lower = pattern.toLowerCase();
    for (const pack of searchOrder) {
      const hit = pack.overlays.find((o) => o.label.toLowerCase().includes(lower));
      if (hit) return { pack, overlay: hit };
    }
  }

  for (const pack of searchOrder) {
    if (pack.overlays.length > 0) {
      const hit = pack.overlays[fallbackIdx % pack.overlays.length];
      return { pack, overlay: hit };
    }
  }
  return null;
}

export function buildDemoPlacements(
  tilesets: readonly Tileset[],
  overlayPacks: readonly ProtoOverlayPack[],
): ProtoPlacement[] {
  if (tilesets.length === 0) return [];
  const primaryTs =
    tilesets.find((t) => t.id === 'man-hewn-dungeons') ?? tilesets[0];
  if (primaryTs.tiles.length === 0) return [];

  const coords: Array<{ q: number; r: number; rot: RotationStep; tileIdx: number }> = [
    { q: 0, r: 0, rot: 0, tileIdx: 0 },
    { q: 1, r: 0, rot: 1, tileIdx: 2 },
    { q: 0, r: 1, rot: 0, tileIdx: 4 },
    { q: -1, r: 1, rot: 2, tileIdx: 6 },
    { q: 1, r: -1, rot: 4, tileIdx: 8 },
    { q: -1, r: 0, rot: 5, tileIdx: 10 },
  ];

  const placements: ProtoPlacement[] = coords.map((spec) => {
    const tile = primaryTs.tiles[spec.tileIdx % primaryTs.tiles.length];
    return {
      q: spec.q,
      r: spec.r,
      tilesetId: primaryTs.id,
      tileId: tile.tileId,
      faceNumber: tile.faceA.faceNumber,
      rotation: spec.rot,
      overlays: [],
    };
  });

  if (overlayPacks.length === 0) return placements;

  const makeInstance = (
    match: { pack: ProtoOverlayPack; overlay: ProtoOverlay } | null,
    offsetX: number,
    offsetY: number,
    rotationDeg: number,
  ): ProtoOverlayPlacement | null => {
    if (!match) return null;
    return {
      id: nextOverlayInstanceId(),
      overlayPackId: match.pack.id,
      overlayId: match.overlay.overlayId,
      label: match.overlay.label,
      shortCode: match.pack.shortCode,
      url: match.overlay.url,
      offsetX,
      offsetY,
      rotationDeg: normalizeDeg(rotationDeg),
    };
  };

  // (0,0): 3 overlapping stacked Overlays (large + medium + small) for cycling & z-order tests
  const largeCenter = findOverlayMatch(
    overlayPacks,
    'man-hewn-dungeons',
    ['collapsed passage 1', 'bridge 1', 'staircase'],
    0,
  );
  const mediumCenter = findOverlayMatch(
    overlayPacks,
    'alchemists-workshop',
    ['archway 1', 'cartography (desk)', 'bedroom (bed)', 'pillars'],
    5,
  );
  const smallCenter = findOverlayMatch(
    overlayPacks,
    'man-hewn-dungeons',
    ['door 1', 'trapdoor 1', 'ladder (down) 1'],
    10,
  );

  const centerStack = [
    makeInstance(largeCenter, 0, 0, 0),
    makeInstance(mediumCenter, 0.08, -0.06, 25),
    makeInstance(smallCenter, 0.14, 0.06, 0),
  ].filter((x): x is ProtoOverlayPlacement => x !== null);
  placements[0].overlays.push(...centerStack);

  // (1,0): Overhanging Bridge near the hex rim crossing toward (0,0) and empty (2,0)
  const overhangBridge = findOverlayMatch(
    overlayPacks,
    'man-hewn-dungeons',
    ['bridge 1', 'bridge 2', 'collapsed passage 2'],
    1,
  );
  const overhangInstance = makeInstance(overhangBridge, 0.52, -0.1, 330);
  if (overhangInstance) {
    placements[1].overlays.push(overhangInstance);
  }

  // (-1,1): Small prop for fine hit-target testing
  const smallProp = findOverlayMatch(
    overlayPacks,
    'man-hewn-dungeons',
    ['ladder (down) 1', 'door 2', 'trapdoor 2'],
    14,
  );
  const smallInstance = makeInstance(smallProp, -0.18, 0.14, 45);
  if (smallInstance) {
    placements[3].overlays.push(smallInstance);
  }

  return placements;
}
