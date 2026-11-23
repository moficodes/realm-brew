// THROWAWAY PROTOTYPE VARIANT B for Wayfinder #13
// Variant B: Layer-Scoped Mode (Edit Layer: Tiles | Overlays toggle, 7-point hex snap, empty-drop revert, inline stack pill, slider + Shift+Wheel spin)

import {
  ArrowDown,
  ArrowUp,
  FlipHorizontal2,
  Layers,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { DragMovePreview } from '../canvas/mapRenderer';
import {
  HEX_HEIGHT,
  HEX_RADIUS,
  axialKey,
  axialToWorld,
  screenToWorld,
  worldToAxial,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '../domain/hexGeometry';
import { canFlipTarget, formatAssemblyLabel } from '../domain/plannerEngine';
import type { AxialCoord, RotationStep } from '../domain/types';
import { isEditableTarget } from '../utils/browserHelpers';
import {
  addOverlayAtWorld,
  findOverlayOnHost,
  findProtoPlacementAt,
  flipHostTile,
  getOverlayWorldSize,
  hexSnapPoints,
  hitTestOverlaysAtWorld,
  moveOrReparentOverlay,
  moveOrSwapHostTile,
  normalizeDeg,
  placeOrReplaceTile,
  removeHostTile,
  removeOverlay,
  reorderOverlayZ,
  rotateHostTile,
  rotateOverlayByDelta,
  setOverlayLocalRotation,
  type OverlayHit,
  type ProtoBrush,
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
import type { VariantSharedProps } from './VariantA';

interface VariantBProps extends VariantSharedProps {
  layerMode: 'tiles' | 'overlays';
  onLayerModeChange: (mode: 'tiles' | 'overlays') => void;
}

interface OverlayDragB {
  fromHostCoord: AxialCoord;
  overlayId: string;
  label: string;
  url: string;
  worldX: number;
  worldY: number;
  worldDeg: number;
  worldRad: number;
  hoveredCoord: AxialCoord;
  isValidHost: boolean;
  reparenting: boolean;
  activeSnapIndex: number | null;
}

function snapToHexAnchors(
  wx: number,
  wy: number,
  hostCoord: AxialCoord,
  disabled: boolean,
): { x: number; y: number; snapIndex: number | null; points: Array<{ x: number; y: number }> } {
  const points = hexSnapPoints(hostCoord);
  if (disabled) {
    return { x: wx, y: wy, snapIndex: null, points };
  }
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(wx - points[i].x, wy - points[i].y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  // Snap cleanly to the nearest of the 7 anchors inside the hex
  return {
    x: points[bestIdx].x,
    y: points[bestIdx].y,
    snapIndex: bestIdx,
    points,
  };
}

export function VariantB({
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
  layerMode,
  onLayerModeChange,
}: VariantBProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredWorld, setHoveredWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoveredOverlayHit, setHoveredOverlayHit] = useState<OverlayHit | null>(null);
  const [hoveredTileCoord, setHoveredTileCoord] = useState<AxialCoord | null>(null);
  const [tileDragMove, setTileDragMove] = useState<DragMovePreview | null>(null);
  const [overlayDrag, setOverlayDrag] = useState<OverlayDragB | null>(null);
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

  const tileDragRef = useRef<{
    pointerId: number;
    from: AxialCoord;
    startClientX: number;
    startClientY: number;
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
    dropWorldX: number;
    dropWorldY: number;
    hoveredCoord: AxialCoord;
    isValidHost: boolean;
  } | null>(null);

  const suppressNextClickRef = useRef(false);

  const showTempNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2400);
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
      if (e.key === 'Alt') setAltPressed(true);
      if (e.code === 'Space' && !isEditableTarget(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(false);
      if (e.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => {
      setSpacePressed(false);
      setAltPressed(false);
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

  const selectedOvMatch = findOverlayOnHost(placements, selectedOverlay);
  const selectedHost = selectedHostCoord
    ? findProtoPlacementAt(placements, selectedHostCoord)
    : undefined;

  // Shift+MouseWheel spins selected Overlay or Overlay brush in Overlays mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey && layerMode === 'overlays') {
        const deltaDeg = e.deltaY > 0 ? 5 : -5;
        if (activeBrush?.kind === 'overlay') {
          onUpdateBrush((prev) =>
            prev && prev.kind === 'overlay'
              ? { ...prev, rotationDeg: normalizeDeg(prev.rotationDeg + deltaDeg) }
              : prev,
          );
          return;
        }
        if (selectedOvMatch) {
          onCommitPlacements(
            (prev) =>
              rotateOverlayByDelta(
                prev,
                selectedOvMatch.host,
                selectedOvMatch.overlay.id,
                deltaDeg,
              ),
            `Shift+Wheel rotated "${selectedOvMatch.overlay.label}" ${deltaDeg > 0 ? '+5°' : '-5°'}`,
          );
          return;
        }
      }

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
  }, [activeBrush, layerMode, onCameraChange, onCommitPlacements, onUpdateBrush, selectedOvMatch]);

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
      tileAlpha: layerMode === 'overlays' ? 0.88 : 1,
    });

    ctx.save();
    ctx.translate(size.width / 2, size.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Tile selection highlight in Tiles mode
    if (layerMode === 'tiles' && selectedHostCoord && !tileDragMove) {
      if (findProtoPlacementAt(placements, selectedHostCoord)) {
        drawHexOutline(
          ctx,
          selectedHostCoord,
          '#f59e0b',
          Math.max(3, 3.5 / camera.zoom),
        );
      }
    }

    if (layerMode === 'tiles' && !tileDragMove && hoveredTileCoord && !previewBrush) {
      drawHexOutline(ctx, hoveredTileCoord, 'rgba(255,255,255,0.25)', 1.5 / camera.zoom);
    }

    // Reparent target highlight during Overlay drag
    if (overlayDrag && overlayDrag.isValidHost && overlayDrag.reparenting) {
      drawHexOutline(
        ctx,
        overlayDrag.hoveredCoord,
        '#38bdf8',
        Math.max(2.5, 3 / camera.zoom),
        false,
        'rgba(56, 189, 248, 0.14)',
      );
    }

    // Global Overlays pass
    drawGlobalOverlaysPass({
      ctx,
      placements,
      imageCache,
      skipOverlayId: overlayDrag?.overlayId ?? null,
      dragMove: tileDragMove,
      defaultAlpha: layerMode === 'tiles' ? 0.72 : 1,
    });

    // Selected Overlay OBB (no protruding stem in Variant B)
    if (layerMode === 'overlays' && selectedOvMatch && !overlayDrag) {
      const img = imageCache.get(selectedOvMatch.overlay.url);
      const { width, height } = getOverlayWorldSize(img);
      const center = axialToWorld(selectedOvMatch.host.q, selectedOvMatch.host.r, HEX_RADIUS);
      const hostRad = (selectedOvMatch.host.rotation * Math.PI) / 3;
      const lx = selectedOvMatch.overlay.offsetX * HEX_RADIUS;
      const ly = selectedOvMatch.overlay.offsetY * HEX_RADIUS;
      const wx = center.x + lx * Math.cos(hostRad) - ly * Math.sin(hostRad);
      const wy = center.y + lx * Math.sin(hostRad) + ly * Math.cos(hostRad);
      const worldDeg = normalizeDeg(
        selectedOvMatch.host.rotation * 60 + selectedOvMatch.overlay.rotationDeg,
      );
      drawHostTether(ctx, selectedOvMatch.host, wx, wy, '#f59e0b', camera.zoom);
      drawOverlayOBB(
        ctx,
        wx,
        wy,
        width,
        height,
        (worldDeg * Math.PI) / 180,
        '#38bdf8',
        2 / camera.zoom,
      );
    }

    // Hover feedback in Overlays mode
    if (layerMode === 'overlays' && !overlayDrag && !previewBrush && hoveredOverlayHit) {
      drawOverlayOBB(
        ctx,
        hoveredOverlayHit.worldX,
        hoveredOverlayHit.worldY,
        hoveredOverlayHit.width,
        hoveredOverlayHit.height,
        hoveredOverlayHit.worldRad,
        'rgba(56, 189, 248, 0.7)',
        1.5 / camera.zoom,
        true,
      );
    }

    // Helper to draw 7-point snap dots on an occupied hex
    const drawSnapDots = (coord: AxialCoord, activeIdx: number | null) => {
      const pts = hexSnapPoints(coord);
      ctx.save();
      for (let i = 0; i < pts.length; i++) {
        const isHot = i === activeIdx;
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, (isHot ? 5.5 : 3.5) / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = isHot ? '#38bdf8' : 'rgba(248, 250, 252, 0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.lineWidth = 1.2 / camera.zoom;
        ctx.stroke();
      }
      ctx.restore();
    };

    // Active Overlay drag preview (shows revert warning on empty hex!)
    if (overlayDrag) {
      const img = imageCache.get(overlayDrag.url);
      if (overlayDrag.isValidHost) {
        drawSnapDots(overlayDrag.hoveredCoord, overlayDrag.activeSnapIndex);
        drawHostTether(
          ctx,
          overlayDrag.hoveredCoord,
          overlayDrag.worldX,
          overlayDrag.worldY,
          overlayDrag.reparenting ? '#38bdf8' : '#f59e0b',
          camera.zoom,
        );
        drawOverlayGhost(
          ctx,
          img,
          overlayDrag.worldX,
          overlayDrag.worldY,
          overlayDrag.worldRad,
          0.9,
          false,
          overlayDrag.label,
        );
        if (overlayDrag.reparenting) {
          drawWorldBadge(
            ctx,
            overlayDrag.worldX,
            overlayDrag.worldY - 52 / camera.zoom,
            `Move to host (${overlayDrag.hoveredCoord.q}, ${overlayDrag.hoveredCoord.r})`,
            'rgba(12, 74, 110, 0.95)',
            '#38bdf8',
            '#e0f2fe',
            camera.zoom,
          );
        }
      } else {
        drawInvalidEmptyHexFeedback(
          ctx,
          overlayDrag.hoveredCoord,
          camera.zoom,
          'Must drop on Tile (will revert)',
        );
        drawOverlayGhost(
          ctx,
          img,
          overlayDrag.worldX,
          overlayDrag.worldY,
          overlayDrag.worldRad,
          0.5,
          true,
          overlayDrag.label,
        );
      }
    }

    // Brush / Sidebar drag preview
    if (previewBrush && hoveredWorld) {
      const coord = worldToAxial(hoveredWorld.x, hoveredWorld.y, HEX_RADIUS);
      if (previewBrush.kind === 'tile') {
        const { x, y } = axialToWorld(coord.q, coord.r, HEX_RADIUS);
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
          ctx.drawImage(
            img,
            -HEX_RADIUS,
            -(Math.sqrt(3) * HEX_RADIUS) / 2,
            HEX_RADIUS * 2,
            Math.sqrt(3) * HEX_RADIUS,
          );
          ctx.restore();
        }
        drawHexOutline(ctx, coord, '#fbbf24', 2 / camera.zoom);
      } else {
        const host = findProtoPlacementAt(placements, coord);
        const img = imageCache.get(previewBrush.url);
        const rad = (previewBrush.rotationDeg * Math.PI) / 180;
        if (host) {
          const snapped = snapToHexAnchors(hoveredWorld.x, hoveredWorld.y, coord, altPressed);
          drawHexOutline(ctx, coord, '#38bdf8', 2 / camera.zoom);
          drawSnapDots(coord, snapped.snapIndex);
          drawOverlayGhost(ctx, img, snapped.x, snapped.y, rad, 0.72, false, previewBrush.label);
        } else {
          drawInvalidEmptyHexFeedback(ctx, coord, camera.zoom, 'No host Tile');
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
    }

    ctx.restore();
  }, [
    altPressed,
    camera,
    hoveredOverlayHit,
    hoveredTileCoord,
    hoveredWorld,
    imageCache,
    layerMode,
    overlayDrag,
    placements,
    previewBrush,
    renderTick,
    selectedHostCoord,
    selectedOvMatch,
    showGrid,
    showLabels,
    size.height,
    size.width,
    tileDragMove,
    tilesetsById,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handlePlaceOverlay = useCallback(
    (
      brush: Extract<ProtoBrush, { kind: 'overlay' }>,
      wx: number,
      wy: number,
      fromDrop: boolean,
    ) => {
      const coord = worldToAxial(wx, wy, HEX_RADIUS);
      const host = findProtoPlacementAt(placements, coord);
      if (!host) {
        const msg = `Blocked: "${brush.label}" needs an occupied host Tile`;
        showTempNotice(msg);
        onLogEvent(msg);
        return;
      }
      const snapped = snapToHexAnchors(wx, wy, coord, altPressed);
      const res = addOverlayAtWorld(placements, coord, brush, snapped.x, snapped.y);
      if (res.createdId) {
        onCommitPlacements(
          (prev) => addOverlayAtWorld(prev, coord, brush, snapped.x, snapped.y).placements,
          `Placed "${brush.label}" on (${coord.q}, ${coord.r})${snapped.snapIndex !== null ? ' (snapped)' : ''}`,
        );
        onSelectHostCoord(coord);
        onSelectOverlay({ hostCoord: coord, overlayId: res.createdId });
        if (fromDrop) {
          onSelectBrush(null);
        }
      }
    },
    [
      altPressed,
      onCommitPlacements,
      onLogEvent,
      onSelectBrush,
      onSelectHostCoord,
      onSelectOverlay,
      placements,
      showTempNotice,
    ],
  );

  const handlePlaceTile = useCallback(
    (brush: Extract<ProtoBrush, { kind: 'tile' }>, coord: AxialCoord, fromDrop: boolean) => {
      onCommitPlacements(
        (prev) => placeOrReplaceTile(prev, coord, brush),
        `Placed/replaced Tile #${String(brush.faceNumber).padStart(2, '0')} at (${coord.q}, ${coord.r})`,
      );
      if (fromDrop) {
        onSelectBrush(null);
        onSelectHostCoord(coord);
        onSelectOverlay(null);
      }
    },
    [onCommitPlacements, onSelectBrush, onSelectHostCoord, onSelectOverlay],
  );

  // Keyboard shortcuts: Tab toggles layer mode, R/Shift+R rotates active layer target, Del deletes active layer target
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('dialog[open]')) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const nextMode = layerMode === 'tiles' ? 'overlays' : 'tiles';
        onLayerModeChange(nextMode);
        onLogEvent(`Switched Edit Layer → ${nextMode === 'tiles' ? 'Tiles' : 'Overlays'}`);
        return;
      }

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
          onUpdateBrush((prev) =>
            prev && prev.kind === 'overlay'
              ? { ...prev, rotationDeg: normalizeDeg(prev.rotationDeg + dir * 15) }
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
        if (layerMode === 'overlays' && selectedOvMatch) {
          onCommitPlacements(
            (prev) =>
              rotateOverlayByDelta(prev, selectedOvMatch.host, selectedOvMatch.overlay.id, dir * 15),
            `Rotated "${selectedOvMatch.overlay.label}" ${dir > 0 ? '+15°' : '-15°'}`,
          );
        } else if (layerMode === 'tiles' && selectedHostCoord) {
          onCommitPlacements(
            (prev) => rotateHostTile(prev, selectedHostCoord, dir),
            `Rotated host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r}) ${dir > 0 ? '+60°' : '-60°'}`,
          );
        }
        return;
      }

      if (e.key.toLowerCase() === 'f' && layerMode === 'tiles' && selectedHostCoord) {
        e.preventDefault();
        onCommitPlacements(
          (prev) => flipHostTile(prev, selectedHostCoord, tilesets),
          `Flipped host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r})`,
        );
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (layerMode === 'overlays' && selectedOvMatch) {
          e.preventDefault();
          onCommitPlacements(
            (prev) => removeOverlay(prev, selectedOvMatch.host, selectedOvMatch.overlay.id),
            `Removed Overlay "${selectedOvMatch.overlay.label}"`,
          );
          onSelectOverlay(null);
        } else if (layerMode === 'tiles' && selectedHostCoord) {
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
    layerMode,
    onCommitPlacements,
    onLayerModeChange,
    onLogEvent,
    onSelectBrush,
    onSelectHostCoord,
    onSelectOverlay,
    onUpdateBrush,
    selectedHostCoord,
    selectedOvMatch,
    tilesets,
  ]);

  const scheduleClickSuppressionClear = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  // Screen position for floating inline stack pill (when an Overlay is selected on a host)
  const stackPillScreenPos = (() => {
    if (layerMode !== 'overlays' || !selectedOvMatch || overlayDrag || size.width <= 0) {
      return null;
    }
    const worldCenter = axialToWorld(selectedOvMatch.host.q, selectedOvMatch.host.r, HEX_RADIUS);
    const pt = worldToScreen(
      worldCenter.x,
      worldCenter.y - HEX_HEIGHT / 2 - 14 / camera.zoom,
      size.width,
      size.height,
      camera,
    );
    return {
      x: Math.max(150, Math.min(size.width - 150, pt.x)),
      y: Math.max(64, Math.min(size.height - 140, pt.y)),
    };
  })();

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : overlayDrag || tileDragMove
      ? 'cursor-grabbing'
      : spacePressed
        ? 'cursor-grab'
        : activeBrush
          ? 'cursor-crosshair'
          : layerMode === 'overlays' && hoveredOverlayHit
            ? 'cursor-pointer'
            : layerMode === 'tiles' && hoveredTileCoord && findProtoPlacementAt(placements, hoveredTileCoord)
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

          if (layerMode === 'tiles') {
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
          } else {
            const hits = hitTestOverlaysAtWorld(
              placements,
              world.x,
              world.y,
              imageCache,
              alphaCache,
            );
            if (hits.length > 0) {
              const preferred =
                selectedOverlay && hits.find((h) => h.overlay.id === selectedOverlay.overlayId);
              const pick = preferred ?? hits[0];
              e.currentTarget.setPointerCapture(e.pointerId);
              overlayDragRef.current = {
                pointerId: e.pointerId,
                fromHostCoord: pick.hostCoord,
                overlayId: pick.overlay.id,
                label: pick.overlay.label,
                url: pick.overlay.url,
                worldDeg: pick.worldDeg,
                worldRad: pick.worldRad,
                grabOffsetX: world.x - pick.worldX,
                grabOffsetY: world.y - pick.worldY,
                startClientX: e.clientX,
                startClientY: e.clientY,
                moved: false,
                dropWorldX: pick.worldX,
                dropWorldY: pick.worldY,
                hoveredCoord: pick.hostCoord,
                isValidHost: true,
              };
              return;
            }
          }

          // Bare Tile in Overlays mode OR empty space -> pan (or clear on click)
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

          const ovDrag = overlayDragRef.current;
          if (ovDrag && ovDrag.pointerId === e.pointerId) {
            const dx = e.clientX - ovDrag.startClientX;
            const dy = e.clientY - ovDrag.startClientY;
            if (!ovDrag.moved && Math.hypot(dx, dy) > 4) {
              ovDrag.moved = true;
            }
            if (ovDrag.moved) {
              const rawX = world.x - ovDrag.grabOffsetX;
              const rawY = world.y - ovDrag.grabOffsetY;
              const coord = worldToAxial(rawX, rawY, HEX_RADIUS);
              const occupied = Boolean(findProtoPlacementAt(placements, coord));
              ovDrag.hoveredCoord = coord;
              ovDrag.isValidHost = occupied;

              if (occupied) {
                const snapped = snapToHexAnchors(rawX, rawY, coord, e.altKey);
                ovDrag.dropWorldX = snapped.x;
                ovDrag.dropWorldY = snapped.y;
                setOverlayDrag({
                  fromHostCoord: ovDrag.fromHostCoord,
                  overlayId: ovDrag.overlayId,
                  label: ovDrag.label,
                  url: ovDrag.url,
                  worldX: snapped.x,
                  worldY: snapped.y,
                  worldDeg: ovDrag.worldDeg,
                  worldRad: ovDrag.worldRad,
                  hoveredCoord: coord,
                  isValidHost: true,
                  reparenting:
                    coord.q !== ovDrag.fromHostCoord.q || coord.r !== ovDrag.fromHostCoord.r,
                  activeSnapIndex: snapped.snapIndex,
                });
              } else {
                ovDrag.dropWorldX = rawX;
                ovDrag.dropWorldY = rawY;
                setOverlayDrag({
                  fromHostCoord: ovDrag.fromHostCoord,
                  overlayId: ovDrag.overlayId,
                  label: ovDrag.label,
                  url: ovDrag.url,
                  worldX: rawX,
                  worldY: rawY,
                  worldDeg: ovDrag.worldDeg,
                  worldRad: ovDrag.worldRad,
                  hoveredCoord: coord,
                  isValidHost: false,
                  reparenting: false,
                  activeSnapIndex: null,
                });
              }
            }
            return;
          }

          const tileDrag = tileDragRef.current;
          if (tileDrag && tileDrag.pointerId === e.pointerId) {
            const dx = e.clientX - tileDrag.startClientX;
            const dy = e.clientY - tileDrag.startClientY;
            if (!tileDrag.moved && Math.hypot(dx, dy) > 5) tileDrag.moved = true;
            const hoverCoord = worldToAxial(world.x, world.y, HEX_RADIUS);
            if (tileDrag.moved) {
              setTileDragMove({ from: tileDrag.from, to: hoverCoord });
            }
            return;
          }

          if (!activeBrush) {
            if (layerMode === 'overlays') {
              const hits = hitTestOverlaysAtWorld(
                placements,
                world.x,
                world.y,
                imageCache,
                alphaCache,
              );
              setHoveredOverlayHit(hits[0] ?? null);
              setHoveredTileCoord(null);
            } else {
              setHoveredOverlayHit(null);
              const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
              setHoveredTileCoord(findProtoPlacementAt(placements, coord) ? coord : null);
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
              if (layerMode === 'tiles') {
                onSelectHostCoord(null);
              }
            } else if (moved) {
              scheduleClickSuppressionClear();
            }
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
              if (!ovDrag.isValidHost) {
                const msg = `Must drop on an occupied Tile — reverted "${ovDrag.label}"`;
                showTempNotice(msg);
                onLogEvent(msg);
                return;
              }
              const target = ovDrag.hoveredCoord;
              const reparented =
                target.q !== ovDrag.fromHostCoord.q || target.r !== ovDrag.fromHostCoord.r;
              onCommitPlacements(
                (prev) =>
                  moveOrReparentOverlay(
                    prev,
                    ovDrag.fromHostCoord,
                    ovDrag.overlayId,
                    target,
                    ovDrag.dropWorldX,
                    ovDrag.dropWorldY,
                  ).placements,
                reparented
                  ? `Reparented "${ovDrag.label}" (${ovDrag.fromHostCoord.q},${ovDrag.fromHostCoord.r}) → (${target.q},${target.r})`
                  : `Moved "${ovDrag.label}" on (${target.q},${target.r})`,
              );
              onSelectHostCoord(target);
              onSelectOverlay({ hostCoord: target, overlayId: ovDrag.overlayId });
              return;
            }

            // Click selects Overlay and reveals inline host stack pill
            onSelectHostCoord(ovDrag.fromHostCoord);
            onSelectOverlay({ hostCoord: ovDrag.fromHostCoord, overlayId: ovDrag.overlayId });
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

            if (moved && target && (target.q !== from.q || target.r !== from.r)) {
              onCommitPlacements(
                (prev) => moveOrSwapHostTile(prev, from, target),
                `Moved/swapped host Tile (${from.q},${from.r}) → (${target.q},${target.r})`,
              );
              onSelectHostCoord(target);
            } else {
              onSelectHostCoord(from);
            }
          }
        }}
        onPointerCancel={() => {
          panStateRef.current = null;
          tileDragRef.current = null;
          overlayDragRef.current = null;
          setIsPanning(false);
          setTileDragMove(null);
          setOverlayDrag(null);
        }}
        onPointerLeave={() => {
          if (!panStateRef.current && !tileDragRef.current && !overlayDragRef.current) {
            setHoveredWorld(null);
            setHoveredOverlayHit(null);
            setHoveredTileCoord(null);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const world = clientToWorld(e.clientX, e.clientY);
          if (!world) return;
          if (layerMode === 'overlays') {
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
                `Removed Overlay "${top.overlay.label}" (Overlays mode)`,
              );
              if (selectedOverlay?.overlayId === top.overlay.id) {
                onSelectOverlay(null);
              }
            }
          } else {
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            if (findProtoPlacementAt(placements, coord)) {
              onCommitPlacements(
                (prev) => removeHostTile(prev, coord),
                `Removed host Tile (${coord.q}, ${coord.r}) (Tiles mode)`,
              );
              if (
                selectedHostCoord &&
                axialKey(selectedHostCoord.q, selectedHostCoord.r) === axialKey(coord.q, coord.r)
              ) {
                onSelectHostCoord(null);
              }
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
        onDragLeave={() => setHoveredWorld(null)}
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
            onLayerModeChange('overlays');
            handlePlaceOverlay(dropped, world.x, world.y, true);
          } else {
            onLayerModeChange('tiles');
            handlePlaceTile(dropped, worldToAxial(world.x, world.y, HEX_RADIUS), true);
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
            handlePlaceOverlay(activeBrush, world.x, world.y, false);
          } else {
            handlePlaceTile(activeBrush, worldToAxial(world.x, world.y, HEX_RADIUS), false);
          }
        }}
      />

      {/* Top-center Edit Layer segmented mode toggle */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1 text-xs shadow-xl backdrop-blur">
          <span className="pl-1 font-medium text-stone-400">Edit Layer:</span>
          <div className="flex rounded-full bg-[#1c1917] p-0.5">
            <button
              type="button"
              onClick={() => {
                onLayerModeChange('tiles');
                onSelectOverlay(null);
                onLogEvent('Switched Edit Layer → Tiles');
              }}
              className={`flex items-center gap-1 rounded-full px-3 py-1 font-semibold transition ${
                layerMode === 'tiles'
                  ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Tiles
            </button>
            <button
              type="button"
              onClick={() => {
                onLayerModeChange('overlays');
                onLogEvent('Switched Edit Layer → Overlays');
              }}
              className={`flex items-center gap-1 rounded-full px-3 py-1 font-semibold transition ${
                layerMode === 'overlays'
                  ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Overlays
            </button>
          </div>
          <span className="hidden pr-1 text-[11px] text-stone-500 sm:inline">
            <kbd className="rounded bg-stone-800 px-1">Tab</kbd> toggle ·{' '}
            <kbd className="rounded bg-stone-800 px-1">Alt</kbd> freeform ·{' '}
            <kbd className="rounded bg-stone-800 px-1">Shift+Wheel</kbd> spin
          </span>
        </div>
      </div>

      {notice && (
        <div className="pointer-events-none absolute top-14 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-500/50 bg-red-950/90 px-3.5 py-1.5 text-xs font-medium text-red-100 shadow-lg">
          {notice}
        </div>
      )}

      {/* Floating inline stack pill anchored above host hex */}
      {stackPillScreenPos && selectedOvMatch && (
        <div
          style={{ left: stackPillScreenPos.x, top: stackPillScreenPos.y }}
          className="pointer-events-auto absolute z-30 flex -translate-x-1/2 -translate-y-full flex-col gap-1 rounded-xl border border-sky-500/40 bg-[#161412]/95 p-1.5 text-xs shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between gap-3 px-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
            <span>
              Host ({selectedOvMatch.host.q},{selectedOvMatch.host.r}) Stack ({selectedOvMatch.host.overlays.length})
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {[...selectedOvMatch.host.overlays].reverse().map((ov, revIdx) => {
              const realIdx = selectedOvMatch.host.overlays.length - 1 - revIdx;
              const isSelected = ov.id === selectedOvMatch.overlay.id;
              return (
                <div
                  key={ov.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${
                    isSelected
                      ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                      : 'border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:border-stone-500'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSelectOverlay({
                        hostCoord: { q: selectedOvMatch.host.q, r: selectedOvMatch.host.r },
                        overlayId: ov.id,
                      })
                    }
                    className="flex flex-1 items-center gap-1.5 text-left"
                  >
                    <span className="font-mono text-[10px] text-stone-400">{realIdx + 1}:</span>
                    <span className="max-w-[140px] truncate font-medium">{ov.label}</span>
                  </button>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={realIdx === selectedOvMatch.host.overlays.length - 1}
                      onClick={() =>
                        onCommitPlacements(
                          (prev) => reorderOverlayZ(prev, selectedOvMatch.host, ov.id, 'up'),
                          `Brought "${ov.label}" forward`,
                        )
                      }
                      title="Bring forward"
                      className="rounded p-0.5 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={realIdx === 0}
                      onClick={() =>
                        onCommitPlacements(
                          (prev) => reorderOverlayZ(prev, selectedOvMatch.host, ov.id, 'down'),
                          `Sent "${ov.label}" backward`,
                        )
                      }
                      title="Send backward"
                      className="rounded p-0.5 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom floating action bar (clears PrototypeSwitcher at bottom-16) */}
      {(selectedOvMatch || (layerMode === 'tiles' && selectedHost) || activeBrush) && (
        <div className="pointer-events-none absolute inset-x-3 bottom-16 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur">
            {layerMode === 'overlays' && selectedOvMatch && !activeBrush && (
              <>
                <span className="max-w-[160px] truncate font-semibold text-sky-300">
                  {selectedOvMatch.overlay.shortCode} {selectedOvMatch.overlay.label}
                </span>

                {/* Continuous 0-359 scrubber slider */}
                <label className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={Math.round(selectedOvMatch.overlay.rotationDeg)}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onCommitPlacements(
                        (prev) =>
                          setOverlayLocalRotation(
                            prev,
                            selectedOvMatch.host,
                            selectedOvMatch.overlay.id,
                            val,
                          ),
                        `Scrubbed "${selectedOvMatch.overlay.label}" to ${val}°`,
                      );
                    }}
                    className="h-1.5 w-28 accent-sky-400"
                  />
                  <span className="w-9 font-mono text-[11px] text-stone-200">
                    {Math.round(selectedOvMatch.overlay.rotationDeg)}°
                  </span>
                </label>

                {/* Quick 60-degree hex facing pills */}
                <div className="flex items-center gap-0.5">
                  {[0, 60, 120, 180, 240, 300].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() =>
                        onCommitPlacements(
                          (prev) =>
                            setOverlayLocalRotation(
                              prev,
                              selectedOvMatch.host,
                              selectedOvMatch.overlay.id,
                              deg,
                            ),
                          `Aligned "${selectedOvMatch.overlay.label}" to ${deg}°`,
                        )
                      }
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                        Math.round(selectedOvMatch.overlay.rotationDeg) === deg
                          ? 'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400/60'
                          : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>

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

            {layerMode === 'tiles' && selectedHost && !activeBrush && (
              <>
                <span className="font-mono font-semibold text-amber-300">
                  {formatAssemblyLabel(selectedHost, tilesetsById)} ({selectedHost.q},{selectedHost.r})
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {selectedHost.rotation * 60}° · {selectedHost.overlays.length} Overlays travel
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
                  Remove
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
                    ? `${activeBrush.shortCode} ${activeBrush.label} (${Math.round(activeBrush.rotationDeg)}°)`
                    : `Tile #${String(activeBrush.faceNumber).padStart(2, '0')} (${activeBrush.rotation * 60}°)`}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectBrush(null)}
                  className="rounded border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-300 hover:text-white"
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
