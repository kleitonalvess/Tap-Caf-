import { describe, expect, it } from 'vitest';

import { awayLines, formatAway, type AwaySummary } from '../../game/src/game/away';

const base: AwaySummary = {
  from: 0, to: 2 * 3600_000 + 15 * 60_000, simulatedMs: 2 * 3600_000 + 15 * 60_000, served: 0, coins: 0, tips: 0, freshCoins: 0, xp: 0,
  levelFrom: 3, levelTo: 3, popularityFrom: 800, popularityTo: 800, plates: 0, cleared: 0, waiters: 0, cleaners: 0,
  servingsLeft: 0, readyDishes: 0, spoiledDishes: 0,
};

describe('welcome back summary', () => {
  it('formats the absence', () => {
    expect(formatAway(base.to)).toBe('2 h 15 min');
    expect(formatAway(30_000)).toBe('1 min');
    expect(formatAway(5 * 24 * 3600_000)).toBe('5 dias');
  });

  it('says the café closed when there was no food', () => {
    expect(awayLines(base).map((line) => line.text)).toEqual(['O café ficou fechado: não havia comida no balcão.']);
  });

  it('credits the waiters, tips and fresh ingredients', () => {
    const lines = awayLines({ ...base, served: 6, coins: 40, tips: 6, freshCoins: 4, xp: 9, waiters: 1, cleared: 6, popularityTo: 806, levelTo: 4 });
    expect(lines.map((line) => line.text)).toEqual([
      'Seus garçons serviram 6 porções.',
      '+40 moedas (6 de gorjeta e 4 de ingredientes frescos) e +9 XP',
      'Você subiu para o nível 4!',
      'Popularidade: 80,0 → 80,6',
      'A equipe recolheu 6 pratos.',
      'O balcão esvaziou: cozinhe para reabrir.',
    ]);
  });

  it('warns about dirty tables and dishes waiting on the stoves', () => {
    const lines = awayLines({ ...base, served: 3, coins: 15, xp: 3, plates: 3, servingsLeft: 7, readyDishes: 1, spoiledDishes: 2, popularityTo: 803 });
    expect(lines.filter((line) => line.tone === 'warn').map((line) => line.text)).toEqual([
      '3 pratos sujos esperam na mesa (contrate um faxineiro).',
      '1 prato pronto espera no fogão: sirva antes que estrague!',
      '2 pratos estragaram no fogão.',
    ]);
  });
});
