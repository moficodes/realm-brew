// THROWAWAY PROTOTYPE VARIANT C for Wayfinder #13
// Variant C: Host-Tile Inspector & Stack Drawer (persistent right-side Inspector, two-tier host+child selection, minimal radial dial ring, disambiguated right-click menu)

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FlipHorizontal2,
  Layers,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragMovePreview } from '../canvas/mapRenderer';
import {
  HEX_RADIUS,
  axialKey,
  axialToWorld,
  screenToWorld,
  worldToAxial,
  zoomCameraAtScreenPoint,
} from '../domain/hexGeometry';
import {
  canFlipTarget,
  formatAssemblyLabel,
  resolvePlacementAsset,
} from '../domain/plannerEngine';
import type { AxialCoord, RotationStep } from '../domain/types';
import { isEditableTarget } from '../utils/browserHelpers';
import {
  addOverlayAtWorld,
  centerOverlayOnHost,
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
  setOverlayLocalRotation,
  setOverlayWorldRotation,
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

interface OverlayDragC {
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

interface RadialRotatePreview {
  hostCoord: AxialCoord;
  overlayId: string;
  label: string;
  worldDeg: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  coord: AxialCoord;
  overlayCount: number;
  hitOverlay: OverlayHit | null;
}

export function VariantC({
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
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredWorld, setHoveredWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoveredOverlayHit, setHoveredOverlayHit] = useState<OverlayHit | null>(null);
  const [hoveredInspectorOverlayId, setHoveredInspectorOverlayId] = useState<string | null>(null);
  const [tileDragMove, setTileDragMove] = useState<DragMovePreview | null>(null);
  const [overlayDrag, setOverlayDrag] = useState<OverlayDragC | null>(null);
  const [radialRotate, setRadialRotate] = useState<RadialRotatePreview | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

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
  } | null>(null);

  const tileDragRef = useRef<{
    pointerId: number;
    from: AxialCoord;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  const dialDragRef = useRef<{
    pointerId: number;
    hostCoord: AxialCoord;
    overlayId: string;
    label: string;
    centerX: number;
    centerY: number;
    worldDeg: number;
  } | null>(null);

  const suppressNextClickRef = useRef(false);

  const showTempNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2200);
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
      if (e.code === 'Space' && !isEditableTarget(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => setSpacePressed(false);
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

  const getRadialDialWorld = useCallback(() => {
    const match = findOverlayOnHost(placements, selectedOverlay);
    if (!match) return null;
    const t = overlayLocalToWorld(match.host, match.overlay);
    const worldDeg =
      radialRotate && radialRotate.overlayId === match.overlay.id
        ? radialRotate.worldDeg
        : t.worldDeg;
    const worldRad = (worldDeg * Math.PI) / 180;
    const img = imageCache.get(match.overlay.url);
    const { width, height } = getOverlayWorldSize(img);
    const ringRadius = Math.max(36, Math.min(82, Math.hypot(width, height) * 0.44));
    // Knob sits at local up (-PI/2 rotated by worldRad)
    const knobAngle = worldRad - Math.PI / 2;
    return {
      host: match.host,
      overlay: match.overlay,
      wx: t.x,
      wy: t.y,
      width,
      height,
      worldDeg,
      worldRad,
      ringRadius,
      knobX: t.x + ringRadius * Math.cos(knobAngle),
      knobY: t.y + ringRadius * Math.sin(knobAngle),
    };
  }, [imageCache, placements, radialRotate, selectedOverlay]);

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
    ctx.translate(size.width / 2, size.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Always draw amber outline around selected Host Tile
    if (selectedHostCoord && !tileDragMove && findProtoPlacementAt(placements, selectedHostCoord)) {
      drawHexOutline(
        ctx,
        selectedHostCoord,
        '#f59e0b',
        Math.max(3, 3.5 / camera.zoom),
        false,
        'rgba(245, 158, 11, 0.08)',
      );
    }

    // Emerald reparent target highlight when dragging Overlay to another occupied hex
    if (overlayDrag && overlayDrag.reparenting) {
      drawHexOutline(
        ctx,
        overlayDrag.targetHostCoord,
        '#10b981',
        Math.max(2.5, 3 / camera.zoom),
        false,
        'rgba(16, 185, 129, 0.14)',
      );
    }

    drawGlobalOverlaysPass({
      ctx,
      placements,
      imageCache,
      skipOverlayId: overlayDrag?.overlayId ?? (radialRotate ? radialRotate.overlayId : null),
      dragMove: tileDragMove,
    });

    if (radialRotate) {
      const match = findOverlayOnHost(placements, {
        hostCoord: radialRotate.hostCoord,
        overlayId: radialRotate.overlayId,
      });
      if (match) {
        const img = imageCache.get(match.overlay.url);
        const t = overlayLocalToWorld(match.host, match.overlay);
        const rad = (radialRotate.worldDeg * Math.PI) / 180;
        const { width, height } = getOverlayWorldSize(img);
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(rad);
        if (img) ctx.drawImage(img, -width / 2, -height / 2, width, height);
        ctx.restore();
      }
    }

    // Highlight Overlay hovered in the right-side Inspector or directly on canvas
    const inspectorHoverId = hoveredInspectorOverlayId;
    if (inspectorHoverId) {
      for (const host of placements) {
        const ov = host.overlays.find((o) => o.id === inspectorHoverId);
        if (ov) {
          const t = overlayLocalToWorld(host, ov);
          const { width, height } = getOverlayWorldSize(imageCache.get(ov.url));
          drawOverlayOBB(
            ctx,
            t.x,
            t.y,
            width,
            height,
            t.worldRad,
            '#fbbf24',
            2 / camera.zoom,
            true,
          );
          break;
        }
      }
    } else if (!overlayDrag && !radialRotate && !previewBrush && hoveredOverlayHit) {
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

    // Minimal radial dial ring around focused Overlay
    if (!overlayDrag && !tileDragMove) {
      const dial = getRadialDialWorld();
      if (dial) {
        drawHostTether(ctx, dial.host, dial.wx, dial.wy, '#f59e0b', camera.zoom);
        drawOverlayOBB(
          ctx,
          dial.wx,
          dial.wy,
          dial.width,
          dial.height,
          dial.worldRad,
          '#38bdf8',
          1.75 / camera.zoom,
        );

        ctx.save();
        ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.beginPath();
        ctx.arc(dial.wx, dial.wy, dial.ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(dial.knobX, dial.knobY, 6 / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#0ea5e9';
        ctx.fill();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.stroke();
        ctx.restore();

        if (radialRotate) {
          drawWorldBadge(
            ctx,
            dial.knobX,
            dial.knobY - 18 / camera.zoom,
            `${Math.round(radialRotate.worldDeg)}°`,
            'rgba(12, 74, 110, 0.95)',
            '#38bdf8',
            '#e0f2fe',
            camera.zoom,
          );
        }
      }
    }

    // Active Overlay drag preview
    if (overlayDrag) {
      const img = imageCache.get(overlayDrag.url);
      const { width, height } = getOverlayWorldSize(img);
      ctx.save();
      ctx.translate(overlayDrag.worldX, overlayDrag.worldY);
      ctx.rotate(overlayDrag.worldRad);
      if (img) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
      }
      ctx.restore();

      drawHostTether(
        ctx,
        overlayDrag.targetHostCoord,
        overlayDrag.worldX,
        overlayDrag.worldY,
        overlayDrag.reparenting ? '#10b981' : '#f59e0b',
        camera.zoom,
      );
      drawOverlayOBB(
        ctx,
        overlayDrag.worldX,
        overlayDrag.worldY,
        width,
        height,
        overlayDrag.worldRad,
        overlayDrag.reparenting ? '#10b981' : '#38bdf8',
        2 / camera.zoom,
      );
      if (overlayDrag.reparenting) {
        drawWorldBadge(
          ctx,
          overlayDrag.worldX,
          overlayDrag.worldY - height / 2 - 18 / camera.zoom,
          `Reparent to (${overlayDrag.targetHostCoord.q}, ${overlayDrag.targetHostCoord.r})`,
          'rgba(6, 78, 59, 0.95)',
          '#10b981',
          '#d1fae5',
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
          const clamped = clampWorldPointToHex(hoveredWorld.x, hoveredWorld.y, coord);
          drawHexOutline(ctx, coord, '#38bdf8', 2 / camera.zoom);
          drawOverlayGhost(ctx, img, clamped.x, clamped.y, rad, 0.72, false, previewBrush.label);
        } else {
          drawInvalidEmptyHexFeedback(ctx, coord, camera.zoom, 'Place a Tile first');
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
    camera,
    getRadialDialWorld,
    hoveredInspectorOverlayId,
    hoveredOverlayHit,
    hoveredWorld,
    imageCache,
    overlayDrag,
    placements,
    previewBrush,
    radialRotate,
    renderTick,
    selectedHostCoord,
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
        const msg = `Blocked: Place a Tile at (${coord.q}, ${coord.r}) first`;
        showTempNotice(msg);
        onLogEvent(msg);
        return;
      }
      const res = addOverlayAtWorld(placements, coord, brush, wx, wy);
      if (res.createdId) {
        onCommitPlacements(
          (prev) => addOverlayAtWorld(prev, coord, brush, wx, wy).placements,
          `Placed "${brush.label}" on host (${coord.q}, ${coord.r})`,
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
      showTempNotice,
    ],
  );

  const handlePlaceTile = useCallback(
    (brush: Extract<ProtoBrush, { kind: 'tile' }>, coord: AxialCoord, fromDrop: boolean) => {
      onCommitPlacements(
        (prev) => placeOrReplaceTile(prev, coord, brush),
        `Placed/replaced Tile #${String(brush.faceNumber).padStart(2, '0')} at (${coord.q}, ${coord.r})`,
      );
      onSelectHostCoord(coord);
      onSelectOverlay(null);
      if (fromDrop) {
        onSelectBrush(null);
      }
    },
    [onCommitPlacements, onSelectBrush, onSelectHostCoord, onSelectOverlay],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('dialog[open]')) return;

      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else if (activeBrush) {
          onSelectBrush(null);
        } else if (selectedOverlay) {
          onSelectOverlay(null);
        } else {
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
        const ovMatch = findOverlayOnHost(placements, selectedOverlay);
        if (ovMatch) {
          onCommitPlacements(
            (prev) =>
              rotateOverlayByDelta(prev, ovMatch.host, ovMatch.overlay.id, dir * 15),
            `Rotated "${ovMatch.overlay.label}" ${dir > 0 ? '+15°' : '-15°'}`,
          );
        } else if (selectedHostCoord) {
          onCommitPlacements(
            (prev) => rotateHostTile(prev, selectedHostCoord, dir),
            `Rotated host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r}) ${dir > 0 ? '+60°' : '-60°'}`,
          );
        }
        return;
      }

      if (e.key.toLowerCase() === 'f' && selectedHostCoord && !selectedOverlay) {
        e.preventDefault();
        onCommitPlacements(
          (prev) => flipHostTile(prev, selectedHostCoord, tilesets),
          `Flipped host Tile (${selectedHostCoord.q}, ${selectedHostCoord.r})`,
        );
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ovMatch = findOverlayOnHost(placements, selectedOverlay);
        if (ovMatch) {
          e.preventDefault();
          onCommitPlacements(
            (prev) => removeOverlay(prev, ovMatch.host, ovMatch.overlay.id),
            `Removed Overlay "${ovMatch.overlay.label}"`,
          );
          onSelectOverlay(null);
        } else if (selectedHostCoord) {
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
    contextMenu,
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

  const selectedHost = selectedHostCoord
    ? findProtoPlacementAt(placements, selectedHostCoord)
    : undefined;
  const selectedOvMatch = findOverlayOnHost(placements, selectedOverlay);

  const scheduleClickSuppressionClear = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : overlayDrag || tileDragMove || radialRotate
      ? 'cursor-grabbing'
      : spacePressed
        ? 'cursor-grab'
        : activeBrush
          ? 'cursor-crosshair'
          : hoveredOverlayHit
            ? 'cursor-pointer'
            : 'cursor-default';

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div ref={containerRef} className="relative h-full min-w-0 flex-1 overflow-hidden bg-[#221f1c]">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full ${cursorClass}`}
          onPointerDown={(e) => {
            if (contextMenu) setContextMenu(null);

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

            // 1. Check minimal radial dial knob
            const dial = getRadialDialWorld();
            if (dial) {
              const dist = Math.hypot(world.x - dial.knobX, world.y - dial.knobY);
              if (dist <= Math.max(11 / cameraRef.current.zoom, 9)) {
                e.currentTarget.setPointerCapture(e.pointerId);
                dialDragRef.current = {
                  pointerId: e.pointerId,
                  hostCoord: { q: dial.host.q, r: dial.host.r },
                  overlayId: dial.overlay.id,
                  label: dial.overlay.label,
                  centerX: dial.wx,
                  centerY: dial.wy,
                  worldDeg: dial.worldDeg,
                };
                setRadialRotate({
                  hostCoord: { q: dial.host.q, r: dial.host.r },
                  overlayId: dial.overlay.id,
                  label: dial.overlay.label,
                  worldDeg: dial.worldDeg,
                });
                return;
              }
            }

            // 2. Hit-test Overlays
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
                lastValidHostCoord: pick.hostCoord,
                lastValidWorldX: pick.worldX,
                lastValidWorldY: pick.worldY,
              };
              return;
            }

            // 3. Bare Tile space -> host Tile drag candidate
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            if (findProtoPlacementAt(placements, coord)) {
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

            // 4. Empty space -> pan
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

            const dialDrag = dialDragRef.current;
            if (dialDrag && dialDrag.pointerId === e.pointerId) {
              let deg =
                (Math.atan2(world.y - dialDrag.centerY, world.x - dialDrag.centerX) * 180) /
                  Math.PI +
                90;
              deg = normalizeDeg(deg);
              if (e.shiftKey) {
                deg = normalizeDeg(Math.round(deg / 15) * 15);
              }
              dialDrag.worldDeg = deg;
              setRadialRotate({
                hostCoord: dialDrag.hostCoord,
                overlayId: dialDrag.overlayId,
                label: dialDrag.label,
                worldDeg: deg,
              });
              return;
            }

            const ovDrag = overlayDragRef.current;
            if (ovDrag && ovDrag.pointerId === e.pointerId) {
              const dx = e.clientX - ovDrag.startClientX;
              const dy = e.clientY - ovDrag.startClientY;
              if (!ovDrag.moved && Math.hypot(dx, dy) > 4) ovDrag.moved = true;
              if (ovDrag.moved) {
                const rawX = world.x - ovDrag.grabOffsetX;
                const rawY = world.y - ovDrag.grabOffsetY;
                const hoverCoord = worldToAxial(rawX, rawY, HEX_RADIUS);
                const occupied = findProtoPlacementAt(placements, hoverCoord);
                let validCoord = ovDrag.lastValidHostCoord;
                let emptyCoord: AxialCoord | null = null;
                if (occupied) {
                  validCoord = hoverCoord;
                  ovDrag.lastValidHostCoord = hoverCoord;
                } else {
                  emptyCoord = hoverCoord;
                }
                const clamped = clampWorldPointToHex(rawX, rawY, validCoord);
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
              if (!tileDrag.moved && Math.hypot(dx, dy) > 5) tileDrag.moved = true;
              const hoverCoord = worldToAxial(world.x, world.y, HEX_RADIUS);
              if (tileDrag.moved) {
                setTileDragMove({ from: tileDrag.from, to: hoverCoord });
              }
              return;
            }

            if (!activeBrush) {
              const hits = hitTestOverlaysAtWorld(
                placements,
                world.x,
                world.y,
                imageCache,
                alphaCache,
              );
              setHoveredOverlayHit(hits[0] ?? null);
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

            const dialDrag = dialDragRef.current;
            if (dialDrag && dialDrag.pointerId === e.pointerId) {
              dialDragRef.current = null;
              setRadialRotate(null);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              scheduleClickSuppressionClear();
              onCommitPlacements(
                (prev) =>
                  setOverlayWorldRotation(
                    prev,
                    dialDrag.hostCoord,
                    dialDrag.overlayId,
                    dialDrag.worldDeg,
                  ),
                `Rotated "${dialDrag.label}" to ${Math.round(dialDrag.worldDeg)}° world`,
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
                    : `Moved "${ovDrag.label}" within host (${target.q},${target.r})`,
                );
                onSelectHostCoord(target);
                onSelectOverlay({ hostCoord: target, overlayId: ovDrag.overlayId });
              } else {
                // Two-tier selection: select host Tile AND focus hit Overlay child
                onSelectHostCoord(ovDrag.fromHostCoord);
                onSelectOverlay({ hostCoord: ovDrag.fromHostCoord, overlayId: ovDrag.overlayId });
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

              if (moved && target && (target.q !== from.q || target.r !== from.r)) {
                onCommitPlacements(
                  (prev) => moveOrSwapHostTile(prev, from, target),
                  `Moved/swapped host Tile (${from.q},${from.r}) → (${target.q},${target.r})`,
                );
                onSelectHostCoord(target);
                onSelectOverlay(null);
              } else {
                onSelectHostCoord(from);
                onSelectOverlay(null);
              }
            }
          }}
          onPointerCancel={() => {
            panStateRef.current = null;
            overlayDragRef.current = null;
            tileDragRef.current = null;
            dialDragRef.current = null;
            setIsPanning(false);
            setOverlayDrag(null);
            setTileDragMove(null);
            setRadialRotate(null);
          }}
          onPointerLeave={() => {
            if (!panStateRef.current && !overlayDragRef.current && !tileDragRef.current) {
              setHoveredWorld(null);
              setHoveredOverlayHit(null);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const world = clientToWorld(e.clientX, e.clientY);
            const container = containerRef.current;
            if (!world || !container) return;
            const rect = container.getBoundingClientRect();
            const hits = hitTestOverlaysAtWorld(
              placements,
              world.x,
              world.y,
              imageCache,
              alphaCache,
            );
            const coord = hits[0]?.hostCoord ?? worldToAxial(world.x, world.y, HEX_RADIUS);
            const host = findProtoPlacementAt(placements, coord);
            if (!host) {
              setContextMenu(null);
              return;
            }
            setContextMenu({
              x: Math.min(rect.width - 210, Math.max(8, e.clientX - rect.left)),
              y: Math.min(rect.height - 140, Math.max(8, e.clientY - rect.top)),
              coord,
              overlayCount: host.overlays.length,
              hitOverlay: hits[0] ?? null,
            });
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
              handlePlaceOverlay(dropped, world.x, world.y, true);
            } else {
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

        {notice && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-500/50 bg-red-950/90 px-3.5 py-1.5 text-xs font-medium text-red-100 shadow-lg">
            {notice}
          </div>
        )}

        {/* Disambiguated Right-Click Context Menu */}
        {contextMenu && (
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="absolute z-50 w-52 rounded-lg border border-[#2e2a26] bg-[#161412]/98 p-1 text-xs shadow-2xl backdrop-blur"
          >
            {contextMenu.hitOverlay && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const hit = contextMenu.hitOverlay!;
                    onSelectHostCoord(hit.hostCoord);
                    onSelectOverlay({ hostCoord: hit.hostCoord, overlayId: hit.overlay.id });
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sky-200 hover:bg-sky-500/15"
                >
                  <Crosshair className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Focus "{contextMenu.hitOverlay.overlay.label}"</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const hit = contextMenu.hitOverlay!;
                    onCommitPlacements(
                      (prev) => removeOverlay(prev, hit.hostCoord, hit.overlay.id),
                      `Context-menu deleted Overlay "${hit.overlay.label}"`,
                    );
                    if (selectedOverlay?.overlayId === hit.overlay.id) {
                      onSelectOverlay(null);
                    }
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-red-300 hover:bg-red-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Delete "{contextMenu.hitOverlay.overlay.label}"</span>
                </button>
                <div className="my-1 border-t border-[#2e2a26]" />
              </>
            )}

            <button
              type="button"
              onClick={() => {
                onSelectHostCoord(contextMenu.coord);
                onSelectOverlay(null);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-amber-200 hover:bg-amber-500/15"
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>
                Select Host Tile ({contextMenu.coord.q}, {contextMenu.coord.r})
              </span>
            </button>

            <div className="my-1 border-t border-[#2e2a26]" />

            <button
              type="button"
              onClick={() => {
                const coord = contextMenu.coord;
                onCommitPlacements(
                  (prev) => removeHostTile(prev, coord),
                  `Deleted host Tile (${coord.q}, ${coord.r}) & ${contextMenu.overlayCount} Overlays`,
                );
                if (
                  selectedHostCoord &&
                  axialKey(selectedHostCoord.q, selectedHostCoord.r) === axialKey(coord.q, coord.r)
                ) {
                  onSelectHostCoord(null);
                  onSelectOverlay(null);
                }
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-red-300 hover:bg-red-950/60"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Delete Host Tile
                {contextMenu.overlayCount > 0
                  ? ` & ${contextMenu.overlayCount} Overlays`
                  : ''}
              </span>
            </button>
          </div>
        )}

        {/* Compact floating quick-action bar when Host Inspector is collapsed */}
        {inspectorCollapsed && (selectedOvMatch || selectedHost || activeBrush) && (
          <div className="pointer-events-none absolute inset-x-3 bottom-16 flex justify-center">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
              {selectedOvMatch && !activeBrush && (
                <>
                  <span className="max-w-[160px] truncate font-semibold text-sky-300">
                    {selectedOvMatch.overlay.shortCode} {selectedOvMatch.overlay.label}
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
                    {formatAssemblyLabel(selectedHost, tilesetsById)} ({selectedHost.q},
                    {selectedHost.r})
                  </span>
                  <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                    {selectedHost.rotation * 60}°
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

              <button
                type="button"
                onClick={() => setInspectorCollapsed(false)}
                className="ml-0.5 flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-amber-200 hover:bg-amber-500/25"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Inspector
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right-side collapsible Host Inspector Panel (288px expanded, 44px collapsed rail) */}
      {inspectorCollapsed ? (
        <aside className="flex h-full w-11 shrink-0 flex-col items-center border-l border-[#2e2a26] bg-[#161412] py-2">
          <button
            type="button"
            onClick={() => setInspectorCollapsed(false)}
            title="Expand Host Inspector"
            aria-label="Expand Host Inspector"
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="mt-4 flex flex-col items-center gap-2 text-stone-500">
            <Layers className="h-4 w-4 text-amber-400/80" />
            <span className="[writing-mode:vertical-rl] text-[11px] font-medium tracking-wider uppercase">
              Inspector
            </span>
          </div>
          {selectedHost && (
            <button
              type="button"
              onClick={() => setInspectorCollapsed(false)}
              title={`Selected host (${selectedHost.q}, ${selectedHost.r}) · ${selectedHost.overlays.length} Overlays`}
              className="mt-3 rounded-full border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-200 hover:bg-sky-500/25"
            >
              {selectedHost.overlays.length}
            </button>
          )}
        </aside>
      ) : (
      <aside className="flex h-full w-72 shrink-0 flex-col border-l border-[#2e2a26] bg-[#161412]">
        <div className="flex items-center justify-between border-b border-[#2e2a26] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-stone-100">Host Inspector</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {selectedHost && (
              <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
                ({selectedHost.q}, {selectedHost.r})
              </span>
            )}
            <button
              type="button"
              onClick={() => setInspectorCollapsed(true)}
              title="Collapse Host Inspector"
              aria-label="Collapse Host Inspector"
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="rb-scroll flex-1 overflow-y-auto p-3">
          {!selectedHost ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-3 text-xs text-stone-400">
                Click any placed Tile to inspect its facing, attached Overlays, and stacking order.
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
                  Placed Tiles ({placements.length})
                </div>
                {placements.map((p) => (
                  <button
                    key={axialKey(p.q, p.r)}
                    type="button"
                    onClick={() => {
                      onSelectHostCoord({ q: p.q, r: p.r });
                      onSelectOverlay(null);
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-[#2e2a26] bg-[#1c1917] px-2.5 py-2 text-left text-xs transition hover:border-amber-500/50"
                  >
                    <span className="font-mono font-semibold text-amber-300">
                      {formatAssemblyLabel(p, tilesetsById)}{' '}
                      <span className="text-stone-500">
                        ({p.q},{p.r})
                      </span>
                    </span>
                    <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-300">
                      {p.overlays.length} Overlays
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Host Tile Summary Card */}
              <div className="rounded-lg border border-amber-500/30 bg-[#1c1917] p-2.5">
                <div className="flex items-center gap-2.5">
                  {(() => {
                    const asset = resolvePlacementAsset(selectedHost, tilesetsById);
                    return asset.status === 'ok' ? (
                      <img
                        src={asset.url}
                        alt={formatAssemblyLabel(selectedHost, tilesetsById)}
                        className="h-12 w-12 shrink-0 rounded border border-[#2e2a26] bg-[#221f1c] object-contain p-0.5"
                        style={{ transform: `rotate(${selectedHost.rotation * 60}deg)` }}
                      />
                    ) : null;
                  })()}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold text-amber-300">
                      {formatAssemblyLabel(selectedHost, tilesetsById)}
                    </div>
                    <div className="text-[11px] text-stone-400">
                      Rotation: {selectedHost.rotation * 60}° · {selectedHost.overlays.length} Overlays
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-4 gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      onCommitPlacements(
                        (prev) => rotateHostTile(prev, selectedHost, -1),
                        `Rotated host Tile (${selectedHost.q},${selectedHost.r}) -60°`,
                      )
                    }
                    className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
                  >
                    <RotateCcw className="h-3 w-3" />
                    60°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onCommitPlacements(
                        (prev) => rotateHostTile(prev, selectedHost, 1),
                        `Rotated host Tile (${selectedHost.q},${selectedHost.r}) +60°`,
                      )
                    }
                    className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
                  >
                    <RotateCw className="h-3 w-3" />
                    60°
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
                    className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800 disabled:opacity-40"
                  >
                    <FlipHorizontal2 className="h-3 w-3" />
                    Flip
                  </button>
                  <button
                    type="button"
                    title="Remove Host Tile & its Overlays"
                    onClick={() => {
                      onCommitPlacements(
                        (prev) => removeHostTile(prev, selectedHost),
                        `Removed host Tile (${selectedHost.q},${selectedHost.r})`,
                      );
                      onSelectHostCoord(null);
                      onSelectOverlay(null);
                    }}
                    className="flex items-center justify-center rounded border border-red-500/30 bg-red-950/50 py-1 text-red-200 hover:bg-red-900/60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Attached Overlays Stack List (top-to-bottom) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                  <span>Attached Overlays ({selectedHost.overlays.length})</span>
                  {selectedOverlay && (
                    <button
                      type="button"
                      onClick={() => onSelectOverlay(null)}
                      className="text-[10px] font-medium text-stone-400 normal-case hover:text-stone-100"
                    >
                      Focus Tile
                    </button>
                  )}
                </div>

                {selectedHost.overlays.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#2e2a26] p-3 text-center text-xs text-stone-500">
                    No Overlays attached. Pick one from the left Palette and click or drop on this Tile.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...selectedHost.overlays].reverse().map((ov, revIdx) => {
                      const realIdx = selectedHost.overlays.length - 1 - revIdx;
                      const isFocused = selectedOverlay?.overlayId === ov.id;
                      return (
                        <div
                          key={ov.id}
                          onMouseEnter={() => setHoveredInspectorOverlayId(ov.id)}
                          onMouseLeave={() => setHoveredInspectorOverlayId(null)}
                          className={`flex items-center gap-2 rounded-lg border p-1.5 transition ${
                            isFocused
                              ? 'border-sky-400 bg-sky-500/15'
                              : 'border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onSelectOverlay({
                                hostCoord: { q: selectedHost.q, r: selectedHost.r },
                                overlayId: ov.id,
                              })
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <img
                              src={ov.url}
                              alt={ov.label}
                              className="h-9 w-9 shrink-0 rounded border border-[#2e2a26] bg-[#221f1c] object-contain p-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-stone-100">
                                {ov.label}
                              </div>
                              <div className="font-mono text-[10px] text-stone-400">
                                z {realIdx + 1} · {Math.round(ov.rotationDeg)}°
                              </div>
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              disabled={realIdx === selectedHost.overlays.length - 1}
                              onClick={() =>
                                onCommitPlacements(
                                  (prev) => reorderOverlayZ(prev, selectedHost, ov.id, 'up'),
                                  `Brought "${ov.label}" forward`,
                                )
                              }
                              title="Bring Forward"
                              className="rounded p-1 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={realIdx === 0}
                              onClick={() =>
                                onCommitPlacements(
                                  (prev) => reorderOverlayZ(prev, selectedHost, ov.id, 'down'),
                                  `Sent "${ov.label}" backward`,
                                )
                              }
                              title="Send Backward"
                              className="rounded p-1 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onCommitPlacements(
                                  (prev) => removeOverlay(prev, selectedHost, ov.id),
                                  `Removed Overlay "${ov.label}"`,
                                );
                                if (selectedOverlay?.overlayId === ov.id) {
                                  onSelectOverlay(null);
                                }
                              }}
                              title="Remove Overlay"
                              className="rounded p-1 text-red-300 hover:bg-red-950/60"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Focused Overlay Precision Controls */}
              {selectedOvMatch && (
                <div className="space-y-2.5 rounded-lg border border-sky-500/35 bg-[#1c1917] p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-sky-300">
                      {selectedOvMatch.overlay.label}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onCommitPlacements(
                          (prev) =>
                            centerOverlayOnHost(
                              prev,
                              selectedOvMatch.host,
                              selectedOvMatch.overlay.id,
                            ),
                          `Centered "${selectedOvMatch.overlay.label}" on host`,
                        )
                      }
                      className="shrink-0 rounded border border-[#2e2a26] bg-[#161412] px-2 py-0.5 text-[11px] text-stone-200 hover:bg-stone-800"
                    >
                      Center on Tile
                    </button>
                  </div>

                  <div className="grid grid-cols-5 gap-1 font-mono text-[11px]">
                    {[-60, -15, 0, 15, 60].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          onCommitPlacements(
                            (prev) =>
                              val === 0
                                ? setOverlayLocalRotation(
                                    prev,
                                    selectedOvMatch.host,
                                    selectedOvMatch.overlay.id,
                                    0,
                                  )
                                : rotateOverlayByDelta(
                                    prev,
                                    selectedOvMatch.host,
                                    selectedOvMatch.overlay.id,
                                    val,
                                  ),
                            val === 0
                              ? `Reset "${selectedOvMatch.overlay.label}" angle to 0°`
                              : `Rotated "${selectedOvMatch.overlay.label}" ${val > 0 ? `+${val}` : val}°`,
                          )
                        }
                        className="rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
                      >
                        {val === 0 ? '0°' : val > 0 ? `+${val}` : val}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={Math.round(selectedOvMatch.overlay.rotationDeg)}
                      onChange={(e) => {
                        const deg = Number(e.target.value);
                        onCommitPlacements(
                          (prev) =>
                            setOverlayLocalRotation(
                              prev,
                              selectedOvMatch.host,
                              selectedOvMatch.overlay.id,
                              deg,
                            ),
                          `Set "${selectedOvMatch.overlay.label}" to ${deg}°`,
                        );
                      }}
                      className="h-1.5 flex-1 accent-sky-400"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-stone-200">
                      {Math.round(selectedOvMatch.overlay.rotationDeg)}°
                    </span>
                  </div>

                  <div className="space-y-0.5 rounded bg-[#161412] px-2 py-1.5 font-mono text-[10px] text-stone-400">
                    <div>
                      Offset: ({selectedOvMatch.overlay.offsetX.toFixed(2)},{' '}
                      {selectedOvMatch.overlay.offsetY.toFixed(2)}) R
                    </div>
                    <div>
                      Local: {Math.round(selectedOvMatch.overlay.rotationDeg)}° · World:{' '}
                      {Math.round(
                        overlayLocalToWorld(selectedOvMatch.host, selectedOvMatch.overlay).worldDeg,
                      )}
                      °
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      )}
    </div>
  );
}
