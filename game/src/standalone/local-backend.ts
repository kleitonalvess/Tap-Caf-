import { GAME_VERSION } from '../core/version';
import { useLocalBackend, type GameBackend, type RealtimeSource, type RoomSocket } from '../game/backend';
import { PLAYER_STATE_TOPIC } from '../game/player-state-realtime';
import type { FromEngine, LocalProfile, ToEngine } from './protocol';
import { newProfileId, openSaveStore, type SaveRecord } from './save-store';

/** Last moment the page was seen: a tab closed without its final save counts
 * the absence ("Bem-vindo de volta!") from here. */
export const SEEN_KEY = 'coffe-standalone-seen';
const HEARTBEAT_MS = 15000;

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
  private readonly stateListeners = new Set<() => void>();

  constructor(private readonly port: EnginePort) {
    port.addEventListener('message', (event) => this.receive(event.data));
  }

  start(message: StartMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.starting = { resolve, reject };
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
        if (!this.started) {
          this.starting?.reject(new Error(message.message));
          this.starting = null;
          break;
        }
        this.fail(message.message);
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
    }
  }

  /** The engine stopped: nothing will answer again. */
  private fail(message: string): void {
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
  let latest: SaveRecord | null = saved;
  let writing: Promise<void> = Promise.resolve();
  backend.onSave = (data) => {
    const record: SaveRecord = { version: 1, profile, savedAt: Date.now(), data };
    latest = record;
    writing = writing.then(() => store.save(record)).catch((error: unknown) => {
      console.warn('[offline] não foi possível salvar o café', error);
      store.backup(record);
    });
  };
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  // The version keeps a cached engine from outliving the page that expects it.
  const asset = (file: string) => new URL(`standalone/${file}?v=${encodeURIComponent(GAME_VERSION)}`, base).href;
  try {
    await backend.start({
      type: 'start', execUrl: asset('wasm_exec.js'), wasmUrl: asset('coffe.wasm'),
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
  useLocalBackend(backend);
  return backend;
}
