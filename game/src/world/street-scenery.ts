import { TILE_HEIGHT_HALF, TILE_WIDTH_HALF } from './iso';

/**
 * Buildings on the lots around the café. They stand on room tiles outside the
 * room (negative coordinates), so the depth sorter orders them by the same
 * ground geometry as furniture and actors.
 *
 * Art: until a processed PNG exists, StreetScenery draws the building in a
 * canvas. To use Asset Studio art, set `image` with the exported file and its
 * left/top offsets relative to the top vertex of tile (tx, ty), the same origin
 * the item manifests use.
 */
export interface StreetBuildingDef {
  readonly id: string;
  readonly name: string;
  /** Second line of the card shown on hover and tap. */
  readonly status: string;
  /** Footprint on the ground, in room tiles. */
  readonly tx: number;
  readonly ty: number;
  readonly sizeX: number;
  readonly sizeY: number;
  /** Tallest point above the ground, in world pixels (hit area and label). */
  readonly height: number;
  readonly image?: { readonly file: string; readonly left: number; readonly top: number };
}

export const STREET_BUILDINGS: readonly StreetBuildingDef[] = [
  {
    id: 'farm', name: 'Fazenda de Ingredientes', status: 'Toque para colher',
    // Left lot, between the round tree (behind) and the pine at ty 4 (in front).
    tx: -17, ty: -1, sizeX: 4, sizeY: 3, height: 360,
  },
  {
    id: 'disco', name: 'Discoteca', status: 'Festa do Bairro',
    // Corner lot beyond the side street, facing it.
    tx: 1, ty: -17, sizeX: 4, sizeY: 4, height: 470,
  },
];

/**
 * Asphalt and sidewalks drawn in CityBackground*.png, measured in room tiles:
 * the main street runs along ty at tx -13..0 and the side street along tx at
 * ty -13..0 (from tx -13 onwards). Nothing may be built on them.
 */
export const STREET_BANDS = {
  mainStreet: { minTx: -13, maxTx: 0 },
  sideStreet: { minTy: -13, maxTy: 0, minTx: -13 },
} as const;

export interface Point { x: number; y: number }

/** Ground corners of the footprint in world pixels (tile corner projection). */
export function footprintCorners(def: StreetBuildingDef): { back: Point; right: Point; front: Point; left: Point } {
  const corner = (tx: number, ty: number): Point => ({ x: (tx - ty) * TILE_WIDTH_HALF, y: (tx + ty) * TILE_HEIGHT_HALF });
  return {
    back: corner(def.tx, def.ty),
    right: corner(def.tx + def.sizeX, def.ty),
    front: corner(def.tx + def.sizeX, def.ty + def.sizeY),
    left: corner(def.tx, def.ty + def.sizeY),
  };
}

/** Silhouette of the footprint raised to the building height: hit area for taps. */
export function buildingOutline(def: StreetBuildingDef): Point[] {
  const { back, right, front, left } = footprintCorners(def);
  const up = (point: Point): Point => ({ x: point.x, y: point.y - def.height });
  return [left, front, right, up(right), up(back), up(left)];
}

/** True when any footprint tile lies on a street band or inside the room. */
export function blocksStreetOrRoom(def: StreetBuildingDef, room: { tilesX: number; tilesY: number }): boolean {
  for (let tx = def.tx; tx < def.tx + def.sizeX; tx++) {
    for (let ty = def.ty; ty < def.ty + def.sizeY; ty++) {
      const { mainStreet, sideStreet } = STREET_BANDS;
      if (tx >= mainStreet.minTx && tx <= mainStreet.maxTx) return true;
      if (ty >= sideStreet.minTy && ty <= sideStreet.maxTy && tx >= sideStreet.minTx) return true;
      if (tx >= 0 && ty >= 0 && tx < room.tilesX && ty < room.tilesY) return true;
    }
  }
  return false;
}
