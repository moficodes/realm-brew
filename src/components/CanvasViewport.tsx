import { FlipHorizontal2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { TileImageCache } from '../canvas/imageCache';
import { renderMapViewport, type DragMovePreview } from '../canvas/mapRenderer';
import {
  HEX_RADIUS,
  screenToWorld,
  worldToAxial,
  zoomCameraAtScreenPoint,
  type Camera,
  type Point2D,
} from '../domain/hexGeometry';
import {
  canFlipTarget,
  findPlacementAt,
  formatAssemblyLabel,
} from '../domain/plannerEngine';
import type {
  ActiveBrush,
  AxialCoord,
  OverlayBrushSelection,
  OverlayPack,
  Placement,
  PlacementKey,
  TileBrushSelection,
  Tileset,
} from '../domain/types';
import { isEditableTarget } from '../utils/browserHelpers';

interface CanvasViewportProps {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  activeBrush: ActiveBrush | null;
  draggingBrush: ActiveBrush | null;
  selectedCoord: AxialCoord | null;
  overBudgetCoords: ReadonlySet<PlacementKey>;
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
  onSelectCoord: (coord: AxialCoord | null) => void;
  onMoveOrSwap: (from: AxialCoord, to: AxialCoord) => void;
  onRemoveAt: (coord: AxialCoord) => void;
  onRotateAction: (delta: 1 | -1) => void;
  onFlipAction: () => void;
}

export function CanvasViewport({
  placements,
  tilesetsById,
  overlayPacksById,
  activeBrush,
  draggingBrush,
  selectedCoord,
  overBudgetCoords,
  showGrid,
  showLabels,
  camera,
  onCameraChange,
  onViewportSizeChange,
  onPlaceAt,
  onDropFaceAt,
  onPlaceOverlayAt,
  onDropOverlayAt,
  onSelectCoord,
  onMoveOrSwap,
  onRemoveAt,
  onRotateAction,
  onFlipAction,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<TileImageCache | null>(null);
  if (!imageCacheRef.current) {
    imageCacheRef.current = new TileImageCache();
  }

  const [hoveredCoord, setHoveredCoord] = useState<AxialCoord | null>(null);
  const [hoveredWorldPos, setHoveredWorldPos] = useState<Point2D | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderTick, setRenderTick] = useState(0);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragMove, setDragMove] = useState<DragMovePreview | null>(null);

  const panStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
    moved: boolean;
  } | null>(null);

  const moveCandidateRef = useRef<{
    pointerId: number;
    from: AxialCoord;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  const suppressNextClickRef = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const cache = imageCacheRef.current!;
    return cache.subscribe(() => {
      setRenderTick((t) => t + 1);
    });
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
        zoomCameraAtScreenPoint(prev, sx, sy, sizeRef.current.width, sizeRef.current.height, prev.zoom * factor),
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
      placements,
      tilesetsById,
      overlayPacksById,
      imageCache: imageCacheRef.current!,
      showGrid,
      showLabels,
      hoveredCoord,
      hoveredWorldPos,
      selectedCoord,
      activeBrush: previewBrush,
      overBudgetCoords,
      dragMove,
    });
  }, [
    size,
    camera,
    placements,
    tilesetsById,
    overlayPacksById,
    showGrid,
    showLabels,
    hoveredCoord,
    hoveredWorldPos,
    selectedCoord,
    previewBrush,
    overBudgetCoords,
    dragMove,
    renderTick,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToWorld = (clientX: number, clientY: number): Point2D | null => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(
      clientX - rect.left,
      clientY - rect.top,
      size.width,
      size.height,
      cameraRef.current,
    );
  };

  const pointerToAxial = (clientX: number, clientY: number): AxialCoord | null => {
    const world = pointerToWorld(clientX, clientY);
    return world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
  };

  const selectedPlacement = selectedCoord ? findPlacementAt(placements, selectedCoord) : undefined;
  const activeTarget = activeTileBrush ?? selectedPlacement;
  const activeTargetLabel = activeTarget
    ? formatAssemblyLabel(activeTarget, tilesetsById)
    : null;
  const canFlipActiveTarget = activeTarget ? canFlipTarget(activeTarget, tilesetsById) : false;
  const overlayBrushLabel = activeOverlayBrush
    ? `${overlayPacksById.get(activeOverlayBrush.overlayPackId)?.shortCode ?? activeOverlayBrush.shortCode} ${activeOverlayBrush.label}`
    : null;

  const scheduleClickSuppressionClear = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : dragMove
      ? 'cursor-grabbing'
      : spacePressed
        ? 'cursor-grab'
        : activeOverlayBrush
          ? hoveredCoord && !findPlacementAt(placements, hoveredCoord)
            ? 'cursor-not-allowed'
            : 'cursor-crosshair'
          : activeBrush
            ? 'cursor-crosshair'
            : hoveredCoord && findPlacementAt(placements, hoveredCoord)
              ? 'cursor-grab'
              : 'cursor-default';

  return (
    <div ref={containerRef} className="relative h-full flex-1 overflow-hidden bg-[#221f1c]">
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

          if (e.button === 0 && !activeBrush) {
            const coord = pointerToAxial(e.clientX, e.clientY);
            const hit = coord ? findPlacementAt(placements, coord) : undefined;
            if (coord && hit) {
              e.currentTarget.setPointerCapture(e.pointerId);
              moveCandidateRef.current = {
                pointerId: e.pointerId,
                from: coord,
                startClientX: e.clientX,
                startClientY: e.clientY,
                moved: false,
              };
            } else {
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
            }
          }
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

          const moveCandidate = moveCandidateRef.current;
          if (moveCandidate && moveCandidate.pointerId === e.pointerId) {
            const dx = e.clientX - moveCandidate.startClientX;
            const dy = e.clientY - moveCandidate.startClientY;
            if (!moveCandidate.moved && Math.hypot(dx, dy) > 5) {
              moveCandidate.moved = true;
            }
            const hover = pointerToAxial(e.clientX, e.clientY);
            setHoveredCoord(hover);
            if (moveCandidate.moved) {
              setDragMove({ from: moveCandidate.from, to: hover });
            }
            return;
          }

          const world = pointerToWorld(e.clientX, e.clientY);
          const coord = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
          setHoveredCoord(coord);
          setHoveredWorldPos(world);
        }}
        onPointerUp={(e) => {
          const pan = panStateRef.current;
          if (pan && pan.pointerId === e.pointerId) {
            if (pan.moved) {
              scheduleClickSuppressionClear();
            }
            panStateRef.current = null;
            setIsPanning(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
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

            if (wasMoved && target) {
              scheduleClickSuppressionClear();
              onMoveOrSwap(from, target);
              onSelectCoord(target);
            } else {
              scheduleClickSuppressionClear();
              onSelectCoord(from);
            }
          }
        }}
        onPointerCancel={(e) => {
          if (panStateRef.current?.pointerId === e.pointerId) {
            panStateRef.current = null;
            setIsPanning(false);
          }
          if (moveCandidateRef.current?.pointerId === e.pointerId) {
            moveCandidateRef.current = null;
            setDragMove(null);
          }
        }}
        onPointerLeave={() => {
          if (!panStateRef.current && !moveCandidateRef.current) {
            setHoveredCoord(null);
            setHoveredWorldPos(null);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const coord = pointerToAxial(e.clientX, e.clientY);
          if (coord && findPlacementAt(placements, coord)) {
            onRemoveAt(coord);
          }
        }}
        onDragOver={(e) => {
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
            if (droppedOverlay && findPlacementAt(placements, coord)) {
              onDropOverlayAt(coord, world.x, world.y, droppedOverlay);
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
          if (spacePressed || e.button !== 0) return;
          const world = pointerToWorld(e.clientX, e.clientY);
          const coord = world ? worldToAxial(world.x, world.y, HEX_RADIUS) : null;
          if (activeBrush) {
            if (activeBrush.kind === 'tile' && coord) {
              onPlaceAt(coord);
            } else if (
              activeBrush.kind === 'overlay' &&
              coord &&
              world &&
              findPlacementAt(placements, coord)
            ) {
              onPlaceOverlayAt(coord, world.x, world.y);
            }
            return;
          }
          if (coord && findPlacementAt(placements, coord)) {
            onSelectCoord(coord);
          } else {
            onSelectCoord(null);
          }
        }}
      />

      {activeOverlayBrush && overlayBrushLabel && (
        <div className="pointer-events-none absolute inset-x-2 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
            <span className="mr-0.5 whitespace-nowrap font-mono font-semibold text-sky-300">
              {overlayBrushLabel}
            </span>
            <span className="mr-1 whitespace-nowrap rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
              {Math.round(activeOverlayBrush.rotationDeg)}°
            </span>

            <button
              type="button"
              onClick={() => onRotateAction(-1)}
              title="Rotate Overlay brush 60° counter-clockwise (Shift+R)"
              className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>-60°</span>
            </button>

            <button
              type="button"
              onClick={() => onRotateAction(1)}
              title="Rotate Overlay brush 60° clockwise (R)"
              className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>+60°</span>
            </button>
          </div>
        </div>
      )}

      {activeTarget && !activeOverlayBrush && (
        <div className="pointer-events-none absolute inset-x-2 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#2e2a26] bg-[#161412]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
            <span className="mr-0.5 whitespace-nowrap font-mono font-semibold text-amber-300">
              {activeTargetLabel}
            </span>
            <span className="mr-1 whitespace-nowrap rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-300">
              {activeTarget.rotation * 60}°
            </span>

            <button
              type="button"
              onClick={() => onRotateAction(-1)}
              title="Rotate 60° counter-clockwise (Shift+R)"
              className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 transition hover:bg-stone-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>-60°</span>
            </button>

            <button
              type="button"
              onClick={() => onRotateAction(1)}
              title="Rotate 60° clockwise (R)"
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

            {selectedPlacement && !activeBrush && (
              <button
                type="button"
                onClick={() => onRemoveAt({ q: selectedPlacement.q, r: selectedPlacement.r })}
                title="Remove Placement (Del / Right-click)"
                className="ml-1 flex items-center gap-1 rounded-md border border-red-500/30 bg-red-950/50 px-2 py-1 text-red-200 transition hover:bg-red-900/60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
      )}

      {placements.length === 0 && !activeTarget && !activeOverlayBrush && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <div className="rounded-full border border-[#2e2a26] bg-[#161412]/90 px-4 py-1.5 text-xs text-stone-300 shadow-lg">
            Click or drag any Tile Face from the Tile Palette onto the hex grid
          </div>
        </div>
      )}
    </div>
  );
}
