import type { PlayerState } from './player-state';
import { request } from './rewards';

/** The café's tip jar (shared/cafe/tipjar.go): coins waiting for the owner. */
export interface TipJar { coins: number; cap: number }
export interface TipJarCollect { coins: number; levelReward?: number; jar: TipJar; state: PlayerState }

export const collectTips = (): Promise<TipJarCollect> => request('/api/coffe/tips/collect', {});

/** The <tips> band of a level: what the jar holds at most. */
export function tipJarCap(tips: readonly { level: number; coins: number }[] | undefined, level: number): number {
  let cap = 0;
  for (const tip of tips ?? []) if (level >= tip.level) cap = tip.coins;
  return cap;
}
