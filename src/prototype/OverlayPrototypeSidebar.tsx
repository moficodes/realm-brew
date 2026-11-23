// THROWAWAY PROTOTYPE SIDEBAR for Wayfinder #13

import { ChevronLeft, ChevronRight, Layers, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TileFace, Tileset } from '../domain/types';
import type { ProtoBrush, ProtoOverlay, ProtoOverlayPack } from './overlayPrototypeModel';

interface OverlayPrototypeSidebarProps {
  tilesets: readonly Tileset[];
  overlayPacks: readonly ProtoOverlayPack[];
  activeBrush: ProtoBrush | null;
  onSelectBrush: (brush: ProtoBrush | null) => void;
  onDragBrushStart: (brush: ProtoBrush) => void;
  onDragBrushEnd: () => void;
  activeTab: 'tiles' | 'overlays';
  onTabChange: (tab: 'tiles' | 'overlays') => void;
  bundleError?: string;
}

export function OverlayPrototypeSidebar({
  tilesets,
  overlayPacks,
  activeBrush,
  onSelectBrush,
  onDragBrushStart,
  onDragBrushEnd,
  activeTab,
  onTabChange,
  bundleError,
}: OverlayPrototypeSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedTilesetId, setSelectedTilesetId] = useState<string | 'all'>('all');
  const [selectedPackId, setSelectedPackId] = useState<string | 'all'>('all');
  const [overlayQuery, setOverlayQuery] = useState('');

  const visibleTilesets = useMemo(
    () =>
      selectedTilesetId === 'all'
        ? tilesets
        : tilesets.filter((t) => t.id === selectedTilesetId),
    [selectedTilesetId, tilesets],
  );

  const filteredOverlaySections = useMemo(() => {
    const q = overlayQuery.trim().toLowerCase();
    const basePacks =
      selectedPackId === 'all'
        ? overlayPacks
        : overlayPacks.filter((p) => p.id === selectedPackId);

    return basePacks
      .map((pack) => {
        const overlays = q
          ? pack.overlays.filter(
              (ov) =>
                ov.label.toLowerCase().includes(q) ||
                pack.name.toLowerCase().includes(q) ||
                pack.shortCode.toLowerCase().includes(q),
            )
          : pack.overlays;
        return { pack, overlays };
      })
      .filter((sec) => sec.overlays.length > 0);
  }, [overlayPacks, overlayQuery, selectedPackId]);

  const totalMatchesAllPacks = useMemo(() => {
    const q = overlayQuery.trim().toLowerCase();
    if (!q) return 0;
    let count = 0;
    for (const pack of overlayPacks) {
      for (const ov of pack.overlays) {
        if (
          ov.label.toLowerCase().includes(q) ||
          pack.name.toLowerCase().includes(q) ||
          pack.shortCode.toLowerCase().includes(q)
        ) {
          count += 1;
        }
      }
    }
    return count;
  }, [overlayPacks, overlayQuery]);

  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center border-r border-[#2e2a26] bg-[#161412] py-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand Palette"
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

  const handleTileFaceClick = (tilesetId: string, tileId: string, face: TileFace) => {
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

  const handleOverlayClick = (pack: ProtoOverlayPack, ov: ProtoOverlay) => {
    const isSame =
      activeBrush?.kind === 'overlay' &&
      activeBrush.overlayPackId === pack.id &&
      activeBrush.overlayId === ov.overlayId;

    if (isSame) {
      onSelectBrush(null);
      return;
    }

    onSelectBrush({
      kind: 'overlay',
      overlayPackId: pack.id,
      overlayId: ov.overlayId,
      label: ov.label,
      shortCode: pack.shortCode,
      url: ov.url,
      rotationDeg: activeBrush?.kind === 'overlay' ? activeBrush.rotationDeg : 0,
    });
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-[#2e2a26] bg-[#161412]">
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-2.5 py-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-[#1c1917] p-1">
          <button
            type="button"
            onClick={() => onTabChange('tiles')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'tiles'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Tiles</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('overlays')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              activeTab === 'overlays'
                ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Overlays</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse Palette"
          aria-label="Collapse Palette"
          className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {activeTab === 'tiles' ? (
        <>
          <div className="border-b border-[#2e2a26] px-2.5 py-2">
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedTilesetId('all')}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  selectedTilesetId === 'all'
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                }`}
              >
                All ({tilesets.length})
              </button>
              {tilesets.map((ts) => (
                <button
                  key={ts.id}
                  type="button"
                  title={ts.name}
                  onClick={() => setSelectedTilesetId(ts.id)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                    selectedTilesetId === ts.id
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                      : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                  }`}
                >
                  {ts.shortCode}
                </button>
              ))}
            </div>
          </div>

          <div className="rb-scroll flex-1 overflow-y-auto px-2.5 py-2.5">
            {bundleError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
                {bundleError}
              </div>
            )}
            <div className="space-y-4">
              {visibleTilesets.map((ts) => (
                <section key={ts.id}>
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <h3 className="text-xs font-semibold tracking-wide text-stone-300 uppercase">
                      {ts.name}
                    </h3>
                    <span className="text-[11px] text-stone-500">{ts.tiles.length} Tiles</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {ts.tiles.map((tile) => {
                      const faces = tile.isSymmetric ? [tile.faceA] : [tile.faceA, tile.faceB];
                      return (
                        <div
                          key={tile.tileId}
                          className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-2"
                        >
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono text-stone-300">
                            <span>
                              {ts.shortCode}{' '}
                              {tile.isSymmetric
                                ? `#${tile.faceA.label}`
                                : `${tile.faceA.label}/${tile.faceB.label}`}
                            </span>
                          </div>
                          <div className={`grid gap-2 ${tile.isSymmetric ? 'grid-cols-1' : 'grid-cols-2'}`}>
                            {faces.map((face) => {
                              const isActive =
                                activeBrush?.kind === 'tile' &&
                                activeBrush.tilesetId === ts.id &&
                                activeBrush.tileId === tile.tileId &&
                                activeBrush.faceNumber === face.faceNumber;
                              const brushPayload: ProtoBrush = {
                                kind: 'tile',
                                tilesetId: ts.id,
                                tileId: tile.tileId,
                                faceNumber: face.faceNumber,
                                rotation: activeBrush?.kind === 'tile' ? activeBrush.rotation : 0,
                              };
                              return (
                                <button
                                  key={face.faceNumber}
                                  type="button"
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                      'application/x-realm-brew-face',
                                      JSON.stringify(brushPayload),
                                    );
                                    e.dataTransfer.effectAllowed = 'copy';
                                    onDragBrushStart(brushPayload);
                                  }}
                                  onDragEnd={onDragBrushEnd}
                                  onClick={() => handleTileFaceClick(ts.id, tile.tileId, face)}
                                  className={`flex cursor-grab flex-col items-center rounded-md border p-1.5 transition active:cursor-grabbing ${
                                    isActive
                                      ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
                                      : 'border-[#2e2a26] bg-[#221f1c] hover:border-stone-500'
                                  }`}
                                >
                                  <img
                                    src={face.url}
                                    alt={`${ts.name} #${face.label}`}
                                    loading="lazy"
                                    draggable={false}
                                    className="h-16 w-full object-contain"
                                  />
                                  <span className="mt-1 font-mono text-[11px] text-stone-300">
                                    #{face.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2 border-b border-[#2e2a26] px-2.5 py-2">
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedPackId('all')}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  selectedPackId === 'all'
                    ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                    : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                }`}
              >
                All ({overlayPacks.length})
              </button>
              {overlayPacks.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  title={pack.name}
                  onClick={() => setSelectedPackId(pack.id)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                    selectedPackId === pack.id
                      ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                      : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                  }`}
                >
                  {pack.shortCode}
                </button>
              ))}
            </div>

            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-stone-500" />
              <input
                type="text"
                value={overlayQuery}
                onChange={(e) => setOverlayQuery(e.target.value)}
                placeholder="Search Overlays (bridge, door, lava...)"
                className="w-full rounded-md border border-[#2e2a26] bg-[#1c1917] py-1.5 pr-7 pl-8 text-xs text-stone-100 placeholder:text-stone-500 focus:border-sky-500/60 focus:outline-none"
              />
              {overlayQuery && (
                <button
                  type="button"
                  onClick={() => setOverlayQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 rounded p-0.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="rb-scroll flex-1 overflow-y-auto px-2.5 py-2.5">
            {filteredOverlaySections.length === 0 ? (
              <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
                <p>No matching Overlays in this pack.</p>
                {selectedPackId !== 'all' && totalMatchesAllPacks > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPackId('all')}
                    className="mt-2 rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
                  >
                    Show {totalMatchesAllPacks} matches across all packs
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredOverlaySections.map(({ pack, overlays }) => (
                  <section key={pack.id}>
                    <div className="mb-2 flex items-center justify-between px-0.5">
                      <h3 className="text-xs font-semibold tracking-wide text-stone-300 uppercase">
                        {pack.name}
                      </h3>
                      <span className="text-[11px] text-stone-500">{overlays.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {overlays.map((ov) => {
                        const isActive =
                          activeBrush?.kind === 'overlay' &&
                          activeBrush.overlayPackId === pack.id &&
                          activeBrush.overlayId === ov.overlayId;
                        const brushPayload: ProtoBrush = {
                          kind: 'overlay',
                          overlayPackId: pack.id,
                          overlayId: ov.overlayId,
                          label: ov.label,
                          shortCode: pack.shortCode,
                          url: ov.url,
                          rotationDeg:
                            activeBrush?.kind === 'overlay' ? activeBrush.rotationDeg : 0,
                        };
                        return (
                          <button
                            key={ov.overlayId}
                            type="button"
                            draggable
                            title={`${pack.shortCode} · ${ov.label}`}
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                'application/x-realm-brew-overlay',
                                JSON.stringify(brushPayload),
                              );
                              e.dataTransfer.effectAllowed = 'copy';
                              onDragBrushStart(brushPayload);
                            }}
                            onDragEnd={onDragBrushEnd}
                            onClick={() => handleOverlayClick(pack, ov)}
                            className={`flex cursor-grab flex-col rounded-md border p-1.5 text-left transition active:cursor-grabbing ${
                              isActive
                                ? 'border-sky-400 bg-sky-500/15 ring-1 ring-sky-400/50'
                                : 'border-[#2e2a26] bg-[#1c1917] hover:border-stone-500'
                            }`}
                          >
                            <div
                              className="flex h-20 w-full items-center justify-center rounded border border-[#2e2a26]/80 p-1"
                              style={{
                                backgroundImage:
                                  'linear-gradient(45deg, #272320 25%, transparent 25%), linear-gradient(-45deg, #272320 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #272320 75%), linear-gradient(-45deg, transparent 75%, #272320 75%)',
                                backgroundSize: '12px 12px',
                                backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                                backgroundColor: '#1e1b18',
                              }}
                            >
                              <img
                                src={ov.url}
                                alt={ov.label}
                                loading="lazy"
                                draggable={false}
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                            <span className="mt-1.5 line-clamp-2 text-[11px] leading-tight font-medium text-stone-200">
                              {ov.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
