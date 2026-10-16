import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RoomCatalogItem } from '../../game/src/game/room-inventory';
import { itemLocked, itemPerk, newsItems, saleUnit, sellPrompt, sellValue, shopUnlocks, storeCategory } from '../../game/src/game/shop';
import { setsText } from '../../game/src/screens/room/PopularityModal';

const catalog = (JSON.parse(readFileSync(new URL('../../shared/roomcatalog/catalog.json', import.meta.url), 'utf8')) as { items: RoomCatalogItem[] }).items;
const byClass = (classname: string) => catalog.find((item) => item.classname === classname)!;
const CATEGORIES = ['flower', 'stove', 'stove-fire', 'counter', 'table', 'chair', 'door', 'flower-window', 'floor', 'wallpaper'];

describe('store categories', () => {
  it('maps every item to one of the store icons', () => {
    for (const item of catalog.filter((entry) => entry.purchasable)) expect(CATEGORIES).toContain(storeCategory(item));
  });

  it('fills every category with something to sell', () => {
    for (const category of CATEGORIES) expect(catalog.some((item) => item.purchasable && storeCategory(item) === category), category).toBe(true);
  });

  it('puts faster stoves on the fire tab and the register with the counters', () => {
    expect(storeCategory(byClass('starter_stove'))).toBe('stove');
    expect(storeCategory(byClass('steel_stove'))).toBe('stove-fire');
    expect(storeCategory(byClass('serving_counter'))).toBe('counter');
    expect(storeCategory(byClass('cash_register'))).toBe('counter');
  });
});

describe('levels and news', () => {
  it('locks items above the player level', () => {
    expect(itemLocked(byClass('master_stove'), 17)).toBe(true);
    expect(itemLocked(byClass('master_stove'), 18)).toBe(false);
    expect(itemLocked(byClass('classic_chair'), 1)).toBe(false);
  });

  it('lists recent unlocks first, then featured, then what comes next', () => {
    const news = newsItems(catalog, 6);
    const recent = news.filter((item) => (item.level ?? 1) > 1 && (item.level ?? 1) <= 6);
    expect(recent.length).toBeGreaterThan(0);
    expect(news.indexOf(recent[0]!)).toBe(0);
    expect(news.some((item) => item.featured)).toBe(true);
    expect(news.length).toBeLessThanOrEqual(16);
  });

  it('names the store items a level-up opened', () => {
    const opened = shopUnlocks(catalog, 1, 3).map((item) => item.classname);
    expect(opened).toContain('red_chair');
    expect(opened).not.toContain('blue_chair');
  });

  it('explains what an item does', () => {
    expect(itemPerk(byClass('master_stove'))).toBe('cozinha 25% mais rápido · o prato dura 50% mais');
    expect(itemPerk(byClass('cash_register'))).toContain('gorjeta');
    expect(itemPerk(byClass('flower_vase'))).toBe('+0,3 de popularidade');
  });
});

describe('venda do estoque e conjuntos (Sprint 15a)', () => {
  const base = { id: 1, classname: 'x', name: 'Vaso', type: 3, kind: 'ornament' as const, purchasable: true, sizeX: 1, sizeY: 1 };
  it('a venda devolve a parte do preço em moedas; Grana e exclusivos não têm valor', () => {
    expect(sellValue({ ...base, priceGold: 91 }, 50)).toBe(45);
    expect(sellValue({ ...base, priceGold: 0, priceCash: 15 }, 50)).toBe(0);
    expect(sellValue({ ...base, priceGold: 300, purchasable: false }, 50)).toBe(0);
    expect(sellPrompt({ ...base, priceGold: 300 }, 50).message).toContain('150 moedas (50% do preço)');
    expect(sellPrompt({ ...base, priceGold: 0, priceCash: 4 }, 50).message).toContain('Grana');
    expect(sellPrompt({ ...base, priceGold: 300 }, 50, true)).toMatchObject({ value: 0 });
    expect(sellPrompt({ ...base, priceGold: 300 }, 50, true).message).toContain('veio com o café');
  });

  it('o multifogão vai para a aba de fogões especiais e mostra as porções extras', () => {
    const multi = { ...base, kind: 'stove' as const, priceGold: 15000, cookSpeedPercent: 0, servingsBonusPercent: 50 };
    expect(storeCategory(multi)).toBe('stove-fire');
    expect(itemPerk(multi)).toContain('+50% de porções por lote');
    expect(itemPerk({ ...base, priceGold: 300, theme: 'japan', charm: 4 })).toContain('conjunto Banzai (Japão)');
  });

  it('o texto dos conjuntos mostra peças, bônus e quanto falta', () => {
    const decor = { bonusTenths: 30, rawTenths: 20, maxTenths: 225, lines: [], setTenths: 10,
      sets: [{ theme: 'japan', name: 'Japão', pieces: 3, next: 6, tenths: 10 }, { theme: 'noble', name: 'Nobreza Clássica', pieces: 6, next: 0, tenths: 25 }] };
    expect(setsText(decor)).toBe('Conjuntos: Japão 3 peças +1,0 (faltam 3 para o próximo bônus) · Nobreza Clássica 6 peças +2,5 (completo)');
    expect(setsText({ ...decor, sets: [] })).toContain('3 peças diferentes do mesmo tema');
  });
});

describe('saleUnit', () => {
  const unit = (unitId: string, placed: boolean, granted?: boolean) => ({ unitId, itemId: 7, placed, tx: 0, ty: 0, rotation: 0, granted });
  it('sells a bought stored unit before one that came with the café', () => {
    expect(saleUnit([unit('starter', false, true), unit('placed', true), unit('bought', false)], 7)?.unitId).toBe('bought');
  });
  it('falls back to a granted unit so the prompt can explain why it does not sell', () => {
    expect(saleUnit([unit('starter', false, true), unit('placed', true)], 7)?.unitId).toBe('starter');
    expect(saleUnit([unit('placed', true)], 7)).toBeUndefined();
  });
});
