import { describe, expect, it, vi } from 'vitest';
import { LocalBackend, type EnginePort } from '../../game/src/standalone/local-backend';
import { offlineRequested } from '../../game/src/standalone/mode';
import type { FromEngine, ToEngine } from '../../game/src/standalone/protocol';
import { newest, newProfileId, pickSave, readStorage, SAVE_KEY, validRecord, type SaveRecord } from '../../game/src/standalone/save-store';

/** The worker side of the protocol, driven by the test. */
function fakeEngine() {
  const sent: ToEngine[] = [];
  let listener: ((event: MessageEvent<FromEngine>) => void) | undefined;
  const port: EnginePort = {
    postMessage: (message) => { sent.push(message); },
    addEventListener: (_type, handler) => { listener = handler; },
  };
  const reply = (message: FromEngine) => listener?.({ data: message } as MessageEvent<FromEngine>);
  return { port, sent, reply };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const record = (savedAt: number, id = 'abcdefghij12345'): SaveRecord => ({ version: 1, profile: { id, name: 'Ana' }, savedAt, data: '{}' });

describe('modo offline', () => {
  it('liga pelo build ou por ?offline=1', () => {
    expect(offlineRequested('', true)).toBe(true);
    expect(offlineRequested('?offline=1', false)).toBe(true);
    expect(offlineRequested('?room=x&offline=1', false)).toBe(true);
    expect(offlineRequested('?offline=0', false)).toBe(false);
    expect(offlineRequested('', false)).toBe(false);
  });
});

describe('save do navegador', () => {
  it('aceita só saves completos com um perfil válido', () => {
    expect(validRecord(record(1))).toBe(true);
    expect(validRecord({ ...record(1), version: 2 })).toBe(false);
    expect(validRecord({ ...record(1), profile: { id: '../x', name: 'Ana' } })).toBe(false);
    expect(validRecord({ ...record(1), data: undefined })).toBe(false);
    expect(validRecord(null)).toBe(false);
  });

  it('fica com a cópia mais nova entre o IndexedDB e o localStorage', () => {
    expect(newest(record(5), record(9))?.savedAt).toBe(9);
    expect(newest(record(9), record(5))?.savedAt).toBe(9);
    expect(newest(null, record(3))?.savedAt).toBe(3);
    expect(newest(record(3), null)?.savedAt).toBe(3);
    expect(newest(null, null)).toBeNull();
  });

  it('nunca troca o café principal por uma cópia de outro perfil', () => {
    const primary = record(5, 'aaaaaaaaaaaaaaa');
    expect(pickSave(primary, record(9, 'bbbbbbbbbbbbbbb'))).toBe(primary);
    expect(pickSave(primary, record(9, 'aaaaaaaaaaaaaaa'))?.savedAt).toBe(9);
    expect(pickSave(null, record(9, 'bbbbbbbbbbbbbbb'))?.savedAt).toBe(9);
  });

  it('ignora uma cópia ilegível no localStorage', () => {
    expect(readStorage({ getItem: () => '{oops' })).toBeNull();
    expect(readStorage({ getItem: () => JSON.stringify({ version: 1 }) })).toBeNull();
    expect(readStorage({ getItem: (key) => (key === SAVE_KEY ? JSON.stringify(record(7)) : null) })?.savedAt).toBe(7);
    expect(readStorage(null)).toBeNull();
  });

  it('cria ids de perfil no formato dos registros do servidor', () => {
    expect(newProfileId()).toMatch(/^[a-z0-9]{15}$/);
    expect(newProfileId((bytes) => bytes.fill(0))).toBe('aaaaaaaaaaaaaaa');
  });
});

describe('LocalBackend', () => {
  it('responde fetch com um Response real, 204 sem corpo', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const pending = backend.fetch('/api/coffe/room?room=x', { method: 'post', body: '{"a":1}' });
    const request = engine.sent.at(-1);
    expect(request).toMatchObject({ type: 'fetch', method: 'POST', path: '/api/coffe/room?room=x', body: '{"a":1}' });
    engine.reply({ type: 'response', id: (request as { id: number }).id, status: 409, body: '{"message":"Fogão ocupado."}' });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ message: 'Fogão ocupado.' });

    const empty = backend.fetch('/api/realtime', { method: 'POST' });
    engine.reply({ type: 'response', id: (engine.sent.at(-1) as { id: number }).id, status: 204, body: '' });
    expect((await empty).status).toBe(204);
  });

  it('cancela pelo AbortSignal e ignora a resposta atrasada', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const controller = new AbortController();
    const pending = backend.fetch('/api/coffe/staff', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    engine.reply({ type: 'response', id: (engine.sent.at(-1) as { id: number }).id, status: 200, body: '{}' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(backend.fetch('/api/coffe/staff', { signal: aborted.signal })).rejects.toThrow();
  });

  it('abre o socket, entrega eventos em ordem e fecha pelos dois lados', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const socket = backend.openSocket('ws://x/game/ws');
    const connect = engine.sent.at(-1) as { type: string; conn: number };
    expect(connect.type).toBe('connect');
    const opened = vi.fn();
    const received: unknown[] = [];
    socket.onopen = opened;
    socket.onmessage = (event) => received.push(event.data);
    expect(socket.readyState).toBe(0);
    await tick();
    expect(opened).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(1);
    socket.send('{"type":"join"}');
    expect(engine.sent.at(-1)).toEqual({ type: 'send', conn: connect.conn, data: '{"type":"join"}' });
    engine.reply({ type: 'message', conn: connect.conn, data: 'um' });
    engine.reply({ type: 'message', conn: connect.conn, data: 'dois' });
    expect(received).toEqual(['um', 'dois']);

    const closed = vi.fn();
    socket.onclose = closed;
    engine.reply({ type: 'close', conn: connect.conn });
    expect(socket.readyState).toBe(3);
    expect(closed).toHaveBeenCalledOnce();
    expect(() => socket.send('x')).toThrow();

    const other = backend.openSocket('ws://x/game/ws');
    const otherClosed = vi.fn();
    other.onclose = otherClosed;
    await tick();
    other.close();
    expect(engine.sent.at(-1)).toMatchObject({ type: 'disconnect' });
    await tick();
    expect(otherClosed).toHaveBeenCalledOnce();
  });

  it('avisa o SSE local a cada mudança do jogador', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const source = backend.openEvents();
    const connected = vi.fn();
    const changed = vi.fn();
    source.addEventListener('PB_CONNECT', connected);
    source.addEventListener('player_state/*', changed);
    await tick();
    expect(connected).toHaveBeenCalledOnce();
    engine.reply({ type: 'state' });
    engine.reply({ type: 'state' });
    expect(changed).toHaveBeenCalledTimes(2);
    source.close();
    engine.reply({ type: 'state' });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('entrega saves, conclui a pausa e falha tudo se o motor parar', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const saves: string[] = [];
    backend.onSave = (data) => saves.push(data);
    const fatal = vi.fn();
    backend.onFatal = fatal;
    const started = backend.start({ type: 'start', execUrl: 'a', wasmUrl: 'b', save: null, profile: { id: 'abcdefghij12345', name: 'Ana' }, lastSeen: 0 });
    engine.reply({ type: 'started' });
    await started;

    const paused = backend.suspend();
    const suspend = engine.sent.at(-1) as { type: string; id: number };
    expect(suspend.type).toBe('suspend');
    engine.reply({ type: 'save', data: '{"v":1}' });
    engine.reply({ type: 'suspended', id: suspend.id });
    await paused;
    expect(saves).toEqual(['{"v":1}']);

    const pending = backend.fetch('/api/coffe/rules');
    const socket = backend.openSocket('ws://x/game/ws');
    const closed = vi.fn();
    socket.onclose = closed;
    engine.reply({ type: 'failed', message: 'O motor do café parou.' });
    await expect(pending).rejects.toThrow('O motor do café parou.');
    expect(closed).toHaveBeenCalledOnce();
    expect(fatal).toHaveBeenCalledWith('O motor do café parou.');
    await expect(backend.fetch('/api/coffe/rules')).rejects.toThrow('O motor do café parou.');
  });

  it('rejeita a partida quando o motor não abre', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const started = backend.start({ type: 'start', execUrl: 'a', wasmUrl: 'b', save: null, profile: { id: 'abcdefghij12345', name: 'Ana' }, lastSeen: 0 });
    engine.reply({ type: 'failed', message: 'save ilegível' });
    await expect(started).rejects.toThrow('save ilegível');
  });

  it('desiste da partida quando o worker não responde', async () => {
    vi.useFakeTimers();
    try {
      const backend = new LocalBackend(fakeEngine().port);
      const started = backend.start({ type: 'start', execUrl: 'a', wasmUrl: 'b', save: null, profile: { id: 'abcdefghij12345', name: 'Ana' }, lastSeen: 0 }, 1000);
      const outcome = expect(started).rejects.toThrow('não respondeu');
      await vi.advanceTimersByTimeAsync(1000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('um erro do worker derruba o café uma vez só', async () => {
    const engine = fakeEngine();
    const backend = new LocalBackend(engine.port);
    const fatal = vi.fn();
    backend.onFatal = fatal;
    const started = backend.start({ type: 'start', execUrl: 'a', wasmUrl: 'b', save: null, profile: { id: 'abcdefghij12345', name: 'Ana' }, lastSeen: 0 });
    engine.reply({ type: 'started' });
    await started;
    const pending = backend.fetch('/api/coffe/rules');
    backend.engineFailed('O motor do café parou: out of memory.');
    engine.reply({ type: 'failed', message: 'outra falha' });
    await expect(pending).rejects.toThrow('out of memory');
    expect(fatal).toHaveBeenCalledOnce();
  });
});
