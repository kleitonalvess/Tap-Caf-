import { apiFetch } from './backend';
/** Server-owned values. Percentages are derived, never persisted independently. */
export interface ResourceValue {
  current: number;
  maximum: number;
}

export interface PlayerState {
  /** Versioned JSON string; empty/absent means the catalogue's default avatar. */
  appearance?: string;
  cafeName: string;
  cash: number;
  gold: number;
  level: number;
  experience: ResourceValue;
  energy: ResourceValue;
  crates: ResourceValue;
  satisfaction: ResourceValue;
  /** Pantry spices by code: {"800001": 2}. */
  pantry?: Record<string, number>;
  /** The instant energy regenerates from (server clock); absent while full or on older saves. */
  energyAt?: string;
}

/**
 * The energy shown now: the stored value plus one point per regen period since
 * energyAt, up to the bar's maximum (shared/cafe energyNow does the same on the server).
 */
export function liveEnergy(state: Pick<PlayerState, 'energy' | 'energyAt'>, nowMs: number, regenSeconds: number): number {
  const { current, maximum } = state.energy;
  if (current >= maximum || !state.energyAt || regenSeconds <= 0) return current;
  const at = Date.parse(state.energyAt.replace(' ', 'T'));
  if (!Number.isFinite(at) || nowMs <= at) return current;
  return Math.min(maximum, current + Math.floor((nowMs - at) / (regenSeconds * 1000)));
}

export function resourcePercentage(value: ResourceValue): number {
  if (!Number.isFinite(value.current) || !Number.isFinite(value.maximum) || value.maximum <= 0) return 0;
  return Math.min(100, Math.max(0, value.current * 100 / value.maximum));
}

/** Share of the current level already earned, 0–100. The server keeps total XP
 * (requirements are cumulative); without the level table this falls back to
 * total ÷ the next requirement. The last level shows a full bar. */
export function levelProgress(state: Pick<PlayerState, 'level' | 'experience'>, levels?: readonly { requiredXp: number }[]): number {
  if (!levels?.length) return resourcePercentage(state.experience);
  const floor = levels[state.level - 1]?.requiredXp;
  const next = levels[state.level]?.requiredXp;
  if (floor === undefined || next === undefined || next <= floor) return 100;
  const earned = (state.experience.current - floor) * 100 / (next - floor);
  return Number.isFinite(earned) ? Math.min(100, Math.max(0, earned)) : 0;
}

/** Unloaded HUDs are hidden; this only keeps isolated screens deterministic. */
export function emptyPlayerState(): PlayerState {
  return {
    cafeName: '',
    cash: 0, gold: 0, level: 1,
    experience: { current: 0, maximum: 1 },
    energy: { current: 0, maximum: 50 },
    crates: { current: 0, maximum: 4 },
    satisfaction: { current: 0, maximum: 105 },
  };
}

/** Authenticated snapshot at entry or after realtime notifications; no polling. */
export async function loadPlayerState(signal?: AbortSignal): Promise<PlayerState> {
  let response: Response;
  try {
    response = await apiFetch('/api/coffe/player-state', {
      credentials: 'same-origin', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor para carregar seus dados.');
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error('Não foi possível carregar seus dados. Tente novamente.');
  return response.json() as Promise<PlayerState>;
}
