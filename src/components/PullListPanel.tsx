import { AlertTriangle, Check, ClipboardList, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { formatPullListText, type PullListSummary } from '../domain/plannerEngine';

interface PullListPanelProps {
  mapName: string;
  pullList: PullListSummary;
  onClose: () => void;
}

export function PullListPanel({ mapName, pullList, onClose }: PullListPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = formatPullListText(mapName, pullList);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in non-secure context
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-[#2e2a26] bg-[#161412]">
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold tracking-tight text-stone-100">Pull List</h2>
          <span className="rounded bg-[#1c1917] px-1.5 py-0.5 font-mono text-[11px] text-stone-400">
            {pullList.totalPlacements}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={pullList.totalPlacements === 0}
            title="Copy Pull List summary"
            className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-2 py-1 text-xs text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Pull List"
            title="Close Pull List"
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rb-scroll flex-1 overflow-y-auto px-3 py-3">
        {pullList.totalPlacements === 0 ? (
          <div className="rounded-lg border border-[#2e2a26] bg-[#1c1917] p-4 text-center text-xs text-stone-400">
            Place Tiles on the Map to generate your tabletop Pull List.
          </div>
        ) : (
          <div className="space-y-4">
            {pullList.groups.map((group) => (
              <section key={group.tilesetId} aria-label={group.tilesetName}>
                <div className="mb-2 flex items-center justify-between border-b border-[#2e2a26] pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                      {group.shortCode}
                    </span>
                    <h3 className="text-xs font-semibold text-stone-200">{group.tilesetName}</h3>
                  </div>
                  <span className="text-[11px] text-stone-400">
                    {group.totalNeeded} needed · own {group.owned}
                  </span>
                </div>

                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <li
                      key={item.tileId}
                      className={`rounded-lg border px-2.5 py-2 text-xs ${
                        item.isOverBudget
                          ? 'border-red-500/40 bg-red-950/25'
                          : 'border-[#2e2a26] bg-[#1c1917]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-stone-100">
                          Tile {item.displayLabel}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                            item.isOverBudget
                              ? 'bg-red-950/80 text-red-300'
                              : 'bg-[#161412] text-amber-300'
                          }`}
                        >
                          {item.isOverBudget && <AlertTriangle className="h-3 w-3 text-red-400" />}
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
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {pullList.missing.length > 0 && (
              <section aria-label="Missing assets">
                <div className="mb-2 flex items-center justify-between border-b border-amber-500/30 pb-1">
                  <h3 className="text-xs font-semibold text-amber-300 uppercase">Missing Assets</h3>
                  <span className="text-[11px] text-amber-400">
                    {pullList.missing.reduce((acc, m) => acc + m.count, 0)} Placements
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {pullList.missing.map((m) => (
                    <li
                      key={`${m.tilesetId}:${m.tileId}:${m.faceNumber}`}
                      className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-2 text-xs"
                    >
                      <span className="font-mono text-amber-200">
                        {m.tilesetId} #{m.label}
                      </span>
                      <span className="font-mono font-semibold text-amber-300">×{m.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
