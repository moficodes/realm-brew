import {
  AlertTriangle,
  ClipboardList,
  Eraser,
  Grid3x3,
  Hexagon,
  Maximize2,
  Package,
  Redo2,
  Tag,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { BrushSelection, MapSummary, Tileset } from '../domain/types';
import { MapSwitcher } from './MapSwitcher';

interface ToolbarProps {
  maps: readonly MapSummary[];
  activeMapId: string | null;
  activeMapName: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onSelectMap: (id: string) => void;
  onCreateMap: () => void;
  onRenameMap: (name: string) => void;
  onRequestDeleteMap: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  pullListOpen: boolean;
  onTogglePullList: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToContent: () => void;
  activeBrush: BrushSelection | null;
  onClearBrush: () => void;
  tilesetsById: ReadonlyMap<string, Tileset>;
  placementCount: number;
  overBudgetCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRequestClearMap: () => void;
  onOpenCollection: () => void;
}

export function Toolbar({
  maps,
  activeMapId,
  activeMapName,
  saveStatus,
  onSelectMap,
  onCreateMap,
  onRenameMap,
  onRequestDeleteMap,
  onExportJson,
  onImportJsonFile,
  showGrid,
  onToggleGrid,
  showLabels,
  onToggleLabels,
  pullListOpen,
  onTogglePullList,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToContent,
  activeBrush,
  onClearBrush,
  tilesetsById,
  placementCount,
  overBudgetCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRequestClearMap,
  onOpenCollection,
}: ToolbarProps) {
  const activeTileset = activeBrush ? tilesetsById.get(activeBrush.tilesetId) : undefined;
  const activeLabel = activeBrush
    ? `${activeTileset?.shortCode ?? activeBrush.tilesetId} #${String(activeBrush.faceNumber).padStart(2, '0')}`
    : null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-[#2e2a26] bg-[#161412] px-3">
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
          <Hexagon className="h-4 w-4" />
        </div>
        <h1 className="hidden text-sm font-semibold tracking-tight text-stone-100 lg:block">
          Realm Brew
        </h1>

        <MapSwitcher
          maps={maps}
          activeMapId={activeMapId}
          activeMapName={activeMapName}
          saveStatus={saveStatus}
          onSelectMap={onSelectMap}
          onCreateMap={onCreateMap}
          onRenameMap={onRenameMap}
          onRequestDeleteMap={onRequestDeleteMap}
          onExportJson={onExportJson}
          onImportJsonFile={onImportJsonFile}
        />

        <span className="rounded bg-[#1c1917] px-2 py-0.5 text-xs text-stone-400">
          {placementCount}
        </span>

        {overBudgetCount > 0 && (
          <span
            title="Some Placements exceed your physical Collection copy count"
            className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-950/50 px-2 py-0.5 text-xs font-medium text-red-300"
          >
            <AlertTriangle className="h-3 w-3 text-red-400" />
            {overBudgetCount} over
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {activeLabel && (
          <div className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
            <span className="font-mono font-semibold">{activeLabel}</span>
            <button
              type="button"
              onClick={onClearBrush}
              title="Clear active brush (Esc)"
              aria-label="Clear active brush"
              className="rounded p-0.5 text-amber-300 hover:bg-amber-500/20"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917]">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Cmd/Ctrl+Z)"
            aria-label="Undo"
            className="px-2 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Cmd/Ctrl+Shift+Z)"
            aria-label="Redo"
            className="border-l border-[#2e2a26] px-2 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917]">
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            className="px-1.5 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            title="Reset zoom to 100%"
            className="min-w-[3rem] border-x border-[#2e2a26] px-1.5 py-1 text-center font-mono text-xs text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            className="px-1.5 py-1.5 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onFitToContent}
          title="Fit Map to viewport"
          className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span>Fit</span>
        </button>

        <button
          type="button"
          onClick={onToggleGrid}
          aria-pressed={showGrid}
          className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            showGrid
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              : 'border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:bg-stone-800'
          }`}
        >
          <Grid3x3 className="h-3.5 w-3.5" />
          <span>Grid</span>
        </button>

        <button
          type="button"
          onClick={onToggleLabels}
          aria-pressed={showLabels}
          title="Toggle Tile number & orientation labels on Map"
          className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            showLabels
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              : 'border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:bg-stone-800'
          }`}
        >
          <Tag className="h-3.5 w-3.5" />
          <span>Labels</span>
        </button>

        <button
          type="button"
          onClick={onTogglePullList}
          aria-pressed={pullListOpen}
          title="Toggle Pull List panel"
          className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            pullListOpen
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              : 'border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:bg-stone-800'
          }`}
        >
          <ClipboardList className="h-3.5 w-3.5" />
          <span>Pull List</span>
        </button>

        <button
          type="button"
          onClick={onOpenCollection}
          className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <Package className="h-3.5 w-3.5 text-amber-400" />
          <span>Collection</span>
        </button>

        <button
          type="button"
          onClick={onRequestClearMap}
          disabled={placementCount === 0}
          title="Clear all Placements on this Map"
          className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:border-red-500/40 hover:bg-red-950/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" />
          <span>Clear</span>
        </button>
      </div>
    </header>
  );
}
