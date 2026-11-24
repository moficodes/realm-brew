import {
  CheckCircle2,
  FileArchive,
  FolderOpen,
  HardDrive,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  clearStoredBundle,
  deleteStoredPack,
  importBundleFromDataTransfer,
  importBundleFromFiles,
  type ImportBundleResult,
  type ImportProgress,
  type StoredPackSummary,
} from '../api/client';
import { formatBytes } from '../storage/bundleImporter';
import { useModalDialog } from './useModalDialog';

interface BundleImportDialogProps {
  open: boolean;
  onClose: () => void;
  storedPacks: readonly StoredPackSummary[];
  onBundleUpdated: () => Promise<void>;
}

function formatImportSummary(result: ImportBundleResult): string {
  const parts: string[] = [];
  if (result.tilesetCount > 0) {
    parts.push(`${result.tilesetCount} ${result.tilesetCount === 1 ? 'Tileset' : 'Tilesets'}`);
  }
  if (result.overlayPackCount > 0) {
    parts.push(
      `${result.overlayPackCount} ${
        result.overlayPackCount === 1 ? 'Overlay Pack' : 'Overlay Packs'
      }`,
    );
  }
  const packSummary = parts.length > 0 ? parts.join(' and ') : 'bundle';
  const imageLabel = result.imageCount === 1 ? 'image' : 'images';
  return `Imported ${packSummary} (${result.imageCount} ${imageLabel}, ${formatBytes(result.totalBytes)}).`;
}

export function BundleImportDialog({
  open,
  onClose,
  storedPacks,
  onBundleUpdated,
}: BundleImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const progressLabelId = useId();
  const tilesetsHeadingId = useId();
  const overlayPacksHeadingId = useId();

  const [importing, setImporting] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const isBusy = importing || busyAction;

  useModalDialog({
    dialogRef,
    open,
    onClose,
    lightDismiss: !isBusy,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      if (isBusy) {
        event.preventDefault();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [isBusy]);

  useEffect(() => {
    if (!open) {
      setDragOver(false);
      setConfirmClearAll(false);
    }
  }, [open]);

  const { tilesetPacks, overlayPackRecords, totalBytes, totalFiles } = useMemo(() => {
    const tilesetList: StoredPackSummary[] = [];
    const overlayList: StoredPackSummary[] = [];
    let bytes = 0;
    let files = 0;
    for (const pack of storedPacks) {
      bytes += pack.totalBytes;
      files += pack.fileCount;
      if (pack.kind === 'tileset') {
        tilesetList.push(pack);
      } else {
        overlayList.push(pack);
      }
    }
    return {
      tilesetPacks: tilesetList,
      overlayPackRecords: overlayList,
      totalBytes: bytes,
      totalFiles: files,
    };
  }, [storedPacks]);

  const runImport = async (runner: () => Promise<ImportBundleResult>) => {
    if (isBusy) return;
    setImporting(true);
    setError(null);
    setStatusMessage(null);
    setConfirmClearAll(false);
    setProgress({ phase: 'scanning', message: 'Scanning selected files…' });

    try {
      const result = await runner();
      await onBundleUpdated();
      setStatusMessage(formatImportSummary(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Realm Brew bundle.');
    } finally {
      setProgress(null);
      setImporting(false);
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    void runImport(() => importBundleFromFiles(fileArray, setProgress));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (isBusy) return;
    void runImport(() => importBundleFromDataTransfer(event.dataTransfer, setProgress));
  };

  const handleDeletePack = async (pack: StoredPackSummary) => {
    if (isBusy) return;
    setBusyAction(true);
    setError(null);
    setStatusMessage(null);
    try {
      await deleteStoredPack(pack.key);
      await onBundleUpdated();
      setStatusMessage(`Removed ${pack.name} from browser storage.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove pack.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmClearAll = async () => {
    if (isBusy) return;
    setBusyAction(true);
    setError(null);
    setStatusMessage(null);
    setConfirmClearAll(false);
    try {
      await clearStoredBundle();
      await onBundleUpdated();
      setStatusMessage('Cleared all cached Realm Brew images from browser storage.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear browser storage.');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: isBusy ? 'none' : 'any' } as Record<string, string>)}
      className="w-full max-w-xl rounded-xl border border-[#2e2a26] bg-[#161412] p-0 text-stone-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-[#2e2a26] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-amber-400" />
          <h2 id={titleId} className="text-sm font-semibold text-stone-100">
            Load Realm Brew Bundle
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={isBusy}
          aria-label="Close bundle manager"
          className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="text-xs leading-relaxed text-stone-400">
          Bring your own Realm Brew digital bundle (
          <span className="font-mono text-stone-300">*Tiles</span> and{' '}
          <span className="font-mono text-stone-300">*Overlays</span> folders or{' '}
          <span className="font-mono text-stone-300">.zip</span> archives). All PNGs are stored
          locally in this browser&apos;s IndexedDB and are never uploaded to any server.
        </p>

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            if (!isBusy) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = isBusy ? 'none' : 'copy';
            if (!isBusy && !dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOver(false);
            }
          }}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragOver
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-[#2e2a26] bg-[#1c1917]/80 hover:border-stone-600'
          }`}
        >
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
            <Upload className="h-5 w-5" />
          </div>
          <p className="mt-2.5 text-sm font-medium text-stone-100">
            Drop your Realm Brew bundle folder or .zip archive here
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Supports the full bundle folder, individual Tileset / Overlay Pack folders, or .zip
            files. Re-importing updates existing packs in place.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              autoFocus={storedPacks.length === 0}
              disabled={isBusy}
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Choose Folder</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => zipInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#2e2a26] bg-[#161412] px-3.5 py-2 text-xs font-medium text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileArchive className="h-3.5 w-3.5 text-amber-400" />
              <span>Choose .zip File(s)</span>
            </button>
          </div>

          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.currentTarget.value = '';
            }}
            className="hidden"
          />

          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            multiple
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.currentTarget.value = '';
            }}
            className="hidden"
          />
        </div>

        {(progress || statusMessage) && (
          <div className="space-y-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              {!progress && statusMessage && (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              )}
              <p
                id={progressLabelId}
                role="status"
                aria-live="polite"
                className={progress ? 'text-stone-200' : 'text-emerald-200'}
              >
                {progress ? progress.message : statusMessage}
              </p>
            </div>
            {progress && (
              <progress
                className="rb-progress block"
                aria-labelledby={progressLabelId}
                max={progress.total}
                value={progress.total !== undefined ? progress.current ?? 0 : undefined}
              />
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-950/40 px-3.5 py-2.5 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        {storedPacks.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-stone-400">
              <span>
                Cached in browser: {storedPacks.length}{' '}
                {storedPacks.length === 1 ? 'pack' : 'packs'} ({totalFiles} PNGs)
              </span>
              <span className="font-mono text-stone-300">{formatBytes(totalBytes)}</span>
            </div>

            <div className="rb-scroll max-h-[30vh] space-y-3 overflow-y-auto pr-1">
              {tilesetPacks.length > 0 && (
                <section aria-labelledby={tilesetsHeadingId}>
                  <h3
                    id={tilesetsHeadingId}
                    className="mb-1.5 text-[11px] font-semibold tracking-wide text-stone-400 uppercase"
                  >
                    Tilesets ({tilesetPacks.length})
                  </h3>
                  <div className="space-y-1.5">
                    {tilesetPacks.map((pack) => (
                      <div
                        key={pack.key}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                            {pack.shortCode}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-stone-100">
                              {pack.name}
                            </p>
                            <p className="text-[11px] text-stone-400">
                              {pack.itemCount} {pack.itemCount === 1 ? 'Tile' : 'Tiles'} ·{' '}
                              {formatBytes(pack.totalBytes)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDeletePack(pack)}
                          aria-label={`Remove ${pack.name} Tileset`}
                          title={`Remove ${pack.name}`}
                          className="shrink-0 rounded-md p-1.5 text-stone-400 transition hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {overlayPackRecords.length > 0 && (
                <section aria-labelledby={overlayPacksHeadingId}>
                  <h3
                    id={overlayPacksHeadingId}
                    className="mb-1.5 text-[11px] font-semibold tracking-wide text-stone-400 uppercase"
                  >
                    Overlay Packs ({overlayPackRecords.length})
                  </h3>
                  <div className="space-y-1.5">
                    {overlayPackRecords.map((pack) => (
                      <div
                        key={pack.key}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#2e2a26] bg-[#1c1917] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-300">
                            {pack.shortCode}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-stone-100">
                              {pack.name}
                            </p>
                            <p className="text-[11px] text-stone-400">
                              {pack.itemCount}{' '}
                              {pack.itemCount === 1 ? 'Overlay' : 'Overlays'} ·{' '}
                              {formatBytes(pack.totalBytes)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDeletePack(pack)}
                          aria-label={`Remove ${pack.name} Overlay Pack`}
                          title={`Remove ${pack.name}`}
                          className="shrink-0 rounded-md p-1.5 text-stone-400 transition hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#2e2a26] px-5 py-3">
        <div>
          {storedPacks.length > 0 &&
            (!confirmClearAll ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirmClearAll(true)}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-400 transition hover:bg-red-950/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all images
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setConfirmClearAll(false)}
                  className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-2.5 py-1.5 text-xs font-medium text-stone-300 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleConfirmClearAll()}
                  className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Confirm clear
                </button>
              </div>
            ))}
        </div>

        <button
          type="button"
          autoFocus={storedPacks.length > 0}
          disabled={isBusy}
          onClick={() => dialogRef.current?.close()}
          className="rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
