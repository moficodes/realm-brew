import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { TileImageCache } from '../canvas/imageCache';
import { renderMapViewport } from '../canvas/mapRenderer';
import {
  HEX_RADIUS,
  screenToAxial,
  zoomCameraAtScreenPoint,
  type Camera,
} from '../domain/hexGeometry';
import type { AxialCoord, BrushSelection, Placement, Tileset } from '../domain/types';

interface CanvasViewportProps {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  activeBrush: BrushSelection | null;
  showGrid: boolean;
  camera: Camera;
  onCameraChange: Dispatch<SetStateAction<Camera>>;
  onViewportSizeChange: (size: { width: number; height: number }) => void;
  onPlaceAt: (coord: AxialCoord) => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function CanvasViewport({
  placements,
  tilesetsById,
  activeBrush,
  showGrid,
  camera,
  onCameraChange,
  onViewportSizeChange,
  onPlaceAt,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<TileImageCache | null>(null);
  if (!imageCacheRef.current) {
    imageCacheRef.current = new TileImageCache();
  }

  const [hoveredCoord, setHoveredCoord] = useState<AxialCoord | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderTick, setRenderTick] = useState(0);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const panStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
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
      if (e.code === 'Space' && !isEditableElement(e.target) && !document.querySelector('dialog[open]')) {
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
      imageCache: imageCacheRef.current!,
      showGrid,
      hoveredCoord,
      activeBrush,
    });
  }, [size, camera, placements, tilesetsById, showGrid, hoveredCoord, activeBrush, renderTick]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToAxial = (clientX: number, clientY: number): AxialCoord | null => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return screenToAxial(
      clientX - rect.left,
      clientY - rect.top,
      size.width,
      size.height,
      cameraRef.current,
      HEX_RADIUS,
    );
  };

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : spacePressed
      ? 'cursor-grab'
      : activeBrush
        ? 'cursor-crosshair'
        : 'cursor-grab';

  return (
    <div ref={containerRef} className="relative h-full flex-1 overflow-hidden bg-[#221f1c]">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${cursorClass}`}
        onPointerDown={(e) => {
          const shouldPan = e.button === 1 || (e.button === 0 && (spacePressed || !activeBrush));
          if (!shouldPan) return;
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
          setHoveredCoord(pointerToAxial(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          const pan = panStateRef.current;
          if (pan && pan.pointerId === e.pointerId) {
            if (pan.moved) {
              suppressNextClickRef.current = true;
            }
            panStateRef.current = null;
            setIsPanning(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }
        }}
        onPointerCancel={(e) => {
          if (panStateRef.current?.pointerId === e.pointerId) {
            panStateRef.current = null;
            setIsPanning(false);
          }
        }}
        onPointerLeave={() => {
          if (!panStateRef.current) {
            setHoveredCoord(null);
          }
        }}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (!activeBrush || spacePressed || e.button !== 0) return;
          const coord = pointerToAxial(e.clientX, e.clientY);
          if (coord) {
            onPlaceAt(coord);
          }
        }}
      />
      {placements.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <div className="rounded-full border border-[#2e2a26] bg-[#161412]/90 px-4 py-1.5 text-xs text-stone-300 shadow-lg">
            {activeBrush
              ? 'Click any hex to place (Space+drag to pan, scroll to zoom, Esc to cancel)'
              : 'Select a Tile Face from the Tile Palette to start building your Map'}
          </div>
        </div>
      )}
    </div>
  );
}
