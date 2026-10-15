// Isolated stacks for the E2E roteiros: a fresh database in a temporary folder
// and ports of their own, so a run never touches `npm run dev`, its database or
// another copy of the project.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { buildWasm, goCommand } from '../../../scripts/build-wasm.mjs';

export const root = resolve(import.meta.dirname, '../../..');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const suffix = process.platform === 'win32' ? '.exe' : '';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Account created by COFFE_DEV_SEED on a new database. */
export const DEV_ACCOUNT = { email: 'test@local.mail', password: '123456' };
const SUPERUSER = { email: 'e2e@local.mail', password: 'e2e-superuser-123' };

function free(port) {
  return new Promise((done, fail) => {
    const probe = createNetServer().once('error', () => fail(new Error(`A porta ${port} está ocupada; escolha outra base (COFFE_E2E_PORT).`)));
    probe.listen(port, '127.0.0.1', () => probe.close(done));
  });
}

async function ready(url, accepts = (response) => response.ok, attempts = 240) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (accepts(await fetch(url, { signal: AbortSignal.timeout(1000) }))) return;
    } catch { /* still starting */ }
    await delay(250);
  }
  throw new Error(`Serviço indisponível: ${url}`);
}

// A roteiro stopped from outside (Ctrl+C, a timeout) takes its services with it.
const live = new Set();
process.once('exit', () => { for (const child of live) child.kill('SIGKILL'); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(130));

function start(command, args, cwd, env, logFile) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  live.add(child);
  child.once('close', () => live.delete(child));
  const log = createWriteStream(logFile);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

function stopChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 10000);
    child.once('close', () => { clearTimeout(timer); done(); });
    child.kill(signal);
  });
}

function compile(go, path, binary) {
  const result = spawnSync(go, ['build', '-o', binary, path], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Falha ao compilar ${path}.`);
}

/** The ports of a stack: database, game server and web client, from one base. */
export function ports(base = Number(process.env.COFFE_E2E_PORT ?? 18300)) {
  return { db: base, game: base + 1, web: base + 2 };
}

/**
 * PocketBase (new database with the dev account), the game server built from
 * the current code and the Vite dev client (the __coffeMania hooks only exist
 * there). `admin` is a superuser client for adjusting records between steps.
 * Stopping flushes the rooms first, as Ctrl+C does in `npm run dev`.
 */
export async function startServers({ base } = {}) {
  const port = ports(base);
  await free(port.db); await free(port.game); await free(port.web);
  const dir = mkdtempSync(join(tmpdir(), 'coffe-e2e-'));
  const go = goCommand();
  const databaseBinary = join(dir, 'coffe-database' + suffix);
  const gameBinary = join(dir, 'coffe-game-server' + suffix);
  compile(go, './database', databaseBinary);
  compile(go, './game-server', gameBinary);
  const secretFile = join(dir, 'game-secret');
  const env = {
    ...process.env,
    COFFE_BACKEND_URL: `http://127.0.0.1:${port.db}`,
    COFFE_GAME_URL: `http://127.0.0.1:${port.game}`,
    COFFE_GAME_ADDR: `127.0.0.1:${port.game}`,
    COFFE_WEB_PORT: String(port.web),
    COFFE_DEV_SEED: 'true',
    COFFE_GAME_SECRET_FILE: secretFile,
  };
  const children = [];
  const stack = {
    dir,
    db: env.COFFE_BACKEND_URL,
    game: env.COFFE_GAME_URL,
    web: `http://127.0.0.1:${port.web}`,
    admin: null,
    async stop({ keep = process.env.COFFE_E2E_KEEP === '1' } = {}) {
      const [database, gameServer, client] = children;
      // Rooms save their NPCs before the database goes away.
      try {
        await fetch(`${stack.game}/internal/shutdown`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + readFileSync(secretFile, 'utf8').trim() }, signal: AbortSignal.timeout(33000),
        });
      } catch { /* the game server may already be down */ }
      await stopChild(client);
      await stopChild(gameServer, 'SIGINT');
      await stopChild(database);
      if (keep) console.info(`[e2e] banco e logs mantidos em ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
    },
  };
  try {
    children.push(start(databaseBinary, ['serve', `--http=127.0.0.1:${port.db}`, `--dir=${join(dir, 'pb_data')}`], join(root, 'database'), env, join(dir, 'database.log')));
    await ready(`${stack.db}/api/coffe/session`, (response) => response.status === 401);
    children.push(start(gameBinary, [], join(root, 'game-server'), env, join(dir, 'game-server.log')));
    await ready(`${stack.game}/game/health`);
    children.push(start(process.execPath, [vite, '--port', String(port.web), '--strictPort', '--host', '127.0.0.1'], join(root, 'game'), env, join(dir, 'vite.log')));
    await ready(`${stack.web}/`);
    const created = spawnSync(databaseBinary, ['superuser', 'upsert', SUPERUSER.email, SUPERUSER.password, `--dir=${join(dir, 'pb_data')}`], { cwd: join(root, 'database'), encoding: 'utf8' });
    if (created.status !== 0) throw new Error(`Superusuário não criado: ${created.stderr || created.stdout}`);
    stack.admin = await adminClient(stack.db);
    return stack;
  } catch (error) {
    await stack.stop({ keep: true });
    throw error;
  }
}

/** PocketBase's record API as a superuser, for the steps a player cannot take
 * from the UI (more coins, a higher level, an earlier timestamp). */
async function adminClient(base) {
  const auth = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: SUPERUSER.email, password: SUPERUSER.password }),
  });
  if (!auth.ok) throw new Error(`Login do superusuário recusado: ${auth.status}`);
  const { token } = await auth.json();
  const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: token, 'Content-Type': 'application/json', ...init.headers } });
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  };
  return {
    list: async (collection, filter = '') => (await call(`/api/collections/${collection}/records?perPage=500${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`)).items,
    update: (collection, id, fields) => call(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    create: (collection, fields) => call(`/api/collections/${collection}/records`, { method: 'POST', body: JSON.stringify(fields) }),
    remove: (collection, id) => call(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' }),
  };
}

/** Vite in standalone mode: the café runs in the browser (Go/WASM), no servers. */
export async function startStandalone({ base } = {}) {
  const port = ports(base).web;
  await free(port);
  if (!existsSync(join(root, 'game', 'src', 'standalone', 'generated', 'coffe.wasm'))) await buildWasm({ quiet: true });
  const dir = mkdtempSync(join(tmpdir(), 'coffe-e2e-'));
  const client = start(process.execPath, [vite, '--mode', 'standalone', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], join(root, 'game'), process.env, join(dir, 'vite.log'));
  const url = `http://127.0.0.1:${port}`;
  try {
    await ready(`${url}/`);
  } catch (error) {
    await stopChild(client);
    throw error;
  }
  return {
    url,
    async stop() {
      await stopChild(client);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.dae': 'application/xml',
};

/** A static host for a build folder, mounted under a prefix as GitHub Pages
 * does; `csp` sends a Content-Security-Policy with every file. */
export async function serveStatic(folder, { prefix = '/', base, csp } = {}) {
  const port = ports(base).web;
  await free(port);
  const rootDir = normalize(folder);
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    let file = normalize(join(rootDir, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(rootDir)) { response.writeHead(403); response.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...(csp ? { 'Content-Security-Policy': csp } : {}) });
    createReadStream(file).pipe(response);
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${port}${prefix}`, stop: () => new Promise((done) => server.close(done)) };
}

/** Builds the static site of the offline mode (game/dist-standalone). */
export function buildStandaloneSite() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build:standalone'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.status !== 0) throw new Error('npm run build:standalone falhou.');
  return join(root, 'game', 'dist-standalone');
}
