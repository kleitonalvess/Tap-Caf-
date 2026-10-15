import { describe, expect, it } from 'vitest';

import { achievementStep, currencySources, missionProgress, popularityLines, rewardLine, type Achievement, type Mission } from '../../game/src/game/progress';
import type { GameRules } from '../../game/src/game/game-rules';
import { readBootFlags } from '../../game/src/core/flags';

const achievement = (progress: number, claimed: number): Achievement => ({
  id: 'customers', name: 'Clientela Fiel', description: '', stat: 'customers', progress, claimed, claimable: false,
  goals: [{ target: 25, coins: 150, xp: 10, cash: 0 }, { target: 250, coins: 1000, xp: 40, cash: 2 }, { target: 1000, coins: 4000, xp: 120, cash: 5 }],
});

describe('achievements', () => {
  it('chases the first unclaimed tier', () => {
    expect(achievementStep(achievement(10, 0))).toEqual({ tier: 0, target: 25, done: false, fraction: 0.4 });
    expect(achievementStep(achievement(300, 1))).toMatchObject({ tier: 1, target: 250, done: false, fraction: 1 });
  });

  it('is done once every tier was claimed', () => {
    expect(achievementStep(achievement(1200, 3))).toMatchObject({ done: true, fraction: 1, tier: 2 });
  });

  it('writes rewards with moedas, XP and Grana', () => {
    expect(rewardLine({ coins: 1500, xp: 40, cash: 2 })).toBe('+1.500 moedas · +40 XP · +2 Grana');
    expect(rewardLine({ coins: 0, xp: 15, cash: 0 })).toBe('+15 XP');
  });
});

describe('missions', () => {
  it('shows the goal closest to done', () => {
    const mission: Mission = { id: 'clean_or_season', title: '', coins: 50, xp: 5, cash: 1, complete: false, claimed: false,
      goals: [{ stat: 'tables', target: 3, progress: 1 }, { stat: 'seasoned', target: 1, progress: 0 }] };
    expect(missionProgress(mission)).toBe('1/3');
  });
});

describe('information windows', () => {
  const rules = {
    recipes: [], stove: {} as GameRules['stove'], customers: {} as GameRules['customers'],
    popularity: { min: 5, max: 105, satisfiedDelta: 0.1, unsatisfiedDelta: 0.3 },
    customerFrequency: [{ popularity: 5, perMinute: 5 }, { popularity: 95, perMinute: 25 }],
    daily: { days: [{ day: 1, coins: 100, cash: 0 }, { day: 3, coins: 400, cash: 2 }, { day: 6, coins: 500, cash: 10 }] },
    expansions: { startTiles: 8, rewardCoins: 250, steps: [] },
  } satisfies GameRules;

  it('explains popularity with the rules values', () => {
    const lines = popularityLines(rules).join('\n');
    expect(lines).toContain('+0,1');
    expect(lines).toContain('−0,3');
    expect(lines).toContain('de 5 a 25 por minuto');
  });

  it('lists where Moedas and Grana come from', () => {
    expect(currencySources('gold', rules).join('\n')).toMatch(/de 100 a 500 moedas[\s\S]*\+250 moedas/);
    expect(currencySources('cash', rules)[0]).toBe('Bônus diário: 3º dia: +2, 6º dia: +10 Grana.');
  });
});

describe('debug flag', () => {
  it('shows the debug HUD only when asked', () => {
    expect(readBootFlags('').debug).toBe(false);
    expect(readBootFlags('?debug=1').debug).toBe(true);
    expect(readBootFlags('?debug').debug).toBe(true);
    expect(readBootFlags('?debug=0').debug).toBe(false);
  });
});
