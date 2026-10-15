import { describe, expect, it } from 'vitest';

import { staleness, stoveStatus, type StoveCooking } from '../../game/src/game/cooking';
import { formatDuration, recipeAvailability, recipeProfit, recipeTab, RECIPE_TABS, type RecipeRule } from '../../game/src/game/game-rules';
import { fetchProgress, patienceColor, patienceLeft } from '../../game/src/screens/room/PatienceMeter';

const recipe = (id: string, level: number, costCoins: number): RecipeRule => ({
  id, name: id, level, costCoins, cookSeconds: 30, servings: 4, pricePerServing: 4, xpPerServing: 1, spoilSeconds: 120,
});

describe('recipe availability', () => {
  const bolo = recipe('bolo', 1, 5);

  it('locks recipes above the player level, even when free', () => {
    expect(recipeAvailability(recipe('lasanha', 10, 120), { level: 3, gold: 999, emergencyRecipeId: 'lasanha' })).toBe('locked');
  });

  it('marks the emergency recipe free and the rest by coins', () => {
    expect(recipeAvailability(bolo, { level: 1, gold: 0, emergencyRecipeId: 'bolo' })).toBe('free');
    expect(recipeAvailability(bolo, { level: 1, gold: 4 })).toBe('unaffordable');
    expect(recipeAvailability(bolo, { level: 1, gold: 5 })).toBe('available');
  });
});

describe('recipe book tabs', () => {
  const book = [
    { ...recipe('pao', 1, 3), cookSeconds: 15, servings: 3, pricePerServing: 3 },
    { ...recipe('bolo', 1, 5), cookSeconds: 30 },
    { ...recipe('lasanha', 10, 120), cookSeconds: 1800, servings: 30, pricePerServing: 8 },
    { ...recipe('misto', 5, 40), cookSeconds: 600, servings: 18, pricePerServing: 6 },
  ];

  it('lists every recipe in catalogue order on Todas', () => {
    expect(recipeTab(book, 'all', 1).map((r) => r.id)).toEqual(['pao', 'bolo', 'lasanha', 'misto']);
  });

  it('keeps the quick ones (up to ten minutes), fastest first', () => {
    expect(recipeTab(book, 'quick', 1).map((r) => r.id)).toEqual(['pao', 'bolo', 'misto']);
  });

  it('sorts by profit per batch on Lucrativas', () => {
    expect(recipeProfit(book[2]!)).toBe(30 * 8 - 120);
    expect(recipeTab(book, 'profitable', 1).map((r) => r.id)).toEqual(['lasanha', 'misto', 'bolo', 'pao']);
  });

  it('shows only what the level unlocked on Desbloqueadas', () => {
    expect(recipeTab(book, 'unlocked', 5).map((r) => r.id)).toEqual(['pao', 'bolo', 'misto']);
    expect(RECIPE_TABS.map((tab) => tab.label)).toEqual(['Todas', 'Rápidas', 'Lucrativas', 'Desbloqueadas']);
  });
});

describe('durations', () => {
  it('reads like the book', () => {
    expect(formatDuration(15)).toBe('15 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });
});

describe('stove status on the server clock', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, seconds)).toISOString().replace('T', ' ');
  const job: StoveCooking = {
    id: 'j', recipeId: 'bolo', status: 'preparing',
    preparingAt: at(0), startedAt: at(2), readyAt: at(32), spoilsAt: at(152),
  };
  const ms = (seconds: number) => Date.UTC(2026, 9, 14, 12, 0, seconds);

  it('moves through preparing, cooking, ready and spoiled', () => {
    expect(stoveStatus(job, ms(1))).toBe('preparing');
    expect(stoveStatus(job, ms(10))).toBe('cooking');
    expect(stoveStatus(job, ms(32))).toBe('ready');
    expect(stoveStatus(job, ms(152))).toBe('spoiled');
  });

  it('measures how close a ready dish is to spoiling', () => {
    expect(staleness(job, ms(32))).toBe(0);
    expect(staleness(job, ms(92))).toBeCloseTo(0.5);
    expect(staleness(job, ms(200))).toBe(1);
  });

  it('never spoils jobs saved without a spoil time', () => {
    expect(stoveStatus({ ...job, spoilsAt: undefined }, ms(10_000))).toBe('ready');
  });
});

describe('customer patience', () => {
  it('drains from full to empty and changes colour', () => {
    const patience = { startedAt: 1000, duration: 40_000 };
    expect(patienceLeft(patience, 1000)).toBe(1);
    expect(patienceLeft(patience, 21_000)).toBeCloseTo(0.5);
    expect(patienceLeft(patience, 60_000)).toBe(0);
    expect(patienceColor(0.9)).not.toBe(patienceColor(0.1));
  });

  it('turns calm when nothing in the café can be served', () => {
    expect(patienceColor(0.1, true)).toBe(patienceColor(0.9, true));
    expect(patienceColor(0.1, true)).not.toBe(patienceColor(0.1));
  });
});

describe('self-service fetch', () => {
  it('fills the bubble while the customer fetches the dish', () => {
    const action = { startedAt: 1000, duration: 3500 };
    expect(fetchProgress(action, 1000)).toBe(0);
    expect(fetchProgress(action, 2750)).toBeCloseTo(0.5);
    expect(fetchProgress(action, 9000)).toBe(1);
    expect(fetchProgress({ startedAt: 0, duration: 0 }, 5)).toBe(1);
  });
});
