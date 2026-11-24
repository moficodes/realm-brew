import { AlertTriangle, ChevronLeft, ChevronRight, Layers, Search, Sparkles, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  buildOverlayPaletteSections,
  groupOverlaysByPrefix,
  overlayCollectionKey,
  sortOverlayPacksPairedFirst,
  tileCollectionKey,
  type OverlayAvailability,
  type OverlayPrefixGroup,
  type TileAvailability,
} from '../domain/plannerEngine';
import type {
  ActiveBrush,
  Overlay,
  OverlayBrushSelection,
  OverlayPack,
  TileBrushSelection,
  TileFace,
  Tileset,
} from '../domain/types';
import { CHECKERBOARD_STYLE } from './paletteStyles';

export type PaletteTab = 'tiles' | 'overlays';

interface TilePaletteProps {
  activeTab: PaletteTab;
  onTabChange: (tab: PaletteTab) => void;
  tilesets: readonly Tileset[];
  overlayPacks: readonly OverlayPack[];
  selectedTilesetId: string | 'all';
  onSelectTileset: (tilesetId: string | 'all') => void;
  selectedOverlayPackId: string | 'all';
  onSelectOverlayPack: (overlayPackId: string | 'all') => void;
  overlaySearchQuery: string;
  onOverlaySearchChange: (query: string) => void;
  inStockOnly: boolean;
  onToggleInStockOnly: () => void;
  availabilityByTileKey: ReadonlyMap<string, TileAvailability>;
  availabilityByOverlayKey: ReadonlyMap<string, OverlayAvailability>;
  overBudgetTilesetIds: ReadonlySet<string>;
  overBudgetOverlayPackIds: ReadonlySet<string>;
  activeBrush: ActiveBrush | null;
  onSelectBrush: (brush: ActiveBrush | null) => void;
  onDragBrushStart: (brush: ActiveBrush) => void;
  onDragBrushEnd: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  scrollPositionsRef?: MutableRefObject<{ tiles: number; overlays: number }>;
  bundleError?: string;
}

function RemainingBadge({ remaining, compact = false }: { remaining: number; compact?: boolean }) {
  const isDepletedOrOver = remaining <= 0;
  const isOver = remaining < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono font-semibold ${
        compact ? 'text-[10px]' : 'text-[11px]'
      } ${
        isDepletedOrOver
          ? 'border border-red-500/40 bg-red-950/60 text-red-300'
          : 'border border-[#2e2a26] bg-[#161412] text-stone-300'
      }`}
    >
      {isOver && <AlertTriangle className={compact ? 'h-2.5 w-2.5 text-red-400' : 'h-3 w-3 text-red-400'} />}
      {remaining} left
    </span>
  );
}

interface PackFilterStripProps {
  ariaLabel: string;
  allLabel: string;
  items: ReadonlyArray<{ id: string; shortCode: string; name: string }>;
  selectedId: string | 'all';
  onSelect: (id: string | 'all') => void;
  overBudgetIds: ReadonlySet<string>;
  accent: 'amber' | 'sky';
  overBudgetNoun: string;
}

function PackFilterStrip({
  ariaLabel,
  allLabel,
  items,
  selectedId,
  onSelect,
  overBudgetIds,
  accent,
  overBudgetNoun,
}: PackFilterStripProps) {
  const activeClass =
    accent === 'sky'
      ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
      : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40';
  const inactiveClass = 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200';

  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={ariaLabel}>
      <button
        type="button"
        role="tab"
        aria-selected={selectedId === 'all'}
        onClick={() => onSelect('all')}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
          selectedId === 'all' ? activeClass : inactiveClass
        }`}
      >
        {allLabel}
      </button>
      {items.map((item) => {
        const isOverPack = overBudgetIds.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selectedId === item.id}
            onClick={() => onSelect(item.id)}
            title={item.name}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              selectedId === item.id ? activeClass : inactiveClass
            }`}
          >
            <span>{item.shortCode}</span>
            {isOverPack && (
              <span
                aria-label={`${item.name} has over-budget ${overBudgetNoun}`}
                className="h-1.5 w-1.5 rounded-full bg-red-400"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TileFaceButtonProps {
  tileset: Tileset;
  tileId: string;
  face: TileFace;
  isActive: boolean;
  defaultRotation: TileBrushSelection['rotation'];
  onClick: () => void;
  onDragStart: (brush: TileBrushSelection) => void;
  onDragEnd: () => void;
}

function TileFaceButton({
  tileset,
  tileId,
  face,
  isActive,
  defaultRotation,
  onClick,
  onDragStart,
  onDragEnd,
}: TileFaceButtonProps) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        const payload: TileBrushSelection = {
          kind: 'tile',
          tilesetId: tileset.id,
          tileId,
          faceNumber: face.faceNumber,
          rotation: defaultRotation,
        };
        e.dataTransfer.setData('application/x-realm-brew-face', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart(payload);
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group relative flex cursor-grab flex-col items-center rounded-md border p-1.5 transition active:cursor-grabbing ${
        isActive
          ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
          : 'border-[#2e2a26] bg-[#221f1c] hover:border-stone-500'
      }`}
    >
      <img
        src={face.url}
        alt={`${tileset.name} Tile Face #${face.label}`}
        loading="lazy"
        draggable={false}
        className="h-20 w-full object-contain"
      />
      <span className="mt-1 font-mono text-[11px] text-stone-300">#{face.label}</span>
    </button>
  );
}

interface OverlayCardButtonProps {
  pack: OverlayPack;
  overlay: Overlay;
  remaining: number;
  isActive: boolean;
  defaultRotationDeg: number;
  onClick: () => void;
  onDragStart: (brush: OverlayBrushSelection) => void;
  onDragEnd: () => void;
}

function OverlayCardButton({
  pack,
  overlay,
  remaining,
  isActive,
  defaultRotationDeg,
  onClick,
  onDragStart,
  onDragEnd,
}: OverlayCardButtonProps) {
  const isOver = remaining < 0;

  return (
    <button
      type="button"
      draggable
      title={overlay.label}
      onDragStart={(e) => {
        const payload: OverlayBrushSelection = {
          kind: 'overlay',
          overlayPackId: pack.id,
          overlayId: overlay.overlayId,
          label: overlay.label,
          shortCode: pack.shortCode,
          url: overlay.url,
          rotationDeg: defaultRotationDeg,
        };
        e.dataTransfer.setData('application/x-realm-brew-overlay', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart(payload);
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`flex cursor-grab flex-col rounded-lg border p-1.5 text-left transition active:cursor-grabbing ${
        isActive && isOver
          ? 'border-red-500/80 bg-sky-500/15 ring-1 ring-sky-400/60'
          : isActive
            ? 'border-sky-400 bg-sky-500/15 ring-1 ring-sky-400/50'
            : isOver
              ? 'border-red-500/50 bg-[#1c1917] hover:border-red-400'
              : 'border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
      }`}
    >
      <div
        className="flex h-20 w-full items-center justify-center rounded border border-[#2e2a26]/80 p-1"
        style={CHECKERBOARD_STYLE}
      >
        <img
          src={overlay.url}
          alt={overlay.label}
          loading="lazy"
          draggable={false}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <span className="mt-1.5 line-clamp-2 w-full text-[11px] leading-tight font-medium text-stone-200">
        {overlay.label}
      </span>
      <div className="mt-auto flex w-full items-center justify-between gap-1 pt-1.5">
        <span className="font-mono text-[10px] text-stone-500">{pack.shortCode}</span>
        <RemainingBadge remaining={remaining} compact />
      </div>
    </button>
  );
}

export function TilePalette({
  activeTab,
  onTabChange,
  tilesets,
  overlayPacks,
  selectedTilesetId,
  onSelectTileset,
  selectedOverlayPackId,
  onSelectOverlayPack,
  overlaySearchQuery,
  onOverlaySearchChange,
  inStockOnly,
  onToggleInStockOnly,
  availabilityByTileKey,
  availabilityByOverlayKey,
  overBudgetTilesetIds,
  overBudgetOverlayPackIds,
  activeBrush,
  onSelectBrush,
  onDragBrushStart,
  onDragBrushEnd,
  collapsed,
  onToggleCollapse,
  scrollPositionsRef,
  bundleError,
}: TilePaletteProps) {
  const tilesScrollRef = useRef<HTMLDivElement>(null);
  const overlaysScrollRef = useRef<HTMLDivElement>(null);
  const localScrollPositionsRef = useRef({ tiles: 0, overlays: 0 });
  const resolvedScrollPositionsRef = scrollPositionsRef ?? localScrollPositionsRef;

  useLayoutEffect(() => {
    if (collapsed) return;
    if (activeTab === 'tiles' && tilesScrollRef.current) {
      tilesScrollRef.current.scrollTop = resolvedScrollPositionsRef.current.tiles;
    } else if (activeTab === 'overlays' && overlaysScrollRef.current) {
      overlaysScrollRef.current.scrollTop = resolvedScrollPositionsRef.current.overlays;
    }
  }, [activeTab, collapsed, resolvedScrollPositionsRef]);

  const orderedOverlayPacks = useMemo(
    () => sortOverlayPacksPairedFirst(overlayPacks, tilesets),
    [overlayPacks, tilesets],
  );

  const groupedByPackId = useMemo(() => {
    const map = new Map<string, readonly OverlayPrefixGroup[]>();
    for (const pack of orderedOverlayPacks) {
      map.set(pack.id, groupOverlaysByPrefix(pack.overlays));
    }
    return map;
  }, [orderedOverlayPacks]);

  const { sections: visibleOverlaySections, totalMatchesAllPacks } = useMemo(
    () =>
      buildOverlayPaletteSections({
        orderedPacks: orderedOverlayPacks,
        groupedByPackId,
        selectedPackId: selectedOverlayPackId,
        searchQuery: overlaySearchQuery,
        inStockOnly,
        availabilityByOverlayKey,
      }),
    [
      orderedOverlayPacks,
      groupedByPackId,
      selectedOverlayPackId,
      overlaySearchQuery,
      inStockOnly,
      availabilityByOverlayKey,
    ],
  );

  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center border-r border-[#2e2a26] bg-[#161412] py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Palette ([)"
          aria-label="Expand Palette"
          className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="mt-4 flex flex-col items-center gap-2 text-stone-500">
          <Layers className="h-4 w-4" />
          <span className="[writing-mode:vertical-rl] text-[11px] font-medium tracking-wider uppercase">
            Palette
          </span>
        </div>
      </aside>
    );
  }

  const baseTilesets =
    selectedTilesetId === 'all'
      ? tilesets
      : tilesets.filter((t) => t.id === selectedTilesetId);

  const visibleTileSections = baseTilesets
    .map((ts) => {
      const filteredTiles = inStockOnly
        ? ts.tiles.filter((tile) => {
            const avail = availabilityByTileKey.get(tileCollectionKey(ts.id, tile.tileId));
            return (avail?.remaining ?? 0) > 0;
          })
        : ts.tiles;
      return { tileset: ts, tiles: filteredTiles };
    })
    .filter((section) => !inStockOnly || section.tiles.length > 0);

  const handleFaceClick = (tilesetId: string, tileId: string, face: TileFace) => {
    const isSame =
      activeBrush?.kind === 'tile' &&
      activeBrush.tilesetId === tilesetId &&
      activeBrush.tileId === tileId &&
      activeBrush.faceNumber === face.faceNumber;

    if (isSame) {
      onSelectBrush(null);
      return;
    }

    onSelectBrush({
      kind: 'tile',
      tilesetId,
      tileId,
      faceNumber: face.faceNumber,
      rotation: activeBrush?.kind === 'tile' ? activeBrush.rotation : 0,
    });
  };

  const handleOverlayClick = (pack: OverlayPack, overlay: Overlay) => {
    const isSame =
      activeBrush?.kind === 'overlay' &&
      activeBrush.overlayPackId === pack.id &&
      activeBrush.overlayId === overlay.overlayId;

    if (isSame) {
      onSelectBrush(null);
      return;
    }

    onSelectBrush({
      kind: 'overlay',
      overlayPackId: pack.id,
      overlayId: overlay.overlayId,
      label: overlay.label,
      shortCode: pack.shortCode,
      url: overlay.url,
      rotationDeg: activeBrush?.kind === 'overlay' ? activeBrush.rotationDeg : 0,
    });
  };

  const hasOverBudgetTiles = overBudgetTilesetIds.size > 0;
  const hasOverBudgetOverlays = overBudgetOverlayPackIds.size > 0;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-[#2e2a26] bg-[#161412]">
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-2.5 py-2">
        <div
          className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-[#1c1917] p-1"
          role="tablist"
          aria-label="Palette category"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tiles'}
            onClick={() => onTabChange('tiles')}
            className={`relative flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'tiles'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Tiles</span>
            {hasOverBudgetTiles && (
              <span
                title="Active Map has over-budget Tile Placements"
                aria-label="Over-budget Tiles"
                className="h-1.5 w-1.5 rounded-full bg-red-400"
              />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overlays'}
            onClick={() => onTabChange('overlays')}
            className={`relative flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'overlays'
                ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Overlays</span>
            {hasOverBudgetOverlays && (
              <span
                title="Active Map has over-budget Overlay Placements"
                aria-label="Over-budget Overlays"
                className="h-1.5 w-1.5 rounded-full bg-red-400"
              />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Palette ([)"
          aria-label="Collapse Palette"
          className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-[#2e2a26] px-2.5 py-2">
        {activeTab === 'tiles' ? (
          <PackFilterStrip
            ariaLabel="Tileset filter"
            allLabel={`All (${tilesets.length})`}
            items={tilesets}
            selectedId={selectedTilesetId}
            onSelect={onSelectTileset}
            overBudgetIds={overBudgetTilesetIds}
            accent="amber"
            overBudgetNoun="Tiles"
          />
        ) : (
          <>
            <PackFilterStrip
              ariaLabel="Overlay Pack filter"
              allLabel={`All (${orderedOverlayPacks.length})`}
              items={orderedOverlayPacks}
              selectedId={selectedOverlayPackId}
              onSelect={onSelectOverlayPack}
              overBudgetIds={overBudgetOverlayPackIds}
              accent="sky"
              overBudgetNoun="Overlays"
            />

            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-stone-500" />
              <input
                type="text"
                value={overlaySearchQuery}
                onChange={(e) => onOverlaySearchChange(e.target.value)}
                placeholder="Search Overlays..."
                aria-label="Search Overlays"
                className="h-8 w-full rounded-md border border-[#2e2a26] bg-[#1c1917] pr-7 pl-8 text-xs text-stone-100 placeholder:text-stone-500 focus:border-sky-500 focus:outline-none"
              />
              {overlaySearchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={() => onOverlaySearchChange('')}
                  title="Clear search"
                  aria-label="Clear search"
                  className="absolute right-1.5 rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        )}

        <label className="flex cursor-pointer items-center justify-between rounded-md bg-[#1c1917] px-2.5 py-1.5 text-xs text-stone-300 hover:bg-stone-800/70">
          <span>In-stock only</span>
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={onToggleInStockOnly}
            className="h-3.5 w-3.5 accent-amber-500"
          />
        </label>
      </div>

      <div
        ref={tilesScrollRef}
        onScroll={(e) => {
          resolvedScrollPositionsRef.current.tiles = e.currentTarget.scrollTop;
        }}
        className={activeTab === 'tiles' ? 'rb-scroll flex-1 overflow-y-auto px-2.5 py-2.5' : 'hidden'}
      >
        {bundleError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
            <p className="font-semibold">Bundle directory unavailable</p>
            <p className="mt-1 text-amber-200/80">{bundleError}</p>
          </div>
        )}

        {!bundleError && visibleTileSections.length === 0 && (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            {inStockOnly ? 'No available Tiles remaining in this filter.' : 'No Tilesets found.'}
          </div>
        )}

        <div className="space-y-4">
          {visibleTileSections.map(({ tileset, tiles }) => (
            <section key={tileset.id} aria-label={tileset.name}>
              <div className="mb-2 flex items-center justify-between px-0.5">
                <h3 className="text-xs font-semibold tracking-wide text-stone-300 uppercase">
                  {tileset.name}
                </h3>
                <span className="text-[11px] text-stone-500">{tiles.length} Tiles</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {tiles.map((tile) => {
                  const avail = availabilityByTileKey.get(tileCollectionKey(tileset.id, tile.tileId));
                  const remaining = avail?.remaining ?? 0;
                  const isOver = remaining < 0;

                  const isFaceAActive =
                    activeBrush?.kind === 'tile' &&
                    activeBrush.tilesetId === tileset.id &&
                    activeBrush.tileId === tile.tileId &&
                    activeBrush.faceNumber === tile.faceA.faceNumber;
                  const isFaceBActive =
                    !tile.isSymmetric &&
                    activeBrush?.kind === 'tile' &&
                    activeBrush.tilesetId === tileset.id &&
                    activeBrush.tileId === tile.tileId &&
                    activeBrush.faceNumber === tile.faceB.faceNumber;

                  const defaultRotation = activeBrush?.kind === 'tile' ? activeBrush.rotation : 0;

                  return (
                    <div
                      key={tile.tileId}
                      className={`rounded-lg border p-2 transition-colors ${
                        isOver
                          ? 'border-red-500/50 bg-[#1c1917]'
                          : 'border-[#2e2a26] bg-[#1c1917]'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-medium text-stone-300">
                            {tileset.shortCode}{' '}
                            {tile.isSymmetric
                              ? `#${tile.faceA.label}`
                              : `${tile.faceA.label}/${tile.faceB.label}`}
                          </span>
                          {tile.isSymmetric && (
                            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400">
                              Dark
                            </span>
                          )}
                        </div>

                        <RemainingBadge remaining={remaining} />
                      </div>

                      <div className={`grid gap-2 ${tile.isSymmetric ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <TileFaceButton
                          tileset={tileset}
                          tileId={tile.tileId}
                          face={tile.faceA}
                          isActive={isFaceAActive}
                          defaultRotation={defaultRotation}
                          onClick={() => handleFaceClick(tileset.id, tile.tileId, tile.faceA)}
                          onDragStart={onDragBrushStart}
                          onDragEnd={onDragBrushEnd}
                        />
                        {!tile.isSymmetric && (
                          <TileFaceButton
                            tileset={tileset}
                            tileId={tile.tileId}
                            face={tile.faceB}
                            isActive={isFaceBActive}
                            defaultRotation={defaultRotation}
                            onClick={() => handleFaceClick(tileset.id, tile.tileId, tile.faceB)}
                            onDragStart={onDragBrushStart}
                            onDragEnd={onDragBrushEnd}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div
        ref={overlaysScrollRef}
        onScroll={(e) => {
          resolvedScrollPositionsRef.current.overlays = e.currentTarget.scrollTop;
        }}
        className={activeTab === 'overlays' ? 'rb-scroll flex-1 overflow-y-auto px-2.5 py-2.5' : 'hidden'}
      >
        {bundleError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
            <p className="font-semibold">Bundle directory unavailable</p>
            <p className="mt-1 text-amber-200/80">{bundleError}</p>
          </div>
        )}

        {!bundleError && visibleOverlaySections.length === 0 && (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            <p>
              {overlaySearchQuery.trim().length > 0
                ? selectedOverlayPackId !== 'all'
                  ? 'No matching Overlays in this pack.'
                  : 'No matching Overlays found.'
                : inStockOnly
                  ? 'No available Overlays remaining in this filter.'
                  : 'No Overlay Packs found.'}
            </p>
            {selectedOverlayPackId !== 'all' &&
              overlaySearchQuery.trim().length > 0 &&
              totalMatchesAllPacks > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectOverlayPack('all')}
                  className="mt-2.5 rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:bg-sky-500/25"
                >
                  Show {totalMatchesAllPacks} {totalMatchesAllPacks === 1 ? 'match' : 'matches'} across
                  all Overlay Packs
                </button>
              )}
          </div>
        )}

        <div className="space-y-4">
          {visibleOverlaySections.map(({ pack, groups, totalCount }) => (
            <section key={pack.id} aria-label={pack.name}>
              <div className="mb-2 flex items-center justify-between px-0.5">
                <h3 className="text-xs font-semibold tracking-wide text-stone-300 uppercase">
                  {pack.name}
                </h3>
                <span className="text-[11px] text-stone-500">
                  {totalCount} {totalCount === 1 ? 'Overlay' : 'Overlays'}
                </span>
              </div>

              <div className="space-y-3">
                {groups.map((group) => (
                  <div key={group.name}>
                    {group.heading !== null && (
                      <h4 className="mb-1.5 px-0.5 text-[11px] font-medium text-stone-400">
                        {group.heading} · {group.overlays.length}
                      </h4>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {group.overlays.map((ov) => {
                        const avail = availabilityByOverlayKey.get(
                          overlayCollectionKey(pack.id, ov.overlayId),
                        );
                        const remaining = avail?.remaining ?? 0;
                        const isActive =
                          activeBrush?.kind === 'overlay' &&
                          activeBrush.overlayPackId === pack.id &&
                          activeBrush.overlayId === ov.overlayId;
                        const defaultRotationDeg =
                          activeBrush?.kind === 'overlay' ? activeBrush.rotationDeg : 0;

                        return (
                          <OverlayCardButton
                            key={ov.overlayId}
                            pack={pack}
                            overlay={ov}
                            remaining={remaining}
                            isActive={isActive}
                            defaultRotationDeg={defaultRotationDeg}
                            onClick={() => handleOverlayClick(pack, ov)}
                            onDragStart={onDragBrushStart}
                            onDragEnd={onDragBrushEnd}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}
