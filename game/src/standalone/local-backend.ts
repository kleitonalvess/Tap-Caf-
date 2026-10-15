import { useLocalBackend, type GameBackend, type RealtimeSource, type RoomSocket } from '../game/backend';
import { PLAYER_STATE_TOPIC } from '../game/player-state-realtime';
import type { FromEngine, LocalProfile, ToEngine } from './protocol';
import { newProfileId, openSaveStore, type SaveRecord } from './save-store';

/** Last moment the page was seen: a tab closed without its final save counts
 * the absence ("Bem-vindo de volta!") from here. */
export const SEEN_KEY = 'coffe-standalone-seen';
const HEARTBEAT_MS = 15000;
/** Downloading and compiling the engine takes seconds; a start that never
 * answers (a worker stuck before its first message) must not hang the page. */
export const START_TIMEOUT_MS = 90_000;

export interface EnginePort {
  postMessage(message: ToEngine): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FromEngine>) => void): void;
}

type StartMessage = Extract<ToEngine, { type: 'start' }>;

/** The page's side of the café in the worker: requests become messages and the
 * answers come back as real Response objects, sockets and SSE events. */
export class LocalBackend implements GameBackend {
  onSave: ((data: string) => void) | null = null;
  onFatal: ((message: string) => void) | null = null;
  private nextId = 1;
  private started = false;
  private starting: { resolve(): void; reject(error: Error): void } | null = null;
  private failure: string | null = null;
  private readonly requests = new Map<number, { resolve(status: number, body: string): void; reject(error: Error): void }>();
  private readonly sockets = new Map<number, LocalSocket>();
  private readonly suspends = new Map<number, () => void>();
  private readonly checks = new Map<number, (error: string) => void>();
  /** Export and import of the save; set once the café opened (startLocalBackend). */
  saves: SaveTransfer | null = null;
  private readonly stateListeners = new Set<() => void>();

  constructor(private readonly port: EnginePort) {
    port.addEventListener('message', (event) => this.receive(event.data));
  }

  start(message: StartMessage, timeoutMs = START_TIMEOUT_MS): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.engineFailed('O motor do café não respondeu. Recarregue a página.'), timeoutMs);
      this.starting = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      this.post(message);
    });
  }

  post(message: ToEngine): void { this.port.postMessage(message); }

  private receive(message: FromEngine): void {
    switch (message.type) {
      case 'started':
        this.started = true;
        this.starting?.resolve();
        this.starting = null;
        break;
      case 'failed':
        this.engineFailed(message.message);
        break;
      case 'response':
        this.requests.get(message.id)?.resolve(message.status, message.body);
        break;
      case 'rejected':
        this.requests.get(message.id)?.reject(new Error(message.message));
        break;
      case 'message':
        this.sockets.get(message.conn)?.deliver(message.data);
        break;
      case 'close': {
        const socket = this.sockets.get(message.conn);
        this.sockets.delete(message.conn);
        socket?.ended();
        break;
      }
      case 'state':
        for (const listener of this.stateListeners) listener();
        break;
      case 'save':
        this.onSave?.(message.data);
        break;
      case 'suspended':
        this.suspends.get(message.id)?.();
        this.suspends.delete(message.id);
        break;
      case 'checked':
        this.checks.get(message.id)?.(message.error);
        this.checks.delete(message.id);
        break;
    }
  }

  /** The worker reported a failure, crashed or never answered: before it
   * started, the start fails; after, the whole café does. */
  engineFailed(message: string): void {
    if (!this.started) {
      this.starting?.reject(new Error(message));
      this.starting = null;
      return;
    }
    this.fail(message);
  }

  /** The engine stopped: nothing will answer again. */
  private fail(message: string): void {
    if (this.failure) return;
    this.failure = message;
    for (const request of this.requests.values()) request.reject(new Error(message));
    this.requests.clear();
    for (const socket of this.sockets.values()) socket.ended();
    this.sockets.clear();
    this.onFatal?.(message);
  }

  fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const signal = init.signal;
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('A requisição foi cancelada.', 'AbortError'));
    if (this.failure) return Promise.reject(new Error(this.failure));
    const id = this.nextId++;
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        this.requests.delete(id);
        reject(signal?.reason ?? new DOMException('A requisição foi cancelada.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.requests.set(id, {
        resolve: (status, body) => {
          this.requests.delete(id);
          signal?.removeEventListener('abort', abort);
          resolve(new Response(status === 204 ? null : body, { status, headers: { 'Content-Type': 'application/json' } }));
        },
        reject: (error) => {
          this.requests.delete(id);
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      });
      this.post({ type: 'fetch', id, method: (init.method ?? 'GET').toUpperCase(), path, body: typeof init.body === 'string' ? init.body : '' });
    });
  }

  openSocket(): RoomSocket {
    const socket = new LocalSocket(this, this.nextId++);
    if (this.failure) {
      setTimeout(() => socket.ended(), 0);
      return socket;
    }
    this.sockets.set(socket.id, socket);
    this.post({ type: 'connect', conn: socket.id });
    return socket;
  }

  /** The client closed its socket. */
  release(id: number): void {
    if (this.sockets.delete(id)) this.post({ type: 'disconnect', conn: id });
  }

  openEvents(): RealtimeSource { return new LocalEventSource(this); }

  onState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Sleeps the room and saves; resolves once the save has been handed over. */
  suspend(): Promise<void> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.suspends.set(id, resolve);
      this.post({ type: 'suspend', id });
    });
  }

  resume(): void { this.post({ type: 'resume' }); }

  /** Asks the engine whether it can open a save; resolves to why not, or ''. */
  check(save: string, profileId: string): Promise<string> {
    if (this.failure) return Promise.resolve(this.failure);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.checks.set(id, resolve);
      this.post({ type: 'check', id, save, profileId });
    });
  }
}

export interface SaveTransfer {
  /** The current café, saved right now (the room sleeps for a moment). */
  exportRecord(): Promise<SaveRecord>;
  /** Replaces the café with a checked save and reloads the page. */
  importRecord(record: SaveRecord): Promise<void>;
}

/** The room WebSocket, in the same protocol (join, commands, ordered events). */
export class LocalSocket implements RoomSocket {
  readyState = 0;
  onopen: RoomSocket['onopen'] = null;
  onmessage: RoomSocket['onmessage'] = null;
  onclose: RoomSocket['onclose'] = null;
  onerror: RoomSocket['onerror'] = null;

  constructor(private readonly backend: LocalBackend, readonly id: number) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('A conexão com o café não está aberta.');
    this.backend.post({ type: 'send', conn: this.id, data });
  }

  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.backend.release(this.id);
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }

  deliver(data: string): void {
    if (this.readyState === 1) this.onmessage?.({ data });
  }

  /** The café ended the connection. */
  ended(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

/** PocketBase's SSE as the player-state subscription sees it: a connect event,
 * then one notification per change of the player's HUD values. */
export class LocalEventSource extends EventTarget implements RealtimeSource {
  private closed = false;
  private readonly off: () => void;

  constructor(backend: LocalBackend) {
    super();
    this.off = backend.onState(() => {
      if (!this.closed) this.dispatchEvent(new MessageEvent(PLAYER_STATE_TOPIC, { data: '{}' }));
    });
    setTimeout(() => {
      if (!this.closed) this.dispatchEvent(new MessageEvent('PB_CONNECT', { data: JSON.stringify({ clientId: 'local' }) }));
    }, 0);
  }

  close(): void {
    this.closed = true;
    this.off();
  }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* Storage opcional. */ }
}

function lastSeen(): number {
  try {
    const value = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** One tab per café: two engines on one save would overwrite each other. A
 * reload waits a moment for the page it replaces to let go. */
async function claimTab(): Promise<void> {
  const locks = (navigator as Partial<Navigator>).locks;
  if (!locks) return;
  const granted = await new Promise<boolean>((resolve) => {
    locks.request('coffe-standalone', { signal: AbortSignal.timeout(3000) }, () => {
      resolve(true);
      // Held until the page goes away.
      return new Promise<void>(() => {});
    }).catch(() => resolve(false));
  });
  if (!granted) throw new Error('O café offline já está aberto em outra aba deste navegador. Feche-a para jogar aqui.');
}

function showFatal(message: string): void {
  const banner = document.createElement('div');
  banner.className = 'offline-fatal';
  banner.setAttribute('role', 'alert');
  banner.textContent = message;
  document.body.appendChild(banner);
}

/** Opens the browser's café and routes every request of the page to it. */
export async function startLocalBackend(): Promise<LocalBackend> {
  await claimTab();
  const store = await openSaveStore();
  const saved = await store.load();
  const profile: LocalProfile = saved?.profile ?? { id: newProfileId(), name: 'Jogador' };
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'coffe-engine' });
  const backend = new LocalBackend(worker);
  backend.onFatal = showFatal;
  // A worker that cannot load, or throws outside a request, sends no 'failed'.
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    backend.engineFailed(`O motor do café parou${event.message ? `: ${event.message}` : ''}. Recarregue a página.`);
  });
  worker.addEventListener('messageerror', () => backend.engineFailed('O motor do café enviou uma mensagem ilegível. Recarregue a página.'));
  let latest: SaveRecord | null = saved;
  let writing: Promise<void> = Promise.resolve();
  // Once an imported save is written, nothing of the old café may be saved over it.
  let replaced = false;
  backend.onSave = (data) => {
    if (replaced) return;
    const record: SaveRecord = { version: 1, profile, savedAt: Date.now(), data };
    latest = record;
    writing = writing.then(() => store.save(record)).catch((error: unknown) => {
      console.warn('[offline] não foi possível salvar o café', error);
      store.backup(record);
    });
  };
  try {
    const engine = await import('./engine-assets').catch(() => {
      throw new Error('O modo offline não foi compilado (npm run wasm).');
    });
    // The worker resolves addresses against its own script, so they go absolute.
    const absolute = (url: string) => new URL(url, document.baseURI).href;
    await backend.start({
      type: 'start', execUrl: absolute(engine.execUrl), wasmUrl: absolute(engine.wasmUrl),
      save: saved?.data ?? null, profile, lastSeen: Math.max(lastSeen(), saved?.savedAt ?? 0),
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }
  // The save made right after opening is stored before the page counts as seen.
  await writing;
  // A hidden page sleeps the café, as a server room without players does, and
  // the return replays the absence; a hidden tab's timers would not keep time.
  const hide = () => { markSeen(); void backend.suspend(); };
  const show = () => { markSeen(); backend.resume(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); else show(); });
  window.addEventListener('pagehide', () => { hide(); if (latest) store.backup(latest); });
  window.addEventListener('pageshow', (event) => { if (event.persisted && !document.hidden) show(); });
  setInterval(() => { if (!document.hidden) markSeen(); }, HEARTBEAT_MS);
  markSeen();
  if (document.hidden) hide();
  backend.saves = {
    async exportRecord() {
      // Sleeping the room writes the customers inside too, as on a hidden tab.
      await backend.suspend();
      await writing;
      if (!document.hidden) backend.resume();
      if (!latest) throw new Error('O café ainda não foi salvo.');
      return latest;
    },
    async importRecord(record) {
      const error = await backend.check(record.data, record.profile.id);
      if (error) throw new Error(`Este save não abre: ${error}.`);
      replaced = true;
      await writing.catch(() => undefined);
      worker.terminate();
      const imported: SaveRecord = { ...record, savedAt: Date.now() };
      latest = imported;
      await store.save(imported);
      store.backup(imported);
      // The imported café counts its absence from now, not from the old café's last visit.
      try { localStorage.removeItem(SEEN_KEY); } catch { /* sem localStorage */ }
      window.location.reload();
    },
  };
  useLocalBackend(backend);
  return backend;
}
