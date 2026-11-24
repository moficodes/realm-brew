import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CloudFog,
  Eye,
  EyeOff,
  FlipHorizontal2,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { overlayLocalToWorld } from '../domain/overlayGeometry';
import {
  canFlipTarget,
  formatAssemblyLabel,
  resolveOverlayAsset,
  resolvePlacementAsset,
} from '../domain/plannerEngine';
import type { AxialCoord, OverlayPack, OverlayPlacement, Placement, Tileset } from '../domain/types';
import { formatDisplayDegrees } from '../utils/browserHelpers';
import { CHECKERBOARD_MINI_STYLE } from './paletteStyles';

export interface HostInspectorPanelProps {
  selectedHost: Placement | undefined;
  focusedOverlayId: string | null;
  tilesetsById: ReadonlyMap<string, Tileset>;
  overlayPacksById: ReadonlyMap<string, OverlayPack>;
  onFocusOverlayId: (overlayId: string | null) => void;
  onHoverOverlayId: (overlayId: string | null) => void;
  onRotateHost: (coord: AxialCoord, delta: 1 | -1) => void;
  onFlipHost: (coord: AxialCoord) => void;
  onToggleHostFog: (coord: AxialCoord) => void;
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

export function HostInspectorPanel({
  selectedHost,
  focusedOverlayId,
  tilesetsById,
  overlayPacksById,
  onFocusOverlayId,
  onHoverOverlayId,
  onRotateHost,
  onFlipHost,
  onToggleHostFog,
  onRemoveHost,
  onReorderOverlay,
  onRemoveOverlay,
  onCenterOverlay,
  onRotateOverlayDelta,
  onSetOverlayLocalRotation,
  onPreviewOverlayRotation,
}: HostInspectorPanelProps) {
  const hostOverlays: readonly OverlayPlacement[] = selectedHost?.overlays ?? [];
  const focusedOverlay =
    selectedHost && focusedOverlayId
      ? hostOverlays.find((ov) => ov.id === focusedOverlayId) ?? null
      : null;

  const [sliderDraftDeg, setSliderDraftDeg] = useState<number | null>(null);
  const sliderDragRef = useRef<{
    hostCoord: AxialCoord;
    overlayId: string;
    startDeg: number;
    draftDeg: number;
  } | null>(null);
  const commitSliderRef = useRef<() => void>(() => {});
  const onPreviewOverlayRotationRef = useRef(onPreviewOverlayRotation);
  onPreviewOverlayRotationRef.current = onPreviewOverlayRotation;

  useEffect(() => {
    sliderDragRef.current = null;
    setSliderDraftDeg(null);
    onPreviewOverlayRotationRef.current(null);
  }, [focusedOverlay?.id, selectedHost?.q, selectedHost?.r]);

  useEffect(() => {
    return () => {
      window.removeEventListener('pointerup', commitSliderRef.current);
      window.removeEventListener('pointercancel', commitSliderRef.current);
      sliderDragRef.current = null;
      onPreviewOverlayRotationRef.current(null);
    };
  }, []);

  if (!selectedHost) {
    return (
      <div className="rb-scroll flex-1 overflow-y-auto p-3">
        <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-3 text-xs text-stone-400">
          Click any placed Tile to inspect its facing, attached Overlays, and stacking order.
        </div>
      </div>
    );
  }

  const hostCoord = { q: selectedHost.q, r: selectedHost.r };
  const hostAsset = resolvePlacementAsset(selectedHost, tilesetsById);
  const canFlipHost = canFlipTarget(selectedHost, tilesetsById);

  const commitSliderIfActive = () => {
    window.removeEventListener('pointerup', commitSliderRef.current);
    window.removeEventListener('pointercancel', commitSliderRef.current);
    const drag = sliderDragRef.current;
    if (!drag) return;
    sliderDragRef.current = null;
    setSliderDraftDeg(null);
    onPreviewOverlayRotation(null);
    if (drag.draftDeg !== drag.startDeg) {
      onSetOverlayLocalRotation(drag.hostCoord, drag.overlayId, drag.draftDeg);
    }
  };
  commitSliderRef.current = commitSliderIfActive;

  const focusedAsset = focusedOverlay
    ? resolveOverlayAsset(focusedOverlay, overlayPacksById)
    : null;
  const focusedLabel = focusedOverlay
    ? focusedAsset?.status === 'ok'
      ? focusedAsset.overlay.label
      : focusedOverlay.overlayId
    : '';
  const activeSliderDeg =
    focusedOverlay !== null
      ? sliderDraftDeg ?? formatDisplayDegrees(focusedOverlay.rotationDeg)
      : 0;
  const focusedWorldDeg =
    focusedOverlay !== null
      ? overlayLocalToWorld(selectedHost, {
          ...focusedOverlay,
          rotationDeg: activeSliderDeg,
        }).worldDeg
      : 0;

  return (
    <div className="rb-scroll flex-1 overflow-y-auto p-3">
      <div className="space-y-4">
        {/* Host Tile Summary Card */}
        <div className="rounded-lg border border-amber-500/30 bg-[#1c1917] p-2.5">
          <div className="flex items-center gap-2.5">
            {hostAsset.status === 'ok' ? (
              <img
                src={hostAsset.url}
                alt={formatAssemblyLabel(selectedHost, tilesetsById)}
                className="h-12 w-12 shrink-0 rounded border border-[#2e2a26] bg-[#221f1c] object-contain p-0.5"
                style={{ transform: `rotate(${selectedHost.rotation * 60}deg)` }}
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-dashed border-amber-500/50 bg-amber-950/25 text-amber-300">
                <AlertTriangle className="h-4 w-4" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold text-amber-300">
                  {formatAssemblyLabel(selectedHost, tilesetsById)}
                </span>
                <div className="flex items-center gap-1">
                  {selectedHost.covered && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-slate-500/40 bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
                      <CloudFog className="h-2.5 w-2.5" />
                      Fog
                    </span>
                  )}
                  <span className="rounded bg-[#161412] px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                    ({selectedHost.q}, {selectedHost.r})
                  </span>
                </div>
              </div>
              <div className="mt-0.5 text-[11px] text-stone-400">
                Rotation: {selectedHost.rotation * 60}° · {hostOverlays.length}{' '}
                {hostOverlays.length === 1 ? 'Overlay' : 'Overlays'}
              </div>
              {hostAsset.status !== 'ok' && (
                <div className="mt-1 text-[10px] font-medium text-amber-300">
                  Missing asset ({selectedHost.tilesetId})
                </div>
              )}
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => onRotateHost(hostCoord, -1)}
              title="Rotate host Tile -60°"
              className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
            >
              <RotateCcw className="h-3 w-3" />
              -60°
            </button>
            <button
              type="button"
              onClick={() => onRotateHost(hostCoord, 1)}
              title="Rotate host Tile +60°"
              className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
            >
              <RotateCw className="h-3 w-3" />
              +60°
            </button>
            <button
              type="button"
              disabled={!canFlipHost}
              onClick={() => onFlipHost(hostCoord)}
              title={
                canFlipHost
                  ? 'Flip host Tile (F)'
                  : 'Symmetric Tile has no distinct opposite face'
              }
              className="flex items-center justify-center gap-1 rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FlipHorizontal2 className="h-3 w-3" />
              Flip
            </button>
            <button
              type="button"
              title="Delete Host Tile & attached Overlays"
              aria-label="Delete Host Tile"
              onClick={() => onRemoveHost(hostCoord)}
              className="flex items-center justify-center rounded border border-red-500/30 bg-red-950/50 py-1 text-red-200 hover:bg-red-900/60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onToggleHostFog(hostCoord)}
            aria-pressed={Boolean(selectedHost.covered)}
            title={
              selectedHost.covered
                ? 'Reveal this Placement from Fog of War'
                : 'Cover this Placement and its Overlays with Fog of War'
            }
            className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border py-1 text-[11px] font-medium transition ${
              selectedHost.covered
                ? 'border-slate-400/50 bg-slate-700/40 text-slate-100 hover:bg-slate-700/60'
                : 'border-[#2e2a26] bg-[#161412] text-stone-200 hover:bg-stone-800'
            }`}
          >
            {selectedHost.covered ? (
              <>
                <Eye className="h-3.5 w-3.5 text-sky-300" />
                <span>Reveal from Fog</span>
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5 text-slate-300" />
                <span>Cover with Fog</span>
              </>
            )}
          </button>
        </div>

        {/* Attached Overlays Stack List (top-to-bottom) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
            <span>Attached Overlays ({hostOverlays.length})</span>
            {focusedOverlay && (
              <button
                type="button"
                onClick={() => onFocusOverlayId(null)}
                className="text-[10px] font-medium text-stone-400 normal-case hover:text-stone-100"
              >
                Focus Tile
              </button>
            )}
          </div>

          {hostOverlays.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#2e2a26] p-3 text-center text-xs text-stone-500">
              No Overlays attached. Pick one from the Overlays tab and click or drop on this Tile.
            </div>
          ) : (
            <div className="space-y-1.5">
              {[...hostOverlays].reverse().map((ov, revIdx) => {
                const realIdx = hostOverlays.length - 1 - revIdx;
                const isFocused = focusedOverlay?.id === ov.id;
                const ovAsset = resolveOverlayAsset(ov, overlayPacksById);
                const isMissing = ovAsset.status !== 'ok';
                const label = ovAsset.status === 'ok' ? ovAsset.overlay.label : ov.overlayId;

                return (
                  <div
                    key={ov.id}
                    onMouseEnter={() => onHoverOverlayId(ov.id)}
                    onMouseLeave={() => onHoverOverlayId(null)}
                    className={`flex items-center gap-2 rounded-lg border p-1.5 transition ${
                      isFocused
                        ? 'border-sky-400 bg-sky-500/15'
                        : 'border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onFocusOverlayId(ov.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {ovAsset.status === 'ok' ? (
                        <img
                          src={ovAsset.url}
                          alt={label}
                          style={CHECKERBOARD_MINI_STYLE}
                          className="h-9 w-9 shrink-0 rounded border border-[#2e2a26] object-contain p-0.5"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-amber-500/70 bg-amber-950/30 text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-stone-100">{label}</div>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-stone-400">
                          <span>
                            z {realIdx + 1} · {formatDisplayDegrees(ov.rotationDeg)}°
                          </span>
                          {isMissing && (
                            <span className="rounded bg-amber-950/70 px-1 py-0.2 text-[9px] font-semibold text-amber-300">
                              Missing asset
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={realIdx === hostOverlays.length - 1}
                        onClick={() => onReorderOverlay(hostCoord, ov.id, 'up')}
                        title="Bring Forward"
                        aria-label={`Bring ${label} forward`}
                        className="rounded p-1 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={realIdx === 0}
                        onClick={() => onReorderOverlay(hostCoord, ov.id, 'down')}
                        title="Send Backward"
                        aria-label={`Send ${label} backward`}
                        className="rounded p-1 text-stone-300 hover:bg-stone-800 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveOverlay(hostCoord, ov.id)}
                        title="Remove Overlay"
                        aria-label={`Delete ${label}`}
                        className="rounded p-1 text-red-300 hover:bg-red-950/60"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Focused Overlay Precision Controls */}
        {focusedOverlay && (
          <div className="space-y-2.5 rounded-lg border border-sky-500/35 bg-[#1c1917] p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-sky-300">{focusedLabel}</span>
              <button
                type="button"
                onClick={() => onCenterOverlay(hostCoord, focusedOverlay.id)}
                className="shrink-0 rounded border border-[#2e2a26] bg-[#161412] px-2 py-0.5 text-[11px] text-stone-200 hover:bg-stone-800"
              >
                Center on Tile
              </button>
            </div>

            {focusedAsset?.status !== 'ok' && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <div>
                  <span className="font-semibold text-amber-300">Missing asset</span> —{' '}
                  <span className="font-mono text-[10px]">
                    {focusedOverlay.overlayPackId}/{focusedOverlay.overlayId}
                  </span>
                  . Still movable, reparentable, rotatable, reorderable, and deletable.
                </div>
              </div>
            )}

            <div className="grid grid-cols-5 gap-1 font-mono text-[11px]">
              {[-60, -15, 0, 15, 60].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() =>
                    val === 0
                      ? onSetOverlayLocalRotation(hostCoord, focusedOverlay.id, 0)
                      : onRotateOverlayDelta(hostCoord, focusedOverlay.id, val)
                  }
                  className="rounded border border-[#2e2a26] bg-[#161412] py-1 text-stone-200 hover:bg-stone-800"
                >
                  {val === 0 ? '0°' : val > 0 ? `+${val}` : val}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={359}
                aria-label="Overlay rotation degrees"
                value={activeSliderDeg}
                onPointerDown={() => {
                  const startDeg = formatDisplayDegrees(focusedOverlay.rotationDeg);
                  sliderDragRef.current = {
                    hostCoord,
                    overlayId: focusedOverlay.id,
                    startDeg,
                    draftDeg: startDeg,
                  };
                  setSliderDraftDeg(startDeg);
                  window.addEventListener('pointerup', commitSliderRef.current);
                  window.addEventListener('pointercancel', commitSliderRef.current);
                }}
                onChange={(e) => {
                  const deg = Number(e.target.value);
                  if (sliderDragRef.current) {
                    sliderDragRef.current.draftDeg = deg;
                    setSliderDraftDeg(deg);
                    const previewWorld = overlayLocalToWorld(selectedHost, {
                      ...focusedOverlay,
                      rotationDeg: deg,
                    });
                    onPreviewOverlayRotation({
                      hostCoord,
                      overlayId: focusedOverlay.id,
                      worldDeg: previewWorld.worldDeg,
                    });
                  } else {
                    onSetOverlayLocalRotation(hostCoord, focusedOverlay.id, deg);
                  }
                }}
                onPointerUp={commitSliderIfActive}
                onPointerCancel={commitSliderIfActive}
                onBlur={commitSliderIfActive}
                className="h-1.5 flex-1 accent-sky-400"
              />
              <span className="w-9 text-right font-mono text-[11px] text-stone-200">
                {activeSliderDeg}°
              </span>
            </div>

            <div className="space-y-0.5 rounded bg-[#161412] px-2 py-1.5 font-mono text-[10px] text-stone-400">
              <div>
                Offset: ({focusedOverlay.offsetX.toFixed(2)}, {focusedOverlay.offsetY.toFixed(2)}) R
              </div>
              <div>
                Local: {activeSliderDeg}° · World: {formatDisplayDegrees(focusedWorldDeg)}°
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
