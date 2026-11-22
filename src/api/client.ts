import type { Collection, TilesetCatalogResponse } from '../domain/types';

export async function fetchTilesets(): Promise<TilesetCatalogResponse> {
  const res = await fetch('/api/tilesets');
  if (!res.ok) {
    throw new Error(`Failed to fetch tilesets (${res.status})`);
  }
  return res.json() as Promise<TilesetCatalogResponse>;
}

export async function fetchCollection(): Promise<Collection> {
  const res = await fetch('/api/collection');
  if (!res.ok) {
    throw new Error(`Failed to fetch collection (${res.status})`);
  }
  const body = (await res.json()) as { collection: Collection };
  return body.collection;
}

export async function saveCollection(collection: Collection): Promise<Collection> {
  const res = await fetch('/api/collection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save collection (${res.status})`);
  }
  const body = (await res.json()) as { collection: Collection };
  return body.collection;
}
