import { Dices, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createMap,
  deleteMap,
  fetchCollection,
  fetchMap,
  fetchMaps,
  fetchTilesets,
  initStorageMode,
  listStoredPacks,
  saveCollection,
  saveMap,
  type StorageMode,
  type StoredPackSummary,
} from './api/client';
import { TileImageCache } from './canvas/imageCache';
import { resolveOverlayFitAssetState } from './canvas/mapRenderer';
import { exportMapAsPng } from './canvas/pngExporter';
import { TileEdgeAnalyzer } from './canvas/tileEdgeAnalyzer';
import { BundleImportDialog } from './components/BundleImportDialog';
import { CanvasViewport } from './components/CanvasViewport';
import { CollectionDialog, type CollectionPackKind } from './components/CollectionDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import {
  GenerateMapDialog,
  type EdgeAnalysisStatus,
  type GenerateMapDialogSubmit,
} from './components/GenerateMapDialog';
import type { OverlayContextMenuState } from './components/OverlayContextMenu';
import { PngExportDialog } from './components/PngExportDialog';
import type { PullListSubView } from './components/PullListPanel';
import { RightDrawer, type RightDrawerTab } from './components/RightDrawer';
import { TilePalette, type PaletteTab } from './components/TilePalette';
import { Toolbar } from './components/Toolbar';
import {
  DEFAULT_CAMERA,
  HEX_RADIUS,
  axialToWorld,
  clampZoom,
  computePanToFocusCamera,
  normalizeRotationDeg,
  type Camera,
} from './domain/hexGeometry';
import {
  computeFitCameraWithOverlays,
  overlayLocalToWorld,
} from './domain/overlayGeometry';
import { generateSeamlessMap } from './domain/mapGenerator';
import type { TileEdgeIndex } from './domain/tileEdges';
import {
  applyFogStroke,
  attachOverlayAtWorld,
  canRedoWithFence,
  canUndoWithFence,
  centerOverlayOnHost,
  clearMap,
  commitWithFence,
  compactPlacement,
  computeCollectionUsage,
  computePullList,
  countCoveredPlacements,
  countMapOverlays,
  coverAllPlacements,
  createHistory,
  enterPlayerViewSession,
  findOverlayById,
  findPlacementAt,
  flipBrush,
  flipPlacement,
  formatClearMapDescription,
  moveOrReparentOverlay,
  moveOrSwapPlacement,
  placeTile,
  reconcileSelectionAfterHistory,
  redoWithFence,
  removeOverlay,
  removePlacement,
  reorderOverlayZ,
  revealAllPlacements,
  rotateOverlayByDelta,
  rotatePlacement,
  rotateStep,
  setOverlayLocalRotation,
  setOverlayWorldRotation,
  toMapSummary,
  togglePlacementFog,
  undoWithFence,
  validateAndParseMapJson,
  type HistoryState,
  type MapViewMode,
  type PlayerViewFence,
  type PullListHighlight,
} from './domain/plannerEngine';
import type {
  ActiveBrush,
  AxialCoord,
  Collection,
  MapDocument,
  MapSummary,
  OverlayBrushSelection,
  OverlayPack,
  Placement,
  TileBrushSelection,
  Tileset,
} from './domain/types';
import { downloadBlob, isEditableTarget, slugifyFilename } from './utils/browserHelpers';

export function App() {
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [overlayPacks, setOverlayPacks] = useState<OverlayPack[]>([]);
  const [collection, setCollection] = useState<Collection>({
    version: 2,
    tilesets: {},
    overlayPacks: {},
  });
  const [bundleError, setBundleError] = useState<string | undefined>();
  const [appBannerError, setAppBannerError] = useState<string | null>(null);

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [activeMap, setActiveMap] = useState<MapDocument | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [paletteTab, setPaletteTab] = useState<PaletteTab>('tiles');
  const [selectedTilesetId, setSelectedTilesetId] = useState<string | 'all'>('all');
  const [selectedOverlayPackId, setSelectedOverlayPackId] = useState<string | 'all'>('all');
  const [overlaySearchQuery, setOverlaySearchQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [rightDrawerCollapsed, setRightDrawerCollapsed] = useState(true);
  const [rightDrawerTab, setRightDrawerTab] = useState<RightDrawerTab>('inspector');
  const [pullListSubView, setPullListSubView] = useState<PullListSubView>('by-pack');
  const [activeBrush, setActiveBrush] = useState<ActiveBrush | null>(null);
  const [draggingBrush, setDraggingBrush] = useState<ActiveBrush | null>(null);
  const [selectedCoord, setSelectedCoord] = useState<AxialCoord | null>(null);
  const [focusedOverlayId, setFocusedOverlayId] = useState<string | null>(null);
  const [hoveredInspectorOverlayId, setHoveredInspectorOverlayId] = useState<string | null>(null);
  const [pullListHighlight, setPullListHighlight] = useState<PullListHighlight | null>(null);
  const [inspectorRotationPreview, setInspectorRotationPreview] = useState<{
    hostCoord: AxialCoord;
    overlayId: string;
    worldDeg: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<OverlayContextMenuState | null>(null);
  const [viewMode, setViewMode] = useState<MapViewMode>('gm');
  const [playerViewFence, setPlayerViewFence] = useState<PlayerViewFence | null>(null);
  const [fogToolActive, setFogToolActive] = useState(false);
  const [history, setHistory] = useState<HistoryState<Placement[]>>(() =>
    createHistory<Placement[]>([]),
  );
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [storageMode, setStorageMode] = useState<StorageMode>('server');
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [storedPacks, setStoredPacks] = useState<StoredPackSummary[]>([]);
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [generatorDialogOpen, setGeneratorDialogOpen] = useState(false);
  const [edgeIndex, setEdgeIndex] = useState<TileEdgeIndex>(() => new Map());
  const [edgeAnalysisStatus, setEdgeAnalysisStatus] = useState<EdgeAnalysisStatus>({
    state: 'idle',
    analyzed: 0,
    total: 0,
  });
  const [lastGenConfig, setLastGenConfig] = useState<{
    selectedTilesetIds: string[];
    targetTileCount: number;
  } | null>(null);
  const [lastGenToast, setLastGenToast] = useState<{
    placedCount: number;
    requestedCount: number;
    openPerimeterEdges: number;
    matchedSeams: number;
    selectedTilesetIds: string[];
    targetTileCount: number;
  } | null>(null);
  const [pngExportOpen, setPngExportOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteMapConfirmOpen, setDeleteMapConfirmOpen] = useState(false);

  const placements = history.present;

  const historyRef = useRef(history);
  historyRef.current = history;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const playerViewFenceRef = useRef(playerViewFence);
  playerViewFenceRef.current = playerViewFence;
  const fogToolActiveRef = useRef(fogToolActive);
  fogToolActiveRef.current = fogToolActive;
  const activeMapRef = useRef(activeMap);
  activeMapRef.current = activeMap;
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const selectedCoordRef = useRef(selectedCoord);
  selectedCoordRef.current = selectedCoord;
  const focusedOverlayIdRef = useRef(focusedOverlayId);
  focusedOverlayIdRef.current = focusedOverlayId;
  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;
  const activeBrushRef = useRef(activeBrush);
  activeBrushRef.current = activeBrush;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const panAnimFrameRef = useRef<number | null>(null);
  const paletteScrollPositionsRef = useRef({ tiles: 0, overlays: 0 });
  const collectionSaveSeqRef = useRef(0);
  const didAutoOpenBundleRef = useRef(false);
  const imageCache = useMemo(() => new TileImageCache(), []);
  const edgeAnalyzer = useMemo(() => new TileEdgeAnalyzer(), []);

  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ id: string; name: string; placements: Placement[] } | null>(null);

  const persistNow = useCallback(
    async (payload: { id: string; name: string; placements: Placement[] }) => {
      setSaveStatus('saving');
      try {
        const updated = await saveMap(payload.id, payload.name, payload.placements);
        const summary = toMapSummary(updated);
        setMaps((prev) => prev.map((m) => (m.id === updated.id ? summary : m)));
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

  const tilesetsById = useMemo(() => {
    const map = new Map<string, Tileset>();
    for (const ts of tilesets) {
      map.set(ts.id, ts);
    }
    return map;
  }, [tilesets]);

  const overlayPacksById = useMemo(() => {
    const map = new Map<string, OverlayPack>();
    for (const pack of overlayPacks) {
      map.set(pack.id, pack);
    }
    return map;
  }, [overlayPacks]);
  const overlayPacksByIdRef = useRef(overlayPacksById);
  overlayPacksByIdRef.current = overlayPacksById;

  const cancelSmoothPan = useCallback(() => {
    if (panAnimFrameRef.current !== null) {
      window.cancelAnimationFrame(panAnimFrameRef.current);
      panAnimFrameRef.current = null;
    }
  }, []);

  const loadMapIntoEditor = useCallback(
    (doc: MapDocument) => {
      const nextHistory = createHistory(doc.placements);
      historyRef.current = nextHistory;
      activeMapRef.current = doc;
      viewModeRef.current = 'gm';
      playerViewFenceRef.current = null;
      fogToolActiveRef.current = false;
      activeBrushRef.current = null;
      selectedCoordRef.current = null;
      focusedOverlayIdRef.current = null;
      contextMenuRef.current = null;
      setViewMode('gm');
      setPlayerViewFence(null);
      setFogToolActive(false);
      setActiveBrush(null);
      setDraggingBrush(null);
      setActiveMap(doc);
      setHistory(nextHistory);
      setSelectedCoord(null);
      setFocusedOverlayId(null);
      setHoveredInspectorOverlayId(null);
      setPullListHighlight(null);
      setInspectorRotationPreview(null);
      setContextMenu(null);
      setLastGenToast(null);
      setSaveStatus('saved');
      cancelSmoothPan();
      const size = viewportSizeRef.current;
      setCamera(
        doc.placements.length > 0
          ? computeFitCameraWithOverlays(doc.placements, size.width, size.height, {
              padding: 56,
              viewMode: 'gm',
              getOverlayAssetState: (ov) =>
                resolveOverlayFitAssetState(ov, overlayPacksByIdRef.current, imageCache),
            })
          : DEFAULT_CAMERA,
      );
    },
    [cancelSmoothPan, imageCache],
  );

  useEffect(() => {
    let cancelled = false;
    initStorageMode()
      .then(async (mode) => {
        if (cancelled) return;
        setStorageMode(mode);
        const [tilesetList, col, mapList, packSummaries] = await Promise.all([
          fetchTilesets(),
          fetchCollection(),
          fetchMaps(),
          mode === 'browser' ? listStoredPacks() : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const nextOverlayPacks = new Map<string, OverlayPack>();
        for (const pack of tilesetList.overlayPacks) {
          nextOverlayPacks.set(pack.id, pack);
        }
        overlayPacksByIdRef.current = nextOverlayPacks;
        setTilesets(tilesetList.tilesets);
        setOverlayPacks(tilesetList.overlayPacks);
        setStoredPacks(packSummaries);
        setBundleError(tilesetList.bundleConfigured ? undefined : tilesetList.error);
        setCollection(col);

        if (mode === 'browser' && !tilesetList.bundleConfigured && !didAutoOpenBundleRef.current) {
          didAutoOpenBundleRef.current = true;
          setBundleDialogOpen(true);
        }

        if (mapList.length === 0) {
          const initial = await createMap('Untitled Map', []);
          if (cancelled) return;
          setMaps([toMapSummary(initial)]);
          loadMapIntoEditor(initial);
        } else {
          setMaps(mapList);
          const loaded = await fetchMap(mapList[0].id);
          if (cancelled) return;
          loadMapIntoEditor(loaded);
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
      if (panAnimFrameRef.current !== null) {
        window.cancelAnimationFrame(panAnimFrameRef.current);
      }
    };
  }, [loadMapIntoEditor]);

  const handleBundleUpdated = useCallback(async () => {
    const [tilesetList, packSummaries, col] = await Promise.all([
      fetchTilesets(),
      listStoredPacks(),
      fetchCollection(),
    ]);
    const nextTilesetsById = new Map<string, Tileset>();
    for (const ts of tilesetList.tilesets) {
      nextTilesetsById.set(ts.id, ts);
    }
    const nextOverlayPacks = new Map<string, OverlayPack>();
    for (const pack of tilesetList.overlayPacks) {
      nextOverlayPacks.set(pack.id, pack);
    }

    imageCache.clear();
    edgeAnalyzer.clear();
    overlayPacksByIdRef.current = nextOverlayPacks;
    setTilesets(tilesetList.tilesets);
    setOverlayPacks(tilesetList.overlayPacks);
    setStoredPacks(packSummaries);
    setCollection(col);
    setBundleError(tilesetList.bundleConfigured ? undefined : tilesetList.error);

    setSelectedTilesetId((cur) => (cur !== 'all' && !nextTilesetsById.has(cur) ? 'all' : cur));
    setSelectedOverlayPackId((cur) =>
      cur !== 'all' && !nextOverlayPacks.has(cur) ? 'all' : cur,
    );

    setActiveBrush((current) => {
      if (!current) return null;
      if (current.kind === 'tile') {
        const ts = nextTilesetsById.get(current.tilesetId);
        const tile = ts?.tiles.find((t) => t.tileId === current.tileId);
        if (!tile) return null;
        const hasFace =
          tile.faceA.faceNumber === current.faceNumber ||
          tile.faceB.faceNumber === current.faceNumber;
        return hasFace ? current : null;
      }
      const pack = nextOverlayPacks.get(current.overlayPackId);
      const overlay = pack?.overlays.find((o) => o.overlayId === current.overlayId);
      if (!pack || !overlay) return null;
      return {
        ...current,
        label: overlay.label,
        shortCode: pack.shortCode,
        url: overlay.url,
      };
    });
  }, [imageCache, edgeAnalyzer]);

  useEffect(() => {
    if (tilesets.length === 0) {
      setEdgeIndex(new Map());
      setEdgeAnalysisStatus({ state: 'idle', analyzed: 0, total: 0 });
      return;
    }

    const controller = new AbortController();
    const totalFaces = tilesets.reduce(
      (sum, ts) => sum + ts.tiles.reduce((tSum, t) => tSum + (t.isSymmetric ? 1 : 2), 0),
      0,
    );
    setEdgeAnalysisStatus({ state: 'analyzing', analyzed: 0, total: totalFaces });

    edgeAnalyzer
      .analyzeTilesets(tilesets, imageCache, {
        signal: controller.signal,
        onProgress: ({ analyzed, total }) => {
          if (!controller.signal.aborted) {
            setEdgeAnalysisStatus({ state: 'analyzing', analyzed, total });
          }
        },
      })
      .then((nextIndex) => {
        if (controller.signal.aborted) return;
        setEdgeIndex(nextIndex);
        setEdgeAnalysisStatus({ state: 'ready', analyzed: nextIndex.size, total: totalFaces });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setEdgeAnalysisStatus({
          state: 'error',
          analyzed: 0,
          total: totalFaces,
          error: err instanceof Error ? err.message : 'Unable to analyze Tile edges',
        });
      });

    return () => {
      controller.abort();
    };
  }, [tilesets, edgeAnalyzer, imageCache]);

  const collectionUsage = useMemo(
    () => computeCollectionUsage(placements, tilesets, collection, overlayPacks),
    [placements, tilesets, collection, overlayPacks],
  );

  const overlayCount = useMemo(() => countMapOverlays(placements), [placements]);
  const coveredCount = useMemo(() => countCoveredPlacements(placements), [placements]);

  const { overBudgetTilesetIds, overBudgetOverlayPackIds } = useMemo(() => {
    const tilesetIds = new Set<string>();
    for (const avail of collectionUsage.byTileKey.values()) {
      if (avail.isOverBudget) {
        tilesetIds.add(avail.tilesetId);
      }
    }
    const overlayPackIds = new Set<string>();
    for (const avail of collectionUsage.byOverlayKey.values()) {
      if (avail.isOverBudget) {
        overlayPackIds.add(avail.overlayPackId);
      }
    }
    return { overBudgetTilesetIds: tilesetIds, overBudgetOverlayPackIds: overlayPackIds };
  }, [collectionUsage]);

  const pullList = useMemo(
    () => computePullList(placements, tilesets, collection, overlayPacks),
    [placements, tilesets, collection, overlayPacks],
  );

  const selectedHost = useMemo(
    () => (selectedCoord ? findPlacementAt(placements, selectedCoord) : undefined),
    [placements, selectedCoord],
  );

  const applyCommittedPlacements = useCallback(
    (nextPlacements: Placement[]) => {
      const committed = commitWithFence(
        historyRef.current,
        playerViewFenceRef.current,
        nextPlacements,
      );
      historyRef.current = committed.history;
      setHistory(committed.history);
      playerViewFenceRef.current = committed.fence;
      setPlayerViewFence(committed.fence);

      const currentMap = activeMapRef.current;
      if (currentMap) {
        scheduleAutoSave(currentMap.id, currentMap.name, nextPlacements);
      }
    },
    [scheduleAutoSave],
  );

  const commitPlacements = useCallback(
    (updater: (current: Placement[]) => Placement[]) => {
      const currentPlacements = historyRef.current.present;
      const nextPlacements = updater(currentPlacements);
      if (nextPlacements === currentPlacements) {
        return;
      }
      applyCommittedPlacements(nextPlacements);
    },
    [applyCommittedPlacements],
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
      setMaps((prev) => [toMapSummary(created), ...prev]);
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
        setMaps([toMapSummary(fresh)]);
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
      version: 2,
      id: currentMap.id,
      name: currentMap.name,
      createdAt: currentMap.createdAt,
      updatedAt: new Date().toISOString(),
      placements: historyRef.current.present.map(compactPlacement),
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
        setMaps((prev) => [toMapSummary(created), ...prev]);
        loadMapIntoEditor(created);
        setAppBannerError(null);
      } catch (err) {
        setAppBannerError(err instanceof Error ? err.message : 'Failed to import Map JSON');
      }
    },
    [flushPendingSave, loadMapIntoEditor],
  );

  const handleSelectBrush = useCallback((brush: ActiveBrush | null) => {
    setActiveBrush(brush);
    if (brush) {
      setFogToolActive(false);
      setSelectedCoord(null);
      setFocusedOverlayId(null);
    }
  }, []);

  const handleDragBrushStart = useCallback((brush: ActiveBrush) => {
    setFogToolActive(false);
    setDraggingBrush(brush);
  }, []);

  const handlePlaceAt = useCallback(
    (coord: AxialCoord, brushOverride?: TileBrushSelection) => {
      const brush = brushOverride ?? (activeBrush?.kind === 'tile' ? activeBrush : null);
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
      setFocusedOverlayId(null);
      if (brushOverride) {
        setActiveBrush(null);
        setSelectedCoord(coord);
      }
    },
    [activeBrush, commitPlacements],
  );

  const handlePlaceOverlayAt = useCallback(
    (
      coord: AxialCoord,
      worldX: number,
      worldY: number,
      brushOverride?: OverlayBrushSelection,
    ) => {
      const brush = brushOverride ?? (activeBrush?.kind === 'overlay' ? activeBrush : null);
      if (!brush) return;

      const current = historyRef.current.present;
      const { placements: next, createdOverlay } = attachOverlayAtWorld(
        current,
        coord,
        brush,
        worldX,
        worldY,
      );
      if (!createdOverlay) return;

      applyCommittedPlacements(next);

      setSelectedCoord(coord);
      setFocusedOverlayId(createdOverlay.id);
      if (brushOverride) {
        setActiveBrush(null);
      }
    },
    [activeBrush, applyCommittedPlacements],
  );

  const handleSelectHostOnly = useCallback((coord: AxialCoord | null) => {
    if (coord) {
      setFogToolActive(false);
    }
    setSelectedCoord(coord);
    setFocusedOverlayId(null);
  }, []);

  const handleSelectOverlay = useCallback((hostCoord: AxialCoord, overlayId: string) => {
    setSelectedCoord(hostCoord);
    setFocusedOverlayId(overlayId);
  }, []);

  const handleFocusOverlayFromContextMenu = useCallback(
    (hostCoord: AxialCoord, overlayId: string) => {
      setActiveBrush(null);
      setSelectedCoord(hostCoord);
      setFocusedOverlayId(overlayId);
    },
    [],
  );

  const handleSelectHostFromContextMenu = useCallback((coord: AxialCoord) => {
    setActiveBrush(null);
    setSelectedCoord(coord);
    setFocusedOverlayId(null);
  }, []);

  const handleMoveOrSwap = useCallback(
    (from: AxialCoord, to: AxialCoord) => {
      if (from.q === to.q && from.r === to.r) return;
      commitPlacements((prev) => moveOrSwapPlacement(prev, from, to));
    },
    [commitPlacements],
  );

  const handleMoveOrReparentOverlay = useCallback(
    (
      fromHost: AxialCoord,
      overlayId: string,
      targetHost: AxialCoord,
      worldX: number,
      worldY: number,
    ) => {
      const current = historyRef.current.present;
      const res = moveOrReparentOverlay(
        current,
        fromHost,
        overlayId,
        targetHost,
        worldX,
        worldY,
      );
      if (res.changed) {
        applyCommittedPlacements(res.placements);
      }
      setSelectedCoord(targetHost);
      setFocusedOverlayId(overlayId);
    },
    [applyCommittedPlacements],
  );

  const handleSetOverlayWorldRotation = useCallback(
    (hostCoord: AxialCoord, overlayId: string, worldDeg: number) => {
      commitPlacements((prev) =>
        setOverlayWorldRotation(prev, hostCoord, overlayId, worldDeg),
      );
    },
    [commitPlacements],
  );

  const handleSetOverlayLocalRotation = useCallback(
    (hostCoord: AxialCoord, overlayId: string, localDeg: number) => {
      commitPlacements((prev) =>
        setOverlayLocalRotation(prev, hostCoord, overlayId, localDeg),
      );
    },
    [commitPlacements],
  );

  const handleRotateOverlayDelta = useCallback(
    (hostCoord: AxialCoord, overlayId: string, deltaDeg: number) => {
      commitPlacements((prev) =>
        rotateOverlayByDelta(prev, hostCoord, overlayId, deltaDeg),
      );
    },
    [commitPlacements],
  );

  const handleCenterOverlay = useCallback(
    (hostCoord: AxialCoord, overlayId: string) => {
      commitPlacements((prev) => centerOverlayOnHost(prev, hostCoord, overlayId));
    },
    [commitPlacements],
  );

  const handleReorderOverlay = useCallback(
    (hostCoord: AxialCoord, overlayId: string, direction: 'up' | 'down') => {
      commitPlacements((prev) => reorderOverlayZ(prev, hostCoord, overlayId, direction));
    },
    [commitPlacements],
  );

  const handleRemoveOverlay = useCallback(
    (hostCoord: AxialCoord, overlayId: string) => {
      commitPlacements((prev) => removeOverlay(prev, hostCoord, overlayId));
      if (focusedOverlayIdRef.current === overlayId) {
        setFocusedOverlayId(null);
      }
      setHoveredInspectorOverlayId((cur) => (cur === overlayId ? null : cur));
    },
    [commitPlacements],
  );

  const handleRemoveAt = useCallback(
    (coord: AxialCoord) => {
      const removing = findPlacementAt(historyRef.current.present, coord);
      const removedFocused = Boolean(
        focusedOverlayIdRef.current &&
          removing?.overlays?.some((ov) => ov.id === focusedOverlayIdRef.current),
      );
      commitPlacements((prev) => removePlacement(prev, coord));
      setSelectedCoord((cur) => (cur && cur.q === coord.q && cur.r === coord.r ? null : cur));
      if (removedFocused) {
        setFocusedOverlayId(null);
      }
    },
    [commitPlacements],
  );

  const handleRotateHost = useCallback(
    (coord: AxialCoord, delta: 1 | -1) => {
      commitPlacements((prev) => rotatePlacement(prev, coord, delta));
    },
    [commitPlacements],
  );

  const handleFlipHost = useCallback(
    (coord: AxialCoord) => {
      commitPlacements((prev) => flipPlacement(prev, coord, tilesets));
    },
    [commitPlacements, tilesets],
  );

  const handleRotateAction = useCallback(
    (delta: 1 | -1) => {
      const brush = activeBrushRef.current;
      if (brush) {
        if (brush.kind === 'tile') {
          setActiveBrush((prev) =>
            prev && prev.kind === 'tile'
              ? { ...prev, rotation: rotateStep(prev.rotation, delta) }
              : prev,
          );
        } else {
          setActiveBrush((prev) =>
            prev && prev.kind === 'overlay'
              ? { ...prev, rotationDeg: normalizeRotationDeg(prev.rotationDeg + delta * 15) }
              : prev,
          );
        }
        return;
      }

      const ovMatch = findOverlayById(historyRef.current.present, focusedOverlayIdRef.current);
      if (ovMatch) {
        handleRotateOverlayDelta(ovMatch.host, ovMatch.overlay.id, delta * 15);
        return;
      }

      if (selectedCoordRef.current) {
        handleRotateHost(selectedCoordRef.current, delta);
      }
    },
    [handleRotateHost, handleRotateOverlayDelta],
  );

  const handleFlipAction = useCallback(() => {
    const brush = activeBrushRef.current;
    if (brush) {
      if (brush.kind === 'tile') {
        setActiveBrush((prev) =>
          prev && prev.kind === 'tile' ? flipBrush(prev, tilesets) : prev,
        );
      }
      return;
    }

    // F flips host Tile only when no child Overlay Placement is focused
    if (focusedOverlayIdRef.current) {
      return;
    }

    if (selectedCoordRef.current) {
      handleFlipHost(selectedCoordRef.current);
    }
  }, [handleFlipHost, tilesets]);

  const handleToggleHostFog = useCallback(
    (coord: AxialCoord) => {
      commitPlacements((prev) => togglePlacementFog(prev, coord));
    },
    [commitPlacements],
  );

  const handleCommitFogStroke = useCallback(
    (coords: AxialCoord[], targetCovered: boolean) => {
      commitPlacements((prev) => applyFogStroke(prev, coords, targetCovered));
    },
    [commitPlacements],
  );

  const handleCoverAllFog = useCallback(() => {
    if (viewModeRef.current !== 'gm') return;
    commitPlacements((prev) => coverAllPlacements(prev));
  }, [commitPlacements]);

  const handleRevealAllFog = useCallback(() => {
    if (viewModeRef.current !== 'gm') return;
    commitPlacements((prev) => revealAllPlacements(prev));
  }, [commitPlacements]);

  const handleToggleFogTool = useCallback(() => {
    if (viewModeRef.current !== 'gm') return;
    setFogToolActive((prev) => {
      const next = !prev;
      fogToolActiveRef.current = next;
      if (next) {
        activeBrushRef.current = null;
        selectedCoordRef.current = null;
        focusedOverlayIdRef.current = null;
        contextMenuRef.current = null;
        setActiveBrush(null);
        setSelectedCoord(null);
        setFocusedOverlayId(null);
        setHoveredInspectorOverlayId(null);
        setPullListHighlight(null);
        setInspectorRotationPreview(null);
        setContextMenu(null);
      }
      return next;
    });
  }, []);

  const handleChangeViewMode = useCallback((nextMode: MapViewMode) => {
    if (nextMode === viewModeRef.current) return;
    if (nextMode === 'player') {
      const fence = enterPlayerViewSession(historyRef.current);
      playerViewFenceRef.current = fence;
      setPlayerViewFence(fence);
      fogToolActiveRef.current = false;
      activeBrushRef.current = null;
      selectedCoordRef.current = null;
      focusedOverlayIdRef.current = null;
      contextMenuRef.current = null;
      setFogToolActive(false);
      setActiveBrush(null);
      setDraggingBrush(null);
      setSelectedCoord(null);
      setFocusedOverlayId(null);
      setHoveredInspectorOverlayId(null);
      setPullListHighlight(null);
      setInspectorRotationPreview(null);
      setContextMenu(null);
      setCollectionDialogOpen(false);
      setGeneratorDialogOpen(false);
      setLastGenToast(null);
      setPngExportOpen(false);
      setClearConfirmOpen(false);
      setDeleteMapConfirmOpen(false);
      if (panAnimFrameRef.current !== null) {
        window.cancelAnimationFrame(panAnimFrameRef.current);
        panAnimFrameRef.current = null;
      }
      viewModeRef.current = 'player';
      setViewMode('player');
      return;
    }

    playerViewFenceRef.current = null;
    setPlayerViewFence(null);
    viewModeRef.current = 'gm';
    setViewMode('gm');
  }, []);

  const applyHistoryTransition = useCallback(
    (res: { history: HistoryState<Placement[]>; fence: PlayerViewFence | null; changed: boolean }) => {
      if (!res.changed) return;
      historyRef.current = res.history;
      setHistory(res.history);
      playerViewFenceRef.current = res.fence;
      setPlayerViewFence(res.fence);
      contextMenuRef.current = null;
      setContextMenu(null);
      setInspectorRotationPreview(null);

      if (viewModeRef.current === 'gm') {
        const reconciled = reconcileSelectionAfterHistory(
          res.history.present,
          selectedCoordRef.current,
          focusedOverlayIdRef.current,
        );
        selectedCoordRef.current = reconciled.selectedCoord;
        focusedOverlayIdRef.current = reconciled.focusedOverlayId;
        setSelectedCoord(reconciled.selectedCoord);
        setFocusedOverlayId(reconciled.focusedOverlayId);
        setHoveredInspectorOverlayId((cur) =>
          cur && findOverlayById(res.history.present, cur) ? cur : null,
        );
      }

      const currentMap = activeMapRef.current;
      if (currentMap) {
        scheduleAutoSave(currentMap.id, currentMap.name, res.history.present);
      }
    },
    [scheduleAutoSave],
  );

  const handleUndo = useCallback(() => {
    applyHistoryTransition(undoWithFence(historyRef.current, playerViewFenceRef.current));
  }, [applyHistoryTransition]);

  const handleRedo = useCallback(() => {
    applyHistoryTransition(redoWithFence(historyRef.current, playerViewFenceRef.current));
  }, [applyHistoryTransition]);

  const handleConfirmClearMap = useCallback(() => {
    commitPlacements((prev) => clearMap(prev));
    selectedCoordRef.current = null;
    focusedOverlayIdRef.current = null;
    contextMenuRef.current = null;
    fogToolActiveRef.current = false;
    setSelectedCoord(null);
    setFocusedOverlayId(null);
    setHoveredInspectorOverlayId(null);
    setPullListHighlight(null);
    setInspectorRotationPreview(null);
    setContextMenu(null);
    setFogToolActive(false);
    setClearConfirmOpen(false);
  }, [commitPlacements]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = () => {
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [contextMenu]);

  const handleFitToContent = useCallback(() => {
    cancelSmoothPan();
    const currentPlacements = historyRef.current.present;
    const size = viewportSizeRef.current;
    const mode = viewModeRef.current;
    setCamera(
      currentPlacements.length > 0
        ? computeFitCameraWithOverlays(currentPlacements, size.width, size.height, {
            padding: 56,
            viewMode: mode,
            getOverlayAssetState: (ov) =>
              resolveOverlayFitAssetState(ov, overlayPacksByIdRef.current, imageCache),
          })
        : DEFAULT_CAMERA,
    );
  }, [cancelSmoothPan, imageCache]);

  const applyGeneratedInPlace = useCallback(
    (
      result: ReturnType<typeof generateSeamlessMap>,
      selectedTilesetIds: string[],
      targetTileCount: number,
    ) => {
      activeBrushRef.current = null;
      fogToolActiveRef.current = false;
      selectedCoordRef.current = null;
      focusedOverlayIdRef.current = null;
      contextMenuRef.current = null;
      setActiveBrush(null);
      setFogToolActive(false);
      setSelectedCoord(null);
      setFocusedOverlayId(null);
      setHoveredInspectorOverlayId(null);
      setPullListHighlight(null);
      setInspectorRotationPreview(null);
      setContextMenu(null);

      applyCommittedPlacements(result.placements);
      cancelSmoothPan();
      const size = viewportSizeRef.current;
      setCamera(
        result.placements.length > 0
          ? computeFitCameraWithOverlays(result.placements, size.width, size.height, {
              padding: 56,
              viewMode: 'gm',
              getOverlayAssetState: (ov) =>
                resolveOverlayFitAssetState(ov, overlayPacksByIdRef.current, imageCache),
            })
          : DEFAULT_CAMERA,
      );
      setLastGenConfig({ selectedTilesetIds, targetTileCount });
      setLastGenToast({
        placedCount: result.placedCount,
        requestedCount: result.requestedCount,
        openPerimeterEdges: result.openPerimeterEdges,
        matchedSeams: result.matchedSeams,
        selectedTilesetIds,
        targetTileCount,
      });
    },
    [applyCommittedPlacements, cancelSmoothPan, imageCache],
  );

  const handleGenerateMap = useCallback(
    async ({ selectedTilesetIds, targetTileCount, destination }: GenerateMapDialogSubmit) => {
      const result = generateSeamlessMap({
        tilesets,
        selectedTilesetIds,
        collection: collectionRef.current,
        edgeIndex,
        targetTileCount,
      });

      setGeneratorDialogOpen(false);
      setLastGenConfig({ selectedTilesetIds, targetTileCount });

      if (destination === 'new-map') {
        await flushPendingSave();
        try {
          const nextNum = maps.length + 1;
          const created = await createMap(`Generated Map ${nextNum}`, result.placements);
          setMaps((prev) => [toMapSummary(created), ...prev]);
          loadMapIntoEditor(created);
          setLastGenToast({
            placedCount: result.placedCount,
            requestedCount: result.requestedCount,
            openPerimeterEdges: result.openPerimeterEdges,
            matchedSeams: result.matchedSeams,
            selectedTilesetIds,
            targetTileCount,
          });
        } catch (err) {
          setAppBannerError(err instanceof Error ? err.message : 'Failed to create generated Map');
        }
        return;
      }

      applyGeneratedInPlace(result, selectedTilesetIds, targetTileCount);
    },
    [
      applyGeneratedInPlace,
      edgeIndex,
      flushPendingSave,
      loadMapIntoEditor,
      maps.length,
      tilesets,
    ],
  );

  const handleRerollGeneratedMap = useCallback(() => {
    if (!lastGenToast) return;
    const result = generateSeamlessMap({
      tilesets,
      selectedTilesetIds: lastGenToast.selectedTilesetIds,
      collection: collectionRef.current,
      edgeIndex,
      targetTileCount: lastGenToast.targetTileCount,
    });
    applyGeneratedInPlace(
      result,
      lastGenToast.selectedTilesetIds,
      lastGenToast.targetTileCount,
    );
  }, [applyGeneratedInPlace, edgeIndex, lastGenToast, tilesets]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || isEditableTarget(event.target)) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      if (!event.altKey && (event.metaKey || event.ctrlKey) && lowerKey === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        lowerKey === 'y'
      ) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (lowerKey === 'g') {
          event.preventDefault();
          setShowGrid((g) => !g);
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          handleFitToContent();
          return;
        }
      }

      // In Player View all editing shortcuts, Labels, drawers, and Esc are disabled
      if (viewModeRef.current === 'player') {
        return;
      }

      if (event.key === 'Escape') {
        if (contextMenuRef.current) {
          setContextMenu(null);
        } else if (activeBrushRef.current) {
          setActiveBrush(null);
        } else if (fogToolActiveRef.current) {
          setFogToolActive(false);
        } else if (focusedOverlayIdRef.current) {
          setFocusedOverlayId(null);
        } else if (selectedCoordRef.current) {
          setSelectedCoord(null);
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (!event.shiftKey && lowerKey === 'l') {
          event.preventDefault();
          setShowLabels((l) => !l);
          return;
        }
        if (event.key === '[') {
          event.preventDefault();
          setPaletteCollapsed((c) => !c);
          return;
        }
        if (event.key === ']') {
          event.preventDefault();
          setRightDrawerCollapsed((c) => !c);
          return;
        }
        if (fogToolActiveRef.current) {
          return;
        }
        if (lowerKey === 'r') {
          event.preventDefault();
          handleRotateAction(event.shiftKey ? -1 : 1);
          return;
        }
        if (!event.shiftKey && lowerKey === 'f') {
          event.preventDefault();
          handleFlipAction();
          return;
        }
        if (
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !activeBrushRef.current
        ) {
          const ovMatch = findOverlayById(historyRef.current.present, focusedOverlayIdRef.current);
          if (ovMatch) {
            event.preventDefault();
            handleRemoveOverlay(ovMatch.host, ovMatch.overlay.id);
            return;
          }
          if (selectedCoordRef.current) {
            event.preventDefault();
            handleRemoveAt(selectedCoordRef.current);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleFitToContent,
    handleFlipAction,
    handleRedo,
    handleRemoveAt,
    handleRemoveOverlay,
    handleRotateAction,
    handleUndo,
  ]);

  const handleChangeCopies = (kind: CollectionPackKind, id: string, copies: number) => {
    const prev = collectionRef.current;
    const next: Collection =
      kind === 'tileset'
        ? { ...prev, version: 2, tilesets: { ...prev.tilesets, [id]: copies } }
        : { ...prev, version: 2, overlayPacks: { ...prev.overlayPacks, [id]: copies } };
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

  const handleCameraChange = useCallback(
    (next: Camera | ((prev: Camera) => Camera)) => {
      cancelSmoothPan();
      setCamera(next);
    },
    [cancelSmoothPan],
  );

  const smoothPanToWorldIfNeeded = useCallback(
    (worldX: number, worldY: number) => {
      cancelSmoothPan();
      const targetCam = computePanToFocusCamera(
        cameraRef.current,
        worldX,
        worldY,
        viewportSizeRef.current.width,
        viewportSizeRef.current.height,
        64,
      );
      if (!targetCam) return;

      const startCam = cameraRef.current;
      const startTime = performance.now();
      const durationMs = 260;

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCamera((prev) => ({
          ...prev,
          x: startCam.x + (targetCam.x - startCam.x) * eased,
          y: startCam.y + (targetCam.y - startCam.y) * eased,
        }));
        if (progress < 1) {
          panAnimFrameRef.current = window.requestAnimationFrame(step);
        } else {
          panAnimFrameRef.current = null;
        }
      };

      panAnimFrameRef.current = window.requestAnimationFrame(step);
    },
    [cancelSmoothPan],
  );

  const handleFocusPullListHost = useCallback(
    (coord: AxialCoord) => {
      setActiveBrush(null);
      setFogToolActive(false);
      setContextMenu(null);
      setSelectedCoord(coord);
      setFocusedOverlayId(null);
      const { x, y } = axialToWorld(coord.q, coord.r, HEX_RADIUS);
      smoothPanToWorldIfNeeded(x, y);
    },
    [smoothPanToWorldIfNeeded],
  );

  const handleFocusPullListOverlay = useCallback(
    (hostCoord: AxialCoord, overlayId: string) => {
      setActiveBrush(null);
      setFogToolActive(false);
      setContextMenu(null);
      setSelectedCoord(hostCoord);
      setFocusedOverlayId(overlayId);
      const match = findOverlayById(historyRef.current.present, overlayId);
      if (match) {
        const world = overlayLocalToWorld(match.host, match.overlay);
        smoothPanToWorldIfNeeded(world.x, world.y);
      } else {
        const { x, y } = axialToWorld(hostCoord.q, hostCoord.r, HEX_RADIUS);
        smoothPanToWorldIfNeeded(x, y);
      }
    },
    [smoothPanToWorldIfNeeded],
  );

  const handleViewportSizeChange = useCallback((nextSize: { width: number; height: number }) => {
    viewportSizeRef.current = nextSize;
    setViewportSize(nextSize);
  }, []);

  const handleTogglePullListFromToolbar = useCallback(() => {
    if (rightDrawerCollapsed || rightDrawerTab !== 'pull-list') {
      setRightDrawerTab('pull-list');
      setRightDrawerCollapsed(false);
    } else {
      setRightDrawerCollapsed(true);
    }
  }, [rightDrawerCollapsed, rightDrawerTab]);

  useEffect(() => {
    if (rightDrawerCollapsed || rightDrawerTab !== 'inspector') {
      setHoveredInspectorOverlayId(null);
      setInspectorRotationPreview(null);
    }
    if (rightDrawerCollapsed || rightDrawerTab !== 'pull-list') {
      setPullListHighlight(null);
    }
  }, [rightDrawerCollapsed, rightDrawerTab]);

  const handleExpandInspector = useCallback(() => {
    setRightDrawerTab('inspector');
    setRightDrawerCollapsed(false);
  }, []);

  const pullListToolbarActive = !rightDrawerCollapsed && rightDrawerTab === 'pull-list';
  const canUndo = canUndoWithFence(history, playerViewFence);
  const canRedo = canRedoWithFence(history, playerViewFence);

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
        pullListOpen={pullListToolbarActive}
        onTogglePullList={handleTogglePullListFromToolbar}
        zoom={camera.zoom}
        onZoomIn={() => handleCameraChange((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))}
        onZoomOut={() => handleCameraChange((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))}
        onResetZoom={() => handleCameraChange((c) => ({ ...c, zoom: 1 }))}
        onFitToContent={handleFitToContent}
        activeBrush={activeBrush}
        onClearBrush={() => setActiveBrush(null)}
        tilesetsById={tilesetsById}
        overlayPacksById={overlayPacksById}
        placementCount={placements.length}
        overlayCount={overlayCount}
        overBudgetTileCount={collectionUsage.overBudgetCoords.size}
        overBudgetOverlayCount={collectionUsage.overBudgetOverlayIds.size}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRequestClearMap={() => setClearConfirmOpen(true)}
        onOpenCollection={() => setCollectionDialogOpen(true)}
        onOpenGenerator={() => setGeneratorDialogOpen(true)}
        canGenerate={tilesets.length > 0}
        onOpenBundleManager={
          storageMode === 'browser' ? () => setBundleDialogOpen(true) : undefined
        }
        bundleLoaded={tilesets.length > 0 || overlayPacks.length > 0}
        onOpenPngExport={() => {
          if (viewModeRef.current === 'gm') {
            setPngExportOpen(true);
          }
        }}
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        fogToolActive={fogToolActive}
        onToggleFogTool={handleToggleFogTool}
        coveredCount={coveredCount}
        onCoverAll={handleCoverAllFog}
        onRevealAll={handleRevealAllFog}
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
        {viewMode === 'gm' && (
          <TilePalette
            activeTab={paletteTab}
            onTabChange={setPaletteTab}
            tilesets={tilesets}
            overlayPacks={overlayPacks}
            selectedTilesetId={selectedTilesetId}
            onSelectTileset={setSelectedTilesetId}
            selectedOverlayPackId={selectedOverlayPackId}
            onSelectOverlayPack={setSelectedOverlayPackId}
            overlaySearchQuery={overlaySearchQuery}
            onOverlaySearchChange={setOverlaySearchQuery}
            inStockOnly={inStockOnly}
            onToggleInStockOnly={() => setInStockOnly((v) => !v)}
            availabilityByTileKey={collectionUsage.byTileKey}
            availabilityByOverlayKey={collectionUsage.byOverlayKey}
            overBudgetTilesetIds={overBudgetTilesetIds}
            overBudgetOverlayPackIds={overBudgetOverlayPackIds}
            activeBrush={activeBrush}
            onSelectBrush={handleSelectBrush}
            onDragBrushStart={handleDragBrushStart}
            onDragBrushEnd={() => setDraggingBrush(null)}
            collapsed={paletteCollapsed}
            onToggleCollapse={() => setPaletteCollapsed((c) => !c)}
            scrollPositionsRef={paletteScrollPositionsRef}
            bundleError={bundleError}
            onOpenBundleManager={
              storageMode === 'browser' ? () => setBundleDialogOpen(true) : undefined
            }
          />
        )}

        <div className="relative flex min-w-0 flex-1">
          <CanvasViewport
            placements={placements}
            tilesetsById={tilesetsById}
            overlayPacksById={overlayPacksById}
            imageCache={imageCache}
            activeBrush={activeBrush}
            draggingBrush={draggingBrush}
            selectedCoord={selectedCoord}
            focusedOverlayId={focusedOverlayId}
            hoveredInspectorOverlayId={hoveredInspectorOverlayId}
            pullListHighlight={pullListHighlight}
            inspectorRotationPreview={inspectorRotationPreview}
            rightDrawerCollapsed={rightDrawerCollapsed}
            contextMenu={contextMenu}
            onContextMenuChange={setContextMenu}
            overBudgetCoords={collectionUsage.overBudgetCoords}
            overBudgetOverlayIds={collectionUsage.overBudgetOverlayIds}
            showGrid={showGrid}
            showLabels={showLabels}
            camera={camera}
            onCameraChange={handleCameraChange}
            onViewportSizeChange={handleViewportSizeChange}
            onPlaceAt={(coord) => handlePlaceAt(coord)}
            onDropFaceAt={(coord, brush) => handlePlaceAt(coord, brush)}
            onPlaceOverlayAt={(coord, wx, wy) => handlePlaceOverlayAt(coord, wx, wy)}
            onDropOverlayAt={(coord, wx, wy, brush) => handlePlaceOverlayAt(coord, wx, wy, brush)}
            onSelectHostOnly={handleSelectHostOnly}
            onSelectOverlay={handleSelectOverlay}
            onFocusOverlayFromContextMenu={handleFocusOverlayFromContextMenu}
            onSelectHostFromContextMenu={handleSelectHostFromContextMenu}
            onClearBrush={() => setActiveBrush(null)}
            onMoveOrSwap={handleMoveOrSwap}
            onMoveOrReparentOverlay={handleMoveOrReparentOverlay}
            onSetOverlayWorldRotation={handleSetOverlayWorldRotation}
            onRemoveAt={(coord) => handleRemoveAt(coord)}
            onRemoveOverlayAt={(hostCoord, overlayId) => handleRemoveOverlay(hostCoord, overlayId)}
            onRotateAction={handleRotateAction}
            onFlipAction={handleFlipAction}
            onExpandInspector={handleExpandInspector}
            viewMode={viewMode}
            fogToolActive={fogToolActive}
            coveredCount={coveredCount}
            onExitFogTool={() => setFogToolActive(false)}
            onCoverAll={handleCoverAllFog}
            onRevealAll={handleRevealAllFog}
            onToggleHostFog={handleToggleHostFog}
            onCommitFogStroke={handleCommitFogStroke}
          />

          {viewMode === 'gm' && lastGenToast && (
            <div
              role="status"
              className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3"
            >
              <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[#2e2a26] bg-[#161412]/95 px-3.5 py-1.5 text-xs text-stone-200 shadow-xl backdrop-blur">
                <Dices className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>
                  Generated{' '}
                  <strong className="font-semibold text-stone-100">
                    {lastGenToast.placedCount}
                  </strong>{' '}
                  {lastGenToast.placedCount === 1 ? 'Tile' : 'Tiles'} ·{' '}
                  {lastGenToast.matchedSeams} matched{' '}
                  {lastGenToast.matchedSeams === 1 ? 'seam' : 'seams'} ·{' '}
                  {lastGenToast.openPerimeterEdges === 0
                    ? 'Fully sealed'
                    : `${lastGenToast.openPerimeterEdges} open ${
                        lastGenToast.openPerimeterEdges === 1 ? 'exit' : 'exits'
                      }`}
                </span>
                <button
                  type="button"
                  onClick={handleRerollGeneratedMap}
                  title="Generate another variation with the same settings (undoable)"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/25"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Re-roll</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLastGenToast(null)}
                  aria-label="Dismiss generated Map summary"
                  className="rounded-full p-0.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {viewMode === 'gm' && (
          <RightDrawer
            collapsed={rightDrawerCollapsed}
            activeTab={rightDrawerTab}
            onTabChange={setRightDrawerTab}
            pullListSubView={pullListSubView}
            onPullListSubViewChange={setPullListSubView}
            onToggleCollapse={() => setRightDrawerCollapsed((c) => !c)}
            onExpandToInspector={handleExpandInspector}
            mapName={activeMap?.name ?? 'Untitled Map'}
            pullList={pullList}
            selectedHost={selectedHost}
            focusedOverlayId={focusedOverlayId}
            tilesetsById={tilesetsById}
            overlayPacksById={overlayPacksById}
            onFocusOverlayId={setFocusedOverlayId}
            onHoverOverlayId={setHoveredInspectorOverlayId}
            onHoverPullListHighlight={setPullListHighlight}
            onFocusPullListHost={handleFocusPullListHost}
            onFocusPullListOverlay={handleFocusPullListOverlay}
            onRotateHost={handleRotateHost}
            onFlipHost={handleFlipHost}
            onToggleHostFog={handleToggleHostFog}
            onRemoveHost={handleRemoveAt}
            onReorderOverlay={handleReorderOverlay}
            onRemoveOverlay={handleRemoveOverlay}
            onCenterOverlay={handleCenterOverlay}
            onRotateOverlayDelta={handleRotateOverlayDelta}
            onSetOverlayLocalRotation={handleSetOverlayLocalRotation}
            onPreviewOverlayRotation={setInspectorRotationPreview}
          />
        )}
      </main>

      <CollectionDialog
        open={collectionDialogOpen}
        onClose={() => setCollectionDialogOpen(false)}
        tilesets={tilesets}
        overlayPacks={overlayPacks}
        collection={collection}
        onChangeCopies={handleChangeCopies}
      />

      <GenerateMapDialog
        open={viewMode === 'gm' && generatorDialogOpen}
        onClose={() => setGeneratorDialogOpen(false)}
        tilesets={tilesets}
        collection={collection}
        edgeIndex={edgeIndex}
        analysisStatus={edgeAnalysisStatus}
        hasExistingPlacements={placements.length > 0}
        initialSelectedTilesetIds={lastGenConfig?.selectedTilesetIds ?? []}
        initialTargetCount={lastGenConfig?.targetTileCount ?? 24}
        onOpenCollection={() => setCollectionDialogOpen(true)}
        onGenerate={(params) => void handleGenerateMap(params)}
      />

      {storageMode === 'browser' && (
        <BundleImportDialog
          open={bundleDialogOpen}
          onClose={() => setBundleDialogOpen(false)}
          storedPacks={storedPacks}
          onBundleUpdated={handleBundleUpdated}
        />
      )}

      <PngExportDialog
        open={viewMode === 'gm' && pngExportOpen}
        onClose={() => setPngExportOpen(false)}
        mapName={activeMap?.name ?? 'Untitled Map'}
        placementCount={placements.length}
        overlayCount={overlayCount}
        coveredCount={coveredCount}
        defaultIncludeLabels={showLabels}
        onExport={async ({ background, includeLabels, fogMode }) => {
          if (viewModeRef.current !== 'gm') return;
          await exportMapAsPng({
            mapName: activeMap?.name ?? 'Untitled Map',
            placements,
            tilesetsById,
            overlayPacksById,
            background,
            includeLabels,
            fogMode,
          });
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear entire Map?"
        description={formatClearMapDescription(placements)}
        confirmLabel="Clear Map"
        onConfirm={handleConfirmClearMap}
        onCancel={() => setClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteMapConfirmOpen}
        title={`Delete "${activeMap?.name ?? 'Map'}"?`}
        description={
          storageMode === 'browser'
            ? "This permanently deletes this saved Map from this browser's local storage."
            : 'This permanently deletes this saved Map from your local .data/maps directory.'
        }
        confirmLabel="Delete Map"
        onConfirm={() => void handleConfirmDeleteMap()}
        onCancel={() => setDeleteMapConfirmOpen(false)}
      />
    </div>
  );
}

export default App;
