import { describe, expect, it } from 'vitest';
import { CrateOpener, crateContents, crateCost, ownedSpices, type Crate, type Spice } from '../../game/src/game/pantry';
import { RequestError, rewardText } from '../../game/src/game/rewards';

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

describe('abrir caixas', () => {
  const result = { crate: 'gold' } as never;
  it('repete a mesma chave depois de uma falha de conexão ou do servidor', async () => {
    const keys: string[] = [];
    const answers: Array<() => Promise<never>> = [
      () => Promise.reject(new Error('Não foi possível conectar ao servidor.')),
      () => Promise.reject(new RequestError('Não foi possível concluir agora.', 500)),
      () => Promise.resolve(result),
    ];
    let n = 0;
    const opener = new CrateOpener((_crate, key) => { keys.push(key); return answers.shift()!(); }, () => `key-${++n}`);
    await expect(opener.open('gold')).rejects.toThrow();
    await expect(opener.open('gold')).rejects.toThrow();
    await expect(opener.open('gold')).resolves.toBe(result);
    await opener.open('gold').catch(() => undefined);
    expect(keys).toEqual(['key-1', 'key-1', 'key-1', 'key-2']);
  });

  it('troca a chave depois de uma recusa definitiva', async () => {
    const keys: string[] = [];
    let n = 0;
    const opener = new CrateOpener((_crate, key) => { keys.push(key); return Promise.reject(new RequestError('Grana insuficiente.', 409)); }, () => `key-${++n}`);
    await expect(opener.open('gold')).rejects.toThrow('Grana insuficiente.');
    await expect(opener.open('gold')).rejects.toThrow();
    expect(keys).toEqual(['key-1', 'key-2']);
  });
});
