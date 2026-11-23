import { Minus, Package, Plus, X } from 'lucide-react';
import { useId, useMemo, useRef } from 'react';
import { DEFAULT_OVERLAY_PACK_COPIES, DEFAULT_TILESET_COPIES } from '../domain/plannerEngine';
import type { Collection, OverlayPack, Tileset } from '../domain/types';
import { useModalDialog } from './useModalDialog';

export type CollectionPackKind = 'tileset' | 'overlayPack';

interface CollectionDialogProps {
  open: boolean;
  onClose: () => void;
  tilesets: readonly Tileset[];
  overlayPacks: readonly OverlayPack[];
  collection: Collection;
  onChangeCopies: (kind: CollectionPackKind, id: string, copies: number) => void;
}

interface CollectionPackRowProps {
  shortCode: string;
  name: string;
  itemCount: number;
  unitLabel: string;
  kindLabel: string;
  pairedTitle?: string;
  count: number;
  autoFocus?: boolean;
  onChange: (copies: number) => void;
}

function CollectionPackRow({
  shortCode,
  name,
  itemCount,
  unitLabel,
  kindLabel,
  pairedTitle,
  count,
  autoFocus,
  onChange,
}: CollectionPackRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
            {shortCode}
          </span>
          <span className="truncate text-sm font-medium text-stone-100">{name}</span>
          {pairedTitle !== undefined && (
            <span
              title={pairedTitle}
              className="shrink-0 rounded border border-[#2e2a26] bg-[#161412] px-1.5 py-0.5 text-[10px] font-medium text-stone-400"
            >
              Paired
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-stone-400">
          {itemCount} physical {unitLabel} per copy · {count * itemCount} total {unitLabel}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, count - 1))}
          disabled={count <= 0}
          aria-label={`Decrease copies of ${name} ${kindLabel}`}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2e2a26] bg-[#161412] text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          min={0}
          step={1}
          autoFocus={autoFocus}
          aria-label={`Owned copies of ${name} ${kindLabel}`}
          value={count}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            if (!Number.isNaN(parsed) && parsed >= 0) {
              onChange(parsed);
            } else if (e.target.value === '') {
              onChange(0);
            }
          }}
          className="h-8 w-14 rounded-md border border-[#2e2a26] bg-[#161412] px-2 text-center font-mono text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(count + 1)}
          aria-label={`Increase copies of ${name} ${kindLabel}`}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2e2a26] bg-[#161412] text-stone-200 transition hover:bg-stone-800"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function CollectionDialog({
  open,
  onClose,
  tilesets,
  overlayPacks,
  collection,
  onChangeCopies,
}: CollectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tilesetsHeadingId = useId();
  const overlayPacksHeadingId = useId();

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: true,
  });

  const { tilesetNamesById, orderedOverlayPacks } = useMemo(() => {
    const names = new Map<string, string>();
    const order = new Map<string, number>();
    tilesets.forEach((ts, idx) => {
      names.set(ts.id, ts.name);
      order.set(ts.id, idx);
    });
    const ordered = [...overlayPacks].sort((a, b) => {
      const aPaired = a.pairedTilesetId !== null;
      const bPaired = b.pairedTilesetId !== null;
      if (aPaired !== bPaired) return aPaired ? -1 : 1;
      if (aPaired && bPaired) {
        const aOrder = order.get(a.pairedTilesetId!) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = order.get(b.pairedTilesetId!) ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      return a.name.localeCompare(b.name);
    });
    return { tilesetNamesById: names, orderedOverlayPacks: ordered };
  }, [tilesets, overlayPacks]);

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

      <div className="space-y-4 px-5 py-4">
        <p className="text-xs text-stone-400">
          Track owned physical copies for each Tileset and Overlay Pack independently. Set any pack
          to <span className="font-mono text-stone-200">0</span> for digital-only planning (all
          Placements or Overlay Placements from that pack will soft-warn as over budget).
        </p>

        <section aria-labelledby={tilesetsHeadingId}>
          <div className="mb-2 flex items-center justify-between">
            <h3
              id={tilesetsHeadingId}
              className="text-xs font-semibold tracking-wide text-stone-300 uppercase"
            >
              Tilesets
            </h3>
            <span className="text-[11px] text-stone-500">{tilesets.length}</span>
          </div>

          {tilesets.length === 0 ? (
            <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
              No Tilesets discovered yet.
            </div>
          ) : (
            <div className="rb-scroll max-h-[26vh] space-y-2.5 overflow-y-auto pr-1">
              {tilesets.map((ts, index) => (
                <CollectionPackRow
                  key={ts.id}
                  shortCode={ts.shortCode}
                  name={ts.name}
                  itemCount={ts.tiles.length}
                  unitLabel="Tiles"
                  kindLabel="Tileset"
                  count={collection.tilesets[ts.id] ?? DEFAULT_TILESET_COPIES}
                  autoFocus={index === 0}
                  onChange={(copies) => onChangeCopies('tileset', ts.id, copies)}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby={overlayPacksHeadingId}>
          <div className="mb-2 flex items-center justify-between">
            <h3
              id={overlayPacksHeadingId}
              className="text-xs font-semibold tracking-wide text-stone-300 uppercase"
            >
              Overlay Packs
            </h3>
            <span className="text-[11px] text-stone-500">{orderedOverlayPacks.length}</span>
          </div>

          {orderedOverlayPacks.length === 0 ? (
            <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
              No Overlay Packs discovered yet.
            </div>
          ) : (
            <div className="rb-scroll max-h-[30vh] space-y-2.5 overflow-y-auto pr-1">
              {orderedOverlayPacks.map((pack, index) => {
                const pairedName =
                  pack.pairedTilesetId !== null ? tilesetNamesById.get(pack.pairedTilesetId) : undefined;
                const pairedTitle =
                  pack.pairedTilesetId !== null
                    ? pairedName
                      ? `Paired with ${pairedName} Tileset`
                      : 'Paired with Tileset'
                    : undefined;
                return (
                  <CollectionPackRow
                    key={pack.id}
                    shortCode={pack.shortCode}
                    name={pack.name}
                    itemCount={pack.overlays.length}
                    unitLabel="Overlays"
                    kindLabel="Overlay Pack"
                    pairedTitle={pairedTitle}
                    count={collection.overlayPacks[pack.id] ?? DEFAULT_OVERLAY_PACK_COPIES}
                    autoFocus={tilesets.length === 0 && index === 0}
                    onChange={(copies) => onChangeCopies('overlayPack', pack.id, copies)}
                  />
                );
              })}
            </div>
          )}
        </section>
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
