import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RoomCatalogItem } from '../../game/src/game/room-inventory';
import { itemLocked, itemPerk, newsItems, shopUnlocks, storeCategory } from '../../game/src/game/shop';

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
