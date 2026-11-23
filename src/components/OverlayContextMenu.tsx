import { Crosshair, Layers, Trash2 } from 'lucide-react';
import type { OverlayHit } from '../domain/overlayGeometry';
import { resolveOverlayAsset } from '../domain/plannerEngine';
import type { AxialCoord, OverlayPack } from '../domain/types';

export interface OverlayContextMenuState {
  x: number;
  y: number;
  coord: AxialCoord;
  overlayCount: number;
  hitOverlay: OverlayHit | null;
}

interface OverlayContextMenuProps {
  menu: OverlayContextMenuState;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  onFocusOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
  onDeleteOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
  onSelectHost: (coord: AxialCoord) => void;
  onDeleteHost: (coord: AxialCoord) => void;
}

export function OverlayContextMenu({
  menu,
  overlayPacksById,
  onFocusOverlay,
  onDeleteOverlay,
  onSelectHost,
  onDeleteHost,
}: OverlayContextMenuProps) {
  const hitLabel = menu.hitOverlay
    ? (() => {
        const asset = resolveOverlayAsset(menu.hitOverlay.overlay, overlayPacksById);
        return asset.status === 'ok' ? asset.overlay.label : menu.hitOverlay.overlay.overlayId;
      })()
    : null;

  return (
    <div
      role="menu"
      aria-label="Placement actions"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: menu.x, top: menu.y }}
      className="absolute z-50 w-56 rounded-lg border border-[#2e2a26] bg-[#161412]/98 p-1 text-xs shadow-2xl backdrop-blur"
    >
      {menu.hitOverlay && hitLabel && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onFocusOverlay(menu.hitOverlay!.hostCoord, menu.hitOverlay!.overlay.id)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sky-200 transition-colors hover:bg-sky-500/15"
          >
            <Crosshair className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Focus &ldquo;{hitLabel}&rdquo;</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onDeleteOverlay(menu.hitOverlay!.hostCoord, menu.hitOverlay!.overlay.id)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-red-300 transition-colors hover:bg-red-500/15"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Delete &ldquo;{hitLabel}&rdquo;</span>
          </button>
          <div className="my-1 border-t border-[#2e2a26]" />
        </>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => onSelectHost(menu.coord)}
        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-amber-200 transition-colors hover:bg-amber-500/15"
      >
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span>
          Select Host Tile ({menu.coord.q}, {menu.coord.r})
        </span>
      </button>

      <div className="my-1 border-t border-[#2e2a26]" />

      <button
        type="button"
        role="menuitem"
        onClick={() => onDeleteHost(menu.coord)}
        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-red-300 transition-colors hover:bg-red-950/60"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          Delete Host Tile
          {menu.overlayCount > 0
            ? ` & ${menu.overlayCount} ${menu.overlayCount === 1 ? 'Overlay' : 'Overlays'}`
            : ''}
        </span>
      </button>
    </div>
  );
}
