/** The game's way out to its services. On the network these are fetch, the room
 * WebSocket and PocketBase's SSE; in the standalone mode the same requests go to
 * the café running in the browser (standalone/local-backend.ts), which answers
 * with the same JSON, so the modules above never know which one they talk to. */

/** Parameters checked both ways, as DOM event handlers are, so the browser's
 * WebSocket and the local socket both fit. */
type Handler<T> = { bivarianceHack(event: T): void }['bivarianceHack'];

/** The part of WebSocket the room client uses. */
export interface RoomSocket {
  readonly readyState: number;
  onopen: Handler<Event> | null;
  onmessage: Handler<{ data: unknown }> | null;
  onclose: Handler<{ code: number }> | null;
  onerror: Handler<Event> | null;
  send(data: string): void;
  close(): void;
}

/** The part of EventSource the player-state subscription uses. */
export interface RealtimeSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export interface GameBackend {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  openSocket(url: string): RoomSocket;
  openEvents(url: string): RealtimeSource;
}

let local: GameBackend | null = null;

/** Switches every request of this page to the café in the browser. */
export function useLocalBackend(backend: GameBackend): void { local = backend; }

/** The café in this browser, if the page runs offline. */
export function localBackend(): GameBackend | null { return local; }

/** True when the café runs in this browser (no server, save kept locally). */
export function isOffline(): boolean { return local !== null; }

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return local ? local.fetch(path, init) : fetch(path, init);
}

export function openRoomSocket(url: string): RoomSocket {
  return local ? local.openSocket(url) : new WebSocket(url);
}

export function openRealtime(url: string): RealtimeSource {
  return local ? local.openEvents(url) : new EventSource(url, { withCredentials: true });
}
