import type { FileEntry } from '@zip.js/zip.js';
import { groupRelativePngPaths } from '../domain/bundleParser';
import type { ImportedPackInput } from './browserStorage';

export interface ImportProgress {
  phase: 'scanning' | 'extracting' | 'storing';
  message: string;
  current?: number;
  total?: number;
}

export interface ImportBundleResult {
  tilesetCount: number;
  overlayPackCount: number;
  imageCount: number;
  totalBytes: number;
  packNames: string[];
}

const NO_PACKS_ERROR =
  'No Realm Brew *Tiles or *Overlays folders containing PNGs were found. Select your unzipped Realm Brew bundle folder, an individual *Tiles or *Overlays pack folder, or a .zip archive.';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function isZipFilename(name: string): boolean {
  return /\.zip$/i.test(name);
}

export async function extractPacksFromZipBlob(
  zipBlob: Blob,
  zipFilename: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportedPackInput[]> {
  onProgress?.({
    phase: 'scanning',
    message: `Reading ${zipFilename}…`,
  });

  const { BlobReader, BlobWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(zipBlob), { useWebWorkers: false });

  try {
    const entries = await reader.getEntries();
    const fileEntries = entries.filter((entry): entry is FileEntry => !entry.directory);

    const fallbackFolderName = zipFilename.replace(/\.zip$/i, '').trim() || undefined;
    const grouped = groupRelativePngPaths(
      fileEntries.map((entry) => ({
        relativePath: entry.filename,
        payload: entry,
      })),
      fallbackFolderName,
    );

    const total = grouped.reduce((sum, group) => sum + group.files.length, 0);
    if (total === 0) {
      return [];
    }

    let extracted = 0;
    const packs: ImportedPackInput[] = [];

    for (const group of grouped) {
      const files: Array<{ filename: string; blob: Blob }> = [];
      for (const item of group.files) {
        const blob = await item.payload.getData(new BlobWriter('image/png'));
        files.push({ filename: item.filename, blob });
        extracted += 1;
        onProgress?.({
          phase: 'extracting',
          message: `Extracting ${group.folderName} (${extracted} / ${total})…`,
          current: extracted,
          total,
        });
      }
      packs.push({
        kind: group.kind,
        folderName: group.folderName,
        files,
      });
    }

    return packs;
  } finally {
    await reader.close();
  }
}

function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readNextBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readNextBatch();
        },
        (err) => reject(err),
      );
    };
    readNextBatch();
  });
}

function readFileEntry(fileEntry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

async function walkFileSystemEntry(
  entry: FileSystemEntry,
  relativeFiles: Array<{ relativePath: string; file: File }>,
  zipFiles: File[],
): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    if (isZipFilename(file.name)) {
      zipFiles.push(file);
    } else {
      const relativePath = entry.fullPath.replace(/^\/+/, '') || file.name;
      relativeFiles.push({ relativePath, file });
    }
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const children = await readAllDirectoryEntries(dirEntry.createReader());
    for (const child of children) {
      await walkFileSystemEntry(child, relativeFiles, zipFiles);
    }
  }
}

export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<{ relativeFiles: Array<{ relativePath: string; file: File }>; zipFiles: File[] }> {
  const relativeFiles: Array<{ relativePath: string; file: File }> = [];
  const zipFiles: File[] = [];

  // Snapshot DataTransfer items synchronously before any await clears DataTransferItemList.
  const rootEntries: FileSystemEntry[] = [];
  if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i] as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
      };
      const entry = item.webkitGetAsEntry?.() ?? null;
      if (entry) {
        rootEntries.push(entry);
      }
    }
  }

  if (rootEntries.length > 0) {
    for (const entry of rootEntries) {
      await walkFileSystemEntry(entry, relativeFiles, zipFiles);
    }
    return { relativeFiles, zipFiles };
  }

  const droppedFiles = Array.from(dataTransfer.files);
  for (const file of droppedFiles) {
    if (isZipFilename(file.name)) {
      zipFiles.push(file);
    } else {
      relativeFiles.push({
        relativePath: file.webkitRelativePath || file.name,
        file,
      });
    }
  }
  return { relativeFiles, zipFiles };
}

async function finalizePacks(
  relativeFiles: ReadonlyArray<{ relativePath: string; file: File }>,
  zipFiles: readonly File[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportedPackInput[]> {
  onProgress?.({
    phase: 'scanning',
    message: 'Scanning bundle folders…',
  });

  const packs: ImportedPackInput[] = [];

  if (relativeFiles.length > 0) {
    const grouped = groupRelativePngPaths(
      relativeFiles.map((entry) => ({
        relativePath: entry.relativePath,
        payload: entry.file,
      })),
    );
    for (const group of grouped) {
      packs.push({
        kind: group.kind,
        folderName: group.folderName,
        files: group.files.map((item) => ({
          filename: item.filename,
          blob: item.payload,
        })),
      });
    }
  }

  for (const zipFile of zipFiles) {
    const extracted = await extractPacksFromZipBlob(zipFile, zipFile.name, onProgress);
    packs.push(...extracted);
  }

  if (packs.length === 0) {
    throw new Error(NO_PACKS_ERROR);
  }

  return packs;
}

export async function preparePacksFromFileList(
  files: FileList | readonly File[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportedPackInput[]> {
  const fileArray = Array.from(files);
  const relativeFiles: Array<{ relativePath: string; file: File }> = [];
  const zipFiles: File[] = [];

  for (const file of fileArray) {
    if (isZipFilename(file.name)) {
      zipFiles.push(file);
    } else {
      relativeFiles.push({
        relativePath: file.webkitRelativePath || file.name,
        file,
      });
    }
  }

  return finalizePacks(relativeFiles, zipFiles, onProgress);
}

export async function preparePacksFromDataTransfer(
  dataTransfer: DataTransfer,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportedPackInput[]> {
  const { relativeFiles, zipFiles } = await collectDroppedFiles(dataTransfer);
  return finalizePacks(relativeFiles, zipFiles, onProgress);
}
