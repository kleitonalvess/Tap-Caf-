/** Runs the café (Go compiled to WebAssembly) off the main thread, so the room
 * simulation never competes with Pixi for frames. The page owns the save; this
 * worker reports it after game transactions, never per tick. */
import type { FromEngine, ToEngine } from './protocol';

interface CoffeEngine {
  start(save: string, profile: string, lastSeenMs: number, hooks: object): string;
  fetch(method: string, path: string, body: string): Promise<{ status: number; body: string }>;
  connect(conn: number): boolean;
  send(conn: number, data: string): void;
  disconnect(conn: number): void;
  suspend(): Promise<void>;
  resume(): void;
  export(): Promise<string>;
}

interface GoRuntime { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> }

const scope = globalThis as unknown as {
  postMessage(message: FromEngine): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToEngine>) => void): void;
  Go?: new () => GoRuntime;
  coffeEngine?: CoffeEngine;
};

/** Saves coalesce: a burst of transactions (a payment, a level-up) is one save. */
const SAVE_DELAY_MS = 400;

let engine: CoffeEngine | undefined;
let pending: ToEngine[] = [];
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let lifecycle: Promise<void> = Promise.resolve();

const post = (message: FromEngine): void => scope.postMessage(message);

function scheduleSave(): void {
  dirty = true;
  if (saveTimer === undefined) saveTimer = setTimeout(() => { saveTimer = undefined; void flush(); }, SAVE_DELAY_MS);
}

async function flush(): Promise<void> {
  if (!engine || !dirty) return;
  dirty = false;
  try {
    post({ type: 'save', data: await engine.export() });
  } catch (error) {
    dirty = true;
    console.warn('[offline] falha ao exportar o save', error);
  }
}

async function start(message: Extract<ToEngine, { type: 'start' }>): Promise<void> {
  await import(/* @vite-ignore */ message.execUrl);
  if (!scope.Go) throw new Error('wasm_exec.js não definiu Go.');
  const go = new scope.Go();
  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await WebAssembly.instantiateStreaming(fetch(message.wasmUrl), go.importObject));
  } catch {
    // Hosts that serve .wasm without application/wasm still work, a bit slower.
    const bytes = await (await fetch(message.wasmUrl)).arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes, go.importObject));
  }
  void go.run(instance).then(() => post({ type: 'failed', message: 'O motor do café parou. Recarregue a página.' }));
  const api = scope.coffeEngine;
  if (!api) throw new Error('O motor do café não iniciou.');
  const failure = api.start(message.save ?? '', JSON.stringify(message.profile), message.lastSeen, {
    message: (conn: number, data: string) => post({ type: 'message', conn, data }),
    close: (conn: number) => post({ type: 'close', conn }),
    state: () => post({ type: 'state' }),
    commit: scheduleSave,
  });
  if (failure) throw new Error(failure);
  engine = api;
  // Saved before 'started': opening may have stamped the absence of a tab
  // closed without its last save, and the page marks itself seen only after.
  dirty = true;
  await flush();
}

function handle(message: ToEngine): void {
  if (!engine) return;
  switch (message.type) {
    case 'fetch':
      engine.fetch(message.method, message.path, message.body).then(
        (response) => post({ type: 'response', id: message.id, ...response }),
        (error: unknown) => post({ type: 'rejected', id: message.id, message: String(error) }),
      );
      break;
    case 'connect':
      if (!engine.connect(message.conn)) post({ type: 'close', conn: message.conn });
      break;
    case 'send':
      engine.send(message.conn, message.data);
      break;
    case 'disconnect':
      engine.disconnect(message.conn);
      break;
    case 'suspend': {
      const current = engine;
      // Pause and resume run in order: a quick hide and show never interleave.
      lifecycle = lifecycle.then(async () => {
        try {
          await current.suspend();
        } catch (error) {
          console.warn('[offline] falha ao pausar o café', error);
        }
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = undefined;
        await flush();
        post({ type: 'suspended', id: message.id });
      });
      break;
    }
    case 'resume': {
      const current = engine;
      lifecycle = lifecycle.then(() => current.resume());
      break;
    }
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'start') {
    start(message).then(() => {
      post({ type: 'started' });
      const queued = pending;
      pending = [];
      for (const item of queued) handle(item);
    }, (error: unknown) => post({ type: 'failed', message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (!engine) pending.push(message);
  else handle(message);
});
