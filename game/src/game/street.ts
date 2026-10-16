import { apiFetch } from './backend';
/** The buildings across the street, as the server derives them from absolute instants (unix ms). */
export interface StreetState {
  farmReadyAt?: number;
  freshCharges?: number;
  partyStartedAt?: number;
  partyEndsAt?: number;
  partyReadyAt?: number;
  /** Only in a harvest's answer: the spice a spice shelf gave with it. */
  freeSpice?: number;
}

export interface FarmStatus {
  /** A harvest is possible right now (cooldown over and room for one more charge). */
  canHarvest: boolean;
  /** Milliseconds until the crop is ready again (0 when ready). */
  readyInMs: number;
  charges: number;
  full: boolean;
}

export interface PartyStatus {
  active: boolean;
  /** Milliseconds left in the current party. */
  endsInMs: number;
  /** Milliseconds until a new party may start (0 when it can start now). */
  readyInMs: number;
  canStart: boolean;
}

export function farmStatus(street: StreetState | undefined, nowMs: number, maxCharges = 1): FarmStatus {
  const charges = street?.freshCharges ?? 0;
  const readyInMs = Math.max(0, (street?.farmReadyAt ?? 0) - nowMs);
  const full = charges >= maxCharges;
  return { canHarvest: readyInMs === 0 && !full, readyInMs, charges, full };
}

export function partyStatus(street: StreetState | undefined, nowMs: number): PartyStatus {
  const active = Boolean(street?.partyEndsAt && (street.partyStartedAt ?? 0) <= nowMs && nowMs < street.partyEndsAt);
  const endsInMs = active ? Math.max(0, street!.partyEndsAt! - nowMs) : 0;
  const readyInMs = active ? 0 : Math.max(0, (street?.partyReadyAt ?? 0) - nowMs);
  return { active, endsInMs, readyInMs, canStart: !active && readyInMs === 0 };
}

/** "4:05", "1:02:03": a countdown that changes once per second. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Second line of the building cards. */
export function farmCaption(status: FarmStatus): string {
  if (status.full) return 'Ingredientes frescos guardados!';
  return status.canHarvest ? 'Colheita pronta!' : `Colheita em ${formatClock(status.readyInMs)}`;
}

export function partyCaption(status: PartyStatus): string {
  if (status.active) return `Festa! Termina em ${formatClock(status.endsInMs)}`;
  return status.canStart ? 'Pronta para a festa!' : `Próxima festa em ${formatClock(status.readyInMs)}`;
}

export class StreetClient {
  private async post(path: string): Promise<StreetState> {
    let response: Response;
    try {
      response = await apiFetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' }, body: '{}',
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
      throw new Error(typeof message === 'string' && message ? message : 'Não foi possível usar o prédio agora.');
    }
    if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
    return data as StreetState;
  }

  harvest(): Promise<StreetState> { return this.post('/api/coffe/street/farm/harvest'); }
  startParty(): Promise<StreetState> { return this.post('/api/coffe/street/disco/party'); }
}
