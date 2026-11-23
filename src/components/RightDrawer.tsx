import { ChevronLeft, ChevronRight, ClipboardList, Layers } from 'lucide-react';
import type { PullListSummary } from '../domain/plannerEngine';
import type { AxialCoord, OverlayPack, Placement, Tileset } from '../domain/types';
import { HostInspectorPanel } from './HostInspectorPanel';
import { PullListPanel } from './PullListPanel';

export type RightDrawerTab = 'inspector' | 'pull-list';

interface RightDrawerProps {
  collapsed: boolean;
  activeTab: RightDrawerTab;
  onTabChange: (tab: RightDrawerTab) => void;
  onToggleCollapse: () => void;
  onExpandToInspector: () => void;
  mapName: string;
  pullList: PullListSummary;
  placements: readonly Placement[];
  selectedHost: Placement | undefined;
  focusedOverlayId: string | null;
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  onSelectHostCoord: (coord: AxialCoord) => void;
  onFocusOverlayId: (overlayId: string | null) => void;
  onHoverOverlayId: (overlayId: string | null) => void;
  onRotateHost: (coord: AxialCoord, delta: 1 | -1) => void;
  onFlipHost: (coord: AxialCoord) => void;
  onRemoveHost: (coord: AxialCoord) => void;
  onReorderOverlay: (hostCoord: AxialCoord, overlayId: string, direction: 'up' | 'down') => void;
  onRemoveOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
  onCenterOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
  onRotateOverlayDelta: (hostCoord: AxialCoord, overlayId: string, deltaDeg: number) => void;
  onSetOverlayLocalRotation: (hostCoord: AxialCoord, overlayId: string, localDeg: number) => void;
  onPreviewOverlayRotation: (
    preview: { hostCoord: AxialCoord; overlayId: string; worldDeg: number } | null,
  ) => void;
}

export function RightDrawer({
  collapsed,
  activeTab,
  onTabChange,
  onToggleCollapse,
  onExpandToInspector,
  mapName,
  pullList,
  placements,
  selectedHost,
  focusedOverlayId,
  tilesetsById,
  overlayPacksById,
  onSelectHostCoord,
  onFocusOverlayId,
  onHoverOverlayId,
  onRotateHost,
  onFlipHost,
  onRemoveHost,
  onReorderOverlay,
  onRemoveOverlay,
  onCenterOverlay,
  onRotateOverlayDelta,
  onSetOverlayLocalRotation,
  onPreviewOverlayRotation,
}: RightDrawerProps) {
  const attachedOverlayCount = selectedHost?.overlays?.length ?? 0;

  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center border-l border-[#2e2a26] bg-[#161412] py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand drawer (])"
          aria-label="Expand right drawer"
          className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="mt-4 flex flex-col items-center gap-2 text-stone-500">
          {activeTab === 'pull-list' ? (
            <ClipboardList className="h-4 w-4 text-amber-400/80" />
          ) : (
            <Layers className="h-4 w-4 text-amber-400/80" />
          )}
          <span className="[writing-mode:vertical-rl] text-[11px] font-medium tracking-wider uppercase">
            {activeTab === 'pull-list' ? 'Pull List' : 'Inspector'}
          </span>
        </div>

        {selectedHost && (
          <button
            type="button"
            onClick={onExpandToInspector}
            title={`Selected host (${selectedHost.q}, ${selectedHost.r}) · ${attachedOverlayCount} ${
              attachedOverlayCount === 1 ? 'Overlay' : 'Overlays'
            }`}
            aria-label={`Attached Overlays: ${attachedOverlayCount}`}
            className={`mt-3 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
              attachedOverlayCount > 0
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
                : 'border-[#2e2a26] bg-[#1c1917] text-stone-400 hover:text-stone-200'
            }`}
          >
            {attachedOverlayCount}
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-[#2e2a26] bg-[#161412]">
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-2.5 py-2">
        <div
          className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-[#1c1917] p-1"
          role="tablist"
          aria-label="Right drawer panel"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inspector'}
            onClick={() => onTabChange('inspector')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'inspector'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Inspector</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pull-list'}
            onClick={() => onTabChange('pull-list')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'pull-list'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Pull List</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse drawer (])"
          aria-label="Collapse right drawer"
          className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {activeTab === 'inspector' ? (
        <HostInspectorPanel
          placements={placements}
          selectedHost={selectedHost}
          focusedOverlayId={focusedOverlayId}
          tilesetsById={tilesetsById}
          overlayPacksById={overlayPacksById}
          onSelectHostCoord={onSelectHostCoord}
          onFocusOverlayId={onFocusOverlayId}
          onHoverOverlayId={onHoverOverlayId}
          onRotateHost={onRotateHost}
          onFlipHost={onFlipHost}
          onRemoveHost={onRemoveHost}
          onReorderOverlay={onReorderOverlay}
          onRemoveOverlay={onRemoveOverlay}
          onCenterOverlay={onCenterOverlay}
          onRotateOverlayDelta={onRotateOverlayDelta}
          onSetOverlayLocalRotation={onSetOverlayLocalRotation}
          onPreviewOverlayRotation={onPreviewOverlayRotation}
        />
      ) : (
        <PullListPanel mapName={mapName} pullList={pullList} />
      )}
    </aside>
  );
}
