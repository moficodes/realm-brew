import { Grid3x3, Hexagon, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { BrushSelection, Tileset } from '../domain/types';

interface ToolbarProps {
  showGrid: boolean;
  onToggleGrid: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToContent: () => void;
  activeBrush: BrushSelection | null;
  onClearBrush: () => void;
  tilesetsById: ReadonlyMap<string, Tileset>;
  placementCount: number;
}

export function Toolbar({
  showGrid,
  onToggleGrid,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToContent,
  activeBrush,
  onClearBrush,
  tilesetsById,
  placementCount,
}: ToolbarProps) {
  const activeTileset = activeBrush ? tilesetsById.get(activeBrush.tilesetId) : undefined;
  const activeLabel = activeBrush
    ? `${activeTileset?.shortCode ?? activeBrush.tilesetId} #${String(activeBrush.faceNumber).padStart(2, '0')}`
    : null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#2e2a26] bg-[#161412] px-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
          <Hexagon className="h-4 w-4" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-stone-100">
          Realm Brew Map Planner
        </h1>
        <span className="rounded bg-[#1c1917] px-2 py-0.5 text-xs text-stone-400">
          {placementCount} {placementCount === 1 ? 'Placement' : 'Placements'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {activeLabel && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
            <span>Brush:</span>
            <span className="font-mono font-semibold">{activeLabel}</span>
            <button
              type="button"
              onClick={onClearBrush}
              title="Clear active brush (Esc)"
              aria-label="Clear active brush"
              className="ml-0.5 rounded p-0.5 text-amber-300 hover:bg-amber-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917]">
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            className="px-2 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            title="Reset zoom to 100%"
            className="min-w-[3.25rem] border-x border-[#2e2a26] px-2 py-1 text-center font-mono text-xs text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            className="px-2 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onFitToContent}
          title="Fit Map to viewport"
          className="flex items-center gap-1.5 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2.5 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span>Fit</span>
        </button>

        <button
          type="button"
          onClick={onToggleGrid}
          aria-pressed={showGrid}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showGrid
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              : 'border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:bg-stone-800'
          }`}
        >
          <Grid3x3 className="h-3.5 w-3.5" />
          <span>Hex Grid</span>
        </button>
      </div>
    </header>
  );
}
