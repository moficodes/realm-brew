import {
  ChevronLeft,
  CloudFog,
  Eye,
  EyeOff,
  FlipHorizontal2,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { AlphaMaskCache, createOverlayHitTestLookup } from '../canvas/alphaMaskCache';
import { TileImageCache } from '../canvas/imageCache';
import {
  renderMapViewport,
  resolveOverlayRenderWorldSize,
  type DragMovePreview,
  type OverlayDragPreview,
  type OverlayRotationPreview,
} from '../canvas/mapRenderer';
import { applyFogStroke, type MapViewMode } from '../domain/fogOfWar';
import {
  HEX_RADIUS,
  axialKey,
  normalizeRotationDeg,
  screenToWorld,
  worldToAxial,
  zoomCameraAtScreenPoint,
  type Camera,
  type Point2D,
} from '../domain/hexGeometry';
import {
  clampWorldPointToHostHex,
  getOverlayDialGeometry,
  hitTestOverlaysAtWorld,
  isPointOnDialKnob,
  overlayLocalToWorld,
  type OverlayHit,
} from '../domain/overlayGeometry';
import {
  canFlipTarget,
  findOverlayById,
  findPlacementAt,
  formatAssemblyLabel,
  resolveOverlayAsset,
  type PullListHighlight,
} from '../domain/plannerEngine';
import type {
  ActiveBrush,
  AxialCoord,
  OverlayBrushSelection,
  OverlayPack,
  OverlayPlacement,
  Placement,
  PlacementKey,
  TileBrushSelection,
  Tileset,
} from '../domain/types';
import { shouldYieldSpacePan } from '../utils/browserHelpers';
import { OverlayContextMenu, type OverlayContextMenuState } from './OverlayContextMenu';

interface CanvasViewportProps {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  imageCache?: TileImageCache;
  activeBrush: ActiveBrush | null;
  draggingBrush: ActiveBrush | null;
  selectedCoord: AxialCoord | null;
  focusedOverlayId: string | null;
  hoveredInspectorOverlayId: string | null;
  pullListHighlight: PullListHighlight | null;
  inspectorRotationPreview: { hostCoord: AxialCoord; overlayId: string; worldDeg: number } | null;
  rightDrawerCollapsed: boolean;
  contextMenu: OverlayContextMenuState | null;
  onContextMenuChange: (menu: OverlayContextMenuState | null) => void;
  overBudgetCoords: ReadonlySet<PlacementKey>;
  overBudgetOverlayIds: ReadonlySet<string>;
  showGrid: boolean;
  showLabels: boolean;
  camera: Camera;
  onCameraChange: Dispatch<SetStateAction<Camera>>;
  onViewportSizeChange: (size: { width: number; height: number }) => void;
  onPlaceAt: (coord: AxialCoord) => void;
  onDropFaceAt: (coord: AxialCoord, brush: TileBrushSelection) => void;
  onPlaceOverlayAt: (coord: AxialCoord, worldX: number, worldY: number) => void;
  onDropOverlayAt: (
    coord: AxialCoord,
    worldX: number,
    worldY: number,
    brush: OverlayBrushSelection,
  ) => void;
  onSelectHostOnly: (coord: AxialCoord | null) => void;
  onSelectOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
  onFocusOverlayFromContextMenu: (hostCoord: AxialCoord, overlayId: string) => void;
  onSelectHostFromContextMenu: (coord: AxialCoord) => void;
  onClearBrush: () => void;
  onMoveOrSwap: (from: AxialCoord, to: AxialCoord) => void;
  onMoveOrReparentOverlay: (
    fromHost: AxialCoord,
    overlayId: string,
    targetHost: AxialCoord,
    worldX: number,
    worldY: number,
  ) => void;
  onSetOverlayWorldRotation: (hostCoord: AxialCoord, overlayId: string, worldDeg: number) => void;
  onRemoveAt: (coord: AxialCoord, keepBrush?: boolean) => void;
  onRemoveOverlayAt: (hostCoord: AxialCoord, overlayId: string, keepBrush?: boolean) => void;
  onRotateAction: (delta: 1 | -1) => void;
  onFlipAction: () => void;
  onExpandInspector: () => void;
  viewMode: MapViewMode;
  fogToolActive: boolean;
  coveredCount: number;
  onExitFogTool: () => void;
  onCoverAll: () => void;
  onRevealAll: () => void;
  onToggleHostFog: (coord: AxialCoord) => void;
  onCommitFogStroke: (coords: AxialCoord[], targetCovered: boolean) => void;
}

const EMPTY_OVER_BUDGET_COORDS = new Set<PlacementKey>();
const EMPTY_OVER_BUDGET_OVERLAY_IDS = new Set<string>();

function displayDeg(deg: number): number {
  const rounded = Math.round(deg) % 360;
  return rounded < 0 ? rounded + 360 : rounded;
}

export function CanvasViewport({
  placements,
  tilesetsById,
  overlayPacksById,
  imageCache,
  activeBrush,
  draggingBrush,
  selectedCoord,
  focusedOverlayId,
  hoveredInspectorOverlayId,
  pullListHighlight,
  inspectorRotationPreview,
  rightDrawerCollapsed,
  contextMenu,
  onContextMenuChange,
  overBudgetCoords,
  overBudgetOverlayIds,
  showGrid,
  showLabels,
  camera,
  onCameraChange,
  onViewportSizeChange,
  onPlaceAt,
  onDropFaceAt,
  onPlaceOverlayAt,
  onDropOverlayAt,
  onSelectHostOnly,
  onSelectOverlay,
  onFocusOverlayFromContextMenu,
  onSelectHostFromContextMenu,
  onClearBrush,
  onMoveOrSwap,
  onMoveOrReparentOverlay,
  onSetOverlayWorldRotation,
  onRemoveAt,
  onRemoveOverlayAt,
  onRotateAction,
  onFlipAction,
  onExpandInspector,
  viewMode,
  fogToolActive,
  coveredCount,
  onExitFogTool,
  onCoverAll,
  onRevealAll,
  onToggleHostFog,
  onCommitFogStroke,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackImageCacheRef = useRef<TileImageCache | null>(null);
  if (!imageCache && !fallbackImageCacheRef.current) {
    fallbackImageCacheRef.current = new TileImageCache();
  }
  const activeImageCache = imageCache ?? fallbackImageCacheRef.current!;
  const alphaCacheRef = useRef<AlphaMaskCache | null>(null);
  if (!alphaCacheRef.current) {
    alphaCacheRef.current = new AlphaMaskCache();
  }

  const [hoveredCoord, setHoveredCoord] = useState<AxialCoord | null>(null);
  const [hoveredWorldPos, setHoveredWorldPos] = useState<Point2D | null>(null);
  const [hoveredOverlayHit, setHoveredOverlayHit] = useState<OverlayHit | null>(null);
  const [hoveredDialKnob, setHoveredDialKnob] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderTick, setRenderTick] = useState(0);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragMove, setDragMove] = useState<DragMovePreview | null>(null);
  const [overlayDrag, setOverlayDrag] = useState<OverlayDragPreview | null>(null);
  const [dialRotatePreview, setDialRotatePreview] = useState<OverlayRotationPreview | null>(null);
  const [fogStrokePreview, setFogStrokePreview] = useState<{
    coords: AxialCoord[];
    targetCovered: boolean;
  } | null>(null);
  const [emptyHexNotice, setEmptyHexNotice] = useState<string | null>(null);

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
    overlay: OverlayPlacement;
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

  const dialDragRef = useRef<{
    pointerId: number;
    hostCoord: AxialCoord;
    overlayId: string;
    centerX: number;
    centerY: number;
    worldDeg: number;
  } | null>(null);

  const moveCandidateRef = useRef<{
    pointerId: number;
    from: AxialCoord;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  const fogStrokeRef = useRef<{
    pointerId: number;
    targetCovered: boolean;
    coords: Map<PlacementKey, AxialCoord>;
  } | null>(null);

  const isFogInteractive = viewMode === 'player' || fogToolActive;

  const suppressNextClickRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const showTempNotice = useCallback((msg: string) => {
    setEmptyHexNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setEmptyHexNotice(null), 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return activeImageCache.subscribe(() => {
      setRenderTick((t) => t + 1);
    });
  }, [activeImageCache]);

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
      if (
        e.code === 'Space' &&
        !shouldYieldSpacePan(e.target) &&
        !document.querySelector('dialog[open]')
      ) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
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

  const prevDraggingBrushRef = useRef<ActiveBrush | null>(null);
  useEffect(() => {
    if (prevDraggingBrushRef.current && !draggingBrush) {
      setHoveredCoord(null);
      setHoveredWorldPos(null);
    }
    prevDraggingBrushRef.current = draggingBrush;
  }, [draggingBrush]);

  useEffect(() => {
    fogStrokeRef.current = null;
    setFogStrokePreview(null);
    if (isFogInteractive) {
      setHoveredOverlayHit(null);
      setHoveredDialKnob(false);
      setDragMove(null);
      setOverlayDrag(null);
      setDialRotatePreview(null);
      moveCandidateRef.current = null;
      overlayDragRef.current = null;
      dialDragRef.current = null;
    }
  }, [isFogInteractive, viewMode]);

  const renderedPlacements = useMemo(
    () =>
      fogStrokePreview
        ? applyFogStroke(placements, fogStrokePreview.coords, fogStrokePreview.targetCovered)
        : placements,
    [placements, fogStrokePreview],
  );

  const hitTestLookup = useMemo(
    () =>
      createOverlayHitTestLookup(
        overlayPacksById,
        activeImageCache,
        alphaCacheRef.current!,
      ),
    [activeImageCache, overlayPacksById],
  );

  const activeRotationPreview: OverlayRotationPreview | null =
    dialRotatePreview ??
    (inspectorRotationPreview
      ? { ...inspectorRotationPreview, source: 'slider' }
      : null);

  const getFocusedDialWorld = useCallback(() => {
    if (!focusedOverlayId || activeBrush || dragMove || overlayDrag) return null;
    const match = findOverlayById(placements, focusedOverlayId);
    if (!match) return null;
    const t = overlayLocalToWorld(match.host, match.overlay);
    const worldDeg =
      activeRotationPreview && activeRotationPreview.overlayId === match.overlay.id
        ? activeRotationPreview.worldDeg
        : t.worldDeg;
    const { width, height } = resolveOverlayRenderWorldSize(
      match.overlay,
      overlayPacksById,
      activeImageCache,
    );
    return {
      host: match.host,
      overlay: match.overlay,
      ...getOverlayDialGeometry(t.x, t.y, width, height, worldDeg),
    };
  }, [
    activeBrush,
    activeImageCache,
    activeRotationPreview,
    dragMove,
    focusedOverlayId,
    overlayDrag,
    overlayPacksById,
    placements,
  ]);

  const activeTileBrush = activeBrush?.kind === 'tile' ? activeBrush : null;
  const activeOverlayBrush = activeBrush?.kind === 'overlay' ? activeBrush : null;
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

    renderMapViewport({
      ctx,
      width: size.width,
      height: size.height,
      camera,
      placements: renderedPlacements,
      tilesetsById,
      overlayPacksById,
      imageCache: activeImageCache,
      showGrid,
      showLabels: viewMode === 'gm' && showLabels,
      hoveredCoord,
      hoveredWorldPos,
      selectedCoord: viewMode === 'gm' && !fogToolActive ? selectedCoord : null,
      focusedOverlayId: viewMode === 'gm' && !fogToolActive ? focusedOverlayId : null,
      hoveredOverlayHit: viewMode === 'gm' && !fogToolActive ? hoveredOverlayHit : null,
      hoveredInspectorOverlayId:
        viewMode === 'gm' && !fogToolActive ? hoveredInspectorOverlayId : null,
      pullListHighlight: viewMode === 'gm' ? pullListHighlight : null,
      activeBrush: viewMode === 'gm' && !fogToolActive ? previewBrush : null,
      overBudgetCoords: viewMode === 'gm' ? overBudgetCoords : EMPTY_OVER_BUDGET_COORDS,
      overBudgetOverlayIds:
        viewMode === 'gm' ? overBudgetOverlayIds : EMPTY_OVER_BUDGET_OVERLAY_IDS,
      showOverBudgetCues: viewMode === 'gm',
      dragMove: viewMode === 'gm' && !fogToolActive ? dragMove : null,
      overlayDrag: viewMode === 'gm' && !fogToolActive ? overlayDrag : null,
      overlayRotationPreview:
        viewMode === 'gm' && !fogToolActive ? activeRotationPreview : null,
      viewMode,
      fogToolActive,
    });
  }, [
    size,
    camera,
    renderedPlacements,
    tilesetsById,
    overlayPacksById,
    activeImageCache,
    showGrid,
    showLabels,
    viewMode,
    fogToolActive,
    hoveredCoord,
    hoveredWorldPos,
    selectedCoord,
    focusedOverlayId,
    hoveredOverlayHit,
    hoveredInspectorOverlayId,
    pullListHighlight,
    previewBrush,
    overBudgetCoords,
    overBudgetOverlayIds,
    dragMove,
    overlayDrag,
    activeRotationPreview,
    renderTick,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToWorld = useCallback((clientX: number, clientY: number): Point2D | null => {
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

  const pointerToAxial = useCallback(
    (clientX: number, clientY: number): AxialCoord | null => {
      const world = pointerToWorld(clientX, clientY);
      return world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
    },
    [pointerToWorld],
  );

  const selectedPlacement = selectedCoord ? findPlacementAt(placements, selectedCoord) : undefined;
  const focusedMatch = focusedOverlayId ? findOverlayById(placements, focusedOverlayId) : null;
  const focusedAsset = focusedMatch
    ? resolveOverlayAsset(focusedMatch.overlay, overlayPacksById)
    : null;
  const focusedLabel = focusedMatch
    ? focusedAsset?.status === 'ok'
      ? `${focusedAsset.shortCode} ${focusedAsset.overlay.label}`
      : focusedMatch.overlay.overlayId
    : null;

  const activeTarget = activeTileBrush ?? (!focusedMatch ? selectedPlacement : undefined);
  const activeTargetLabel = activeTarget
    ? formatAssemblyLabel(activeTarget, tilesetsById)
    : null;
  const canFlipActiveTarget = activeTarget ? canFlipTarget(activeTarget, tilesetsById) : false;
  const overlayBrushLabel = activeOverlayBrush
    ? `${overlayPacksById.get(activeOverlayBrush.overlayPackId)?.shortCode ?? activeOverlayBrush.shortCode} ${activeOverlayBrush.label}`
    : null;

  const showFloatingBar =
    viewMode === 'gm' &&
    (fogToolActive ||
      activeBrush !== null ||
      (rightDrawerCollapsed && (focusedMatch !== null || selectedPlacement !== undefined)));

  const scheduleClickSuppressionClear = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const cursorClass = isPanning || overlayDrag || dragMove || dialRotatePreview
    ? 'cursor-grabbing'
    : spacePressed
      ? 'cursor-grab'
      : isFogInteractive
        ? hoveredCoord && findPlacementAt(placements, hoveredCoord)
          ? 'cursor-pointer'
          : 'cursor-default'
        : activeOverlayBrush
          ? hoveredCoord && !findPlacementAt(placements, hoveredCoord)
            ? 'cursor-not-allowed'
            : 'cursor-crosshair'
          : activeBrush
            ? 'cursor-crosshair'
            : hoveredDialKnob || hoveredOverlayHit
              ? 'cursor-pointer'
              : hoveredCoord && findPlacementAt(placements, hoveredCoord)
                ? 'cursor-grab'
                : 'cursor-default';

  return (
    <div ref={containerRef} className="relative h-full min-w-0 flex-1 overflow-hidden bg-[#221f1c]">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${cursorClass}`}
        onPointerDown={(e) => {
          const hadContextMenu = Boolean(contextMenu);
          if (contextMenu) {
            onContextMenuChange(null);
          }

          const beginPan = () => {
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
          };

          if (e.button === 1 || (e.button === 0 && spacePressed)) {
            e.preventDefault();
            beginPan();
            return;
          }

          if (isFogInteractive) {
            if (e.button !== 0) return;
            const world = pointerToWorld(e.clientX, e.clientY);
            if (!world) return;
            const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
            const hit = findPlacementAt(placements, coord);
            if (hit) {
              const targetCovered = !Boolean(hit.covered);
              const key = axialKey(coord.q, coord.r);
              fogStrokeRef.current = {
                pointerId: e.pointerId,
                targetCovered,
                coords: new Map([[key, coord]]),
              };
              setFogStrokePreview({ coords: [coord], targetCovered });
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
            beginPan();
            return;
          }

          if (e.button !== 0 || activeBrush) {
            if (hadContextMenu && e.button === 0 && activeBrush) {
              scheduleClickSuppressionClear();
            }
            return;
          }
          const world = pointerToWorld(e.clientX, e.clientY);
          if (!world) return;

          // 1. Minimal radial dial knob around focused Overlay
          const dial = getFocusedDialWorld();
          if (dial && isPointOnDialKnob(world.x, world.y, dial, cameraRef.current.zoom)) {
            setHoveredOverlayHit(null);
            e.currentTarget.setPointerCapture(e.pointerId);
            dialDragRef.current = {
              pointerId: e.pointerId,
              hostCoord: { q: dial.host.q, r: dial.host.r },
              overlayId: dial.overlay.id,
              centerX: dial.centerX,
              centerY: dial.centerY,
              worldDeg: dial.worldDeg,
            };
            setDialRotatePreview({
              hostCoord: { q: dial.host.q, r: dial.host.r },
              overlayId: dial.overlay.id,
              worldDeg: dial.worldDeg,
              source: 'dial',
            });
            return;
          }

          // 2. Top-to-bottom alpha-aware OBB hit-testing for Overlay Placements
          const hits = hitTestOverlaysAtWorld(placements, world.x, world.y, hitTestLookup);
          if (hits.length > 0) {
            const pick = hits[0];
            setHoveredOverlayHit(null);
            e.currentTarget.setPointerCapture(e.pointerId);
            overlayDragRef.current = {
              pointerId: e.pointerId,
              fromHostCoord: pick.hostCoord,
              overlayId: pick.overlay.id,
              overlay: pick.overlay,
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

          // 3. Bare host Tile space -> Tile move/swap or selection
          const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
          if (findPlacementAt(placements, coord)) {
            e.currentTarget.setPointerCapture(e.pointerId);
            moveCandidateRef.current = {
              pointerId: e.pointerId,
              from: coord,
              startClientX: e.clientX,
              startClientY: e.clientY,
              moved: false,
            };
            return;
          }

          // 4. Empty space -> pan (or clear selection on stationary click)
          beginPan();
        }}
        onPointerMove={(e) => {
          const pan = panStateRef.current;
          if (pan && pan.pointerId === e.pointerId) {
            const dx = e.clientX - pan.startClientX;
            const dy = e.clientY - pan.startClientY;
            if (!pan.moved && Math.hypot(dx, dy) > 3) {
              pan.moved = true;
            }
            if (pan.moved) {
              onCameraChange((prev) => ({
                ...prev,
                x: pan.startCamX - dx / prev.zoom,
                y: pan.startCamY - dy / prev.zoom,
              }));
            }
            return;
          }

          const world = pointerToWorld(e.clientX, e.clientY);
          if (!world) return;
          const coord = worldToAxial(world.x, world.y, HEX_RADIUS);
          setHoveredCoord(coord);
          setHoveredWorldPos(world);

          const fogStroke = fogStrokeRef.current;
          if (fogStroke && fogStroke.pointerId === e.pointerId) {
            if (findPlacementAt(placements, coord)) {
              const key = axialKey(coord.q, coord.r);
              if (!fogStroke.coords.has(key)) {
                fogStroke.coords.set(key, coord);
                setFogStrokePreview({
                  coords: Array.from(fogStroke.coords.values()),
                  targetCovered: fogStroke.targetCovered,
                });
              }
            }
            return;
          }

          if (isFogInteractive) {
            setHoveredDialKnob(false);
            setHoveredOverlayHit(null);
            return;
          }

          const dialDrag = dialDragRef.current;
          if (dialDrag && dialDrag.pointerId === e.pointerId) {
            let deg =
              (Math.atan2(world.y - dialDrag.centerY, world.x - dialDrag.centerX) * 180) /
                Math.PI +
              90;
            deg = normalizeRotationDeg(deg);
            if (e.shiftKey) {
              deg = normalizeRotationDeg(Math.round(deg / 15) * 15);
            }
            dialDrag.worldDeg = deg;
            setDialRotatePreview({
              hostCoord: dialDrag.hostCoord,
              overlayId: dialDrag.overlayId,
              worldDeg: deg,
              source: 'dial',
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
              const rawX = world.x - ovDrag.grabOffsetX;
              const rawY = world.y - ovDrag.grabOffsetY;
              const hoverCoord = worldToAxial(rawX, rawY, HEX_RADIUS);
              const occupied = findPlacementAt(placements, hoverCoord);
              let validCoord = ovDrag.lastValidHostCoord;
              let emptyCoord: AxialCoord | null = null;
              if (occupied) {
                validCoord = hoverCoord;
                ovDrag.lastValidHostCoord = hoverCoord;
              } else {
                emptyCoord = hoverCoord;
              }
              const clamped = clampWorldPointToHostHex(rawX, rawY, validCoord, HEX_RADIUS);
              ovDrag.lastValidWorldX = clamped.point.x;
              ovDrag.lastValidWorldY = clamped.point.y;

              setOverlayDrag({
                fromHostCoord: ovDrag.fromHostCoord,
                overlayId: ovDrag.overlayId,
                overlay: ovDrag.overlay,
                worldX: clamped.point.x,
                worldY: clamped.point.y,
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

          const moveCandidate = moveCandidateRef.current;
          if (moveCandidate && moveCandidate.pointerId === e.pointerId) {
            const dx = e.clientX - moveCandidate.startClientX;
            const dy = e.clientY - moveCandidate.startClientY;
            if (!moveCandidate.moved && Math.hypot(dx, dy) > 5) {
              moveCandidate.moved = true;
            }
            if (moveCandidate.moved) {
              setDragMove({ from: moveCandidate.from, to: coord });
            }
            return;
          }

          if (!activeBrush) {
            const dial = getFocusedDialWorld();
            const overDial = dial
              ? isPointOnDialKnob(world.x, world.y, dial, cameraRef.current.zoom)
              : false;
            setHoveredDialKnob(overDial);
            if (overDial) {
              setHoveredOverlayHit(null);
            } else {
              const hits = hitTestOverlaysAtWorld(placements, world.x, world.y, hitTestLookup);
              setHoveredOverlayHit(hits[0] ?? null);
            }
          } else {
            setHoveredDialKnob(false);
            setHoveredOverlayHit(null);
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
            scheduleClickSuppressionClear();
            if (!moved && !activeBrush && !isFogInteractive) {
              onSelectHostOnly(null);
            }
            return;
          }

          const fogStroke = fogStrokeRef.current;
          if (fogStroke && fogStroke.pointerId === e.pointerId) {
            const coords = Array.from(fogStroke.coords.values());
            const targetCovered = fogStroke.targetCovered;
            fogStrokeRef.current = null;
            setFogStrokePreview(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();
            onCommitFogStroke(coords, targetCovered);
            return;
          }

          const dialDrag = dialDragRef.current;
          if (dialDrag && dialDrag.pointerId === e.pointerId) {
            dialDragRef.current = null;
            setDialRotatePreview(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();
            onSetOverlayWorldRotation(
              dialDrag.hostCoord,
              dialDrag.overlayId,
              dialDrag.worldDeg,
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
              onMoveOrReparentOverlay(
                ovDrag.fromHostCoord,
                ovDrag.overlayId,
                ovDrag.lastValidHostCoord,
                ovDrag.lastValidWorldX,
                ovDrag.lastValidWorldY,
              );
            } else {
              onSelectOverlay(ovDrag.fromHostCoord, ovDrag.overlayId);
            }
            return;
          }

          const moveCandidate = moveCandidateRef.current;
          if (moveCandidate && moveCandidate.pointerId === e.pointerId) {
            const target = pointerToAxial(e.clientX, e.clientY);
            const wasMoved = moveCandidate.moved;
            const from = moveCandidate.from;
            moveCandidateRef.current = null;
            setDragMove(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            scheduleClickSuppressionClear();

            if (wasMoved && target) {
              onMoveOrSwap(from, target);
              onSelectHostOnly(target);
            } else {
              onSelectHostOnly(from);
            }
          }
        }}
        onPointerCancel={(e) => {
          if (panStateRef.current?.pointerId === e.pointerId) {
            panStateRef.current = null;
            setIsPanning(false);
          }
          if (dialDragRef.current?.pointerId === e.pointerId) {
            dialDragRef.current = null;
            setDialRotatePreview(null);
          }
          if (overlayDragRef.current?.pointerId === e.pointerId) {
            overlayDragRef.current = null;
            setOverlayDrag(null);
          }
          if (moveCandidateRef.current?.pointerId === e.pointerId) {
            moveCandidateRef.current = null;
            setDragMove(null);
          }
          if (fogStrokeRef.current?.pointerId === e.pointerId) {
            fogStrokeRef.current = null;
            setFogStrokePreview(null);
          }
        }}
        onPointerLeave={() => {
          if (
            !panStateRef.current &&
            !dialDragRef.current &&
            !overlayDragRef.current &&
            !moveCandidateRef.current &&
            !fogStrokeRef.current
          ) {
            setHoveredCoord(null);
            setHoveredWorldPos(null);
            setHoveredOverlayHit(null);
            setHoveredDialKnob(false);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (isFogInteractive) {
            onContextMenuChange(null);
            return;
          }
          const world = pointerToWorld(e.clientX, e.clientY);
          const container = containerRef.current;
          if (!world || !container) return;

          const hits = hitTestOverlaysAtWorld(placements, world.x, world.y, hitTestLookup);
          const coord = hits[0]?.hostCoord ?? worldToAxial(world.x, world.y, HEX_RADIUS);
          const host = findPlacementAt(placements, coord);
          if (!host) {
            onContextMenuChange(null);
            return;
          }

          const rect = container.getBoundingClientRect();
          const menuWidth = 224;
          const menuHeight = hits[0] ? 168 : 100;
          onContextMenuChange({
            x: Math.min(Math.max(8, rect.width - menuWidth - 8), Math.max(8, e.clientX - rect.left)),
            y: Math.min(Math.max(8, rect.height - menuHeight - 8), Math.max(8, e.clientY - rect.top)),
            coord,
            overlayCount: host.overlays?.length ?? 0,
            hitOverlay: hits[0] ?? null,
          });
        }}
        onDragOver={(e) => {
          if (viewMode === 'player') return;
          const isOverlayDrag =
            draggingBrush?.kind === 'overlay' ||
            e.dataTransfer.types.includes('application/x-realm-brew-overlay');
          const isTileDrag =
            draggingBrush?.kind === 'tile' ||
            e.dataTransfer.types.includes('application/x-realm-brew-face');

          if (isOverlayDrag || isTileDrag) {
            e.preventDefault();
            const world = pointerToWorld(e.clientX, e.clientY);
            const coord = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
            setHoveredCoord(coord);
            setHoveredWorldPos(world);
            if (isOverlayDrag) {
              const occupied = coord ? Boolean(findPlacementAt(placements, coord)) : false;
              e.dataTransfer.dropEffect = occupied ? 'copy' : 'none';
            } else {
              e.dataTransfer.dropEffect = 'copy';
            }
          }
        }}
        onDragLeave={() => {
          setHoveredCoord(null);
          setHoveredWorldPos(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (viewMode === 'player') return;
          const world = pointerToWorld(e.clientX, e.clientY);
          const coord = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
          setHoveredCoord(null);
          setHoveredWorldPos(null);
          if (!world || !coord) return;

          const isOverlayDrop =
            e.dataTransfer.types.includes('application/x-realm-brew-overlay') ||
            draggingBrush?.kind === 'overlay';
          if (isOverlayDrop) {
            let droppedOverlay: OverlayBrushSelection | null =
              draggingBrush?.kind === 'overlay' ? draggingBrush : null;
            const rawOverlay = e.dataTransfer.getData('application/x-realm-brew-overlay');
            if (rawOverlay) {
              try {
                const parsed = JSON.parse(rawOverlay) as OverlayBrushSelection;
                droppedOverlay = { ...parsed, kind: 'overlay' };
              } catch {
                // Keep draggingBrush fallback
              }
            }
            if (droppedOverlay) {
              if (findPlacementAt(placements, coord)) {
                onDropOverlayAt(coord, world.x, world.y, droppedOverlay);
              } else {
                showTempNotice('Place a Tile first');
              }
            }
            return;
          }

          let droppedTile: TileBrushSelection | null =
            draggingBrush?.kind === 'tile' ? draggingBrush : null;
          const rawFace = e.dataTransfer.getData('application/x-realm-brew-face');
          if (rawFace) {
            try {
              const parsed = JSON.parse(rawFace) as TileBrushSelection;
              droppedTile = { ...parsed, kind: 'tile' };
            } catch {
              // Keep draggingBrush fallback
            }
          }
          if (droppedTile) {
            onDropFaceAt(coord, droppedTile);
          }
        }}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (isFogInteractive || spacePressed || e.button !== 0 || !activeBrush) return;
          const world = pointerToWorld(e.clientX, e.clientY);
          const coord = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
          if (!coord || !world) return;

          if (activeBrush.kind === 'tile') {
            onPlaceAt(coord);
          } else if (activeBrush.kind === 'overlay') {
            if (findPlacementAt(placements, coord)) {
              onPlaceOverlayAt(coord, world.x, world.y);
            } else {
              showTempNotice('Place a Tile first');
            }
          }
        }}
      />

      {emptyHexNotice && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-500/50 bg-red-950/90 px-3.5 py-1.5 text-xs font-medium text-red-100 shadow-lg">
          {emptyHexNotice}
        </div>
      )}

      {contextMenu && (
        <OverlayContextMenu
          menu={contextMenu}
          overlayPacksById={overlayPacksById}
          onFocusOverlay={(hostCoord, overlayId) => {
            onFocusOverlayFromContextMenu(hostCoord, overlayId);
            onContextMenuChange(null);
          }}
          onDeleteOverlay={(hostCoord, overlayId) => {
            onRemoveOverlayAt(hostCoord, overlayId, true);
            onContextMenuChange(null);
          }}
          onSelectHost={(coord) => {
            onSelectHostFromContextMenu(coord);
            onContextMenuChange(null);
          }}
          onDeleteHost={(coord) => {
            onRemoveAt(coord, true);
            onContextMenuChange(null);
          }}
        />
      )}

      {/* Compact floating bottom quick-action bar */}
      {showFloatingBar && (
        <div className="pointer-events-none absolute inset-x-2 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
            {fogToolActive && (
              <>
                <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <CloudFog className="h-3.5 w-3.5 text-slate-300" />
                  Fog Paint
                </span>
                <span className="text-stone-400">
                  Click or drag across Tiles to cover or reveal
                </span>
                <button
                  type="button"
                  onClick={onCoverAll}
                  disabled={placements.length === 0 || coveredCount === placements.length}
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>Cover all</span>
                </button>
                <button
                  type="button"
                  onClick={onRevealAll}
                  disabled={placements.length === 0 || coveredCount === 0}
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Reveal all</span>
                </button>
                <button
                  type="button"
                  onClick={onExitFogTool}
                  className="rounded-md border border-slate-500/40 bg-slate-700/40 px-2 py-1 text-slate-100 transition hover:bg-slate-700/60"
                >
                  Done (Esc)
                </button>
              </>
            )}

            {!fogToolActive && activeOverlayBrush && overlayBrushLabel && (
              <>
                <span className="max-w-[180px] truncate font-mono font-semibold text-sky-300">
                  {overlayBrushLabel}
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {displayDeg(activeOverlayBrush.rotationDeg)}°
                </span>
                <button
                  type="button"
                  onClick={() => onRotateAction(-1)}
                  title="Rotate Overlay brush -15° (Shift+R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>-15°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRotateAction(1)}
                  title="Rotate Overlay brush +15° (R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>+15°</span>
                </button>
                <button
                  type="button"
                  onClick={onClearBrush}
                  className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-300 transition hover:text-white"
                >
                  Clear (Esc)
                </button>
              </>
            )}

            {!fogToolActive && activeTileBrush && activeTargetLabel && (
              <>
                <span className="whitespace-nowrap font-mono font-semibold text-amber-300">
                  {activeTargetLabel}
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {activeTileBrush.rotation * 60}°
                </span>
                <button
                  type="button"
                  onClick={() => onRotateAction(-1)}
                  title="Rotate Tile brush -60° (Shift+R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>-60°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRotateAction(1)}
                  title="Rotate Tile brush +60° (R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>+60°</span>
                </button>
                <button
                  type="button"
                  onClick={onFlipAction}
                  disabled={!canFlipActiveTarget}
                  title={
                    canFlipActiveTarget
                      ? 'Flip to opposite Tile Face (F)'
                      : 'Symmetric Tile has no distinct opposite face'
                  }
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" />
                  <span>Flip</span>
                </button>
                <button
                  type="button"
                  onClick={onClearBrush}
                  className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-300 transition hover:text-white"
                >
                  Clear (Esc)
                </button>
              </>
            )}

            {!fogToolActive && !activeBrush && focusedMatch && focusedLabel && (
              <>
                <span className="max-w-[180px] truncate font-semibold text-sky-300">
                  {focusedLabel}
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {displayDeg(focusedMatch.overlay.rotationDeg)}°
                </span>
                <button
                  type="button"
                  onClick={() => onRotateAction(-1)}
                  title="Rotate Overlay -15° (Shift+R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>-15°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRotateAction(1)}
                  title="Rotate Overlay +15° (R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>+15°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveOverlayAt(focusedMatch.host, focusedMatch.overlay.id)}
                  title="Remove Overlay (Del / Backspace)"
                  className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-950/50 px-2 py-1 text-red-200 transition hover:bg-red-900/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
              </>
            )}

            {!fogToolActive && !activeBrush && !focusedMatch && selectedPlacement && activeTargetLabel && (
              <>
                <span className="whitespace-nowrap font-mono font-semibold text-amber-300">
                  {activeTargetLabel} ({selectedPlacement.q}, {selectedPlacement.r})
                </span>
                <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
                  {selectedPlacement.rotation * 60}°
                </span>
                <button
                  type="button"
                  onClick={() => onRotateAction(-1)}
                  title="Rotate host Tile -60° (Shift+R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>-60°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRotateAction(1)}
                  title="Rotate host Tile +60° (R)"
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>+60°</span>
                </button>
                <button
                  type="button"
                  onClick={onFlipAction}
                  disabled={!canFlipActiveTarget}
                  title={
                    canFlipActiveTarget
                      ? 'Flip host Tile (F)'
                      : 'Symmetric Tile has no distinct opposite face'
                  }
                  className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" />
                  <span>Flip</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onToggleHostFog({ q: selectedPlacement.q, r: selectedPlacement.r })
                  }
                  aria-pressed={Boolean(selectedPlacement.covered)}
                  title={
                    selectedPlacement.covered
                      ? 'Reveal Placement from Fog of War'
                      : 'Cover Placement with Fog of War'
                  }
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
                    selectedPlacement.covered
                      ? 'border-slate-400/50 bg-slate-700/50 text-slate-100 hover:bg-slate-700/70'
                      : 'border-[#2e2a26] bg-[#1c1917] text-stone-200 hover:bg-stone-800'
                  }`}
                >
                  {selectedPlacement.covered ? (
                    <>
                      <Eye className="h-3.5 w-3.5 text-sky-300" />
                      <span>Reveal</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5 text-slate-300" />
                      <span>Cover</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveAt({ q: selectedPlacement.q, r: selectedPlacement.r })}
                  title="Remove Host Tile & attached Overlays (Del)"
                  className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-950/50 px-2 py-1 text-red-200 transition hover:bg-red-900/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
              </>
            )}

            {!fogToolActive && rightDrawerCollapsed && (
              <button
                type="button"
                onClick={onExpandInspector}
                title="Expand Inspector drawer (])"
                className="ml-0.5 flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-amber-200 transition hover:bg-amber-500/25"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Inspector</span>
              </button>
            )}
          </div>
        </div>
      )}

      {placements.length === 0 && !activeBrush && !fogToolActive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <div className="rounded-full border border-[#2e2a26] bg-[#161412]/90 px-4 py-1.5 text-xs text-stone-300 shadow-lg">
            {viewMode === 'player'
              ? 'No Tiles placed on this Map'
              : 'Click or drag any Tile Face from the Tile Palette onto the hex grid'}
          </div>
        </div>
      )}
    </div>
  );
}
