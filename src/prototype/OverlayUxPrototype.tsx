// THROWAWAY PROTOTYPE ENTRY for Wayfinder #13
// Interactive 3-variant UI prototype for Overlay Canvas manipulation and Tile-vs-Overlay selection UX.

import {
  Grid,
  Maximize2,
  Redo2,
  RotateCcw,
  Tag,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTilesets } from '../api/client';
import { TileImageCache } from '../canvas/imageCache';
import {
  DEFAULT_CAMERA,
  clampZoom,
  computeFitCamera,
  type Camera,
} from '../domain/hexGeometry';
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '../domain/plannerEngine';
import type { AxialCoord, Tileset } from '../domain/types';
import { isEditableTarget } from '../utils/browserHelpers';
import {
  AlphaMaskCache,
  buildDemoPlacements,
  type OverlayRef,
  type ProtoBrush,
  type ProtoOverlayPack,
  type ProtoPlacement,
  type VariantKey,
} from './overlayPrototypeModel';
import type { PrototypeOverlayDiscoveryResponse } from './overlayPrototypeServer';
import { OverlayPrototypeSidebar } from './OverlayPrototypeSidebar';
import { PrototypeStateDrawer } from './PrototypeStateDrawer';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';

function readVariantFromUrl(): VariantKey {
  const param = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  if (param === 'B' || param === 'C') return param;
  return 'A';
}

export function OverlayUxPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariantFromUrl);
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [overlayPacks, setOverlayPacks] = useState<ProtoOverlayPack[]>([]);
  const [bundleError, setBundleError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<HistoryState<ProtoPlacement[]>>(() =>
    createHistory<ProtoPlacement[]>([]),
  );
  const historyRef = useRef(history);
  historyRef.current = history;

  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 650 });
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showStateHud, setShowStateHud] = useState(true);

  const [paletteTab, setPaletteTab] = useState<'tiles' | 'overlays'>('overlays');
  const [activeBrush, setActiveBrush] = useState<ProtoBrush | null>(null);
  const [draggingBrush, setDraggingBrush] = useState<ProtoBrush | null>(null);
  const [selectedHostCoord, setSelectedHostCoord] = useState<AxialCoord | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<OverlayRef | null>(null);
  const [layerModeB, setLayerModeB] = useState<'tiles' | 'overlays'>('overlays');
  const [eventLog, setEventLog] = useState<string[]>([
    'Seeded 6-Tile dungeon cluster with stacked, overhanging & small Overlays',
  ]);
  const [renderTick, setRenderTick] = useState(0);

  const imageCacheRef = useRef<TileImageCache | null>(null);
  if (!imageCacheRef.current) {
    imageCacheRef.current = new TileImageCache();
  }
  const alphaCacheRef = useRef<AlphaMaskCache | null>(null);
  if (!alphaCacheRef.current) {
    alphaCacheRef.current = new AlphaMaskCache();
  }

  useEffect(() => {
    const cache = imageCacheRef.current!;
    return cache.subscribe(() => setRenderTick((t) => t + 1));
  }, []);

  const logEvent = useCallback((msg: string) => {
    setEventLog((prev) => [msg, ...prev].slice(0, 12));
  }, []);

  // Load real Tilesets + real Bundle Overlay Packs once into memory
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchTilesets(),
      fetch('/api/prototype/overlays').then((r) =>
        r.json() as Promise<PrototypeOverlayDiscoveryResponse>,
      ),
    ])
      .then(([tsResp, ovResp]) => {
        if (cancelled) return;
        setTilesets(tsResp.tilesets);
        setOverlayPacks(ovResp.overlayPacks);
        if (!tsResp.bundleConfigured || !ovResp.bundleConfigured) {
          setBundleError(tsResp.error ?? ovResp.error);
        }

        const demo = buildDemoPlacements(tsResp.tilesets, ovResp.overlayPacks);
        const initialHistory = createHistory(demo);
        historyRef.current = initialHistory;
        setHistory(initialHistory);
        if (demo.length > 0) {
          setCamera(computeFitCamera(demo, viewportSize.width, viewportSize.height, 84));
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBundleError(err instanceof Error ? err.message : 'Failed to load prototype assets');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Run once on mount; viewportSize initializes camera comfortably on desktop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tilesetsById = useMemo(
    () => new Map(tilesets.map((t) => [t.id, t])),
    [tilesets],
  );

  const handleVariantChange = useCallback(
    (next: VariantKey) => {
      setVariant(next);
      const url = new URL(window.location.href);
      url.searchParams.set('variant', next);
      window.history.replaceState(null, '', url.toString());
      logEvent(`Switched to Variant ${next}`);
    },
    [logEvent],
  );

  const handleCommitPlacements = useCallback(
    (updater: (prev: ProtoPlacement[]) => ProtoPlacement[], logMsg: string) => {
      const nextPresent = updater(historyRef.current.present);
      const nextHistory = commitHistory(historyRef.current, nextPresent);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      logEvent(logMsg);
    },
    [logEvent],
  );

  const handleUndo = useCallback(() => {
    const prev = historyRef.current;
    const next = undoHistory(prev);
    if (next === prev) return;
    historyRef.current = next;
    setHistory(next);
    setSelectedOverlay(null);
    logEvent('Undo');
  }, [logEvent]);

  const handleRedo = useCallback(() => {
    const prev = historyRef.current;
    const next = redoHistory(prev);
    if (next === prev) return;
    historyRef.current = next;
    setHistory(next);
    setSelectedOverlay(null);
    logEvent('Redo');
  }, [logEvent]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('dialog[open]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  const handleSelectBrush = useCallback((brush: ProtoBrush | null) => {
    setActiveBrush(brush);
    if (brush) {
      setSelectedOverlay(null);
      setSelectedHostCoord(null);
      setLayerModeB(brush.kind === 'overlay' ? 'overlays' : 'tiles');
    }
  }, []);

  const handleResetDemo = useCallback(() => {
    const demo = buildDemoPlacements(tilesets, overlayPacks);
    const nextHistory = createHistory(demo);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setSelectedHostCoord(null);
    setSelectedOverlay(null);
    setActiveBrush(null);
    if (demo.length > 0) {
      setCamera(computeFitCamera(demo, viewportSize.width, viewportSize.height, 84));
    }
    logEvent('Reset demo scene');
  }, [logEvent, overlayPacks, tilesets, viewportSize.height, viewportSize.width]);

  const handleViewportSizeChange = useCallback((nextSize: { width: number; height: number }) => {
    setViewportSize(nextSize);
  }, []);

  const placements = history.present;
  const totalOverlays = placements.reduce((sum, p) => sum + p.overlays.length, 0);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#161412] text-stone-100">
      {/* Compact Prototype Header Bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#2e2a26] bg-[#161412] px-3 py-2 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-violet-200">
            Wayfinder #13 Prototype
          </span>
          <span className="hidden text-stone-400 sm:inline">
            In-memory sandbox · {placements.length} Tiles · {totalOverlays} Overlays
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={history.past.length === 0}
            onClick={handleUndo}
            title="Undo (Cmd/Ctrl+Z)"
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800 disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Undo</span>
          </button>
          <button
            type="button"
            disabled={history.future.length === 0}
            onClick={handleRedo}
            title="Redo (Cmd/Ctrl+Shift+Z)"
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800 disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Redo</span>
          </button>

          <span className="mx-0.5 text-stone-700">|</span>

          <button
            type="button"
            onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))}
            title="Zoom out"
            className="rounded-md border border-[#2e2a26] bg-[#1c1917] p-1.5 text-stone-300 hover:bg-stone-800"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCamera((c) => ({ ...c, zoom: 1 }))}
            className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 font-mono text-[11px] text-stone-300 hover:bg-stone-800"
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))}
            title="Zoom in"
            className="rounded-md border border-[#2e2a26] bg-[#1c1917] p-1.5 text-stone-300 hover:bg-stone-800"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCamera(computeFitCamera(placements, viewportSize.width, viewportSize.height, 84))
            }
            title="Fit map"
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Fit</span>
          </button>

          <span className="mx-0.5 text-stone-700">|</span>

          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
              showGrid
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                : 'border-[#2e2a26] bg-[#1c1917] text-stone-400 hover:text-stone-200'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLabels((l) => !l)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
              showLabels
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                : 'border-[#2e2a26] bg-[#1c1917] text-stone-400 hover:text-stone-200'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Labels</span>
          </button>
          <button
            type="button"
            onClick={() => setShowStateHud((s) => !s)}
            className={`rounded-md border px-2 py-1 transition ${
              showStateHud
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                : 'border-[#2e2a26] bg-[#1c1917] text-stone-400 hover:text-stone-200'
            }`}
          >
            HUD
          </button>
          <button
            type="button"
            onClick={handleResetDemo}
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-200 hover:bg-stone-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Demo</span>
          </button>
          <a
            href="?prototype=off"
            className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-stone-400 hover:text-stone-100"
          >
            Open v1 App
          </a>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <OverlayPrototypeSidebar
          tilesets={tilesets}
          overlayPacks={overlayPacks}
          activeBrush={activeBrush}
          onSelectBrush={handleSelectBrush}
          onDragBrushStart={setDraggingBrush}
          onDragBrushEnd={() => setDraggingBrush(null)}
          activeTab={paletteTab}
          onTabChange={setPaletteTab}
          bundleError={bundleError}
        />

        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex flex-1 items-center justify-center bg-[#221f1c] text-sm text-stone-400">
              Loading Realm Brew Tiles & Overlays...
            </div>
          ) : (
            <>
              {variant === 'A' && (
                <VariantA
                  placements={placements}
                  tilesets={tilesets}
                  tilesetsById={tilesetsById}
                  imageCache={imageCacheRef.current}
                  alphaCache={alphaCacheRef.current}
                  activeBrush={activeBrush}
                  draggingBrush={draggingBrush}
                  onSelectBrush={handleSelectBrush}
                  onUpdateBrush={setActiveBrush}
                  selectedHostCoord={selectedHostCoord}
                  onSelectHostCoord={setSelectedHostCoord}
                  selectedOverlay={selectedOverlay}
                  onSelectOverlay={setSelectedOverlay}
                  onCommitPlacements={handleCommitPlacements}
                  onLogEvent={logEvent}
                  showGrid={showGrid}
                  showLabels={showLabels}
                  camera={camera}
                  onCameraChange={setCamera}
                  onViewportSizeChange={handleViewportSizeChange}
                  renderTick={renderTick}
                />
              )}

              {variant === 'B' && (
                <VariantB
                  placements={placements}
                  tilesets={tilesets}
                  tilesetsById={tilesetsById}
                  imageCache={imageCacheRef.current}
                  alphaCache={alphaCacheRef.current}
                  activeBrush={activeBrush}
                  draggingBrush={draggingBrush}
                  onSelectBrush={handleSelectBrush}
                  onUpdateBrush={setActiveBrush}
                  selectedHostCoord={selectedHostCoord}
                  onSelectHostCoord={setSelectedHostCoord}
                  selectedOverlay={selectedOverlay}
                  onSelectOverlay={setSelectedOverlay}
                  onCommitPlacements={handleCommitPlacements}
                  onLogEvent={logEvent}
                  showGrid={showGrid}
                  showLabels={showLabels}
                  camera={camera}
                  onCameraChange={setCamera}
                  onViewportSizeChange={handleViewportSizeChange}
                  renderTick={renderTick}
                  layerMode={layerModeB}
                  onLayerModeChange={setLayerModeB}
                />
              )}

              {variant === 'C' && (
                <VariantC
                  placements={placements}
                  tilesets={tilesets}
                  tilesetsById={tilesetsById}
                  imageCache={imageCacheRef.current}
                  alphaCache={alphaCacheRef.current}
                  activeBrush={activeBrush}
                  draggingBrush={draggingBrush}
                  onSelectBrush={handleSelectBrush}
                  onUpdateBrush={setActiveBrush}
                  selectedHostCoord={selectedHostCoord}
                  onSelectHostCoord={setSelectedHostCoord}
                  selectedOverlay={selectedOverlay}
                  onSelectOverlay={setSelectedOverlay}
                  onCommitPlacements={handleCommitPlacements}
                  onLogEvent={logEvent}
                  showGrid={showGrid}
                  showLabels={showLabels}
                  camera={camera}
                  onCameraChange={setCamera}
                  onViewportSizeChange={handleViewportSizeChange}
                  renderTick={renderTick}
                />
              )}

              {showStateHud && (
                <PrototypeStateDrawer
                  variant={variant}
                  placements={placements}
                  selectedHostCoord={selectedHostCoord}
                  selectedOverlay={selectedOverlay}
                  activeBrush={activeBrush}
                  layerMode={variant === 'B' ? layerModeB : undefined}
                  eventLog={eventLog}
                />
              )}
            </>
          )}
        </div>
      </main>

      <PrototypeSwitcher current={variant} onChange={handleVariantChange} />
    </div>
  );
}
