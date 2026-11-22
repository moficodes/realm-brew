import type {
  Collection,
  MapDocument,
  MapSummary,
  Placement,
  TilesetCatalogResponse,
} from '../domain/types';

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

export async function fetchMaps(): Promise<MapSummary[]> {
  const res = await fetch('/api/maps');
  if (!res.ok) {
    throw new Error(`Failed to list maps (${res.status})`);
  }
  const body = (await res.json()) as { maps: MapSummary[] };
  return body.maps;
}

export async function fetchMap(id: string): Promise<MapDocument> {
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to load map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function createMap(
  name: string,
  placements: readonly Placement[] = [],
): Promise<MapDocument> {
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, placements }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function saveMap(
  id: string,
  name: string,
  placements: readonly Placement[],
): Promise<MapDocument> {
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, placements }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save map (${res.status})`);
  }
  return res.json() as Promise<MapDocument>;
}

export async function deleteMap(id: string): Promise<void> {
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete map (${res.status})`);
  }
}
