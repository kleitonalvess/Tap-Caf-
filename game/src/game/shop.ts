import type { RoomCatalogItem } from './room-inventory';

/** Store tabs by their icon (assets/ui/store-icons). Stoves that cook faster
 * go to the fire-stove tab; the cash register sits with the counters. */
export function storeCategory(item: RoomCatalogItem): string {
  if (item.type === 0) return 'floor';
  if (item.type === 1) return 'wallpaper';
  if (item.type === 2) return 'door';
  switch (item.kind) {
    case 'stove': return (item.cookSpeedPercent ?? 0) > 0 ? 'stove-fire' : 'stove';
    case 'counter': case 'register': return 'counter';
    case 'table': return 'table';
    case 'chair': return 'chair';
    case 'window': case 'panel': return 'flower-window';
    case 'wall': return 'wallpaper';
    case 'door': return 'door';
    default: return 'flower';
  }
}

export const itemLevel = (item: RoomCatalogItem): number => Math.max(1, item.level ?? 1);

/** Locked until the player reaches the item's level. */
export const itemLocked = (item: RoomCatalogItem, level: number): boolean => itemLevel(item) > level;

/** Novidades: what the last levels unlocked (newest first), then the featured
 * items, then the next ones to unlock as a preview. */
export function newsItems(catalog: readonly RoomCatalogItem[], level: number, limit = 16): RoomCatalogItem[] {
  const sellable = catalog.filter((item) => item.purchasable);
  const recent = sellable.filter((item) => itemLevel(item) > 1 && itemLevel(item) <= level && itemLevel(item) > level - 5)
    .sort((a, b) => itemLevel(b) - itemLevel(a) || a.id - b.id);
  const featured = sellable.filter((item) => item.featured && !recent.includes(item)).sort((a, b) => itemLevel(a) - itemLevel(b) || a.id - b.id);
  const upcoming = sellable.filter((item) => itemLevel(item) > level && !featured.includes(item))
    .sort((a, b) => itemLevel(a) - itemLevel(b) || a.id - b.id);
  // Featured items always get room, even after a big level jump.
  const shownFeatured = featured.slice(0, Math.min(6, Math.floor(limit / 2)));
  const shownRecent = recent.slice(0, limit - shownFeatured.length);
  return [...shownRecent, ...shownFeatured, ...upcoming].slice(0, limit);
}

/** Store items a level-up opened (exclusive → inclusive). */
export function shopUnlocks(catalog: readonly RoomCatalogItem[], fromLevel: number, toLevel: number): RoomCatalogItem[] {
  return catalog.filter((item) => item.purchasable && itemLevel(item) > fromLevel && itemLevel(item) <= toLevel)
    .sort((a, b) => itemLevel(a) - itemLevel(b) || a.id - b.id);
}

/** "+0,5 de popularidade" for the store and the windows. */
export function charmText(tenths: number): string {
  return `+${(tenths / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de popularidade`;
}

/** What makes an item worth buying beyond its looks, in one line. */
export function itemPerk(item: RoomCatalogItem): string {
  const parts: string[] = [];
  if (item.kind === 'stove' && item.cookSpeedPercent) parts.push(`cozinha ${item.cookSpeedPercent}% mais rápido`);
  if (item.kind === 'stove' && item.spoilBonusPercent) parts.push(`o prato dura ${item.spoilBonusPercent}% mais`);
  if (item.kind === 'register') parts.push('quem se serve sozinho também dá gorjeta');
  if (item.charm) parts.push(charmText(item.charm));
  return parts.join(' · ');
}
