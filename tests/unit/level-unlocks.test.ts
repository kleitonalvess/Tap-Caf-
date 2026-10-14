import { describe, expect, it } from 'vitest';

import { employeeSlots, levelUnlocks, nextUnlocks, type RecipeRule } from '../../game/src/game/game-rules';

const recipe = (id: string, level: number): RecipeRule => ({
  id, name: id, level, costCoins: level, cookSeconds: 30, servings: 4, pricePerServing: 4, xpPerServing: 1, spoilSeconds: 120,
});
const rules = {
  recipes: [recipe('pao', 1), recipe('bolo', 1), recipe('coxinha', 2), recipe('brigadeiro', 3), recipe('misto', 5), recipe('torta', 8)],
  employeeLocks: [1, 7, 15].map((level, index) => ({ employees: index + 1, level })),
  expansions: { startTiles: 8, rewardCoins: 250, steps: [
    { tiles: 10, level: 5, coins: 2000, cash: 10, xp: 20 },
    { tiles: 12, level: 10, coins: 6000, cash: 20, xp: 50 },
  ] },
};

describe('level unlocks', () => {
  it('lists the recipes and the staff slot opened by the level-up', () => {
    expect(levelUnlocks(rules, 1, 2).recipes.map((r) => r.id)).toEqual(['coxinha']);
    expect(levelUnlocks(rules, 6, 7)).toMatchObject({ recipes: [], slotsBefore: 1, slotsAfter: 2 });
  });

  it('collects everything when several levels pass at once', () => {
    expect(levelUnlocks(rules, 1, 8).recipes.map((r) => r.id)).toEqual(['coxinha', 'brigadeiro', 'misto', 'torta']);
    expect(levelUnlocks(rules, 1, 8).slotsAfter).toBe(2);
  });

  it('shows the expansions a level opens, unless the café already has them', () => {
    expect(levelUnlocks(rules, 4, 5, 8).expansions.map((step) => step.tiles)).toEqual([10]);
    expect(levelUnlocks(rules, 4, 5, 10).expansions).toEqual([]);
    expect(levelUnlocks(rules, 1, 10, 8).expansions.map((step) => step.tiles)).toEqual([10, 12]);
    expect(nextUnlocks(rules, 5, 8).expansion?.tiles).toBe(12);
    expect(nextUnlocks(rules, 3, 10).expansion?.tiles).toBe(12);
    expect(nextUnlocks(rules, 10, 12).expansion).toBeUndefined();
  });

  it('points to the next goals', () => {
    expect(nextUnlocks(rules, 3)).toMatchObject({ recipeLevel: 5, slotLevel: 7 });
    expect(nextUnlocks(rules, 8).recipes).toEqual([]);
    expect(employeeSlots(rules, 15)).toBe(3);
  });
});
