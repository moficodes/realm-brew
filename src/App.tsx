import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCollection, fetchTilesets, saveCollection } from './api/client';
import { CanvasViewport } from './components/CanvasViewport';
import { CollectionDialog } from './components/CollectionDialog';
import { TilePalette } from './components/TilePalette';
import { Toolbar } from './components/Toolbar';
import {
  DEFAULT_CAMERA,
  clampZoom,
  computeFitCamera,
  type Camera,
} from './domain/hexGeometry';
import { computeStock, placeTile } from './domain/plannerEngine';
import type { AxialCoord, BrushSelection, Collection, Placement, Tileset } from './domain/types';

export function App() {
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [collection, setCollection] = useState<Collection>({});
  const [bundleError, setBundleError] = useState<string | undefined>();
  const [selectedTilesetId, setSelectedTilesetId] = useState<string | 'all'>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [activeBrush, setActiveBrush] = useState<BrushSelection | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTilesets(), fetchCollection()])
      .then(([catalog, col]) => {
        if (cancelled) return;
        setTilesets(catalog.tilesets);
        setBundleError(catalog.bundleConfigured ? undefined : catalog.error);
        setCollection(col);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBundleError(err instanceof Error ? err.message : 'Unable to load Tilesets');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setActiveBrush(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const tilesetsById = useMemo(() => {
    const map = new Map<string, Tileset>();
    for (const ts of tilesets) {
      map.set(ts.id, ts);
    }
    return map;
  }, [tilesets]);

  const stock = useMemo(
    () => computeStock(placements, tilesets, collection),
    [placements, tilesets, collection],
  );

  const handlePlaceAt = (coord: AxialCoord) => {
    if (!activeBrush) return;
    setPlacements((prev) =>
      placeTile(prev, {
        q: coord.q,
        r: coord.r,
        tilesetId: activeBrush.tilesetId,
        tileId: activeBrush.tileId,
        faceNumber: activeBrush.faceNumber,
        rotation: activeBrush.rotation,
      }),
    );
  };

  const handleChangeCopies = (tilesetId: string, copies: number) => {
    const next: Collection = { ...collection, [tilesetId]: copies };
    setCollection(next);
    void saveCollection(next).then((persisted) => {
      setCollection(persisted);
    });
  };

  const handleViewportSizeChange = useCallback((nextSize: { width: number; height: number }) => {
    setViewportSize(nextSize);
  }, []);

  const handleFitToContent = () => {
    setCamera(computeFitCamera(placements, viewportSize.width, viewportSize.height, 56));
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#161412] text-stone-100">
      <Toolbar
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
        zoom={camera.zoom}
        onZoomIn={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))}
        onZoomOut={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))}
        onResetZoom={() => setCamera((c) => ({ ...c, zoom: 1 }))}
        onFitToContent={handleFitToContent}
        activeBrush={activeBrush}
        onClearBrush={() => setActiveBrush(null)}
        tilesetsById={tilesetsById}
        placementCount={placements.length}
        overBudgetCount={stock.overBudgetCoords.size}
        onOpenCollection={() => setCollectionDialogOpen(true)}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <TilePalette
          tilesets={tilesets}
          selectedTilesetId={selectedTilesetId}
          onSelectTileset={setSelectedTilesetId}
          inStockOnly={inStockOnly}
          onToggleInStockOnly={() => setInStockOnly((v) => !v)}
          stockByTileKey={stock.byTileKey}
          activeBrush={activeBrush}
          onSelectBrush={setActiveBrush}
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed((c) => !c)}
          bundleError={bundleError}
        />

        <CanvasViewport
          placements={placements}
          tilesetsById={tilesetsById}
          activeBrush={activeBrush}
          overBudgetCoords={stock.overBudgetCoords}
          showGrid={showGrid}
          camera={camera}
          onCameraChange={setCamera}
          onViewportSizeChange={handleViewportSizeChange}
          onPlaceAt={handlePlaceAt}
        />
      </main>

      <CollectionDialog
        open={collectionDialogOpen}
        onClose={() => setCollectionDialogOpen(false)}
        tilesets={tilesets}
        collection={collection}
        onChangeCopies={handleChangeCopies}
      />
    </div>
  );
}

export default App;
