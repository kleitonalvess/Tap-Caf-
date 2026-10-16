import { describe, expect, it } from 'vitest';
import { boostCost } from '../../game/src/game/cooking';
import { rewardText } from '../../game/src/game/rewards';
import { tipJarCap } from '../../game/src/game/tipjar';
import { visitorReview } from '../../game/src/game/visitors';

const at = (ms: number) => new Date(ms).toISOString().replace('T', ' ');

describe('acelerar com energia', () => {
  const job = { startedAt: at(10_000), readyAt: at(10_000 + 600_000) };
  it('custa uma energia a cada 3 minutos economizados, como o servidor', () => {
    // 10 minutes left, half saved (5 min) at 180 s per energy: 2 energy.
    expect(boostCost(job, 10_000, 50, 180)).toBe(2);
    // Before the start the time left counts from the start.
    expect(boostCost(job, 0, 50, 180)).toBe(2);
    // A few seconds left still cost one.
    expect(boostCost(job, 10_000 + 590_000, 50, 180)).toBe(1);
  });
  it('não oferece nada para um prato pronto ou sem regra', () => {
    expect(boostCost(job, 10_000 + 600_000, 50, 180)).toBe(0);
    expect(boostCost(job, 10_000, 0, 180)).toBe(0);
  });
});

describe('pote de gorjetas', () => {
  const tips = [{ level: 1, coins: 100 }, { level: 6, coins: 200 }, { level: 11, coins: 300 }, { level: 16, coins: 400 }, { level: 21, coins: 500 }];
  it('segue as faixas de nível do <tips> do config', () => {
    expect([1, 5, 6, 10, 11, 20, 21, 260].map((level) => tipJarCap(tips, level))).toEqual([100, 100, 200, 200, 300, 400, 500, 500]);
    expect(tipJarCap(undefined, 10)).toBe(0);
  });
});

describe('bônus diário', () => {
  it('o 6º dia cita a caixa grátis', () => {
    expect(rewardText({ coins: 500, cash: 10, spices: 1, crates: 1 })).toBe('+500 moedas e +10 Grana e +1 tempero e +1 caixa');
  });
});

describe('visitantes especiais', () => {
  it('o crítico elogia e mostra a popularidade ganha', () => {
    const critic = { id: 'critic_initial', name: 'Chef Jacquinho', title: 'Crítico gastronômico', critic: true, coinsMultiplier: 3.5, popularityTenths: 50, tipJarCoins: 50, review: 'Que prato!' };
    expect(visitorReview(critic)).toEqual({ title: 'Chef Jacquinho elogiou o café!', detail: '“Que prato!” · +5 de popularidade' });
    expect(visitorReview({ ...critic, critic: false, name: 'Mick Jaca', popularityTenths: 25 }).detail).toBe('“Que prato!” · +2,5 de popularidade');
  });
});
