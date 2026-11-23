// THROWAWAY PROTOTYPE STATE HUD for Wayfinder #13

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import {
  findOverlayOnHost,
  findProtoPlacementAt,
  overlayLocalToWorld,
  type OverlayRef,
  type ProtoBrush,
  type ProtoPlacement,
  type VariantKey,
} from './overlayPrototypeModel';
import { VARIANT_META } from './PrototypeSwitcher';

interface PrototypeStateDrawerProps {
  variant: VariantKey;
  placements: readonly ProtoPlacement[];
  selectedHostCoord: { q: number; r: number } | null;
  selectedOverlay: OverlayRef | null;
  activeBrush: ProtoBrush | null;
  layerMode?: 'tiles' | 'overlays';
  eventLog: readonly string[];
}

export function PrototypeStateDrawer({
  variant,
  placements,
  selectedHostCoord,
  selectedOverlay,
  activeBrush,
  layerMode,
  eventLog,
}: PrototypeStateDrawerProps) {
  const [expanded, setExpanded] = useState(true);
  const meta = VARIANT_META[variant];

  const totalOverlays = placements.reduce((sum, p) => sum + p.overlays.length, 0);
  const selectedOvMatch = findOverlayOnHost(placements, selectedOverlay);
  const selectedHost = selectedHostCoord
    ? findProtoPlacementAt(placements, selectedHostCoord)
    : undefined;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-40 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-[#2e2a26] bg-[#161412]/92 text-xs shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-violet-400" />
          <span className="font-semibold text-stone-100">
            Live State · {placements.length} Tiles, {totalOverlays} Overlays
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-stone-400" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[#2e2a26] px-3 py-2.5 text-[11px]">
          <p className="text-stone-400">{meta.summary}</p>

          <div className="space-y-1 rounded-lg border border-[#2e2a26] bg-[#1c1917] p-2 font-mono">
            {layerMode && (
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Edit Layer:</span>
                <span className={layerMode === 'overlays' ? 'text-sky-300' : 'text-amber-300'}>
                  {layerMode === 'overlays' ? 'Overlays' : 'Tiles'}
                </span>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <span className="text-stone-500">Brush:</span>
              <span className="truncate text-stone-200">
                {activeBrush
                  ? activeBrush.kind === 'tile'
                    ? `Tile #${String(activeBrush.faceNumber).padStart(2, '0')} (${activeBrush.rotation * 60}°)`
                    : `Overlay ${activeBrush.shortCode} ${activeBrush.label}`
                  : 'None (Select/Manipulate)'}
              </span>
            </div>

            {selectedOvMatch ? (
              <>
                <div className="flex justify-between gap-2">
                  <span className="text-stone-500">Selected:</span>
                  <span className="truncate text-sky-300">
                    {selectedOvMatch.overlay.shortCode} {selectedOvMatch.overlay.label}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-stone-500">Host & Layer:</span>
                  <span className="text-stone-200">
                    ({selectedOvMatch.host.q},{selectedOvMatch.host.r}) · z{' '}
                    {selectedOvMatch.index + 1}/{selectedOvMatch.host.overlays.length}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-stone-500">Local / World:</span>
                  <span className="text-stone-200">
                    ({selectedOvMatch.overlay.offsetX.toFixed(2)},{' '}
                    {selectedOvMatch.overlay.offsetY.toFixed(2)}) ·{' '}
                    {Math.round(selectedOvMatch.overlay.rotationDeg)}° /{' '}
                    {Math.round(
                      overlayLocalToWorld(selectedOvMatch.host, selectedOvMatch.overlay).worldDeg,
                    )}
                    °
                  </span>
                </div>
              </>
            ) : selectedHost ? (
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Selected Host:</span>
                <span className="text-amber-300">
                  ({selectedHost.q},{selectedHost.r}) · #{String(selectedHost.faceNumber).padStart(2, '0')} ·{' '}
                  {selectedHost.overlays.length} Overlays
                </span>
              </div>
            ) : (
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Selected:</span>
                <span className="text-stone-400">None</span>
              </div>
            )}
          </div>

          {eventLog.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
                Recent Actions
              </div>
              {eventLog.slice(0, 4).map((entry, idx) => (
                <div
                  key={`${idx}-${entry}`}
                  className={`truncate ${idx === 0 ? 'text-stone-200' : 'text-stone-500'}`}
                  title={entry}
                >
                  • {entry}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
