import { ChevronDown, ChevronRight, Dices, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { countAvailablePlayableTiles } from '../domain/mapGenerator';
import {
  HEX_EDGE_SEGMENTS,
  groupTileFacesByEdgeCategory,
  type EdgeCategoryGroup,
  type EdgeTuple,
  type EdgeType,
  type TileEdgeIndex,
  type TileFaceEdgeProfile,
} from '../domain/tileEdges';
import { DEFAULT_TILESET_COPIES, padFaceNumber, type Collection, type Tileset } from '../domain/types';
import { useModalDialog } from './useModalDialog';

export interface EdgeAnalysisStatus {
  state: 'idle' | 'analyzing' | 'ready' | 'error';
  analyzed: number;
  total: number;
  error?: string;
}

export interface GenerateMapDialogSubmit {
  selectedTilesetIds: string[];
  targetTileCount: number;
  destination: 'replace' | 'new-map';
}

interface GenerateMapDialogProps {
  open: boolean;
  onClose: () => void;
  tilesets: readonly Tileset[];
  collection: Collection;
  edgeIndex: TileEdgeIndex;
  analysisStatus: EdgeAnalysisStatus;
  hasExistingPlacements: boolean;
  initialSelectedTilesetIds: readonly string[];
  initialTargetCount: number;
  onOpenCollection: () => void;
  onGenerate: (params: GenerateMapDialogSubmit) => void;
}

const EDGE_COLOR: Record<EdgeType, string> = {
  V: '#3f3a34',
  F: '#e7e5e4',
  N: '#f59e0b',
  W: '#38bdf8',
};

const EDGE_WIDTH: Record<EdgeType, number> = {
  V: 1.5,
  F: 3,
  N: 2.5,
  W: 3,
};

function EdgeHexIcon({ edges }: { edges: EdgeTuple }) {
  const w = 28;
  const h = 24;
  const pad = 2;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  const points = [
    [pad + iw * 0.25, pad],
    [pad + iw * 0.75, pad],
    [pad + iw, pad + ih * 0.5],
    [pad + iw * 0.75, pad + ih],
    [pad + iw * 0.25, pad + ih],
    [pad, pad + ih * 0.5],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polygon points={points} fill="#161412" />
      {HEX_EDGE_SEGMENTS.map((seg, i) => {
        const edgeType = edges[i];
        return (
          <line
            key={seg.label}
            x1={pad + seg.x0 * iw}
            y1={pad + seg.y0 * ih}
            x2={pad + seg.x1 * iw}
            y2={pad + seg.y1 * ih}
            stroke={EDGE_COLOR[edgeType]}
            strokeWidth={EDGE_WIDTH[edgeType]}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function formatCategoryMembers(
  group: EdgeCategoryGroup,
  shortCodesByTilesetId: ReadonlyMap<string, string>,
): string {
  return group.faces
    .map((f) => {
      const code = shortCodesByTilesetId.get(f.tilesetId) ?? f.tilesetId;
      return `${code} #${padFaceNumber(f.faceNumber)}`;
    })
    .join(', ');
}

export function GenerateMapDialog({
  open,
  onClose,
  tilesets,
  collection,
  edgeIndex,
  analysisStatus,
  hasExistingPlacements,
  initialSelectedTilesetIds,
  initialTargetCount,
  onOpenCollection,
  onGenerate,
}: GenerateMapDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const wasOpenRef = useRef(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetCount, setTargetCount] = useState<number>(24);
  const [destination, setDestination] = useState<'replace' | 'new-map'>('new-map');
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: true,
  });

  const playableAll = useMemo(
    () =>
      countAvailablePlayableTiles(
        tilesets,
        tilesets.map((t) => t.id),
        collection,
        edgeIndex,
      ),
    [tilesets, collection, edgeIndex],
  );

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const validOwnedIds = tilesets
        .filter((ts) => (collection.tilesets[ts.id] ?? DEFAULT_TILESET_COPIES) > 0)
        .map((ts) => ts.id);

      const seeded = initialSelectedTilesetIds.filter((id) => validOwnedIds.includes(id));
      const nextSelected = seeded.length > 0 ? seeded : validOwnedIds;
      setSelectedIds(nextSelected);

      const inv = countAvailablePlayableTiles(tilesets, nextSelected, collection, edgeIndex);
      const maxPlayable = Math.max(1, inv.totalPlayableCopies);
      const fallbackTarget = Math.min(24, maxPlayable);
      const desired = initialTargetCount > 0 ? Math.min(initialTargetCount, maxPlayable) : fallbackTarget;
      setTargetCount(Math.max(1, desired));
      setDestination(hasExistingPlacements ? 'new-map' : 'replace');
    }
    wasOpenRef.current = open;
  }, [
    open,
    tilesets,
    collection,
    edgeIndex,
    initialSelectedTilesetIds,
    initialTargetCount,
    hasExistingPlacements,
  ]);

  const selectedPlayable = useMemo(
    () => countAvailablePlayableTiles(tilesets, selectedIds, collection, edgeIndex),
    [tilesets, selectedIds, collection, edgeIndex],
  );

  const maxPlayableTiles = selectedPlayable.totalPlayableCopies;
  const clampedTargetCount =
    maxPlayableTiles > 0 ? Math.max(1, Math.min(targetCount, maxPlayableTiles)) : 0;

  const {
    shortCodesByTilesetId,
    patternCountByTilesetId,
    selectedFaceCount,
    categoriesByOpenCount,
    totalUniqueCategories,
  } = useMemo(() => {
    const shortCodes = new Map<string, string>();
    const profilesBySet = new Map<string, TileFaceEdgeProfile[]>();
    const selectedSet = new Set(selectedIds);
    const selectedProfiles: TileFaceEdgeProfile[] = [];

    for (const ts of tilesets) {
      shortCodes.set(ts.id, ts.shortCode);
      profilesBySet.set(ts.id, []);
    }

    for (const profile of edgeIndex.values()) {
      const arr = profilesBySet.get(profile.tilesetId);
      if (arr) {
        arr.push(profile);
      }
      if (selectedSet.has(profile.tilesetId)) {
        selectedProfiles.push(profile);
      }
    }

    const patternCounts = new Map<string, number>();
    for (const [tsId, profiles] of profilesBySet.entries()) {
      patternCounts.set(tsId, groupTileFacesByEdgeCategory(profiles).length);
    }

    const grouped = groupTileFacesByEdgeCategory(selectedProfiles);
    const byOpen = new Map<number, EdgeCategoryGroup[]>();
    for (const cat of grouped) {
      const list = byOpen.get(cat.openCount);
      if (list) {
        list.push(cat);
      } else {
        byOpen.set(cat.openCount, [cat]);
      }
    }

    return {
      shortCodesByTilesetId: shortCodes,
      patternCountByTilesetId: patternCounts,
      selectedFaceCount: selectedProfiles.length,
      categoriesByOpenCount: Array.from(byOpen.entries()).sort((a, b) => a[0] - b[0]),
      totalUniqueCategories: grouped.length,
    };
  }, [tilesets, edgeIndex, selectedIds]);

  const toggleTileset = (tilesetId: string) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(tilesetId);
      const next = exists ? prev.filter((id) => id !== tilesetId) : [...prev, tilesetId];
      const nextInv = countAvailablePlayableTiles(tilesets, next, collection, edgeIndex);
      if (nextInv.totalPlayableCopies > 0 && targetCount > nextInv.totalPlayableCopies) {
        setTargetCount(nextInv.totalPlayableCopies);
      }
      return next;
    });
  };

  const presetCounts = useMemo(() => {
    if (maxPlayableTiles <= 0) return [];
    const base = [12, 24, 48].filter((n) => n < maxPlayableTiles);
    return [...base, maxPlayableTiles];
  }, [maxPlayableTiles]);

  const isAnalyzing = analysisStatus.state === 'analyzing';
  const canSubmit =
    !isAnalyzing &&
    selectedIds.length > 0 &&
    maxPlayableTiles > 0 &&
    clampedTargetCount > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onGenerate({
      selectedTilesetIds: selectedIds,
      targetTileCount: clampedTargetCount,
      destination: hasExistingPlacements ? destination : 'replace',
    });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="w-full max-w-xl rounded-xl border border-[#2e2a26] bg-[#161412] p-0 text-stone-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Dices className="h-4 w-4 text-amber-400" />
          <h2 id={titleId} className="text-sm font-semibold text-stone-100">
            Generate Seamless Map
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close Generate Map dialog"
          className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="rb-scroll max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4 text-xs">
        {isAnalyzing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/25 px-3.5 py-2.5 text-amber-200">
            <div className="flex items-center justify-between font-medium">
              <span>Analyzing Tile Face edges…</span>
              <span className="font-mono text-[11px]">
                {analysisStatus.analyzed} / {analysisStatus.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
              <div
                className="h-full bg-amber-400 transition-all"
                style={{
                  width: `${
                    analysisStatus.total > 0
                      ? Math.round((analysisStatus.analyzed / analysisStatus.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {analysisStatus.state === 'error' && analysisStatus.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3.5 py-2.5 text-red-200">
            Edge analysis failed: {analysisStatus.error}
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-stone-300 uppercase">
              Tilesets
            </h3>
            <button
              type="button"
              onClick={() => {
                dialogRef.current?.close();
                onOpenCollection();
              }}
              className="text-[11px] font-medium text-amber-400 hover:text-amber-300 hover:underline"
            >
              Edit Collection
            </button>
          </div>

          {tilesets.length === 0 ? (
            <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-stone-400">
              No Tilesets loaded yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {tilesets.map((ts) => {
                const owned = collection.tilesets[ts.id] ?? DEFAULT_TILESET_COPIES;
                const playableCount = playableAll.byTilesetId.get(ts.id) ?? 0;
                const patternCount = patternCountByTilesetId.get(ts.id) ?? 0;
                const disabled = owned <= 0;
                const checked = !disabled && selectedIds.includes(ts.id);

                return (
                  <label
                    key={ts.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${
                      disabled
                        ? 'cursor-not-allowed border-[#2e2a26]/60 bg-[#1c1917]/50 opacity-60'
                        : checked
                          ? 'cursor-pointer border-amber-500/40 bg-amber-500/10'
                          : 'cursor-pointer border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleTileset(ts.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-amber-500"
                      />
                      <span className="shrink-0 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                        {ts.shortCode}
                      </span>
                      <span className="truncate font-medium text-stone-100">{ts.name}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-stone-400">
                      {disabled ? (
                        <span className="rounded border border-[#2e2a26] bg-[#161412] px-1.5 py-0.5 text-stone-400">
                          0 copies
                        </span>
                      ) : (
                        <>
                          <span>
                            {owned} {owned === 1 ? 'copy' : 'copies'} · {playableCount} playable
                          </span>
                          {patternCount > 0 && (
                            <span className="rounded bg-stone-800/80 px-1.5 py-0.5 font-mono text-[10px] text-stone-300">
                              {patternCount} patterns
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-2.5 rounded-lg border border-[#2e2a26] bg-[#1c1917] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="gen-target-count" className="font-semibold text-stone-200">
              Map Size (Target Tiles)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="gen-target-count"
                type="number"
                min={maxPlayableTiles > 0 ? 1 : 0}
                max={Math.max(1, maxPlayableTiles)}
                disabled={maxPlayableTiles <= 0}
                value={clampedTargetCount}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(parsed)) {
                    setTargetCount(Math.max(1, Math.min(maxPlayableTiles, parsed)));
                  }
                }}
                className="h-7 w-16 rounded-md border border-[#2e2a26] bg-[#161412] px-2 text-center font-mono text-xs text-stone-100 focus:border-amber-500 focus:outline-none disabled:opacity-40"
              />
              <span className="text-[11px] text-stone-400">of {maxPlayableTiles}</span>
            </div>
          </div>

          <input
            type="range"
            aria-label="Target Tiles slider"
            min={maxPlayableTiles > 0 ? 1 : 0}
            max={Math.max(1, maxPlayableTiles)}
            disabled={maxPlayableTiles <= 0}
            value={clampedTargetCount}
            onChange={(e) => setTargetCount(Number.parseInt(e.target.value, 10))}
            className="w-full accent-amber-500 disabled:opacity-40"
          />

          {presetCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {presetCounts.map((count) => {
                const isAll = count === maxPlayableTiles;
                const active = clampedTargetCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setTargetCount(count)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                        : 'border border-[#2e2a26] bg-[#161412] text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    {isAll ? `All (${count})` : count}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-stone-400">
            Uses your owned physical Collection copies (double-sided Tiles use one face per physical
            copy). Prefers closed outer walls while allowing open exits when needed.
          </p>
        </section>

        {hasExistingPlacements && (
          <fieldset className="space-y-2">
            <legend className="font-semibold text-stone-200">Destination</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
                <input
                  type="radio"
                  name="gen-destination"
                  value="new-map"
                  checked={destination === 'new-map'}
                  onChange={() => setDestination('new-map')}
                  className="accent-amber-500"
                />
                <div>
                  <div className="font-medium text-stone-100">Create new Map</div>
                  <div className="text-[11px] text-stone-400">Keeps current Map intact</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2 hover:border-stone-500">
                <input
                  type="radio"
                  name="gen-destination"
                  value="replace"
                  checked={destination === 'replace'}
                  onChange={() => setDestination('replace')}
                  className="accent-amber-500"
                />
                <div>
                  <div className="font-medium text-stone-100">Replace current Map</div>
                  <div className="text-[11px] text-stone-400">Undoable with Cmd/Ctrl+Z</div>
                </div>
              </label>
            </div>
          </fieldset>
        )}

        <section className="rounded-lg border border-[#2e2a26] bg-[#1c1917]">
          <button
            type="button"
            onClick={() => setCategoriesOpen((v) => !v)}
            aria-expanded={categoriesOpen}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition hover:bg-stone-800/50"
          >
            <div className="flex items-center gap-2">
              {categoriesOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
              )}
              <span className="font-medium text-stone-200">
                Detected edge categories ({totalUniqueCategories} unique{' '}
                {totalUniqueCategories === 1 ? 'pattern' : 'patterns'} across {selectedFaceCount}{' '}
                Tile {selectedFaceCount === 1 ? 'Face' : 'Faces'})
              </span>
            </div>
          </button>

          {categoriesOpen && (
            <div className="space-y-3 border-t border-[#2e2a26] px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-[#3f3a34]" /> Wall (V)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-[#e7e5e4]" /> Wide Floor (F)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-[#f59e0b]" /> Narrow Corridor (N)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-[#38bdf8]" /> Water (W)
                </span>
              </div>

              {categoriesByOpenCount.length === 0 ? (
                <p className="text-stone-400">
                  {selectedIds.length === 0
                    ? 'Select at least one Tileset to inspect detected edge categories.'
                    : 'No analyzed Tile Faces yet.'}
                </p>
              ) : (
                <div className="rb-scroll max-h-56 space-y-3 overflow-y-auto pr-1">
                  {categoriesByOpenCount.map(([openCount, groups]) => (
                    <div key={openCount} className="space-y-1.5">
                      <div className="text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
                        {openCount === 0
                          ? '0 open sides (Solid Dark)'
                          : `${openCount} open ${openCount === 1 ? 'side' : 'sides'}`}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {groups.map((group) => (
                          <div
                            key={group.canonicalSignature}
                            className="flex items-start gap-2 rounded-md border border-[#2e2a26] bg-[#161412] p-2"
                          >
                            <EdgeHexIcon edges={group.canonicalEdges} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[11px] font-semibold text-stone-200">
                                  {group.canonicalSignature}
                                </span>
                                <span className="text-[10px] text-stone-400">
                                  {group.faces.length}
                                </span>
                              </div>
                              <div className="mt-0.5 truncate text-[10px] text-stone-400">
                                {formatCategoryMembers(group, shortCodesByTilesetId)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
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
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Dices className="h-3.5 w-3.5" />
          <span>Generate Map</span>
        </button>
      </div>
    </dialog>
  );
}
