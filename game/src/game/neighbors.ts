import type { PlayerState } from './player-state';
import { request } from './rewards';

/** The neighbourhood (shared/cafe/neighbors.go and gifts.go); the server decides limits and prizes. */
export interface Neighbor {
  id: string;
  /** npc: a generated neighbour's café; player: another account. */
  kind: 'npc' | 'player';
  name: string; cafeName: string; level: number; theme?: string; tagline?: string;
  /** The config's <special_neighbors> id (-1, -2). */
  special?: number;
  helpsLeft: number; giftSent?: boolean;
}
export interface NeighborsSnapshot { neighbors: Neighbor[]; helpsPerDay: number; helpReward: { coins: number; xp: number; energy: number } }
export interface HelpResult { action: string; coins: number; xp: number; energy: number; helpsLeft: number; levelReward?: number; state: PlayerState }
export interface GiftItem { id: string; name: string; coins?: number; stock?: number; spice?: number }
export interface Gift { id: string; from: string; fromName: string; item: GiftItem; expiresAt?: number }
export interface GiftsSnapshot { received: Gift[]; sentToday: number; claimedToday: number; limit: number; xp: number; items: GiftItem[] }
export interface GiftClaim { gift: Gift; xp: number; levelReward?: number; gifts: GiftsSnapshot; state: PlayerState }

export const loadNeighbors = (): Promise<NeighborsSnapshot> => request('/api/coffe/neighbors');
export const loadGifts = (): Promise<GiftsSnapshot> => request('/api/coffe/gifts');
export const sendGift = (to: string, item: string): Promise<GiftsSnapshot> => request('/api/coffe/gifts/send', { to, item });
export const claimGift = (id: string): Promise<GiftClaim> => request('/api/coffe/gifts/claim', { id });
/** A visitor cheers a waiting customer up in a neighbour's café. */
export const cheerCustomer = (roomId: string, actorId: string): Promise<{ actorId: string; help: HelpResult }> =>
  request('/api/coffe/room/cheer', { roomId, actorId });

/** The address of a café: the player's own (no room in offline mode) or a neighbour's. */
export function visitUrl(current: string, roomId: string | undefined): string {
  const address = new URL(current);
  if (roomId) address.searchParams.set('room', roomId); else address.searchParams.delete('room');
  return address.href;
}

/** "+20 moedas, +2 XP e +2 de energia · 2 ajudas restantes hoje". */
export function helpText(help: Pick<HelpResult, 'coins' | 'xp' | 'energy' | 'helpsLeft'>): string {
  const parts: string[] = [];
  if (help.coins > 0) parts.push(`+${help.coins.toLocaleString('pt-BR')} moedas`);
  if (help.xp > 0) parts.push(`+${help.xp} XP`);
  if (help.energy > 0) parts.push(`+${help.energy} de energia`);
  const prize = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0] ?? 'Obrigado!';
  const left = help.helpsLeft === 0 ? 'sem mais ajudas hoje' : `${help.helpsLeft} ${help.helpsLeft === 1 ? 'ajuda restante' : 'ajudas restantes'} hoje`;
  return `${prize} · ${left}`;
}

/** What a gift item gives, for the gift cards. */
export function giftText(item: GiftItem, xp: number): string {
  return `${item.name}${xp > 0 ? ` + ${xp} XP` : ''}`;
}

/** One page of the bottom bar: `size` neighbours, the specials first (server order). */
export function neighborPage<T>(neighbors: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(neighbors.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { items: neighbors.slice(current * size, current * size + size), page: current, pages };
}
