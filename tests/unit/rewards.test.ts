import { describe, expect, it } from 'vitest';
import { cancelRefund } from '../../game/src/game/cooking';
import { levelProgress } from '../../game/src/game/player-state';
import { dailyCards, rewardText, untilText, type DailyState } from '../../game/src/game/rewards';

const LEVELS = [{ requiredXp: 0 }, { requiredXp: 7 }, { requiredXp: 40 }, { requiredXp: 95 }];
const state = (level: number, xp: number) => ({ level, experience: { current: xp, maximum: 0 } });

describe('barra de XP', () => {
  it('enche dentro do nível atual, não pelo XP total', () => {
    expect(levelProgress(state(1, 0), LEVELS)).toBe(0);
    expect(levelProgress(state(2, 7), LEVELS)).toBe(0);
    expect(levelProgress(state(2, 23.5), LEVELS)).toBe(50);
    expect(levelProgress(state(3, 94), LEVELS)).toBeCloseTo(98.18, 1);
  });

  it('fica cheia no último nível e vazia num nível acima do XP', () => {
    expect(levelProgress(state(4, 120), LEVELS)).toBe(100);
    expect(levelProgress(state(3, 10), LEVELS)).toBe(0);
  });

  it('sem a tabela, usa XP total ÷ requisito do próximo nível', () => {
    expect(levelProgress({ level: 2, experience: { current: 20, maximum: 40 } })).toBe(50);
  });
});

const DAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, coins: day * 100, cash: day === 6 ? 5 : 0 }));
const daily = (day: number, claimable: boolean): DailyState => ({ day, claimable, nextAt: 0, days: DAYS });

describe('bônus diário', () => {
  it('marca os dias pagos, o de hoje e o de amanhã', () => {
    expect(dailyCards(daily(3, true)).map((card) => card.status)).toEqual(['claimed', 'claimed', 'today', 'later', 'later', 'later']);
    expect(dailyCards(daily(3, false)).map((card) => card.status)).toEqual(['claimed', 'claimed', 'claimed', 'tomorrow', 'later', 'later']);
    expect(dailyCards(daily(1, true)).map((card) => card.status)).toEqual(['today', 'later', 'later', 'later', 'later', 'later']);
  });

  it('depois do último dia, amanhã recomeça no primeiro', () => {
    expect(dailyCards(daily(6, false)).map((card) => card.status)).toEqual(['tomorrow', 'claimed', 'claimed', 'claimed', 'claimed', 'claimed']);
  });

  it('escreve prêmios e esperas', () => {
    expect(rewardText({ coins: 250, cash: 0 })).toBe('+250 moedas');
    expect(rewardText({ coins: 1500, cash: 5 })).toBe('+1.500 moedas e +5 Grana');
    expect(rewardText({ coins: 0, cash: 0 })).toBe('Sem prêmio');
    expect(untilText(30_000)).toBe('em 1 min');
    expect(untilText((3 * 60 + 5) * 60_000)).toBe('em 3 h 05 min');
  });
});

describe('cancelar o preparo', () => {
  it('devolve tudo no preparo e a parte configurada no fogo', () => {
    expect(cancelRefund(15, true, 50)).toBe(15);
    expect(cancelRefund(15, false, 50)).toBe(7);
    expect(cancelRefund(3, false, 50)).toBe(1);
    expect(cancelRefund(0, true, 50)).toBe(0);
    expect(cancelRefund(10, false, 0)).toBe(0);
  });
});
