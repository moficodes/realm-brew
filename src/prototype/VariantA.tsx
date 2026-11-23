// THROWAWAY PROTOTYPE VARIANT A for Wayfinder #13
// Variant A: Smart Direct Canvas (unified hit-testing, click-to-cycle stack, live reparenting, stem rotation gizmo)

import {
  ArrowDown,
  ArrowUp,
  FlipHorizontal2,
  Layers,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TileImageCache } from '../canvas/imageCache';
import type { DragMovePreview } from '../canvas/mapRenderer';
import {
  HEX_RADIUS,
  axialKey,
  axialToWorld,
  screenToWorld,
  worldToAxial,
  zoomCameraAtScreenPoint,
  type Camera,
} from '../domain/hexGeometry';
import { canFlipTarget, formatAssemblyLabel } from '../domain/plannerEngine';
import type { AxialCoord, RotationStep, Tileset } from '../domain/types';
import { isEditableTarget } from '../utils/browserHelpers';
import {
  AlphaMaskCache,
  addOverlayAtWorld,
  clampWorldPointToHex,
  findOverlayOnHost,
  findProtoPlacementAt,
  flipHostTile,
  getOverlayWorldSize,
  hitTestOverlaysAtWorld,
  moveOrReparentOverlay,
  moveOrSwapHostTile,
  normalizeDeg,
  overlayLocalToWorld,
  placeOrReplaceTile,
  removeHostTile,
  removeOverlay,
  reorderOverlayZ,
  rotateHostTile,
  rotateOverlayByDelta,
  setOverlayWorldRotation,
  type OverlayHit,
  type OverlayRef,
  type ProtoBrush,
  type ProtoPlacement,
} from './overlayPrototypeModel';
import {
  drawBaseMapTiles,
  drawGlobalOverlaysPass,
  drawHexOutline,
  drawHostTether,
  drawInvalidEmptyHexFeedback,
  drawOverlayGhost,
  drawOverlayOBB,
  drawWorldBadge,
} from './prototypeCanvasDraw';

export interface VariantSharedProps {
  placements: readonly ProtoPlacement[];
  tilesets: readonly Tileset[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  imageCache: TileImageCache;
  alphaCache: AlphaMaskCache;
  activeBrush: ProtoBrush | null;
  draggingBrush: ProtoBrush | null;
  onSelectBrush: (brush: ProtoBrush | null) => void;
  onUpdateBrush: Dispatch<SetStateAction<ProtoBrush | null>>;
  selectedHostCoord: AxialCoord | null;
  onSelectHostCoord: (coord: AxialCoord | null) => void;
  selectedOverlay: OverlayRef | null;
  onSelectOverlay: (ref: OverlayRef | null) => void;
  onCommitPlacements: (
    updater: (prev: ProtoPlacement[]) => ProtoPlacement[],
    logMessage: string,
  ) => void;
  onLogEvent: (msg: string) => void;
  showGrid: boolean;
  showLabels: boolean;
  camera: Camera;
  onCameraChange: Dispatch<SetStateAction<Camera>>;
  onViewportSizeChange: (size: { width: number; height: number }) => void;
  renderTick: number;
}

interface OverlayDragPreview {
  fromHostCoord: AxialCoord;
  overlayId: string;
  label: string;
  url: string;
  worldX: number;
  worldY: number;
  worldDeg: number;
  worldRad: number;
  targetHostCoord: AxialCoord;
  reparenting: boolean;
  hoveredEmptyCoord: AxialCoord | null;
}

interface RotateGizmoPreview {
  hostCoord: AxialCoord;
  overlayId: string;
  label: string;
  worldX: number;
  worldY: number;
  worldDeg: number;
}

export function VariantA({
  placements,
  tilesets,
  tilesetsById,
  imageCache,
  alphaCache,
  activeBrush,
  draggingBrush,
  onSelectBrush,
  onUpdateBrush,
  selectedHostCoord,
  onSelectHostCoord,
  selectedOverlay,
  onSelectOverlay,
  onCommitPlacements,
  onLogEvent,
  showGrid,
  showLabels,
  camera,
  onCameraChange,
  onViewportSizeChange,
  renderTick,
}: VariantSharedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredWorld, setHoveredWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoveredOverlayHit, setHoveredOverlayHit] = useState<OverlayHit | null>(null);
  const [hoveredEmptyCoord, setHoveredEmptyCoord] = useState<AxialCoord | null>(null);
  const [hoveredTileCoord, setHoveredTileCoord] = useState<AxialCoord | null>(null);
  const [tileDragMove, setTileDragMove] = useState<DragMovePreview | null>(null);
  const [overlayDrag, setOverlayDrag] = useState<OverlayDragPreview | null>(null);
  const [rotatePreview, setRotatePreview] = useState<RotateGizmoPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const noticeTimerRef = useRef<number | null>(null);

  const panStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
    moved: boolean;
  } | null>(null);

  const overlayDragRef = useRef<{
    pointerId: number;
    fromHostCoord: AxialCoord;
    overlayId: string;
    label: string;
    url: string;
    worldDeg: number;
    worldRad: number;
    grabOffsetX: number;
    grabOffsetY: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    lastValidHostCoord: AxialCoord;
    lastValidWorldX: number;
    lastValidWorldY: number;
    allHitsAtDown: OverlayHit[];
    altKeyAtDown: boolean;
  } | null>(null);

  const tileDragRef = useRef<{
    pointerId: number;
    from: AxialCoord;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  const rotateDragRef = useRef<{
    pointerId: number;
    hostCoord: AxialCoord;
    overlayId: string;
    label: string;
    centerX: number;
    centerY: number;
    worldDeg: number;
  } | null>(null);

  const clickCycleRef = useRef<{
    clientX: number;
    clientY: number;
    signature: string;
    step: number;
  } | null>(null);

  const suppressNextClickRef = useRef(false);

  const showTempNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
      setSize(next);
      onViewportSizeChange(next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewportSizeChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true);
      if (e.code === 'Space' && !isEditableTarget(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false);
      if (e.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => {
      setSpacePressed(false);
      setShiftPressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      onCameraChange((prev) =>
        zoomCameraAtScreenPoint(
          prev,
          sx,
          sy,
          sizeRef.current.width,
          sizeRef.current.height,
          prev.zoom * factor,
        ),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onCameraChange]);

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || sizeRef.current.width <= 0 || sizeRef.current.height <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(
      clientX - rect.left,
      clientY - rect.top,
      sizeRef.current.width,
      sizeRef.current.height,
      cameraRef.current,
    );
  }, []);

  const getSelectedHandleWorld = useCallback((): {
    host: ProtoPlacement;
    overlayId: string;
    label: string;
    wx: number;
    wy: number;
    worldDeg: number;
    worldRad: number;
    handleX: number;
    handleY: number;
    boxTopY: number;
    width: number;
    height: number;
  } | null => {
    const match = findOverlayOnHost(placements, selectedOverlay);
    if (!match) return null;
    const t = overlayLocalToWorld(match.host, match.overlay);
    const worldDeg =
      rotatePreview && rotatePreview.overlayId === match.overlay.id
        ? rotatePreview.worldDeg
        : t.worldDeg;
    const worldRad = (worldDeg * Math.PI) / 180;
    const img = imageCache.get(match.overlay.url);
    const { width, height } = getOverlayWorldSize(img);
    const boxHalfH = Math.max(height, 28) / 2;
    const stemLen = 26 / camera.zoom;
    const localY = -(boxHalfH + stemLen);
    const sin = Math.sin(worldRad);
    const cos = Math.cos(worldRad);
    return {
      host: match.host,
      overlayId: match.overlay.id,
      label: match.overlay.label,
      wx: t.x,
      wy: t.y,
      worldDeg,
      worldRad,
      handleX: t.x - localY * sin,
      handleY: t.y + localY * cos,
      boxTopY: -boxHalfH,
      width,
      height,
    };
  }, [camera.zoom, imageCache, placements, rotatePreview, selectedOverlay]);

  const previewBrush = draggingBrush ?? activeBrush;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(size.width * dpr);
    const pixelHeight = Math.round(size.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawBaseMapTiles({
      ctx,
      width: size.width,
      height: size.height,
      camera,
      placements,
      tilesetsById,
      imageCache,
      showGrid,
      showLabels,
      dragMove: tileDragMove,
    });

    ctx.save();
    ctx.translate(widthCenter(size.width), heightCenter(size.height));
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Selected host Tile highlight (below Overlays)
    if (selectedHostCoord && !selectedOverlay && !tileDragMove) {
      if (findProtoPlacementAt(placements, selectedHostCoord)) {
        drawHexOutline(
          ctx,
          selectedHostCoord,
          '#f59e0b',
          Math.max(3, 3.5 / camera.zoom),
        );
      }
    }

    // Reparent target highlight while dragging Overlay
    if (overlayDrag && overlayDrag.reparenting) {
      drawHexOutline(
        ctx,
        overlayDrag.targetHostCoord,
        '#38bdf8',
        Math.max(2.5, 3 / camera.zoom),
        false,
        'rgba(56, 189, 248, 0.12)',
      );
    }

    // Global Overlays pass
    drawGlobalOverlaysPass({
      ctx,
      placements,
      imageCache,
      skipOverlayId: overlayDrag?.overlayId ?? (rotatePreview ? rotatePreview.overlayId : null),
      dragMove: tileDragMove,
    });

    // If rotating via stem handle, draw the rotated Overlay at preview angle
    if (rotatePreview) {
      const match = findOverlayOnHost(placements, {
        hostCoord: rotatePreview.hostCoord,
        overlayId: rotatePreview.overlayId,
      });
      if (match) {
        const img = imageCache.get(match.overlay.url);
        const t = overlayLocalToWorld(match.host, match.overlay);
        const rad = (rotatePreview.worldDeg * Math.PI) / 180;
        const { width, height } = getOverlayWorldSize(img);
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(rad);
        if (img) ctx.drawImage(img, -width / 2, -height / 2, width, height);
        ctx.restore();
      }
    }

    // Hover feedback on Overlay or Tile
    if (!overlayDrag && !tileDragMove && !rotatePreview && !previewBrush) {
      if (hoveredOverlayHit) {
        drawHostTether(
          ctx,
          hoveredOverlayHit.hostCoord,
          hoveredOverlayHit.worldX,
          hoveredOverlayHit.worldY,
          'rgba(245, 158, 11, 0.8)',
          camera.zoom,
        );
        drawOverlayOBB(
          ctx,
          hoveredOverlayHit.worldX,
          hoveredOverlayHit.worldY,
          hoveredOverlayHit.width,
          hoveredOverlayHit.height,
          hoveredOverlayHit.worldRad,
          'rgba(56, 189, 248, 0.75)',
          1.5 / camera.zoom,
          true,
        );
      } else if (hoveredTileCoord && findProtoPlacementAt(placements, hoveredTileCoord)) {
        drawHexOutline(
          ctx,
          hoveredTileCoord,
          'rgba(255, 255, 255, 0.25)',
          1.5 / camera.zoom,
        );
      }
    }

    // Selected Overlay gizmo + protruding top stem rotation handle
    if (!overlayDrag && !tileDragMove) {
      const handle = getSelectedHandleWorld();
      if (handle) {
        drawHostTether(
          ctx,
          handle.host,
          handle.wx,
          handle.wy,
          '#f59e0b',
          camera.zoom,
        );
        drawOverlayOBB(
          ctx,
          handle.wx,
          handle.wy,
          handle.width,
          handle.height,
          handle.worldRad,
          '#38bdf8',
          2 / camera.zoom,
        );

        ctx.save();
        ctx.translate(handle.wx, handle.wy);
        ctx.rotate(handle.worldRad);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2 / camera.zoom;
        ctx.beginPath();
        ctx.moveTo(0, handle.boxTopY);
        ctx.lineTo(0, handle.boxTopY - 26 / camera.zoom);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, handle.boxTopY - 26 / camera.zoom, 6.5 / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#0ea5e9';
        ctx.fill();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.stroke();
        ctx.restore();

        if (rotatePreview) {
          drawWorldBadge(
            ctx,
            handle.handleX,
            handle.handleY - 20 / camera.zoom,
            `${Math.round(rotatePreview.worldDeg)}°`,
            'rgba(12, 74, 110, 0.95)',
            '#38bdf8',
            '#e0f2fe',
            camera.zoom,
          );
        }
      }
    }

    // Active Overlay drag ghost
    if (overlayDrag) {
      const img = imageCache.get(overlayDrag.url);
      const { width, height } = getOverlayWorldSize(img);
      ctx.save();
      ctx.translate(overlayDrag.worldX, overlayDrag.worldY);
      ctx.rotate(overlayDrag.worldRad);
      if (img) {
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
      }
      ctx.restore();

      drawHostTether(
        ctx,
        overlayDrag.targetHostCoord,
        overlayDrag.worldX,
        overlayDrag.worldY,
        overlayDrag.reparenting ? '#38bdf8' : '#f59e0b',
        camera.zoom,
      );
      drawOverlayOBB(
        ctx,
        overlayDrag.worldX,
        overlayDrag.worldY,
        width,
        height,
        overlayDrag.worldRad,
        '#38bdf8',
        2 / camera.zoom,
      );
      if (overlayDrag.reparenting) {
        drawWorldBadge(
          ctx,
          overlayDrag.worldX,
          overlayDrag.worldY - height / 2 - 18 / camera.zoom,
          `Host (${overlayDrag.targetHostCoord.q}, ${overlayDrag.targetHostCoord.r})`,
          'rgba(12, 74, 110, 0.95)',
          '#38bdf8',
          '#e0f2fe',
          camera.zoom,
        );
      }
      if (overlayDrag.hoveredEmptyCoord) {
        drawInvalidEmptyHexFeedback(
          ctx,
          overlayDrag.hoveredEmptyCoord,
          camera.zoom,
          'Clamped to host hex',
        );
      }
    }

    // Placement brush / drag-from-sidebar preview
    if (previewBrush && hoveredWorld) {
      const coord = worldToAxial(hoveredWorld.x, hoveredWorld.y, HEX_RADIUS);
      if (previewBrush.kind === 'tile') {
        const { x, y } = axialToWorld(coord.q, coord.r, HEX_RADIUS);
        const pseudoPlacement: ProtoPlacement = {
          q: coord.q,
          r: coord.r,
          tilesetId: previewBrush.tilesetId,
          tileId: previewBrush.tileId,
          faceNumber: previewBrush.faceNumber,
          rotation: previewBrush.rotation,
          overlays: [],
        };
        const ts = tilesetsById.get(previewBrush.tilesetId);
        const face = ts?.tiles
          .flatMap((t) => [t.faceA, t.faceB])
          .find((f) => f.faceNumber === previewBrush.faceNumber);
        const img = face ? imageCache.get(face.url) : null;
        if (img) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate((previewBrush.rotation * Math.PI) / 3);
          ctx.globalAlpha = 0.55;
          ctx.drawImage(img, -HEX_RADIUS, -(Math.sqrt(3) * HEX_RADIUS) / 2, HEX_RADIUS * 2, Math.sqrt(3) * HEX_RADIUS);
          ctx.restore();
        }
        void pseudoPlacement;
        drawHexOutline(ctx, coord, '#fbbf24', 2 / camera.zoom);
      } else {
        const host = findProtoPlacementAt(placements, coord);
        const img = imageCache.get(previewBrush.url);
        const rad = (previewBrush.rotationDeg * Math.PI) / 180;
        if (host) {
          const center = axialToWorld(coord.q, coord.r, HEX_RADIUS);
          const snapCenter =
            !shiftPressed && Math.hypot(hoveredWorld.x - center.x, hoveredWorld.y - center.y) < 14;
          const px = snapCenter ? center.x : hoveredWorld.x;
          const py = snapCenter ? center.y : hoveredWorld.y;
          const clamped = clampWorldPointToHex(px, py, coord);
          drawHexOutline(ctx, coord, '#38bdf8', 2 / camera.zoom);
          drawHostTether(ctx, coord, clamped.x, clamped.y, '#f59e0b', camera.zoom);
          drawOverlayGhost(ctx, img, clamped.x, clamped.y, rad, 0.72, false, previewBrush.label);
        } else {
          drawInvalidEmptyHexFeedback(ctx, coord, camera.zoom, 'Needs a host Tile');
          drawOverlayGhost(
            ctx,
            img,
            hoveredWorld.x,
            hoveredWorld.y,
            rad,
            0.48,
            true,
            previewBrush.label,
          );
        }
      }
    } else if (hoveredEmptyCoord && !overlayDrag && !tileDragMove) {
      drawHexOutline(ctx, hoveredEmptyCoord, 'rgba(255,255,255,0.1)', 1 / camera.zoom);
    }

    ctx.restore();
  }, [
    camera,
    getSelectedHandleWorld,
    hoveredEmptyCoord,
    hoveredOverlayHit,
    hoveredTileCoord,
    hoveredWorld,
    imageCache,
    overlayDrag,
    placements,
    previewBrush,
    rotatePreview,
    selectedHostCoord,
    selectedOverlay,
    shiftPressed,
    showGrid,
    showLabels,
    size.height,
    size.width,
    tileDragMove,
    tilesetsById,
    renderTick,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handlePlaceOverlayAtWorld = useCallback(
    (
      brush: Extract<ProtoBrush, { kind: 'overlay' }>,
      wx: number,
      wy: number,
      fromDrop: boolean,
    ) => {
      const coord = worldToAxial(wx, wy, HEX_RADIUS);
      const host = findProtoPlacementAt(placements, coord);
      if (!host) {
        const msg = `Blocked: "${brush.label}" requires a host Tile at (${coord.q}, ${coord.r})`;
        showTempNotice(msg);
        onLogEvent(msg);
        return;
      }

      const center = axialToWorld(coord.q, coord.r, HEX_RADIUS);
      const snapCenter = !shiftPressed && Math.hypot(wx - center.x, wy - center.y) < 14;
      const px = snapCenter ? center.x : wx;
      const py = snapCenter ? center.y : wy;

      const res = addOverlayAtWorld(placements, coord, brush, px, py);
      if (res.createdId) {
        onCommitPlacements(
          (prev) => addOverlayAtWorld(prev, coord, brush, px, py).placements,
          `Placed "${brush.label}" on (${coord.q}, ${coord.r})`,
        );
        onSelectHostCoord(coord);
        onSelectOverlay({ hostCoord: coord, overlayId: res.createdId });
        if (fromDrop) {
          onSelectBrush(null);
        }
      }
    },
    [
      onCommitPlacements,
      onLogEvent,
      onSelectBrush,
      onSelectHostCoord,
      onSelectOverlay,
      placements,
      shiftPressed,
      showTempNotice,
    ],
  );

  const handlePlaceTileAtCoord = useCallback(
    (brush: Extract<ProtoBrush, { kind: 'tile' }>, coord: AxialCoord, fromDrop: boolean) => {
      const existing = findProtoPlacementAt(placements, coord);
      onCommitPlacements(
        (prev) => placeOrReplaceTile(prev, coord, brush),
        existing
          ? `Replaced host Tile (${coord.q}, ${coord.r}) preserving ${existing.overlays.length} Overlays`
          : `Placed Tile #${String(brush.faceNumber).padStart(2, '0')} at (${coord.q}, ${coord.r})`,
      );
      if (fromDrop) {
        onSelectBrush(null);
        onSelectHostCoord(coord);
        onSelectOverlay(null);
      }
    },
    [onCommitPlacements, onSelectBrush, onSelectHostCoord, onSelectOverlay, placements],
  );

  // Keyboard shortcuts specific to Variant A
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('dialog[open]')) return;

      if (e.key === 'Escape') {
        if (activeBrush) {
          onSelectBrush(null);
        } else {
          onSelectOverlay(null);
          onSelectHostCoord(null);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey) return;

      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        if (activeBrush?.kind === 'overlay') {
          const step = e.altKey ? 60 : 15;
          onUpdateBrush((prev) =>
            prev && prev.kind === 'overlay'
              ? { ...prev, rotationDeg: normalizeDeg(prev.rotationDeg + dir * step) }
              : prev,
          );
          return;
        }
        if (activeBrush?.kind === 'tile') {
          onUpdateBrush((prev) =>
            prev && prev.kind === 'tile'
              ? { ...prev, rotation: (((prev.rotation + dir) % 6 + 6) % 6) as RotationStep }
              : prev,
          );
          return;
        }
        const ovMatch = findOverlayOnHost(placements, selectedOverlay);
        if (ovMatch) {
          const step = e.altKey ? 60 : 15;
          onCommitPlacements(
            (prev) =>
              rotateOverlayByDelta(prev, ovMatch.host, ovMatch.overlay.id, dir * step),
            `Rotated "${ovMatch.overlay.label}" by ${dir * step}°`,
          );
          return;
        }
        if (selectedHostCoord) {
          onCommitPlacements(
            (prev) => rotateHostTile(prev, selectedHostCoord, dir),
            `Rotated host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r}) ${dir > 0 ? '+60°' : '-60°'}`,
          );
        }
        return;
      }

      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (selectedHostCoord && !selectedOverlay) {
          onCommitPlacements(
            (prev) => flipHostTile(prev, selectedHostCoord, tilesets),
            `Flipped host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r})`,
          );
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ovMatch = findOverlayOnHost(placements, selectedOverlay);
        if (ovMatch) {
          e.preventDefault();
          onCommitPlacements(
            (prev) => removeOverlay(prev, ovMatch.host, ovMatch.overlay.id),
            `Removed Overlay "${ovMatch.overlay.label}" (host Tile kept)`,
          );
          onSelectOverlay(null);
          return;
        }
        if (selectedHostCoord) {
          e.preventDefault();
          onCommitPlacements(
            (prev) => removeHostTile(prev, selectedHostCoord),
            `Removed host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r})`,
          );
          onSelectHostCoord(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeBrush,
    onCommitPlacements,
    onSelectBrush,
    onSelectHostCoord,
    onSelectOverlay,
    onUpdateBrush,
    placements,
    selectedHostCoord,
    selectedOverlay,
    tilesets,
  ]);

  const selectedOvMatch = findOverlayOnHost(placements, selectedOverlay);
  const selectedHost = selectedHostCoord
    ? findProtoPlacementAt(placements, selectedHostCoord)
    : undefined;

  const scheduleClickSuppressionClear = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : overlayDrag || tileDragMove || rotatePreview
      ? 'cursor-grabbing'
      : spacePressed
        ? 'cursor-grab'
        : activeBrush
          ? 'cursor-crosshair'
          : hoveredOverlayHit
            ? 'cursor-pointer'
            : hoveredTileCoord && findProtoPlacementAt(placements, hoveredTileCoord)
              ? 'cursor-grab'
              : 'cursor-default';

  return (
    <div ref={containerRef} className="relative h-full w-full flex-1 overflow-hidden bg-[#221f1c]">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${cursorClass}`}
        onPointerDown={(e) => {
          if (e.button === 1 || (e.button === 0 && spacePressed)) {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            panStateRef.current = {
              pointerId: e.pointerId,
              startClientX: e.clientX,
              startClientY: e.clientY,
              startCamX: cameraRef.current.x,
              startCamY: cameraRef.current.y,
              moved: false,
            };
            setIsPanning(true);
            return;
          }

          if (e.button !== 0 || activeBrush) return;
          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;

          // 1. Check rotation stem handle of currently selected Overlay
          const handle = getSelectedHandleWorld();
          if (handle) {
            const handleDist = Math.hypot(world.x - handle.handleX, world.y - handle.handleY);
            if (handleDist <= Math.max(11 / cameraRef.current.zoom, 9)) {
              e.currentTarget.setPointerCapture(e.pointerId);
              rotateDragRef.current = {
                pointerId: e.pointerId,
                hostCoord: { q: handle.host.q, r: handle.host.r },
                overlayId: handle.overlayId,
                label: handle.label,
                centerX: handle.wx,
                centerY: handle.wy,
                worldDeg: handle.worldDeg,
              };
              setRotatePreview({
                hostCoord: { q: handle.host.q, r: handle.host.r },
                overlayId: handle.overlayId,
                label: handle.label,
                worldX: handle.wx,
                worldY: handle.wy,
                worldDeg: handle.worldDeg,
              });
              return;
            }
          }

          // 2. Hit-test Overlays first (unless Alt held -> direct to host Tile)
          const hits = e.altKey
            ? []
            : hitTestOverlaysAtWorld(placements, world.x, world.y, imageCache, alphaCache);
          if (hits.length > 0) {
            const preferred =
              selectedOverlay &&
              hits.find((h) => h.overlay.id === selectedOverlay.overlayId);
            const activeHit = preferred ?? hits[0];
            e.currentTarget.setPointerCapture(e.pointerId);
            overlayDragRef.current = {
              pointerId: e.pointerId,
              fromHostCoord: activeHit.hostCoord,
              overlayId: activeHit.overlay.id,
              label: activeHit.overlay.label,
              url: activeHit.overlay.url,
              worldDeg: activeHit.worldDeg,
              worldRad: activeHit.worldRad,
              grabOffsetX: world.x - activeHit.worldX,
              grabOffsetY: world.y - activeHit.worldY,
              startClientX: e.clientX,
              startClientY: e.clientY,
              moved: false,
              lastValidHostCoord: activeHit.hostCoord,
              lastValidWorldX: activeHit.worldX,
              lastValidWorldY: activeHit.worldY,
              allHitsAtDown: hits,
              altKeyAtDown: e.altKey,
            };
            return;
          }

          // 3. Hit-test host Tile
          const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
          const tileHit = findProtoPlacementAt(placements, coord);
          if (tileHit) {
            e.currentTarget.setPointerCapture(e.pointerId);
            tileDragRef.current = {
              pointerId: e.pointerId,
              from: coord,
              startClientX: e.clientX,
              startClientY: e.clientY,
              moved: false,
            };
            return;
          }

          // 4. Empty space -> pan camera
          e.currentTarget.setPointerCapture(e.pointerId);
          panStateRef.current = {
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCamX: cameraRef.current.x,
            startCamY: cameraRef.current.y,
            moved: false,
          };
          setIsPanning(true);
        }}
        onPointerMove={(e) => {
          const pan = panStateRef.current;
          if (pan && pan.pointerId === e.pointerId) {
            const dx = e.clientX - pan.startClientX;
            const dy = e.clientY - pan.startClientY;
            if (!pan.moved && Math.hypot(dx, dy) > 3) pan.moved = true;
            if (pan.moved) {
              onCameraChange((prev) => ({
                ...prev,
                x: pan.startCamX - dx / prev.zoom,
                y: pan.startCamY - dy / prev.zoom,
              }));
            }
            return;
          }

          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;
          setHoveredWorld(world);

          const rot = rotateDragRef.current;
          if (rot && rot.pointerId === e.pointerId) {
            let angleDeg =
              (Math.atan2(world.y - rot.centerY, world.x - rot.centerX) * 180) / Math.PI + 90;
            angleDeg = normalizeDeg(angleDeg);
            if (e.shiftKey) {
              angleDeg = normalizeDeg(Math.round(angleDeg / 15) * 15);
            }
            rot.worldDeg = angleDeg;
            setRotatePreview({
              hostCoord: rot.hostCoord,
              overlayId: rot.overlayId,
              label: rot.label,
              worldX: rot.centerX,
              worldY: rot.centerY,
              worldDeg: angleDeg,
            });
            return;
          }

          const ovDrag = overlayDragRef.current;
          if (ovDrag && ovDrag.pointerId === e.pointerId) {
            const dx = e.clientX - ovDrag.startClientX;
            const dy = e.clientY - ovDrag.startClientY;
            if (!ovDrag.moved && Math.hypot(dx, dy) > 4) {
              ovDrag.moved = true;
            }
            if (ovDrag.moved) {
              const targetX = world.x - ovDrag.grabOffsetX;
              const targetY = world.y - ovDrag.grabOffsetY;
              const hoverCoord = worldToAxial(targetX, targetY, HEX_RADIUS);
              const occupied = findProtoPlacementAt(placements, hoverCoord);
              let validCoord = ovDrag.lastValidHostCoord;
              let emptyCoord: AxialCoord | null = null;
              if (occupied) {
                validCoord = hoverCoord;
                ovDrag.lastValidHostCoord = hoverCoord;
              } else {
                emptyCoord = hoverCoord;
              }
              const clamped = clampWorldPointToHex(targetX, targetY, validCoord);
              ovDrag.lastValidWorldX = clamped.x;
              ovDrag.lastValidWorldY = clamped.y;

              setOverlayDrag({
                fromHostCoord: ovDrag.fromHostCoord,
                overlayId: ovDrag.overlayId,
                label: ovDrag.label,
                url: ovDrag.url,
                worldX: clamped.x,
                worldY: clamped.y,
                worldDeg: ovDrag.worldDeg,
                worldRad: ovDrag.worldRad,
                targetHostCoord: validCoord,
                reparenting:
                  validCoord.q !== ovDrag.fromHostCoord.q ||
                  validCoord.r !== ovDrag.fromHostCoord.r,
                hoveredEmptyCoord: emptyCoord,
              });
            }
            return;
          }

          const tileDrag = tileDragRef.current;
          if (tileDrag && tileDrag.pointerId === e.pointerId) {
            const dx = e.clientX - tileDrag.startClientX;
            const dy = e.clientY - tileDrag.startClientY;
            if (!tileDrag.moved && Math.hypot(dx, dy) > 5) {
              tileDrag.moved = true;
            }
            const hoverCoord = worldToAxial(world.x, world.y, HEX_RADIUS);
            if (tileDrag.moved) {
              setTileDragMove({ from: tileDrag.from, to: hoverCoord });
            }
            return;
          }

          // Idle hover hit-test
          if (!activeBrush) {
            const hits = e.altKey
              ? []
              : hitTestOverlaysAtWorld(placements, world.x, world.y, imageCache, alphaCache);
            setHoveredOverlayHit(hits[0] ?? null);
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            if (findProtoPlacementAt(placements, coord)) {
              setHoveredTileCoord(coord);
              setHoveredEmptyCoord(null);
            } else {
              setHoveredTileCoord(null);
              setHoveredEmptyCoord(coord);
            }
          }
        }}
        onPointerUp={(e) => {
          const pan = panStateRef.current;
          if (pan && pan.pointerId === e.pointerId) {
            const moved = pan.moved;
            panStateRef.current = null;
            setIsPanning(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            if (!moved && !activeBrush) {
              scheduleClickSuppressionClear();
              onSelectOverlay(null);
              onSelectHostCoord(null);
            } else if (moved) {
              scheduleClickSuppressionClear();
            }
            return;
          }

          const rot = rotateDragRef.current;
          if (rot && rot.pointerId === e.pointerId) {
            rotateDragRef.current = null;
            setRotatePreview(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();
            onCommitPlacements(
              (prev) => setOverlayWorldRotation(prev, rot.hostCoord, rot.overlayId, rot.worldDeg),
              `Rotated "${rot.label}" to ${Math.round(rot.worldDeg)}° world`,
            );
            return;
          }

          const ovDrag = overlayDragRef.current;
          if (ovDrag && ovDrag.pointerId === e.pointerId) {
            overlayDragRef.current = null;
            setOverlayDrag(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();

            if (ovDrag.moved) {
              const target = ovDrag.lastValidHostCoord;
              const reparented =
                target.q !== ovDrag.fromHostCoord.q || target.r !== ovDrag.fromHostCoord.r;
              onCommitPlacements(
                (prev) =>
                  moveOrReparentOverlay(
                    prev,
                    ovDrag.fromHostCoord,
                    ovDrag.overlayId,
                    target,
                    ovDrag.lastValidWorldX,
                    ovDrag.lastValidWorldY,
                  ).placements,
                reparented
                  ? `Reparented "${ovDrag.label}" (${ovDrag.fromHostCoord.q},${ovDrag.fromHostCoord.r}) → (${target.q},${target.r})`
                  : `Moved "${ovDrag.label}" within (${target.q},${target.r})`,
              );
              onSelectHostCoord(target);
              onSelectOverlay({ hostCoord: target, overlayId: ovDrag.overlayId });
              return;
            }

            // Click (not dragged): click-to-cycle through overlapping stack -> host Tile
            const hits = ovDrag.allHitsAtDown;
            const sig = hits.map((h) => h.overlay.id).join('|');
            const prevCycle = clickCycleRef.current;
            const sameSpot =
              prevCycle &&
              prevCycle.signature === sig &&
              Math.hypot(e.clientX - prevCycle.clientX, e.clientY - prevCycle.clientY) <= 6;

            const step = sameSpot ? (prevCycle.step + 1) % (hits.length + 1) : 0;
            clickCycleRef.current = {
              clientX: e.clientX,
              clientY: e.clientY,
              signature: sig,
              step,
            };

            if (step < hits.length) {
              const picked = hits[step];
              onSelectHostCoord(picked.hostCoord);
              onSelectOverlay({ hostCoord: picked.hostCoord, overlayId: picked.overlay.id });
              if (hits.length > 1) {
                onLogEvent(
                  `Selected "${picked.overlay.label}" (${step + 1}/${hits.length} in stack under cursor)`,
                );
              }
            } else {
              const hostCoord = hits[0].hostCoord;
              onSelectOverlay(null);
              onSelectHostCoord(hostCoord);
              onLogEvent(`Cycled past stack to host Tile (${hostCoord.q}, ${hostCoord.r})`);
            }
            return;
          }

          const tileDrag = tileDragRef.current;
          if (tileDrag && tileDrag.pointerId === e.pointerId) {
            const world = clientToWorld(e.clientX, e.clientY);
            const target = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
            const moved = tileDrag.moved;
            const from = tileDrag.from;
            tileDragRef.current = null;
            setTileDragMove(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();
            clickCycleRef.current = null;

            if (moved && target && (target.q !== from.q || target.r !== from.r)) {
              onCommitPlacements(
                (prev) => moveOrSwapHostTile(prev, from, target),
                `Moved/swapped host Tile (${from.q},${from.r}) → (${target.q},${target.r})`,
              );
              onSelectHostCoord(target);
              onSelectOverlay(null);
            } else {
              onSelectOverlay(null);
              onSelectHostCoord(from);
            }
          }
        }}
        onPointerCancel={() => {
          panStateRef.current = null;
          overlayDragRef.current = null;
          tileDragRef.current = null;
          rotateDragRef.current = null;
          setIsPanning(false);
          setOverlayDrag(null);
          setTileDragMove(null);
          setRotatePreview(null);
        }}
        onPointerLeave={() => {
          if (!panStateRef.current && !overlayDragRef.current && !tileDragRef.current) {
            setHoveredWorld(null);
            setHoveredOverlayHit(null);
            setHoveredTileCoord(null);
            setHoveredEmptyCoord(null);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;
          const hits = hitTestOverlaysAtWorld(
            placements,
            world.x,
            world.y,
            imageCache,
            alphaCache,
          );
          if (hits.length > 0) {
            const top = hits[0];
            onCommitPlacements(
              (prev) => removeOverlay(prev, top.hostCoord, top.overlay.id),
              `Right-click removed Overlay "${top.overlay.label}" (host Tile kept)`,
            );
            if (selectedOverlay?.overlayId === top.overlay.id) {
              onSelectOverlay(null);
            }
            return;
          }
          const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
          if (findProtoPlacementAt(placements, coord)) {
            onCommitPlacements(
              (prev) => removeHostTile(prev, coord),
              `Right-click removed host Tile (${coord.q}, ${coord.r})`,
            );
            if (
              selectedHostCoord &&
              axialKey(selectedHostCoord.q, selectedHostCoord.r) === axialKey(coord.q, coord.r)
            ) {
              onSelectHostCoord(null);
              onSelectOverlay(null);
            }
          }
        }}
        onDragOver={(e) => {
          if (
            draggingBrush ||
            e.dataTransfer.types.includes('application/x-realm-brew-overlay') ||
            e.dataTransfer.types.includes('application/x-realm-brew-face')
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const world = clientToWorld(e.clientX, e.clientY);
            if (world) setHoveredWorld(world);
          }
        }}
        onDragLeave={() => {
          setHoveredWorld(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;

          let dropped: ProtoBrush | null = draggingBrush;
          const rawOv = e.dataTransfer.getData('application/x-realm-brew-overlay');
          const rawFace = e.dataTransfer.getData('application/x-realm-brew-face');
          try {
            if (rawOv) dropped = JSON.parse(rawOv) as ProtoBrush;
            else if (rawFace) dropped = JSON.parse(rawFace) as ProtoBrush;
          } catch {
            dropped = draggingBrush;
          }
          setHoveredWorld(null);
          if (!dropped) return;

          if (dropped.kind === 'overlay') {
            handlePlaceOverlayAtWorld(dropped, world.x, world.y, true);
          } else {
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            handlePlaceTileAtCoord(dropped, coord, true);
          }
        }}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (spacePressed || e.button !== 0 || !activeBrush) return;
          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;
          if (activeBrush.kind === 'overlay') {
            handlePlaceOverlayAtWorld(activeBrush, world.x, world.y, false);
          } else {
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            handlePlaceTileAtCoord(activeBrush, coord, false);
          }
        }}
      />

      {notice && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-500/50 bg-red-950/90 px-3.5 py-1.5 text-xs font-medium text-red-100 shadow-lg">
          {notice}
        </div>
      )}

      {/* Variant A tip chip top-right */}
      <div className="pointer-events-none absolute top-3 right-3 rounded-lg border border-[#2e2a26] bg-[#161412]/85 px-2.5 py-1.5 text-[11px] text-stone-300 backdrop-blur">
        <span className="font-semibold text-sky-300">Direct mode:</span> Click stacked spot repeatedly to cycle · <kbd className="rounded bg-stone-800 px-1">Alt+Click</kbd> host Tile · Drag top stem to spin
      </div>

      {/* Floating action bar at bottom-16 so it clears PrototypeSwitcher */}
      {(selectedOvMatch || selectedHost || activeBrush) && (
        <div className="pointer-events-none absolute inset-x-3 bottom-16 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
            {selectedOvMatch && !activeBrush && (
              <>
                <span className="font-semibold text-sky-300">
                  {selectedOvMatch.overlay.shortCode} {selectedOvMatch.overlay.label}
                </span>
                <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
                  on {formatAssemblyLabel(selectedOvMatch.host, tilesetsById)}
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {Math.round(selectedOvMatch.overlay.rotationDeg)}°
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onCommitPlacements(
                      (prev) =>
                        rotateOverlayByDelta(
                          prev,
                          selectedOvMatch.host,
                          selectedOvMatch.overlay.id,
                          -15,
                        ),
                      `Rotated "${selectedOvMatch.overlay.label}" -15°`,
                    )
                  }
                  className="flex items-center gap-1 rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  <RotateCcw className="h-3 w-3" />
                  -15°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCommitPlacements(
                      (prev) =>
                        rotateOverlayByDelta(
                          prev,
                          selectedOvMatch.host,
                          selectedOvMatch.overlay.id,
                          15,
                        ),
                      `Rotated "${selectedOvMatch.overlay.label}" +15°`,
                    )
                  }
                  className="flex items-center gap-1 rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  <RotateCw className="h-3 w-3" />
                  +15°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCommitPlacements(
                      (prev) =>
                        rotateOverlayByDelta(
                          prev,
                          selectedOvMatch.host,
                          selectedOvMatch.overlay.id,
                          60,
                        ),
                      `Snapped "${selectedOvMatch.overlay.label}" +60°`,
                    )
                  }
                  className="rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  +60°
                </button>
                <span className="mx-0.5 text-stone-600">|</span>
                <span className="font-mono text-[11px] text-stone-400">
                  z {selectedOvMatch.index + 1}/{selectedOvMatch.host.overlays.length}
                </span>
                <button
                  type="button"
                  title="Send Backward"
                  disabled={selectedOvMatch.index === 0}
                  onClick={() =>
                    onCommitPlacements(
                      (prev) =>
                        reorderOverlayZ(
                          prev,
                          selectedOvMatch.host,
                          selectedOvMatch.overlay.id,
                          'down',
                        ),
                      `Sent "${selectedOvMatch.overlay.label}" backward`,
                    )
                  }
                  className="rounded border border-[#2e2a26] bg-[#1c1917] p-1 text-stone-200 hover:bg-stone-800 disabled:opacity-35"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Bring Forward"
                  disabled={selectedOvMatch.index === selectedOvMatch.host.overlays.length - 1}
                  onClick={() =>
                    onCommitPlacements(
                      (prev) =>
                        reorderOverlayZ(
                          prev,
                          selectedOvMatch.host,
                          selectedOvMatch.overlay.id,
                          'up',
                        ),
                      `Brought "${selectedOvMatch.overlay.label}" forward`,
                    )
                  }
                  className="rounded border border-[#2e2a26] bg-[#1c1917] p-1 text-stone-200 hover:bg-stone-800 disabled:opacity-35"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectOverlay(null);
                    onSelectHostCoord({
                      q: selectedOvMatch.host.q,
                      r: selectedOvMatch.host.r,
                    });
                  }}
                  className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200 hover:bg-amber-500/20"
                >
                  <Layers className="h-3 w-3" />
                  Select Host
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCommitPlacements(
                      (prev) =>
                        removeOverlay(prev, selectedOvMatch.host, selectedOvMatch.overlay.id),
                      `Removed Overlay "${selectedOvMatch.overlay.label}"`,
                    );
                    onSelectOverlay(null);
                  }}
                  className="flex items-center gap-1 rounded border border-red-500/30 bg-red-950/50 px-2 py-1 text-red-200 hover:bg-red-900/60"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </>
            )}

            {!selectedOvMatch && selectedHost && !activeBrush && (
              <>
                <span className="font-mono font-semibold text-amber-300">
                  Host {formatAssemblyLabel(selectedHost, tilesetsById)} ({selectedHost.q},
                  {selectedHost.r})
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {selectedHost.rotation * 60}° · {selectedHost.overlays.length} Overlays
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onCommitPlacements(
                      (prev) => rotateHostTile(prev, selectedHost, -1),
                      `Rotated host Tile (${selectedHost.q},${selectedHost.r}) -60°`,
                    )
                  }
                  className="flex items-center gap-1 rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  <RotateCcw className="h-3 w-3" />
                  -60°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCommitPlacements(
                      (prev) => rotateHostTile(prev, selectedHost, 1),
                      `Rotated host Tile (${selectedHost.q},${selectedHost.r}) +60°`,
                    )
                  }
                  className="flex items-center gap-1 rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  <RotateCw className="h-3 w-3" />
                  +60°
                </button>
                <button
                  type="button"
                  disabled={!canFlipTarget(selectedHost, tilesetsById)}
                  onClick={() =>
                    onCommitPlacements(
                      (prev) => flipHostTile(prev, selectedHost, tilesets),
                      `Flipped host Tile (${selectedHost.q},${selectedHost.r})`,
                    )
                  }
                  className="flex items-center gap-1 rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800 disabled:opacity-40"
                >
                  <FlipHorizontal2 className="h-3 w-3" />
                  Flip
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCommitPlacements(
                      (prev) => removeHostTile(prev, selectedHost),
                      `Removed host Tile (${selectedHost.q},${selectedHost.r})`,
                    );
                    onSelectHostCoord(null);
                  }}
                  className="flex items-center gap-1 rounded border border-red-500/30 bg-red-950/50 px-2 py-1 text-red-200 hover:bg-red-900/60"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove Tile
                </button>
              </>
            )}

            {activeBrush && (
              <>
                <span
                  className={`font-semibold ${
                    activeBrush.kind === 'overlay' ? 'text-sky-300' : 'text-amber-300'
                  }`}
                >
                  Brush:{' '}
                  {activeBrush.kind === 'overlay'
                    ? `${activeBrush.shortCode} ${activeBrush.label}`
                    : `Tile #${String(activeBrush.faceNumber).padStart(2, '0')}`}
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {activeBrush.kind === 'overlay'
                    ? `${Math.round(activeBrush.rotationDeg)}°`
                    : `${activeBrush.rotation * 60}°`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateBrush((prev) => {
                      if (!prev) return null;
                      return prev.kind === 'overlay'
                        ? { ...prev, rotationDeg: normalizeDeg(prev.rotationDeg - 15) }
                        : { ...prev, rotation: (((prev.rotation + 5) % 6) as typeof prev.rotation) };
                    })
                  }
                  className="rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  {activeBrush.kind === 'overlay' ? '-15°' : '-60°'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateBrush((prev) => {
                      if (!prev) return null;
                      return prev.kind === 'overlay'
                        ? { ...prev, rotationDeg: normalizeDeg(prev.rotationDeg + 15) }
                        : { ...prev, rotation: (((prev.rotation + 1) % 6) as typeof prev.rotation) };
                    })
                  }
                  className="rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
                >
                  {activeBrush.kind === 'overlay' ? '+15°' : '+60°'}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectBrush(null)}
                  className="rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-400 hover:text-stone-100"
                >
                  Clear (Esc)
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function widthCenter(w: number): number {
  return w / 2;
}
function heightCenter(h: number): number {
  return h / 2;
}
