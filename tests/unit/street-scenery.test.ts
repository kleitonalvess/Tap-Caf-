import { describe, expect, it } from 'vitest';

import { STREET_BUILDINGS, blocksStreetOrRoom, buildingOutline, footprintCorners } from '../../game/src/world/street-scenery';

describe('street buildings', () => {
  it('stand on free lots, off the streets and the room', () => {
    for (const def of STREET_BUILDINGS) expect(blocksStreetOrRoom(def, { tilesX: 40, tilesY: 40 }), def.id).toBe(false);
  });

  it('detect a footprint over the main street', () => {
    expect(blocksStreetOrRoom({ ...STREET_BUILDINGS[0], tx: -12 }, { tilesX: 8, tilesY: 8 })).toBe(true);
  });

  it('have unique ids', () => {
    expect(new Set(STREET_BUILDINGS.map((def) => def.id)).size).toBe(STREET_BUILDINGS.length);
  });

  it('project the footprint like the room tiles', () => {
    const corners = footprintCorners({ ...STREET_BUILDINGS[0], tx: 1, ty: -17, sizeX: 4, sizeY: 4 });
    expect(corners.back).toEqual({ x: 1440, y: -640 });
    expect(corners.front).toEqual({ x: 1440, y: -320 });
  });

  it('outline the building up to its height for taps', () => {
    const def = STREET_BUILDINGS[1];
    const top = Math.min(...buildingOutline(def).map((point) => point.y));
    expect(top).toBe(footprintCorners(def).back.y - def.height);
  });
});
