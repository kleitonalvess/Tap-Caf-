import { describe, expect, it } from 'vitest';

import { employeeSlots, levelUnlocks, nextUnlocks, type RecipeRule } from '../../game/src/game/game-rules';

const recipe = (id: string, level: number): RecipeRule => ({
  id, name: id, level, costCoins: level, cookSeconds: 30, servings: 4, pricePerServing: 4, xpPerServing: 1, spoilSeconds: 120,
});
const rules = {
  recipes: [recipe('pao', 1), recipe('bolo', 1), recipe('coxinha', 2), recipe('brigadeiro', 3), recipe('misto', 5), recipe('torta', 8)],
  employeeLocks: [1, 7, 15].map((level, index) => ({ employees: index + 1, level })),
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

  it('points to the next goals', () => {
    expect(nextUnlocks(rules, 3)).toMatchObject({ recipeLevel: 5, slotLevel: 7 });
    expect(nextUnlocks(rules, 8).recipes).toEqual([]);
    expect(employeeSlots(rules, 15)).toBe(3);
  });
});
