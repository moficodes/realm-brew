import { ImageDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ExportBackground } from '../canvas/pngExporter';
import { useModalDialog } from './useModalDialog';

interface PngExportDialogProps {
  open: boolean;
  onClose: () => void;
  mapName: string;
  placementCount: number;
  defaultIncludeLabels: boolean;
  onExport: (options: { background: ExportBackground; includeLabels: boolean }) => Promise<void>;
}

export function PngExportDialog({
  open,
  onClose,
  mapName,
  placementCount,
  defaultIncludeLabels,
  onExport,
}: PngExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [background, setBackground] = useState<ExportBackground>('dark');
  const [includeLabels, setIncludeLabels] = useState(defaultIncludeLabels);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIncludeLabels(defaultIncludeLabels);
      setError(null);
    }
  }, [defaultIncludeLabels, open]);

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: true,
  });

  const handleExportClick = async () => {
    setExporting(true);
    setError(null);
    try {
      await onExport({ background, includeLabels });
      dialogRef.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PNG');
    } finally {
      setExporting(false);
    }
  };

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
          Exports <span className="font-medium text-stone-200">{mapName}</span> ({placementCount}{' '}
          {placementCount === 1 ? 'Placement' : 'Placements'}) tightly cropped around your placed
          Tiles.
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

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2.5 hover:border-stone-500">
          <div>
            <div className="font-medium text-stone-100">Include assembly labels</div>
            <div className="text-[11px] text-stone-400">
              Draws {'<ShortCode> #<Face>'} badges and 0° orientation arrows
            </div>
          </div>
          <input
            type="checkbox"
            checked={includeLabels}
            onChange={(e) => setIncludeLabels(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
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
