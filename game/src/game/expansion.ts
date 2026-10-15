import type { ExpansionRules, ExpansionStep } from './game-rules';
import type { RoomSnapshot } from './room-inventory';
import { apiFetch } from './backend';

/** Coins once the step's level is reached, or cash (Grana) at any level. */
export type ExpansionPay = 'coins' | 'cash';

export interface ExpansionOffer {
  /** Current side of the (square) café in tiles. */
  tiles: number;
  /** The next step; absent once the café reached the largest size. */
  step?: ExpansionStep;
  /** Largest side the rules allow. */
  maxTiles: number;
  rewardCoins: number;
  coins: { enabled: boolean; reason?: 'level' | 'funds' };
  cash: { enabled: boolean; reason?: 'funds' };
}

export interface ExpansionWallet { level: number; gold: number; cash: number }

export function nextExpansion(rules: ExpansionRules, tiles: number): ExpansionStep | undefined {
  return rules.steps.find((step) => step.tiles > tiles);
}

/** What the Expansão window offers for a café of this size and this wallet. */
export function expansionOffer(rules: ExpansionRules, tiles: number, wallet: ExpansionWallet): ExpansionOffer {
  const step = nextExpansion(rules, tiles);
  const maxTiles = rules.steps.at(-1)?.tiles ?? rules.startTiles;
  if (!step) return { tiles, maxTiles, rewardCoins: rules.rewardCoins, coins: { enabled: false }, cash: { enabled: false } };
  const coinReason = wallet.level < step.level ? 'level' : wallet.gold < step.coins ? 'funds' : undefined;
  return {
    tiles, step, maxTiles, rewardCoins: rules.rewardCoins,
    coins: coinReason ? { enabled: false, reason: coinReason } : { enabled: true },
    cash: wallet.cash < step.cash ? { enabled: false, reason: 'funds' } : { enabled: true },
  };
}

/** "10×10". */
export const sizeLabel = (tiles: number): string => `${tiles}×${tiles}`;

export interface ExpansionResult {
  tiles: number;
  pay: ExpansionPay;
  coins: number;
  cash: number;
  rewardCoins: number;
  xp: number;
  level: number;
  levelUp?: boolean;
  levelReward?: number;
  room: RoomSnapshot;
}

export class ExpansionClient {
  /** tiles names the step being bought, so a repeated tap never pays twice. */
  async expand(tiles: number, pay: ExpansionPay): Promise<ExpansionResult> {
    let response: Response;
    try {
      response = await apiFetch('/api/coffe/room/expand', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiles, pay }),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor.');
    }
    if (response.status === 401) {
      window.location.replace('/');
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    let data: unknown;
    try { data = await response.json(); } catch { data = undefined; }
    if (!response.ok) {
      const message = (data as { message?: unknown } | undefined)?.message;
      throw new Error(typeof message === 'string' && message ? message : 'Não foi possível expandir o café.');
    }
    const result = data as ExpansionResult;
    if (!result || typeof result.tiles !== 'number' || !result.room || !Array.isArray(result.room.inventory)) {
      throw new Error('Resposta de expansão inválida.');
    }
    return result;
  }
}
