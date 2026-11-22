import { useCallback, useEffect, useRef, useState } from 'react';
import { TileImageCache } from '../canvas/imageCache';
import { renderMapViewport } from '../canvas/mapRenderer';
import { HEX_RADIUS, worldToAxial } from '../domain/hexGeometry';
import type { AxialCoord, BrushSelection, Placement, Tileset } from '../domain/types';

interface CanvasViewportProps {
  placements: readonly Placement[];
  tilesetsById: ReadonlyMap<string, Tileset>;
  activeBrush: BrushSelection | null;
  showGrid: boolean;
  onPlaceAt: (coord: AxialCoord) => void;
}

export function CanvasViewport({
  placements,
  tilesetsById,
  activeBrush,
  showGrid,
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
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      placements,
      tilesetsById,
      imageCache: imageCacheRef.current!,
      showGrid,
      hoveredCoord,
      activeBrush,
    });
  }, [size, placements, tilesetsById, showGrid, hoveredCoord, activeBrush, renderTick]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToAxial = (clientX: number, clientY: number): AxialCoord | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const worldX = clientX - rect.left - rect.width / 2;
    const worldY = clientY - rect.top - rect.height / 2;
    return worldToAxial(worldX, worldY, HEX_RADIUS);
  };

  return (
    <div ref={containerRef} className="relative h-full flex-1 overflow-hidden bg-[#221f1c]">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${activeBrush ? 'cursor-crosshair' : 'cursor-default'}`}
        onPointerMove={(e) => {
          setHoveredCoord(pointerToAxial(e.clientX, e.clientY));
        }}
        onPointerLeave={() => {
          setHoveredCoord(null);
        }}
        onClick={(e) => {
          if (!activeBrush) return;
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
              ? 'Click any hex to place the active Tile Face (Esc to cancel)'
              : 'Select a Tile Face from the Tile Palette to start building your Map'}
          </div>
        </div>
      )}
    </div>
  );
}
