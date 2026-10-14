// Compiles the standalone café (Go → WebAssembly) into game/public/standalone/,
// with the wasm_exec.js of the same Go toolchain. Both files are generated:
// the client loads them only in the offline mode.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

export function goCommand() {
  const windowsGo = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Go', 'bin', 'go.exe');
  return process.env.COFFE_GO ?? (process.platform === 'win32' && existsSync(windowsGo) ? windowsGo : 'go');
}

export function buildWasm({ go = goCommand(), quiet = false } = {}) {
  const out = join(root, 'game', 'public', 'standalone');
  mkdirSync(out, { recursive: true });
  const goroot = spawnSync(go, ['env', 'GOROOT'], { encoding: 'utf8' });
  if (goroot.status !== 0) return Promise.reject(new Error('Go não encontrado. Instale Go 1.27+ ou configure COFFE_GO.'));
  const exec = join(goroot.stdout.trim(), 'lib', 'wasm', 'wasm_exec.js');
  if (!existsSync(exec)) return Promise.reject(new Error(`wasm_exec.js não encontrado em ${exec}.`));
  return new Promise((done, fail) => {
    const child = spawn(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', join(out, 'coffe.wasm'), './game-server/standalone/wasm'], {
      cwd: root, env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' }, stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit', windowsHide: true,
    });
    let errors = '';
    child.stderr?.on('data', (chunk) => { errors += chunk; });
    child.once('error', () => fail(new Error('Go não encontrado. Instale Go 1.27+ ou configure COFFE_GO.')));
    child.once('close', (code) => {
      if (code !== 0) {
        fail(new Error(`Falha ao compilar o modo offline (WebAssembly).${errors ? '\n' + errors : ''}`));
        return;
      }
      // GOROOT files are read-only; a copy that kept the mode could not be replaced.
      const target = join(out, 'wasm_exec.js');
      rmSync(target, { force: true });
      copyFileSync(exec, target);
      chmodSync(target, 0o644);
      done(out);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildWasm().then((out) => console.info(`Modo offline compilado em ${out}`), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
