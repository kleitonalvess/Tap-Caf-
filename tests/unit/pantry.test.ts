import { describe, expect, it } from 'vitest';
import { crateContents, crateCost, ownedSpices, type Crate, type Spice } from '../../game/src/game/pantry';
import { rewardText } from '../../game/src/game/rewards';

const spices: Spice[] = [
  { code: 800001, name: 'Tempero Caseiro', effect: 'double', description: '', priceCoins: 150, count: 0 },
  { code: 800002, name: 'Tempero do Chef', effect: 'rush', description: '', priceCoins: 400, count: 0 },
  { code: 800003, name: 'Tempero Real', effect: 'preserve', description: '', priceCoins: 800, count: 0 },
];

describe('despensa e caixas', () => {
  it('lista só os temperos guardados, na ordem da despensa', () => {
    const owned = ownedSpices(spices, { '800003': 2, '800001': 1, '800002': 0 });
    expect(owned.map((spice) => [spice.code, spice.count])).toEqual([[800001, 1], [800003, 2]]);
    expect(ownedSpices(spices, undefined)).toEqual([]);
  });

  it('mostra o preço das caixas: grátis, Grana ou moedas', () => {
    expect(crateCost({ id: 'surprise', name: '', free: true, prizes: [] }, 3)).toBe('Grátis (3)');
    expect(crateCost({ id: 'purple', name: '', cash: 7, prizes: [] }, 3)).toBe('7 Grana');
    expect(crateCost({ id: 'brown', name: '', coins: 2000, prizes: [] }, 3)).toBe('2.000 moedas');
  });

  it('descreve o que uma caixa pode dar', () => {
    const crate: Crate = { id: 'x', name: '', prizes: [{ weight: 1, coins: 10 }, { weight: 1, spice: 800001 }, { weight: 1, item: 3020005 }] };
    expect(crateContents(crate)).toBe('itens exclusivos, temperos ou moedas');
    expect(crateContents({ id: 'y', name: '', prizes: [{ weight: 1, cash: 1 }] })).toBe('Grana');
  });

  it('o texto do prêmio cita os temperos', () => {
    expect(rewardText({ coins: 800, cash: 0, spices: 1 })).toBe('+800 moedas e +1 tempero');
    expect(rewardText({ coins: 0, cash: 10, spices: 2 })).toBe('+10 Grana e +2 temperos');
  });
});
