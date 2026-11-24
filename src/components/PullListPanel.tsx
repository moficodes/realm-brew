import { AlertTriangle, Check, Copy, EyeOff } from 'lucide-react';
import { useState } from 'react';
import {
  formatMapSummaryCounts,
  formatPullListText,
  type PullListHighlight,
  type PullListSummary,
} from '../domain/plannerEngine';
import type { AxialCoord } from '../domain/types';
import { CHECKERBOARD_MINI_STYLE } from './paletteStyles';

export type PullListSubView = 'by-pack' | 'by-tile';

interface PullListPanelProps {
  mapName: string;
  pullList: PullListSummary;
  subView: PullListSubView;
  onSubViewChange: (subView: PullListSubView) => void;
  onHoverHighlight: (highlight: PullListHighlight | null) => void;
  onFocusHost: (coord: AxialCoord) => void;
  onFocusOverlay: (hostCoord: AxialCoord, overlayId: string) => void;
}

export function PullListPanel({
  mapName,
  pullList,
  subView,
  onSubViewChange,
  onHoverHighlight,
  onFocusHost,
  onFocusOverlay,
}: PullListPanelProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = async () => {
    const text = formatPullListText(mapName, pullList);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  };

  const hasMissing = pullList.missing.length > 0 || pullList.missingOverlays.length > 0;
  const totalMissingCount =
    pullList.missing.reduce((acc, m) => acc + m.count, 0) +
    pullList.missingOverlays.reduce((acc, m) => acc + m.count, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-[#2e2a26] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-[#1c1917] px-2 py-0.5 text-xs font-medium text-stone-300">
            {formatMapSummaryCounts(pullList.totalPlacements, pullList.totalOverlays)}
          </span>

          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={pullList.totalPlacements === 0}
            title="Copy complete Pull List checklist"
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-xs text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyState === 'copied' ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : copyState === 'error' ? (
              <span className="text-red-300">Unavailable</span>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <div
          className="grid grid-cols-2 gap-1 rounded-lg bg-[#1c1917] p-1"
          role="group"
          aria-label="Pull List grouping"
        >
          <button
            type="button"
            aria-pressed={subView === 'by-pack'}
            onClick={() => {
              onHoverHighlight(null);
              onSubViewChange('by-pack');
            }}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              subView === 'by-pack'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            By Pack
          </button>
          <button
            type="button"
            aria-pressed={subView === 'by-tile'}
            onClick={() => {
              onHoverHighlight(null);
              onSubViewChange('by-tile');
            }}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              subView === 'by-tile'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            By Tile ({pullList.byTile.length})
          </button>
        </div>
      </div>

      <div className="rb-scroll flex-1 overflow-y-auto px-3 py-3">
        {pullList.totalPlacements === 0 ? (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            Place Tiles on the Map to generate your tabletop Pull List.
          </div>
        ) : subView === 'by-pack' ? (
          <div className="space-y-5">
            {pullList.groups.length > 0 && (
              <section aria-label="Tiles" className="space-y-3">
                <div className="text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                  Tiles
                </div>
                {pullList.groups.map((group) => (
                  <section key={group.tilesetId} aria-label={group.tilesetName}>
                    <div className="mb-2 flex items-center justify-between border-b border-[#2e2a26] pb-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                          {group.shortCode}
                        </span>
                        <h3 className="truncate text-xs font-semibold text-stone-200">
                          {group.tilesetName}
                        </h3>
                      </div>
                      <span className="shrink-0 text-[11px] text-stone-400">
                        {group.totalNeeded} needed · {group.owned} owned
                      </span>
                    </div>

                    <ul className="space-y-1.5">
                      {group.items.map((item) => (
                        <li
                          key={item.tileId}
                          onMouseEnter={() =>
                            onHoverHighlight({
                              kind: 'tile-group',
                              tilesetId: group.tilesetId,
                              tileId: item.tileId,
                            })
                          }
                          onMouseLeave={() => onHoverHighlight(null)}
                          className={`flex items-start gap-2 rounded-lg border px-2 py-2 text-xs transition ${
                            item.isOverBudget
                              ? 'border-red-500/40 bg-red-950/25 hover:border-red-400'
                              : 'border-[#2e2a26] bg-[#1c1917] hover:border-amber-500/50'
                          }`}
                        >
                          <img
                            src={item.thumbnailUrl}
                            alt={`Tile ${item.displayLabel}`}
                            className="h-8 w-8 shrink-0 rounded border border-[#2e2a26] bg-[#221f1c] object-contain p-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-stone-100">
                                Tile {item.displayLabel}
                              </span>
                              <span
                                className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                                  item.isOverBudget
                                    ? 'bg-red-950/80 text-red-300'
                                    : 'bg-[#161412] text-amber-300'
                                }`}
                              >
                                {item.isOverBudget && (
                                  <AlertTriangle className="h-3 w-3 text-red-400" />
                                )}
                                ×{item.needed}
                                {item.isOverBudget && ` / ${item.owned}`}
                              </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {item.faces.map((face) => (
                                <span
                                  key={face.faceNumber}
                                  className="rounded border border-[#2e2a26] bg-[#161412] px-1.5 py-0.5 font-mono text-[11px] text-stone-300"
                                >
                                  Face #{face.label} ×{face.count}
                                </span>
                              ))}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </section>
            )}

            {pullList.overlayGroups.length > 0 && (
              <section aria-label="Overlays" className="space-y-3">
                <div className="text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                  Overlays
                </div>
                {pullList.overlayGroups.map((group) => (
                  <section key={group.overlayPackId} aria-label={group.packName}>
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-[#2e2a26] pb-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded bg-sky-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300 ring-1 ring-sky-500/30">
                          {group.shortCode}
                        </span>
                        <h3 className="truncate text-xs font-semibold text-stone-200">
                          {group.packName}
                        </h3>
                      </div>
                      <span className="shrink-0 text-[11px] text-stone-400">
                        {group.totalNeeded} needed · {group.owned} owned
                      </span>
                    </div>

                    <ul className="space-y-1.5">
                      {group.items.map((item) => (
                        <li
                          key={item.overlayId}
                          onMouseEnter={() =>
                            onHoverHighlight({
                              kind: 'overlay-group',
                              overlayPackId: item.overlayPackId,
                              overlayId: item.overlayId,
                            })
                          }
                          onMouseLeave={() => onHoverHighlight(null)}
                          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition ${
                            item.isOverBudget
                              ? 'border-red-500/40 bg-red-950/25 hover:border-red-400'
                              : 'border-[#2e2a26] bg-[#1c1917] hover:border-amber-500/50'
                          }`}
                        >
                          <img
                            src={item.url}
                            alt={item.label}
                            style={CHECKERBOARD_MINI_STYLE}
                            className="h-8 w-8 shrink-0 rounded border border-[#2e2a26] object-contain p-0.5"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-stone-100">
                            {item.label}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                              item.isOverBudget
                                ? 'bg-red-950/80 text-red-300'
                                : 'bg-[#161412] text-sky-300'
                            }`}
                          >
                            {item.isOverBudget && (
                              <AlertTriangle className="h-3 w-3 text-red-400" />
                            )}
                            ×{item.needed}
                            {item.isOverBudget && ` / ${item.owned}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </section>
            )}

            {hasMissing && (
              <section aria-label="Missing assets">
                <div className="mb-2 flex items-center justify-between border-b border-amber-500/30 pb-1">
                  <h3 className="text-xs font-semibold text-amber-300 uppercase">Missing Assets</h3>
                  <span className="text-[11px] text-amber-400">{totalMissingCount} unresolved</span>
                </div>
                <ul className="space-y-1.5">
                  {pullList.missing.map((m) => (
                    <li
                      key={`tile:${m.tilesetId}:${m.tileId}:${m.faceNumber}`}
                      onMouseEnter={() =>
                        onHoverHighlight({
                          kind: 'missing-tile',
                          tilesetId: m.tilesetId,
                          tileId: m.tileId,
                          faceNumber: m.faceNumber,
                        })
                      }
                      onMouseLeave={() => onHoverHighlight(null)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-2 text-xs transition hover:border-amber-400"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                          [Tile]
                        </span>
                        <span className="truncate font-mono text-amber-200">
                          {m.tilesetId} #{m.label}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-amber-300">
                        ×{m.count}
                      </span>
                    </li>
                  ))}
                  {pullList.missingOverlays.map((mo) => (
                    <li
                      key={`overlay:${mo.overlayPackId}:${mo.overlayId}`}
                      onMouseEnter={() =>
                        onHoverHighlight({
                          kind: 'missing-overlay',
                          overlayPackId: mo.overlayPackId,
                          overlayId: mo.overlayId,
                        })
                      }
                      onMouseLeave={() => onHoverHighlight(null)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-2 text-xs transition hover:border-amber-400"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                          [Overlay]
                        </span>
                        <span className="truncate font-mono text-amber-200">
                          {mo.overlayPackId} {mo.overlayId}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-amber-300">
                        ×{mo.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : pullList.byTile.length === 0 ? (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            No Tiles carry attached Overlays yet. Attach an Overlay to any placed Tile to see host assembly instructions.
          </div>
        ) : (
          <div className="space-y-3">
            {pullList.byTile.map((host) => (
              <section
                key={`${host.q},${host.r}`}
                aria-label={`${host.displayLabel} (${host.q}, ${host.r})`}
                className="overflow-hidden rounded-lg border border-[#2e2a26] bg-[#1c1917]"
              >
                <button
                  type="button"
                  onMouseEnter={() =>
                    onHoverHighlight({
                      kind: 'host-placement',
                      coord: { q: host.q, r: host.r },
                    })
                  }
                  onMouseLeave={() => onHoverHighlight(null)}
                  onClick={() => onFocusHost({ q: host.q, r: host.r })}
                  title={`Focus host Tile ${host.displayLabel} (${host.q}, ${host.r})`}
                  className="flex w-full items-center justify-between gap-2 border-b border-[#2e2a26] bg-[#191614] px-2.5 py-2 text-left transition hover:bg-stone-800/70"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`truncate font-mono text-xs font-semibold ${
                        host.isMissingHost ? 'text-amber-300' : 'text-amber-200'
                      }`}
                    >
                      {host.displayLabel}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-stone-400">
                      ({host.q}, {host.r})
                    </span>
                  </div>

                  {host.covered && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-stone-600/60 bg-stone-800/80 px-1.5 py-0.5 text-[10px] font-medium text-stone-300">
                      <EyeOff className="h-2.5 w-2.5 text-stone-400" />
                      Fog
                    </span>
                  )}
                </button>

                <ul className="divide-y divide-[#27231f]">
                  {host.overlays.map((ov) => (
                    <li key={ov.id}>
                      <button
                        type="button"
                        onMouseEnter={() =>
                          onHoverHighlight({ kind: 'overlay-placement', overlayId: ov.id })
                        }
                        onMouseLeave={() => onHoverHighlight(null)}
                        onClick={() => onFocusOverlay({ q: host.q, r: host.r }, ov.id)}
                        title={`Focus ${ov.label} on (${host.q}, ${host.r})`}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                          ov.isOverBudget
                            ? 'bg-red-950/20 hover:bg-red-950/35'
                            : ov.isMissing
                              ? 'bg-amber-950/15 hover:bg-amber-950/30'
                              : 'hover:bg-stone-800/50'
                        }`}
                      >
                        {ov.url && !ov.isMissing ? (
                          <img
                            src={ov.url}
                            alt={ov.label}
                            style={CHECKERBOARD_MINI_STYLE}
                            className="h-8 w-8 shrink-0 rounded border border-[#2e2a26] object-contain p-0.5"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-amber-500/70 bg-amber-950/30 text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold ${
                                ov.isMissing
                                  ? 'bg-amber-950/80 text-amber-300'
                                  : 'bg-sky-950/80 text-sky-300'
                              }`}
                            >
                              [{ov.shortCode}]
                            </span>
                            <span className="truncate font-medium text-stone-100">
                              {ov.label}
                            </span>
                          </div>
                        </div>

                        {ov.isOverBudget && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-300">
                            <AlertTriangle className="h-2.5 w-2.5 text-red-400" />
                            Over
                          </span>
                        )}
                        {ov.isMissing && (
                          <span className="shrink-0 rounded bg-amber-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                            Missing
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
