import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCollection, fetchTilesets, saveCollection } from './api/client';
import { CanvasViewport } from './components/CanvasViewport';
import { CollectionDialog } from './components/CollectionDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TilePalette } from './components/TilePalette';
import { Toolbar } from './components/Toolbar';
import {
  DEFAULT_CAMERA,
  clampZoom,
  computeFitCamera,
  type Camera,
} from './domain/hexGeometry';
import {
  clearMap,
  commitHistory,
  computeStock,
  createHistory,
  findPlacementAt,
  flipBrush,
  flipPlacement,
  moveOrSwapPlacement,
  placeTile,
  redoHistory,
  removePlacement,
  rotatePlacement,
  rotateStep,
  undoHistory,
  type HistoryState,
} from './domain/plannerEngine';
import type { AxialCoord, BrushSelection, Collection, Placement, Tileset } from './domain/types';

function isInputFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function App() {
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [collection, setCollection] = useState<Collection>({});
  const [bundleError, setBundleError] = useState<string | undefined>();
  const [selectedTilesetId, setSelectedTilesetId] = useState<string | 'all'>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [activeBrush, setActiveBrush] = useState<BrushSelection | null>(null);
  const [draggingBrush, setDraggingBrush] = useState<BrushSelection | null>(null);
  const [selectedCoord, setSelectedCoord] = useState<AxialCoord | null>(null);
  const [history, setHistory] = useState<HistoryState<Placement[]>>(() =>
    createHistory<Placement[]>([]),
  );
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const placements = history.present;

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

  const commitPlacements = useCallback((updater: (current: Placement[]) => Placement[]) => {
    setHistory((prev) => commitHistory(prev, updater(prev.present)));
  }, []);

  const handleSelectBrush = useCallback((brush: BrushSelection | null) => {
    setActiveBrush(brush);
    if (brush) {
      setSelectedCoord(null);
    }
  }, []);

  const handlePlaceAt = useCallback(
    (coord: AxialCoord, brushOverride?: BrushSelection) => {
      const brush = brushOverride ?? activeBrush;
      if (!brush) return;
      commitPlacements((prev) =>
        placeTile(prev, {
          q: coord.q,
          r: coord.r,
          tilesetId: brush.tilesetId,
          tileId: brush.tileId,
          faceNumber: brush.faceNumber,
          rotation: brush.rotation,
        }),
      );
      if (brushOverride) {
        setSelectedCoord(coord);
      }
    },
    [activeBrush, commitPlacements],
  );

  const handleRotateAction = useCallback(
    (delta: 1 | -1) => {
      if (activeBrush) {
        setActiveBrush((prev) =>
          prev ? { ...prev, rotation: rotateStep(prev.rotation, delta) } : null,
        );
        return;
      }
      if (selectedCoord) {
        commitPlacements((prev) => rotatePlacement(prev, selectedCoord, delta));
      }
    },
    [activeBrush, selectedCoord, commitPlacements],
  );

  const handleFlipAction = useCallback(() => {
    if (activeBrush) {
      setActiveBrush((prev) => (prev ? flipBrush(prev, tilesets) : null));
      return;
    }
    if (selectedCoord) {
      setHistory((prev) => {
        const next = flipPlacement(prev.present, selectedCoord, tilesets);
        const beforeFace = findPlacementAt(prev.present, selectedCoord)?.faceNumber;
        const afterFace = findPlacementAt(next, selectedCoord)?.faceNumber;
        if (beforeFace === afterFace) return prev;
        return commitHistory(prev, next);
      });
    }
  }, [activeBrush, selectedCoord, tilesets]);

  const handleMoveOrSwap = useCallback(
    (from: AxialCoord, to: AxialCoord) => {
      if (from.q === to.q && from.r === to.r) return;
      commitPlacements((prev) => moveOrSwapPlacement(prev, from, to));
    },
    [commitPlacements],
  );

  const handleRemoveAt = useCallback(
    (coord: AxialCoord) => {
      commitPlacements((prev) => removePlacement(prev, coord));
      setSelectedCoord((cur) => (cur && cur.q === coord.q && cur.r === coord.r ? null : cur));
    },
    [commitPlacements],
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => undoHistory(prev));
    setSelectedCoord(null);
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => redoHistory(prev));
    setSelectedCoord(null);
  }, []);

  const handleConfirmClearMap = useCallback(() => {
    commitPlacements((prev) => clearMap(prev));
    setSelectedCoord(null);
    setClearConfirmOpen(false);
  }, [commitPlacements]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || isInputFocused(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        setActiveBrush(null);
        setSelectedCoord(null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          handleRotateAction(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          handleFlipAction();
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCoord) {
          event.preventDefault();
          handleRemoveAt(selectedCoord);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleFlipAction, handleRedo, handleRemoveAt, handleRotateAction, handleUndo, selectedCoord]);

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
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRequestClearMap={() => setClearConfirmOpen(true)}
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
          onSelectBrush={handleSelectBrush}
          onDragFaceStart={setDraggingBrush}
          onDragFaceEnd={() => setDraggingBrush(null)}
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed((c) => !c)}
          bundleError={bundleError}
        />

        <CanvasViewport
          placements={placements}
          tilesetsById={tilesetsById}
          activeBrush={activeBrush}
          draggingBrush={draggingBrush}
          selectedCoord={selectedCoord}
          overBudgetCoords={stock.overBudgetCoords}
          showGrid={showGrid}
          camera={camera}
          onCameraChange={setCamera}
          onViewportSizeChange={handleViewportSizeChange}
          onPlaceAt={(coord) => handlePlaceAt(coord)}
          onDropFaceAt={(coord, brush) => handlePlaceAt(coord, brush)}
          onSelectCoord={setSelectedCoord}
          onMoveOrSwap={handleMoveOrSwap}
          onRemoveAt={handleRemoveAt}
          onRotateAction={handleRotateAction}
          onFlipAction={handleFlipAction}
        />
      </main>

      <CollectionDialog
        open={collectionDialogOpen}
        onClose={() => setCollectionDialogOpen(false)}
        tilesets={tilesets}
        collection={collection}
        onChangeCopies={handleChangeCopies}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear entire Map?"
        description="This removes all Placements from the active Map. You can undo this action afterward with Cmd/Ctrl+Z."
        confirmLabel="Clear Map"
        onConfirm={handleConfirmClearMap}
        onCancel={() => setClearConfirmOpen(false)}
      />
    </div>
  );
}

export default App;
