import { describe, expect, it } from 'vitest';
import { machineStateAt, machineStatus, type MachineView } from '../../game/src/game/machines';
import { liveEnergy } from '../../game/src/game/player-state';
import { crateContents, itemPrice } from '../../game/src/game/pantry';

describe('energia ao vivo', () => {
  const at = Date.parse('2026-10-16T12:00:00.000Z');
  const state = (current: number, energyAt?: string) => ({ energy: { current, maximum: 50 }, ...(energyAt ? { energyAt } : {}) });
  it('soma um ponto por período desde energyAt, sem passar do máximo', () => {
    expect(liveEnergy(state(40, '2026-10-16 12:00:00.000Z'), at + 119_000, 120)).toBe(40);
    expect(liveEnergy(state(40, '2026-10-16 12:00:00.000Z'), at + 360_000, 120)).toBe(43);
    expect(liveEnergy(state(40, '2026-10-16 12:00:00.000Z'), at + 86_400_000, 120)).toBe(50);
  });
  it('acima do máximo (energético) ou sem instante, mostra o valor guardado', () => {
    expect(liveEnergy(state(60, '2026-10-16 12:00:00.000Z'), at + 360_000, 120)).toBe(60);
    expect(liveEnergy(state(30), at, 120)).toBe(30);
  });
});

describe('máquinas de entretenimento', () => {
  it('uma rodada que terminou aparece pronta pelo relógio do servidor', () => {
    expect(machineStateAt({ state: 'running', runUntil: 1000 }, 999)).toBe('running');
    expect(machineStateAt({ state: 'running', runUntil: 1000 }, 1000)).toBe('ready');
    expect(machineStateAt({ state: 'broken' }, 5000)).toBe('broken');
  });
  it('a janela descreve o estado e o que vem depois', () => {
    const base: MachineView = { unitId: 'u', itemId: 1, level: 1, maxLevel: 3, state: 'idle', parts: 0, partsNeeded: 4, nextCoins: 1500, runs: 1, runCoins: 60, runXp: 6, patiencePercent: 10 };
    const rules = { maintenanceRuns: 4 };
    expect(machineStatus({ ...base, level: 0, state: 'assembling', parts: 2, partsNeeded: 3 }, 0, rules)).toBe('Em montagem: 2/3 peças instaladas.');
    expect(machineStatus(base, 0, rules)).toBe('Parada. Rodadas até a manutenção: 3.');
    expect(machineStatus({ ...base, state: 'ready' }, 0, rules)).toBe('Rodada completa: colete 60 moedas e 6 XP.');
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    expect(machineStatus({ ...base, state: 'running', readyAt: '2026-10-16 12:30:00.000Z' }, now, rules)).toContain('termina em 30 min');
  });
});

describe('despensa: energia e peças', () => {
  it('mostra o preço em moedas ou Grana e cita energia e peças nas caixas', () => {
    expect(itemPrice({ priceCoins: 150 })).toBe('150 moedas');
    expect(itemPrice({ priceCash: 1 })).toBe('1 Grana');
    expect(crateContents({ id: 'x', name: '', prizes: [{ weight: 1, coins: 10 }, { weight: 1, stock: 820001, count: 2 }] })).toBe('peças ou moedas');
    expect(crateContents({ id: 'y', name: '', prizes: [{ weight: 1, spice: 800001, count: 1 }, { weight: 1, stock: 810001, count: 1 }] })).toBe('temperos ou energéticos');
  });
});
