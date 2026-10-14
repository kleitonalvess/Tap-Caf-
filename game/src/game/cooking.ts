import { apiFetch } from './backend';
/** O servidor define posse, ocupação e relógio; o cliente só apresenta o progresso. */
export type StoveStatus = 'preparing' | 'cooking' | 'ready' | 'spoiled';

export interface StoveCooking {
  id: string;
  recipeId: string;
  preparingAt: string;
  startedAt: string;
  readyAt: string;
  spoilsAt?: string;
  /** Status when the snapshot was taken; use stoveStatus() for the current one. */
  status: StoveStatus;
  /** Servings the batch yields, seasoning included. */
  servings?: number;
  seasoned?: boolean;
  fresh?: boolean;
  /** What the batch cost (0 for the emergency help); cancelling returns part of it. */
  costCoins?: number;
}

export interface OwnedStove {
  id: string;
  itemId: number;
  tx: number;
  ty: number;
  cooking: StoveCooking | null;
}

export interface CookingSnapshot {
  serverNow: string;
  stoves: OwnedStove[];
  /** Recipe the owner may cook for free right now (emergency help). */
  emergencyRecipeId?: string;
}

const endpoint = '/api/coffe/cooking';

export function cookingTime(value: string): number {
  return Date.parse(value.replace(' ', 'T'));
}

/** Current phase from the job's absolute times, on the server clock. */
export function stoveStatus(job: StoveCooking, serverNowMs: number): StoveStatus {
  const spoils = cookingTime(job.spoilsAt ?? '');
  if (Number.isFinite(spoils) && serverNowMs >= spoils) return 'spoiled';
  if (serverNowMs >= cookingTime(job.readyAt)) return 'ready';
  if (serverNowMs >= cookingTime(job.startedAt)) return 'cooking';
  return 'preparing';
}

/** Coins a cancel returns, as the server computes it: everything while the batch
 * is being prepared, the configured share (rounded down) once it cooks. */
export function cancelRefund(cost: number, preparing: boolean, percent: number): number {
  if (!(cost > 0)) return 0;
  return preparing ? cost : Math.floor(cost * Math.max(0, Math.min(100, percent)) / 100);
}

/** Fraction of the spoil window already used by a ready dish (0 fresh, 1 spoiled). */
export function staleness(job: StoveCooking, serverNowMs: number): number {
  const ready = cookingTime(job.readyAt);
  const spoils = cookingTime(job.spoilsAt ?? '');
  if (!Number.isFinite(ready) || !Number.isFinite(spoils) || spoils <= ready) return 0;
  return Math.max(0, Math.min(1, (serverNowMs - ready) / (spoils - ready)));
}

export class CookingClient {
  constructor(readonly roomId?: string) {}
  private serverAnchorMs = 0;
  private localAnchorMs = 0;

  serverNowMs(): number {
    return this.serverAnchorMs + (performance.now() - this.localAnchorMs);
  }

  /** False until a kitchen snapshot has synced the clock. */
  get hasClock(): boolean { return this.serverAnchorMs > 0; }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await apiFetch(endpoint + path + (!path && this.roomId ? '?room=' + encodeURIComponent(this.roomId) : ''), {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor de preparo.');
    }
    if (response.status === 401) {
      window.location.replace('/');
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    return response;
  }

  /** Conflicts carry the server's reason, such as missing coins or a locked recipe. */
  private async conflict(response: Response, fallback: string): Promise<Error> {
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === 'string' && body.message) return new Error(body.message);
    } catch { /* Corpo ausente ou inválido: usa a mensagem padrão. */ }
    return new Error(fallback);
  }

  private async read(response: Response): Promise<CookingSnapshot> {
    if (!response.ok) throw new Error('Não foi possível atualizar os fogões.');
    const snapshot = await response.json() as CookingSnapshot;
    const serverMs = cookingTime(snapshot.serverNow);
    if (!Number.isFinite(serverMs) || !Array.isArray(snapshot.stoves)) {
      throw new Error('Dados de preparo inválidos.');
    }
    this.accept(snapshot);
    return snapshot;
  }

  accept(snapshot: CookingSnapshot): void {
    this.serverAnchorMs = cookingTime(snapshot.serverNow); this.localAnchorMs = performance.now();
  }

  async refresh(): Promise<CookingSnapshot> {
    return this.read(await this.request(''));
  }

  async start(stoveId: string, recipeId: string): Promise<CookingSnapshot> {
    const response = await this.request('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId, recipeId }),
    });
    if (response.status === 409) throw await this.conflict(response, 'Fogão ocupado.');
    return this.read(response);
  }

  async serve(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) throw await this.conflict(response, 'O prato ainda não está pronto.');
    return this.read(response);
  }

  async cancel(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) throw await this.conflict(response, 'Este preparo não pode mais ser cancelado.');
    return this.read(response);
  }

  async clean(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) throw await this.conflict(response, 'Não há nada para limpar.');
    return this.read(response);
  }

  /** Owners and visitors may season; the room id selects whose stove. */
  async season(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.roomId ? { stoveId, roomId: this.roomId } : { stoveId }),
    });
    if (response.status === 409 || response.status === 403) throw await this.conflict(response, 'Não foi possível temperar.');
    return this.read(response);
  }
}
