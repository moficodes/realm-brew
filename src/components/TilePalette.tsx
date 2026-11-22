import { AlertTriangle, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { tileCollectionKey, type TileAvailability } from '../domain/plannerEngine';
import type { BrushSelection, TileFace, Tileset } from '../domain/types';

interface TilePaletteProps {
  tilesets: readonly Tileset[];
  selectedTilesetId: string | 'all';
  onSelectTileset: (tilesetId: string | 'all') => void;
  inStockOnly: boolean;
  onToggleInStockOnly: () => void;
  availabilityByTileKey: ReadonlyMap<string, TileAvailability>;
  activeBrush: BrushSelection | null;
  onSelectBrush: (brush: BrushSelection | null) => void;
  onDragFaceStart: (brush: BrushSelection) => void;
  onDragFaceEnd: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  bundleError?: string;
}

interface TileFaceButtonProps {
  tileset: Tileset;
  tileId: string;
  face: TileFace;
  isActive: boolean;
  defaultRotation: BrushSelection['rotation'];
  onClick: () => void;
  onDragStart: (brush: BrushSelection) => void;
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
        const payload: BrushSelection = {
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

export function TilePalette({
  tilesets,
  selectedTilesetId,
  onSelectTileset,
  inStockOnly,
  onToggleInStockOnly,
  availabilityByTileKey,
  activeBrush,
  onSelectBrush,
  onDragFaceStart,
  onDragFaceEnd,
  collapsed,
  onToggleCollapse,
  bundleError,
}: TilePaletteProps) {
  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center border-r border-[#2e2a26] bg-[#161412] py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Tile Palette"
          aria-label="Expand Tile Palette"
          className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="mt-4 flex flex-col items-center gap-2 text-stone-500">
          <Layers className="h-4 w-4" />
          <span className="[writing-mode:vertical-rl] text-[11px] font-medium tracking-wider uppercase">
            Tiles
          </span>
        </div>
      </aside>
    );
  }

  const baseTilesets =
    selectedTilesetId === 'all'
      ? tilesets
      : tilesets.filter((t) => t.id === selectedTilesetId);

  const visibleSections = baseTilesets
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
      activeBrush?.tilesetId === tilesetId &&
      activeBrush.tileId === tileId &&
      activeBrush.faceNumber === face.faceNumber;

    if (isSame) {
      onSelectBrush(null);
      return;
    }

    onSelectBrush({
      tilesetId,
      tileId,
      faceNumber: face.faceNumber,
      rotation: activeBrush?.rotation ?? 0,
    });
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-[#2e2a26] bg-[#161412]">
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold tracking-tight text-stone-100">Tile Palette</h2>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Tile Palette"
          aria-label="Collapse Tile Palette"
          className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-[#2e2a26] px-2.5 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tileset filter">
          <button
            type="button"
            role="tab"
            aria-selected={selectedTilesetId === 'all'}
            onClick={() => onSelectTileset('all')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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
              role="tab"
              aria-selected={selectedTilesetId === ts.id}
              onClick={() => onSelectTileset(ts.id)}
              title={ts.name}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedTilesetId === ts.id
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                  : 'bg-[#1c1917] text-stone-400 hover:bg-stone-800 hover:text-stone-200'
              }`}
            >
              {ts.shortCode}
            </button>
          ))}
        </div>

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

      <div className="rb-scroll flex-1 overflow-y-auto px-2.5 py-2.5">
        {bundleError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
            <p className="font-semibold">Bundle directory unavailable</p>
            <p className="mt-1 text-amber-200/80">{bundleError}</p>
          </div>
        )}

        {!bundleError && visibleSections.length === 0 && (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            {inStockOnly ? 'No available Tiles remaining in this filter.' : 'No Tilesets found.'}
          </div>
        )}

        <div className="space-y-4">
          {visibleSections.map(({ tileset, tiles }) => (
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
                  const isDepletedOrOver = remaining <= 0;
                  const isOver = remaining < 0;

                  const isFaceAActive =
                    activeBrush?.tilesetId === tileset.id &&
                    activeBrush.tileId === tile.tileId &&
                    activeBrush.faceNumber === tile.faceA.faceNumber;
                  const isFaceBActive =
                    !tile.isSymmetric &&
                    activeBrush?.tilesetId === tileset.id &&
                    activeBrush.tileId === tile.tileId &&
                    activeBrush.faceNumber === tile.faceB.faceNumber;

                  const defaultRotation = activeBrush?.rotation ?? 0;

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

                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                            isDepletedOrOver
                              ? 'border border-red-500/40 bg-red-950/60 text-red-300'
                              : 'border border-[#2e2a26] bg-[#161412] text-stone-300'
                          }`}
                        >
                          {isOver && <AlertTriangle className="h-3 w-3 text-red-400" />}
                          {remaining} left
                        </span>
                      </div>

                      <div className={`grid gap-2 ${tile.isSymmetric ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <TileFaceButton
                          tileset={tileset}
                          tileId={tile.tileId}
                          face={tile.faceA}
                          isActive={isFaceAActive}
                          defaultRotation={defaultRotation}
                          onClick={() => handleFaceClick(tileset.id, tile.tileId, tile.faceA)}
                          onDragStart={onDragFaceStart}
                          onDragEnd={onDragFaceEnd}
                        />
                        {!tile.isSymmetric && (
                          <TileFaceButton
                            tileset={tileset}
                            tileId={tile.tileId}
                            face={tile.faceB}
                            isActive={isFaceBActive}
                            defaultRotation={defaultRotation}
                            onClick={() => handleFaceClick(tileset.id, tile.tileId, tile.faceB)}
                            onDragStart={onDragFaceStart}
                            onDragEnd={onDragFaceEnd}
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
    </aside>
  );
}
