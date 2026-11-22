import { Minus, Package, Plus, X } from 'lucide-react';
import { useId, useRef } from 'react';
import { DEFAULT_TILESET_COPIES } from '../domain/plannerEngine';
import type { Collection, Tileset } from '../domain/types';
import { useModalDialog } from './useModalDialog';

interface CollectionDialogProps {
  open: boolean;
  onClose: () => void;
  tilesets: readonly Tileset[];
  collection: Collection;
  onChangeCopies: (tilesetId: string, copies: number) => void;
}

export function CollectionDialog({
  open,
  onClose,
  tilesets,
  collection,
  onChangeCopies,
}: CollectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: true,
  });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="w-full max-w-lg rounded-xl border border-[#2e2a26] bg-[#161412] p-0 text-stone-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-amber-400" />
          <h2 id={titleId} className="text-sm font-semibold text-stone-100">
            Physical Collection
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close Collection settings"
          className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="rb-scroll max-h-[65vh] overflow-y-auto px-5 py-4">
        <p className="mb-4 text-xs text-stone-400">
          Set how many physical box copies of each Tileset you own. Set a Tileset to{' '}
          <span className="font-mono text-stone-200">0</span> for digital-only planning (all Placements
          of that Tileset will soft-warn as over budget).
        </p>

        {tilesets.length === 0 ? (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            No Tilesets discovered yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {tilesets.map((ts, index) => {
              const count = collection[ts.id] ?? DEFAULT_TILESET_COPIES;
              return (
                <div
                  key={ts.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                        {ts.shortCode}
                      </span>
                      <span className="truncate text-sm font-medium text-stone-100">{ts.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {ts.tiles.length} physical Tiles per copy · {count * ts.tiles.length} total Tiles
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeCopies(ts.id, Math.max(0, count - 1))}
                      disabled={count <= 0}
                      aria-label={`Decrease copies of ${ts.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2e2a26] bg-[#161412] text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      autoFocus={index === 0}
                      aria-label={`Owned copies of ${ts.name}`}
                      value={count}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10);
                        if (!Number.isNaN(parsed) && parsed >= 0) {
                          onChangeCopies(ts.id, parsed);
                        } else if (e.target.value === '') {
                          onChangeCopies(ts.id, 0);
                        }
                      }}
                      className="h-8 w-14 rounded-md border border-[#2e2a26] bg-[#161412] px-2 text-center font-mono text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onChangeCopies(ts.id, count + 1)}
                      aria-label={`Increase copies of ${ts.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2e2a26] bg-[#161412] text-stone-200 transition hover:bg-stone-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-[#2e2a26] px-5 py-3">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-stone-950 transition hover:bg-amber-400"
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
