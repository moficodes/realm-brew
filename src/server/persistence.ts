import fs from 'node:fs';
import path from 'node:path';
import type { Collection } from '../domain/types';

export const DEFAULT_OWNED_COPIES = 2;

export function validateCollection(input: unknown): Collection | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const result: Collection = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

function collectionFilePath(dataDir: string): string {
  return path.join(dataDir, 'collection.json');
}

export function readCollection(dataDir: string, discoveredTilesetIds: readonly string[]): Collection {
  const filePath = collectionFilePath(dataDir);
  let stored: Collection = {};

  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const validated = validateCollection(parsed);
      if (validated) {
        stored = validated;
      }
    } catch {
      stored = {};
    }
  }

  const merged: Collection = { ...stored };
  for (const id of discoveredTilesetIds) {
    if (!(id in merged)) {
      merged[id] = DEFAULT_OWNED_COPIES;
    }
  }
  return merged;
}

export function writeCollection(dataDir: string, collection: Collection): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = collectionFilePath(dataDir);
  fs.writeFileSync(filePath, JSON.stringify(collection, null, 2), 'utf8');
}
