import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createMap,
  deleteMap,
  fetchCollection,
  fetchMap,
  fetchMaps,
  fetchTilesets,
  saveCollection,
  saveMap,
} from './api/client';
import { exportMapAsPng } from './canvas/pngExporter';
import { CanvasViewport } from './components/CanvasViewport';
import { CollectionDialog } from './components/CollectionDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PngExportDialog } from './components/PngExportDialog';
import { PullListPanel } from './components/PullListPanel';
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
  computeCollectionUsage,
  computePullList,
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
  validateAndParseMapJson,
  type HistoryState,
} from './domain/plannerEngine';
import type {
  AxialCoord,
  BrushSelection,
  Collection,
  MapDocument,
  MapSummary,
  Placement,
  Tileset,
} from './domain/types';
import { downloadBlob, isEditableTarget, slugifyFilename } from './utils/browserHelpers';

export function App() {
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [collection, setCollection] = useState<Collection>({});
  const [bundleError, setBundleError] = useState<string | undefined>();
  const [appBannerError, setAppBannerError] = useState<string | null>(null);

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [activeMap, setActiveMap] = useState<MapDocument | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [selectedTilesetId, setSelectedTilesetId] = useState<string | 'all'>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [pullListOpen, setPullListOpen] = useState(false);
  const [activeBrush, setActiveBrush] = useState<BrushSelection | null>(null);
  const [draggingBrush, setDraggingBrush] = useState<BrushSelection | null>(null);
  const [selectedCoord, setSelectedCoord] = useState<AxialCoord | null>(null);
  const [history, setHistory] = useState<HistoryState<Placement[]>>(() =>
    createHistory<Placement[]>([]),
  );
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [pngExportOpen, setPngExportOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteMapConfirmOpen, setDeleteMapConfirmOpen] = useState(false);

  const placements = history.present;

  const historyRef = useRef(history);
  historyRef.current = history;
  const activeMapRef = useRef(activeMap);
  activeMapRef.current = activeMap;
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const collectionSaveSeqRef = useRef(0);

  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ id: string; name: string; placements: Placement[] } | null>(null);

  const persistNow = useCallback(
    async (payload: { id: string; name: string; placements: Placement[] }) => {
      setSaveStatus('saving');
      try {
        const updated = await saveMap(payload.id, payload.name, payload.placements);
        setMaps((prev) =>
          prev.map((m) =>
            m.id === updated.id
              ? {
                  id: updated.id,
                  name: updated.name,
                  placementCount: updated.placements.length,
                  updatedAt: updated.updatedAt,
                }
              : m,
          ),
        );
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    },
    [],
  );

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) {
      await persistNow(pending);
    }
  }, [persistNow]);

  const scheduleAutoSave = useCallback(
    (id: string, name: string, nextPlacements: Placement[]) => {
      pendingSaveRef.current = { id, name, placements: nextPlacements };
      setSaveStatus('saving');
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const payload = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (payload) {
          void persistNow(payload);
        }
      }, 400);
    },
    [persistNow],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTilesets(), fetchCollection(), fetchMaps()])
      .then(async ([tilesetList, col, mapList]) => {
        if (cancelled) return;
        setTilesets(tilesetList.tilesets);
        setBundleError(tilesetList.bundleConfigured ? undefined : tilesetList.error);
        setCollection(col);

        if (mapList.length === 0) {
          const initial = await createMap('Untitled Map', []);
          if (cancelled) return;
          setMaps([
            {
              id: initial.id,
              name: initial.name,
              placementCount: 0,
              updatedAt: initial.updatedAt,
            },
          ]);
          setActiveMap(initial);
          setHistory(createHistory(initial.placements));
          setSaveStatus('saved');
        } else {
          setMaps(mapList);
          const loaded = await fetchMap(mapList[0].id);
          if (cancelled) return;
          setActiveMap(loaded);
          setHistory(createHistory(loaded.placements));
          setSaveStatus('saved');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAppBannerError(err instanceof Error ? err.message : 'Unable to load workspace');
      });

    return () => {
      cancelled = true;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const tilesetsById = useMemo(() => {
    const map = new Map<string, Tileset>();
    for (const ts of tilesets) {
      map.set(ts.id, ts);
    }
    return map;
  }, [tilesets]);

  const collectionUsage = useMemo(
    () => computeCollectionUsage(placements, tilesets, collection),
    [placements, tilesets, collection],
  );

  const pullList = useMemo(
    () => computePullList(placements, tilesets, collection),
    [placements, tilesets, collection],
  );

  const commitPlacements = useCallback(
    (updater: (current: Placement[]) => Placement[]) => {
      const nextPlacements = updater(historyRef.current.present);
      const nextHistory = commitHistory(historyRef.current, nextPlacements);
      historyRef.current = nextHistory;
      setHistory(nextHistory);

      const currentMap = activeMapRef.current;
      if (currentMap) {
        scheduleAutoSave(currentMap.id, currentMap.name, nextPlacements);
      }
    },
    [scheduleAutoSave],
  );

  const loadMapIntoEditor = useCallback(
    (doc: MapDocument) => {
      const nextHistory = createHistory(doc.placements);
      historyRef.current = nextHistory;
      activeMapRef.current = doc;
      setActiveMap(doc);
      setHistory(nextHistory);
      setSelectedCoord(null);
      setSaveStatus('saved');
      setCamera(
        doc.placements.length > 0
          ? computeFitCamera(doc.placements, viewportSize.width, viewportSize.height, 56)
          : DEFAULT_CAMERA,
      );
    },
    [viewportSize.height, viewportSize.width],
  );

  const handleSelectMap = useCallback(
    async (id: string) => {
      if (activeMap?.id === id) return;
      await flushPendingSave();
      try {
        const doc = await fetchMap(id);
        loadMapIntoEditor(doc);
      } catch (err) {
        setAppBannerError(err instanceof Error ? err.message : 'Failed to load Map');
      }
    },
    [activeMap?.id, flushPendingSave, loadMapIntoEditor],
  );

  const handleCreateMap = useCallback(async () => {
    await flushPendingSave();
    try {
      const nextNum = maps.length + 1;
      const created = await createMap(`Map ${nextNum}`, []);
      setMaps((prev) => [
        {
          id: created.id,
          name: created.name,
          placementCount: 0,
          updatedAt: created.updatedAt,
        },
        ...prev,
      ]);
      loadMapIntoEditor(created);
    } catch (err) {
      setAppBannerError(err instanceof Error ? err.message : 'Failed to create Map');
    }
  }, [flushPendingSave, loadMapIntoEditor, maps.length]);

  const handleRenameMap = useCallback(
    async (nextName: string) => {
      const currentMap = activeMapRef.current;
      if (!currentMap) return;
      const updatedLocal: MapDocument = { ...currentMap, name: nextName };
      activeMapRef.current = updatedLocal;
      setActiveMap(updatedLocal);
      setMaps((prev) => prev.map((m) => (m.id === currentMap.id ? { ...m, name: nextName } : m)));
      scheduleAutoSave(currentMap.id, nextName, historyRef.current.present);
    },
    [scheduleAutoSave],
  );

  const handleConfirmDeleteMap = useCallback(async () => {
    setDeleteMapConfirmOpen(false);
    const currentMap = activeMapRef.current;
    if (!currentMap) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;

    const deletedId = currentMap.id;
    try {
      await deleteMap(deletedId);
      const remaining = maps.filter((m) => m.id !== deletedId);
      if (remaining.length === 0) {
        const fresh = await createMap('Untitled Map', []);
        setMaps([
          {
            id: fresh.id,
            name: fresh.name,
            placementCount: 0,
            updatedAt: fresh.updatedAt,
          },
        ]);
        loadMapIntoEditor(fresh);
      } else {
        setMaps(remaining);
        const nextDoc = await fetchMap(remaining[0].id);
        loadMapIntoEditor(nextDoc);
      }
    } catch (err) {
      setAppBannerError(err instanceof Error ? err.message : 'Failed to delete Map');
    }
  }, [loadMapIntoEditor, maps]);

  const handleExportJson = useCallback(async () => {
    const currentMap = activeMapRef.current;
    if (!currentMap) return;
    await flushPendingSave();
    const doc: MapDocument = {
      version: 1,
      id: currentMap.id,
      name: currentMap.name,
      createdAt: currentMap.createdAt,
      updatedAt: new Date().toISOString(),
      placements: historyRef.current.present,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${slugifyFilename(currentMap.name)}.realm-brew.json`);
  }, [flushPendingSave]);

  const handleImportJsonFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = validateAndParseMapJson(text);
        if (!parsed.ok) {
          setAppBannerError(`Import failed: ${parsed.error}`);
          return;
        }
        await flushPendingSave();
        const created = await createMap(parsed.map.name, parsed.map.placements);
        setMaps((prev) => [
          {
            id: created.id,
            name: created.name,
            placementCount: created.placements.length,
            updatedAt: created.updatedAt,
          },
          ...prev,
        ]);
        loadMapIntoEditor(created);
        setAppBannerError(null);
      } catch (err) {
        setAppBannerError(err instanceof Error ? err.message : 'Failed to import Map JSON');
      }
    },
    [flushPendingSave, loadMapIntoEditor],
  );

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
        setActiveBrush(null);
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
      const current = historyRef.current.present;
      const next = flipPlacement(current, selectedCoord, tilesets);
      const beforeFace = findPlacementAt(current, selectedCoord)?.faceNumber;
      const afterFace = findPlacementAt(next, selectedCoord)?.faceNumber;
      if (beforeFace === afterFace) return;

      const nextHistory = commitHistory(historyRef.current, next);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      const currentMap = activeMapRef.current;
      if (currentMap) {
        scheduleAutoSave(currentMap.id, currentMap.name, next);
      }
    }
  }, [activeBrush, scheduleAutoSave, selectedCoord, tilesets]);

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
    const prevHistory = historyRef.current;
    const nextHistory = undoHistory(prevHistory);
    if (nextHistory === prevHistory) return;
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setSelectedCoord(null);
    const currentMap = activeMapRef.current;
    if (currentMap) {
      scheduleAutoSave(currentMap.id, currentMap.name, nextHistory.present);
    }
  }, [scheduleAutoSave]);

  const handleRedo = useCallback(() => {
    const prevHistory = historyRef.current;
    const nextHistory = redoHistory(prevHistory);
    if (nextHistory === prevHistory) return;
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setSelectedCoord(null);
    const currentMap = activeMapRef.current;
    if (currentMap) {
      scheduleAutoSave(currentMap.id, currentMap.name, nextHistory.present);
    }
  }, [scheduleAutoSave]);

  const handleConfirmClearMap = useCallback(() => {
    commitPlacements(() => clearMap());
    setSelectedCoord(null);
    setClearConfirmOpen(false);
  }, [commitPlacements]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || isEditableTarget(event.target)) {
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
    const next: Collection = { ...collectionRef.current, [tilesetId]: copies };
    collectionRef.current = next;
    setCollection(next);
    const seq = ++collectionSaveSeqRef.current;
    void saveCollection(next)
      .then((persisted) => {
        if (seq === collectionSaveSeqRef.current) {
          collectionRef.current = persisted;
          setCollection(persisted);
        }
      })
      .catch((err) => {
        if (seq === collectionSaveSeqRef.current) {
          setAppBannerError(err instanceof Error ? err.message : 'Failed to save Collection');
        }
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
        maps={maps}
        activeMapId={activeMap?.id ?? null}
        activeMapName={activeMap?.name ?? 'Untitled Map'}
        saveStatus={saveStatus}
        onSelectMap={(id) => void handleSelectMap(id)}
        onCreateMap={() => void handleCreateMap()}
        onRenameMap={(name) => void handleRenameMap(name)}
        onRequestDeleteMap={() => setDeleteMapConfirmOpen(true)}
        onExportJson={() => void handleExportJson()}
        onImportJsonFile={(file) => void handleImportJsonFile(file)}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels((l) => !l)}
        pullListOpen={pullListOpen}
        onTogglePullList={() => setPullListOpen((o) => !o)}
        zoom={camera.zoom}
        onZoomIn={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))}
        onZoomOut={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))}
        onResetZoom={() => setCamera((c) => ({ ...c, zoom: 1 }))}
        onFitToContent={handleFitToContent}
        activeBrush={activeBrush}
        onClearBrush={() => setActiveBrush(null)}
        tilesetsById={tilesetsById}
        placementCount={placements.length}
        overBudgetCount={collectionUsage.overBudgetCoords.size}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRequestClearMap={() => setClearConfirmOpen(true)}
        onOpenCollection={() => setCollectionDialogOpen(true)}
        onOpenPngExport={() => setPngExportOpen(true)}
      />

      {appBannerError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between border-b border-red-500/40 bg-red-950/60 px-4 py-2 text-xs text-red-200"
        >
          <span>{appBannerError}</span>
          <button
            type="button"
            onClick={() => setAppBannerError(null)}
            aria-label="Dismiss error"
            className="rounded p-0.5 text-red-300 hover:bg-red-900/60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <TilePalette
          tilesets={tilesets}
          selectedTilesetId={selectedTilesetId}
          onSelectTileset={setSelectedTilesetId}
          inStockOnly={inStockOnly}
          onToggleInStockOnly={() => setInStockOnly((v) => !v)}
          availabilityByTileKey={collectionUsage.byTileKey}
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
          overBudgetCoords={collectionUsage.overBudgetCoords}
          showGrid={showGrid}
          showLabels={showLabels}
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

        {pullListOpen && (
          <PullListPanel
            mapName={activeMap?.name ?? 'Untitled Map'}
            pullList={pullList}
            onClose={() => setPullListOpen(false)}
          />
        )}
      </main>

      <CollectionDialog
        open={collectionDialogOpen}
        onClose={() => setCollectionDialogOpen(false)}
        tilesets={tilesets}
        collection={collection}
        onChangeCopies={handleChangeCopies}
      />

      <PngExportDialog
        open={pngExportOpen}
        onClose={() => setPngExportOpen(false)}
        mapName={activeMap?.name ?? 'Untitled Map'}
        placementCount={placements.length}
        defaultIncludeLabels={showLabels}
        onExport={async ({ background, includeLabels }) => {
          await exportMapAsPng({
            mapName: activeMap?.name ?? 'Untitled Map',
            placements,
            tilesetsById,
            background,
            includeLabels,
          });
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear entire Map?"
        description="This removes all Placements from the active Map. You can undo this action afterward with Cmd/Ctrl+Z."
        confirmLabel="Clear Map"
        onConfirm={handleConfirmClearMap}
        onCancel={() => setClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteMapConfirmOpen}
        title={`Delete "${activeMap?.name ?? 'Map'}"?`}
        description="This permanently deletes this saved Map from your local .data/maps directory."
        confirmLabel="Delete Map"
        onConfirm={() => void handleConfirmDeleteMap()}
        onCancel={() => setDeleteMapConfirmOpen(false)}
      />
    </div>
  );
}

export default App;
