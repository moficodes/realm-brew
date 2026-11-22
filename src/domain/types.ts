export const DEFAULT_TILESET_COPIES = 2;

export type RotationStep = 0 | 1 | 2 | 3 | 4 | 5;

export interface AxialCoord {
  q: number;
  r: number;
}

export interface TileFace {
  faceNumber: number;
  label: string;
  filename: string;
  url: string;
}

export interface Tile {
  tileId: string;
  tilesetId: string;
  faceA: TileFace;
  faceB: TileFace;
  isSymmetric: boolean;
}

export interface Tileset {
  id: string;
  name: string;
  shortCode: string;
  tiles: Tile[];
}

export interface TilesetListResponse {
  tilesets: Tileset[];
  bundleConfigured: boolean;
  error?: string;
}

export interface Placement {
  q: number;
  r: number;
  tilesetId: string;
  tileId: string;
  faceNumber: number;
  rotation: RotationStep;
}

export type PlacementKey = `${number},${number}`;

export interface MapDocument {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  placements: Placement[];
}

export interface MapSummary {
  id: string;
  name: string;
  placementCount: number;
  updatedAt: string;
}

export type Collection = Record<string, number>;

export interface BrushSelection {
  tilesetId: string;
  tileId: string;
  faceNumber: number;
  rotation: RotationStep;
}

export function padFaceNumber(faceNumber: number): string {
  return String(faceNumber).padStart(2, '0');
}
