import { apiFetch } from './backend';
import type { PlayerState } from './player-state';

/** Daily bonus (6 days, São Paulo dates) and the café's mail; the server credits both. */
export interface DailyReward { day: number; coins: number; cash: number; spices?: number; crates?: number }
export interface DailyState {
  /** The day the next claim pays; once claimed, today's day. */
  day: number;
  claimable: boolean;
  /** Unix ms of the next São Paulo midnight. */
  nextAt: number;
  days: DailyReward[];
}
export interface DailyClaim { daily: DailyState; reward: DailyReward; levelReward?: number; spices?: number[]; crates?: number; state: PlayerState }

export interface Letter {
  id: string; key: string; title: string; body: string;
  coins: number; cash: number; claimed: boolean; created: number;
}
export interface MailSnapshot { letters: Letter[]; unread: number }
export interface LetterClaim { letter: Letter; levelReward?: number; state: PlayerState }

export type DailyCardStatus = 'claimed' | 'today' | 'tomorrow' | 'later';

/** How each day of the streak looks: paid, to collect now, tomorrow's, or ahead. */
export function dailyCards(state: DailyState): Array<{ reward: DailyReward; status: DailyCardStatus }> {
  const tomorrow = state.claimable ? 0 : state.day % state.days.length + 1;
  return state.days.map((reward) => {
    let status: DailyCardStatus = 'later';
    if (reward.day === tomorrow) status = 'tomorrow';
    else if (state.claimable ? reward.day < state.day : reward.day <= state.day) status = 'claimed';
    else if (state.claimable && reward.day === state.day) status = 'today';
    return { reward, status };
  });
}

/** "+250 moedas", "+500 moedas e +5 Grana", "+800 moedas e +1 tempero". */
export function rewardText(reward: { coins: number; cash: number; spices?: number; crates?: number }): string {
  const parts: string[] = [];
  if (reward.coins > 0) parts.push(`+${reward.coins.toLocaleString('pt-BR')} moedas`);
  if (reward.cash > 0) parts.push(`+${reward.cash.toLocaleString('pt-BR')} Grana`);
  if ((reward.spices ?? 0) > 0) parts.push(`+${reward.spices} ${reward.spices === 1 ? 'tempero' : 'temperos'}`);
  if ((reward.crates ?? 0) > 0) parts.push(`+${reward.crates} ${reward.crates === 1 ? 'caixa' : 'caixas'}`);
  return parts.join(' e ') || 'Sem prêmio';
}

/** "em 3 h 12 min" until the next day opens. */
export function untilText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `em ${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `em ${minutes} min`;
}

/** A refusal with an HTTP status; a lost connection stays a plain Error. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
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
    throw new RequestError(typeof message === 'string' && message ? message : 'Não foi possível concluir agora.', response.status);
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data as T;
}

export const loadDaily = (): Promise<DailyState> => request('/api/coffe/daily');
export const claimDaily = (): Promise<DailyClaim> => request('/api/coffe/daily/claim', {});
export const loadMail = (): Promise<MailSnapshot> => request('/api/coffe/mail');
export const claimLetter = (id: string): Promise<LetterClaim> => request('/api/coffe/mail/claim', { id });
