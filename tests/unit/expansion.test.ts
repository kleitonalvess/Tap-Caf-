import { describe, expect, it } from 'vitest';

import { expansionOffer, nextExpansion, sizeLabel } from '../../game/src/game/expansion';
import type { ExpansionRules } from '../../game/src/game/game-rules';
import { newFloorTiles } from '../../game/src/screens/room/ExpansionGlow';
import { RoomModel } from '../../game/src/world/RoomModel';

const rules: ExpansionRules = {
  startTiles: 8, rewardCoins: 250,
  steps: [[10, 5, 2000, 10], [12, 10, 6000, 20], [14, 15, 15000, 35], [16, 22, 35000, 50], [18, 30, 75000, 75], [20, 40, 150000, 100]]
    .map(([tiles, level, coins, cash], index) => ({ tiles: tiles!, level: level!, coins: coins!, cash: cash!, xp: 10 * (index + 1) })),
};

describe('café expansion offer', () => {
  it('walks the steps two tiles at a time up to 20×20', () => {
    expect(nextExpansion(rules, 8)?.tiles).toBe(10);
    expect(nextExpansion(rules, 18)?.tiles).toBe(20);
    expect(nextExpansion(rules, 20)).toBeUndefined();
    expect(sizeLabel(12)).toBe('12×12');
  });

  it('locks coins below the level but always offers Grana', () => {
    const offer = expansionOffer(rules, 8, { level: 3, gold: 99999, cash: 10 });
    expect(offer.step?.tiles).toBe(10);
    expect(offer.coins).toEqual({ enabled: false, reason: 'level' });
    expect(offer.cash).toEqual({ enabled: true });
    expect(offer.rewardCoins).toBe(250);
  });

  it('asks for the missing coins or Grana', () => {
    const offer = expansionOffer(rules, 10, { level: 10, gold: 5999, cash: 19 });
    expect(offer.coins).toEqual({ enabled: false, reason: 'funds' });
    expect(offer.cash).toEqual({ enabled: false, reason: 'funds' });
    expect(expansionOffer(rules, 10, { level: 10, gold: 6000, cash: 0 }).coins).toEqual({ enabled: true });
  });

  it('offers nothing at the largest size', () => {
    const offer = expansionOffer(rules, 20, { level: 260, gold: 1e9, cash: 1e9 });
    expect(offer.step).toBeUndefined();
    expect(offer.maxTiles).toBe(20);
    expect(offer.coins.enabled || offer.cash.enabled).toBe(false);
  });
});

describe('room growth', () => {
  it('lists only the new floor tiles in front of the old room', () => {
    const tiles = newFloorTiles(8, 8, 10, 10);
    expect(tiles).toHaveLength(9 * 9 - 7 * 7);
    expect(tiles.every(({ tx, ty }) => tx >= 8 || ty >= 8)).toBe(true);
    expect(tiles.some(({ tx, ty }) => tx === 0 || ty === 0)).toBe(false);
  });

  it('keeps the same model and walks on the new tiles after resizing', () => {
    const model = new RoomModel({ walls: false, items: [], tilesX: 8, tilesY: 8 });
    expect(model.isWalkable(9, 9)).toBe(false);
    model.resize(10, 10);
    model.replaceItems([]);
    expect([model.tilesX, model.tilesY]).toEqual([10, 10]);
    expect(model.isWalkable(9, 9)).toBe(true);
    expect(model.walkableTiles()).toHaveLength(100);
    expect(() => model.resize(21, 21)).toThrow();
  });
});
