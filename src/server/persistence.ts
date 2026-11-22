import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validatePlacements } from '../domain/plannerEngine';
import type { Collection, MapDocument, MapSummary, Placement } from '../domain/types';

export const DEFAULT_OWNED_COPIES = 2;
const SAFE_MAP_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isSafeMapId(id: string): boolean {
  return SAFE_MAP_ID_RE.test(id);
}

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

function mapsDirPath(dataDir: string): string {
  return path.join(dataDir, 'maps');
}

function mapFilePath(dataDir: string, id: string): string {
  return path.join(mapsDirPath(dataDir), `${id}.json`);
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

function generateMapId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'map';
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slug}-${suffix}`;
}

export function listMaps(dataDir: string): MapSummary[] {
  const dir = mapsDirPath(dataDir);
  if (!fs.existsSync(dir)) return [];

  const summaries: MapSummary[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MapDocument>;
      if (
        typeof parsed.id === 'string' &&
        isSafeMapId(parsed.id) &&
        typeof parsed.name === 'string' &&
        Array.isArray(parsed.placements)
      ) {
        summaries.push({
          id: parsed.id,
          name: parsed.name,
          placementCount: parsed.placements.length,
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        });
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export function readMap(dataDir: string, id: string): MapDocument | null {
  if (!isSafeMapId(id)) return null;
  const filePath = mapFilePath(dataDir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MapDocument>;
    const placements = validatePlacements(parsed.placements);
    if (!placements || typeof parsed.name !== 'string' || typeof parsed.id !== 'string') {
      return null;
    }
    return {
      version: 1,
      id: parsed.id,
      name: parsed.name,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      placements,
    };
  } catch {
    return null;
  }
}

export function createMap(
  dataDir: string,
  input: { name: string; placements?: Placement[] },
): MapDocument {
  const dir = mapsDirPath(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const trimmedName = input.name.trim() || 'Untitled Map';
  const id = generateMapId(trimmedName);
  const now = new Date().toISOString();
  const doc: MapDocument = {
    version: 1,
    id,
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    placements: input.placements ? [...input.placements] : [],
  };
  fs.writeFileSync(mapFilePath(dataDir, id), JSON.stringify(doc, null, 2), 'utf8');
  return doc;
}

export function updateMap(
  dataDir: string,
  id: string,
  input: { name: string; placements: Placement[] },
): MapDocument | null {
  const existing = readMap(dataDir, id);
  if (!existing) return null;

  const updated: MapDocument = {
    version: 1,
    id: existing.id,
    name: input.name.trim() || existing.name,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    placements: [...input.placements],
  };
  fs.writeFileSync(mapFilePath(dataDir, id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export function deleteMap(dataDir: string, id: string): boolean {
  if (!isSafeMapId(id)) return false;
  const filePath = mapFilePath(dataDir, id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
