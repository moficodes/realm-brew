import { Check, Download, FilePlus2, Pencil, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MapSummary } from '../domain/types';

interface MapSwitcherProps {
  maps: readonly MapSummary[];
  activeMapId: string | null;
  activeMapName: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onSelectMap: (id: string) => void;
  onCreateMap: () => void;
  onRenameMap: (nextName: string) => void;
  onRequestDeleteMap: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
}

export function MapSwitcher({
  maps,
  activeMapId,
  activeMapName,
  saveStatus,
  onSelectMap,
  onCreateMap,
  onRenameMap,
  onRequestDeleteMap,
  onExportJson,
  onImportJsonFile,
}: MapSwitcherProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    setDraftName(activeMapName);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== activeMapName) {
      onRenameMap(trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      {isRenaming ? (
        <div className="flex items-center gap-1">
          <label htmlFor="map-rename-input" className="sr-only">
            Map name
          </label>
          <input
            id="map-rename-input"
            type="text"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  return;
                }
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsRenaming(false);
              }
            }}
            className="h-7 w-44 rounded-md border border-amber-500/60 bg-[#1c1917] px-2 text-xs text-stone-100 focus:outline-none"
          />
          <button
            type="button"
            onClick={commitRename}
            title="Save Map name"
            aria-label="Save Map name"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500 text-stone-950 hover:bg-amber-400"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsRenaming(false)}
            title="Cancel rename"
            aria-label="Cancel rename"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[#2e2a26] bg-[#1c1917] text-stone-300 hover:bg-stone-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-md border border-[#2e2a26] bg-[#1c1917] px-1 py-0.5">
          <label htmlFor="active-map-select" className="sr-only">
            Active Map
          </label>
          <select
            id="active-map-select"
            value={activeMapId ?? ''}
            onChange={(e) => onSelectMap(e.target.value)}
            disabled={maps.length === 0}
            className="h-6 max-w-44 bg-transparent px-1.5 text-xs font-medium text-stone-100 focus:outline-none"
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#1c1917] text-stone-100">
                {m.name} ({m.placementCount})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={startRename}
            disabled={!activeMapId}
            title="Rename active Map"
            aria-label="Rename active Map"
            className="rounded p-1 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100 disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onCreateMap}
            title="Create new Map"
            aria-label="Create new Map"
            className="rounded p-1 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onRequestDeleteMap}
            disabled={!activeMapId}
            title="Delete active Map"
            aria-label="Delete active Map"
            className="rounded p-1 text-stone-400 transition hover:bg-red-950/60 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center rounded-md border border-[#2e2a26] bg-[#1c1917]">
        <button
          type="button"
          onClick={onExportJson}
          disabled={!activeMapId}
          title="Export Map JSON"
          aria-label="Export Map JSON"
          className="flex items-center gap-1 px-2 py-1 text-xs text-stone-300 transition hover:bg-stone-800 hover:text-stone-100 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">JSON</span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Import Map JSON"
          aria-label="Import Map JSON"
          className="flex items-center gap-1 border-l border-[#2e2a26] px-2 py-1 text-xs text-stone-300 transition hover:bg-stone-800 hover:text-stone-100"
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Import</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onImportJsonFile(file);
            }
            e.target.value = '';
          }}
        />
      </div>

      {saveStatus !== 'idle' && (
        <span
          className={`text-[11px] ${
            saveStatus === 'error'
              ? 'text-red-400'
              : saveStatus === 'saving'
                ? 'text-amber-300'
                : 'text-stone-500'
          }`}
        >
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Saved'}
        </span>
      )}
    </div>
  );
}
