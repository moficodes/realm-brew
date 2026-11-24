import { ImageDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ExportBackground, ExportFogMode } from '../canvas/pngExporter';
import { formatMapSummaryCounts } from '../domain/plannerEngine';
import { useModalDialog } from './useModalDialog';

interface PngExportDialogProps {
  open: boolean;
  onClose: () => void;
  mapName: string;
  placementCount: number;
  overlayCount: number;
  coveredCount: number;
  defaultIncludeLabels: boolean;
  onExport: (options: {
    background: ExportBackground;
    includeLabels: boolean;
    fogMode: ExportFogMode;
  }) => Promise<void>;
}

export function formatPngExportSummary(
  placementCount: number,
  overlayCount: number,
  coveredCount: number,
): string {
  const base = formatMapSummaryCounts(placementCount, overlayCount);
  return coveredCount > 0 ? `${base} · ${coveredCount} covered` : base;
}

export function PngExportDialog({
  open,
  onClose,
  mapName,
  placementCount,
  overlayCount,
  coveredCount,
  defaultIncludeLabels,
  onExport,
}: PngExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const wasOpenRef = useRef(false);
  const priorIncludeLabelsRef = useRef(defaultIncludeLabels);

  const [background, setBackground] = useState<ExportBackground>('dark');
  const [fogMode, setFogMode] = useState<ExportFogMode>('gm');
  const [includeLabels, setIncludeLabels] = useState(defaultIncludeLabels);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setFogMode('gm');
      setIncludeLabels(defaultIncludeLabels);
      priorIncludeLabelsRef.current = defaultIncludeLabels;
      setError(null);
    }
    wasOpenRef.current = open;
  }, [defaultIncludeLabels, open]);

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: true,
  });

  const hasCoveredPlacements = coveredCount > 0;
  const effectiveFogMode: ExportFogMode = hasCoveredPlacements ? fogMode : 'none';
  const isPlayerFog = effectiveFogMode === 'player';

  const handleFogModeChange = (nextMode: ExportFogMode) => {
    if (nextMode === fogMode) return;
    if (nextMode === 'player') {
      if (fogMode !== 'player') {
        priorIncludeLabelsRef.current = includeLabels;
      }
      setFogMode('player');
      setIncludeLabels(false);
      return;
    }
    if (fogMode === 'player') {
      setIncludeLabels(priorIncludeLabelsRef.current);
    }
    setFogMode(nextMode);
  };

  const handleIncludeLabelsChange = (checked: boolean) => {
    setIncludeLabels(checked);
    priorIncludeLabelsRef.current = checked;
  };

  const handleExportClick = async () => {
    setExporting(true);
    setError(null);
    try {
      await onExport({
        background,
        includeLabels: isPlayerFog ? false : includeLabels,
        fogMode: effectiveFogMode,
      });
      dialogRef.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PNG');
    } finally {
      setExporting(false);
    }
  };

  const summaryCounts = formatPngExportSummary(placementCount, overlayCount, coveredCount);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="w-full max-w-md rounded-xl border border-[#2e2a26] bg-[#161412] p-0 text-stone-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <ImageDown className="h-4 w-4 text-amber-400" />
          <h2 id={titleId} className="text-sm font-semibold text-stone-100">
            Export PNG
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close PNG Export dialog"
          className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4 text-xs">
        <p className="text-stone-400">
          Exports <span className="font-medium text-stone-200">{mapName}</span> ({summaryCounts})
          tightly cropped around your Map.
        </p>

        <fieldset className="space-y-2">
          <legend className="font-semibold text-stone-200">Background</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
              <input
                type="radio"
                name="png-bg"
                value="dark"
                checked={background === 'dark'}
                onChange={() => setBackground('dark')}
                autoFocus
                className="accent-amber-500"
              />
              <div>
                <div className="font-medium text-stone-100">Dark charcoal</div>
                <div className="text-[11px] text-stone-400">Matches dungeon void</div>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
              <input
                type="radio"
                name="png-bg"
                value="transparent"
                checked={background === 'transparent'}
                onChange={() => setBackground('transparent')}
                className="accent-amber-500"
              />
              <div>
                <div className="font-medium text-stone-100">Transparent</div>
                <div className="text-[11px] text-stone-400">Alpha corners</div>
              </div>
            </label>
          </div>
        </fieldset>

        {hasCoveredPlacements && (
          <fieldset className="space-y-2">
            <legend className="font-semibold text-stone-200">Fog of War</legend>
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
                <input
                  type="radio"
                  name="png-fog"
                  value="gm"
                  checked={fogMode === 'gm'}
                  onChange={() => handleFogModeChange('gm')}
                  className="accent-amber-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-stone-100">GM Fog</div>
                  <div className="text-[11px] text-stone-400">
                    Semi-transparent #37 covers with Fog badges · -gm.png
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
                <input
                  type="radio"
                  name="png-fog"
                  value="player"
                  checked={fogMode === 'player'}
                  onChange={() => handleFogModeChange('player')}
                  className="accent-amber-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-stone-100">Player Fog</div>
                  <div className="text-[11px] text-stone-400">
                    Opaque #37 covers; omits covered Overlays and labels · -player.png
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
                <input
                  type="radio"
                  name="png-fog"
                  value="none"
                  checked={fogMode === 'none'}
                  onChange={() => handleFogModeChange('none')}
                  className="accent-amber-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-stone-100">No Fog (all revealed)</div>
                  <div className="text-[11px] text-stone-400">
                    Reveals all covered Tiles and Overlays · .png
                  </div>
                </div>
              </label>
            </div>
          </fieldset>
        )}

        <label
          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
            isPlayerFog
              ? 'cursor-not-allowed border-[#2e2a26]/70 bg-[#1c1917]/60 opacity-75'
              : 'cursor-pointer border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
          }`}
        >
          <div>
            <div className="font-medium text-stone-100">Include assembly labels</div>
            <div className="text-[11px] text-stone-400">
              Draws {'<ShortCode> #<Face>'} Tile badges, 0° arrows, and Overlay callout pills
            </div>
            {isPlayerFog && (
              <div className="mt-1 text-[11px] text-amber-300/90">
                Disabled in Player Fog to protect hidden Tile and Overlay spoilers.
              </div>
            )}
          </div>
          <input
            type="checkbox"
            checked={isPlayerFog ? false : includeLabels}
            disabled={isPlayerFog}
            onChange={(e) => handleIncludeLabelsChange(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-amber-500 disabled:cursor-not-allowed"
          />
        </label>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-950/50 px-3 py-2 text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[#2e2a26] px-5 py-3">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-3.5 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-stone-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={exporting || placementCount === 0}
          onClick={() => void handleExportClick()}
          className="rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? 'Exporting…' : 'Download PNG'}
        </button>
      </div>
    </dialog>
  );
}
