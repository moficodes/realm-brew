import type { TilesetCatalogResponse } from '../domain/types';

export async function fetchTilesets(): Promise<TilesetCatalogResponse> {
  const res = await fetch('/api/tilesets');
  if (!res.ok) {
    throw new Error(`Failed to fetch tilesets (${res.status})`);
  }
  return res.json() as Promise<TilesetCatalogResponse>;
}
