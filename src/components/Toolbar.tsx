import {
  AlertTriangle,
  ClipboardList,
  CloudFog,
  Eraser,
  Eye,
  EyeOff,
  Grid3x3,
  Hexagon,
  ImageDown,
  Maximize2,
  Package,
  Redo2,
  Shield,
  Tag,
  Undo2,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MapViewMode } from '../domain/fogOfWar';
import {
  formatActiveBrushLabel,
  formatMapSummaryCounts,
} from '../domain/plannerEngine';
import type { ActiveBrush, MapSummary, OverlayPack, Tileset } from '../domain/types';
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
  activeBrush: ActiveBrush | null;
  onClearBrush: () => void;
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  placementCount: number;
  overlayCount: number;
  overBudgetTileCount: number;
  overBudgetOverlayCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRequestClearMap: () => void;
  onOpenCollection: () => void;
  onOpenPngExport: () => void;
  viewMode: MapViewMode;
  onChangeViewMode: (mode: MapViewMode) => void;
  fogToolActive: boolean;
  onToggleFogTool: () => void;
  coveredCount: number;
  onCoverAll: () => void;
  onRevealAll: () => void;
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
  overlayPacksById,
  placementCount,
  overlayCount,
  overBudgetTileCount,
  overBudgetOverlayCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRequestClearMap,
  onOpenCollection,
  onOpenPngExport,
  viewMode,
  onChangeViewMode,
  fogToolActive,
  onToggleFogTool,
  coveredCount,
  onCoverAll,
  onRevealAll,
}: ToolbarProps) {
  const activeLabel = activeBrush
    ? formatActiveBrushLabel(activeBrush, tilesetsById, overlayPacksById)
    : null;
  const totalOverBudget = overBudgetTileCount + overBudgetOverlayCount;
  const overBudgetTooltip = `${overBudgetTileCount} Tile ${
    overBudgetTileCount === 1 ? 'Placement' : 'Placements'
  }, ${overBudgetOverlayCount} Overlay ${
    overBudgetOverlayCount === 1 ? 'Placement' : 'Placements'
  } over budget`;

  const viewModeToggle = (
    <div
      role="group"
      aria-label="View mode"
      className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917] p-0.5 text-xs"
    >
      <button
        type="button"
        onClick={() => onChangeViewMode('gm')}
        aria-pressed={viewMode === 'gm'}
        title="GM View (full editing and semi-transparent Fog peek)"
        className={`flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors ${
          viewMode === 'gm'
            ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
            : 'text-stone-400 hover:text-stone-200'
        }`}
      >
        <Shield className="h-3.5 w-3.5" />
        <span>GM View</span>
      </button>
      <button
        type="button"
        onClick={() => onChangeViewMode('player')}
        aria-pressed={viewMode === 'player'}
        title="Player View (spoiler-safe opaque Fog covers, click/drag to reveal)"
        className={`flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors ${
          viewMode === 'player'
            ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
            : 'text-stone-400 hover:text-stone-200'
        }`}
      >
        <Users className="h-3.5 w-3.5" />
        <span>Player View</span>
      </button>
    </div>
  );

  const zoomAndGridControls = (
    <>
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
    </>
  );

  if (viewMode === 'player') {
    return (
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#2e2a26] bg-[#161412] px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
            <Hexagon className="h-4 w-4" />
          </div>
          <h1 className="hidden text-sm font-semibold tracking-tight text-stone-100 lg:block">
            Realm Brew
          </h1>
          <span className="max-w-64 truncate rounded border border-[#2e2a26] bg-[#1c1917] px-2.5 py-1 text-xs font-medium text-stone-200">
            {activeMapName}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {viewModeToggle}
          {zoomAndGridControls}
        </div>
      </header>
    );
  }

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#2e2a26] bg-[#161412] px-3 py-1.5">
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
          {formatMapSummaryCounts(placementCount, overlayCount)}
        </span>

        {totalOverBudget > 0 && (
          <button
            type="button"
            onClick={onOpenCollection}
            title={overBudgetTooltip}
            aria-label={`${totalOverBudget} over budget — ${overBudgetTooltip}`}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-red-500/40 bg-red-950/50 px-2 py-0.5 text-xs font-medium text-red-300 transition hover:bg-red-900/60"
          >
            <AlertTriangle className="h-3 w-3 text-red-400" />
            {totalOverBudget} over
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {activeLabel && (
          <div
            title={activeLabel}
            className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
          >
            <span className="max-w-44 truncate font-mono font-semibold">{activeLabel}</span>
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

        {zoomAndGridControls}

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

        <div
          role="group"
          aria-label="Fog of War controls"
          className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917]"
        >
          <button
            type="button"
            onClick={onToggleFogTool}
            aria-pressed={fogToolActive}
            title="Fog paint tool — click or drag across occupied Tiles (Esc to exit)"
            className={`flex items-center gap-1 rounded-l-md px-2 py-1.5 text-xs font-medium transition-colors ${
              fogToolActive
                ? 'bg-slate-600/35 text-slate-100 ring-1 ring-slate-400/50'
                : 'text-stone-300 hover:bg-stone-800 hover:text-stone-100'
            }`}
          >
            <CloudFog className="h-3.5 w-3.5 text-slate-300" />
            <span>Fog</span>
          </button>
          <button
            type="button"
            onClick={onCoverAll}
            disabled={placementCount === 0 || coveredCount === placementCount}
            title="Cover all Placements with Fog of War"
            className="flex items-center gap-1 border-l border-[#2e2a26] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <EyeOff className="h-3.5 w-3.5" />
            <span>Cover all</span>
          </button>
          <button
            type="button"
            onClick={onRevealAll}
            disabled={placementCount === 0 || coveredCount === 0}
            title="Reveal all Placements from Fog of War"
            className="flex items-center gap-1 rounded-r-md border-l border-[#2e2a26] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Reveal all</span>
          </button>
        </div>

        {viewModeToggle}

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
          onClick={onOpenPngExport}
          disabled={placementCount === 0}
          title={
            placementCount === 0
              ? 'Place at least one Tile before exporting PNG'
              : 'Export tightly cropped PNG'
          }
          className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ImageDown className="h-3.5 w-3.5 text-amber-400" />
          <span>PNG</span>
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
