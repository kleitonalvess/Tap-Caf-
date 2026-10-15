import type { PlayerState } from './player-state';
import { request } from './rewards';

/** Pantry spices and mystery crates (shared/cafe/pantry.go); the server pays and draws. */
export interface Spice { code: number; name: string; effect: 'double' | 'rush' | 'preserve'; description: string; priceCoins: number; count: number }
export interface CratePrize { weight: number; coins?: number; cash?: number; spice?: number; count?: number; item?: number }
export interface Crate { id: string; code?: number; name: string; free?: boolean; coins?: number; cash?: number; prizes: CratePrize[] }
export interface PantrySnapshot { spices: Spice[]; freeCrates: number; freeMax: number; crates: Crate[] }
export interface PantryResult { pantry: PantrySnapshot; state: PlayerState }
export interface CrateResult {
  crate: string;
  prize: CratePrize & { name: string; unitId?: string };
  levelReward?: number;
  pantry: PantrySnapshot;
  state: PlayerState;
}

export const loadPantry = (): Promise<PantrySnapshot> => request('/api/coffe/pantry');
export const buySpice = (code: number): Promise<PantryResult> => request('/api/coffe/pantry/buy', { code });
export const openCrate = (crate: string, requestId: string): Promise<CrateResult> => request('/api/coffe/crates/open', { crate, requestId });

/** Spices the player holds, in pantry order, for the stove menu. */
export function ownedSpices(spices: readonly Spice[], pantry: Readonly<Record<string, number>> | undefined): Spice[] {
  return spices.map((spice) => ({ ...spice, count: pantry?.[String(spice.code)] ?? 0 })).filter((spice) => spice.count > 0);
}

/** "2.000 moedas", "7 Grana" or "Grátis (3)". */
export function crateCost(crate: Crate, freeCrates: number): string {
  if (crate.free) return `Grátis (${freeCrates})`;
  if ((crate.cash ?? 0) > 0) return `${crate.cash} Grana`;
  return `${(crate.coins ?? 0).toLocaleString('pt-BR')} moedas`;
}

/** What a crate may give, as one line: "moedas, temperos e itens exclusivos". */
export function crateContents(crate: Crate): string {
  const kinds: string[] = [];
  if (crate.prizes.some((prize) => prize.item)) kinds.push('itens exclusivos');
  if (crate.prizes.some((prize) => prize.spice)) kinds.push('temperos');
  if (crate.prizes.some((prize) => prize.coins)) kinds.push('moedas');
  if (crate.prizes.some((prize) => prize.cash)) kinds.push('Grana');
  return kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} ou ${kinds.at(-1)}` : kinds[0] ?? '';
}
