// Build de produção do modo offline (npm run build:standalone) servido como
// arquivos estáticos numa subpasta, como no GitHub Pages: abre, salva, recarrega
// com o mesmo perfil e nunca chama /api nem /game. Depois, sob uma
// Content-Security-Policy sem eval (o Pixi troca para o módulo sem eval) e sob uma
// que também bloqueia WebAssembly (a página mostra o motivo, sem tela parada).
// COFFE_E2E_SKIP_BUILD=1 reaproveita o game/dist-standalone existente.
import { join } from 'node:path';
import { scenario, sleep } from './lib/browser.mjs';
import { buildStandaloneSite, root, serveStatic } from './lib/stack.mjs';

const dist = process.env.COFFE_E2E_SKIP_BUILD === '1' ? join(root, 'game', 'dist-standalone') : buildStandaloneSite();
const run = await scenario('static-build');
const PREFIX = '/jogos/coffe/';
const NO_EVAL = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data:; media-src 'self' data: blob:";
const NO_WASM = NO_EVAL.replace(" 'wasm-unsafe-eval'", '');

/** The save as IndexedDB holds it: profile, stoves and coins. */
const save = (page) => page.evaluate(async () => {
  try {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); request.onerror = () => done(null); });
    db.close();
    if (!record) return null;
    const data = JSON.parse(record.data);
    return { profile: record.profile.id, stoves: data.collections.player_stoves?.length ?? 0, gold: data.collections.player_state?.[0]?.fields.gold };
  } catch { return null; }
});
const opened = async (page, tries = 240) => {
  let state = null;
  for (let i = 0; i < tries && !state?.stoves; i++) { await sleep(500); state = await save(page); }
  return state;
};
const failure = (page) => page.evaluate(() => document.querySelector('.login-error, [role=alert]')?.textContent ?? null);

try {
  // 1. Subpasta sem CSP: abre, salva e recarrega com o mesmo perfil.
  let host = await serveStatic(dist, { prefix: PREFIX });
  const context = await run.browser.newContext({ viewport: { width: 1600, height: 900 } });
  const calls = [];
  context.on('request', (request) => { const path = new URL(request.url()).pathname; if (path.includes('/api/') || path.includes('/game/')) calls.push(path); });
  let page = (await run.page({ context })).page;
  await page.goto(`${host.url}?screen=room`);
  const first = await opened(page);
  run.check(Boolean(first?.stoves) && first.gold === 100, 'o build numa subpasta abre e salva um café novo', first);
  await sleep(3000);
  await page.screenshot({ path: `${run.out}/1-subpasta.png` });
  await page.close({ runBeforeUnload: true });
  page = (await run.page({ context })).page;
  await page.goto(`${host.url}?screen=room`);
  await sleep(3000);
  const again = await opened(page);
  run.check(again?.profile === first?.profile, 'a recarga volta ao mesmo perfil', { first, again });
  run.check(calls.length === 0, 'nenhuma chamada a /api ou /game', calls.slice(0, 5));
  await context.close();
  await host.stop();

  // 2. CSP sem eval, com WebAssembly: o café abre e desenha.
  host = await serveStatic(dist, { prefix: PREFIX, csp: NO_EVAL });
  page = (await run.page()).page;
  await page.goto(host.url);
  const strict = await opened(page);
  await sleep(15000);
  const canvas = await page.evaluate(() => Boolean(document.querySelector('canvas')));
  run.check(Boolean(strict?.stoves) && canvas && !await failure(page), 'sob CSP sem eval o café abre e desenha', { strict, canvas });
  await page.screenshot({ path: `${run.out}/2-csp-sem-eval.png` });
  await page.context().close();
  await host.stop();

  // 3. CSP que bloqueia WebAssembly: a página diz por que o café não abriu.
  host = await serveStatic(dist, { prefix: PREFIX, csp: NO_WASM });
  page = (await run.page()).page;
  await page.goto(host.url);
  await page.waitForSelector('.login-error:not(:empty)', { timeout: 60000 }).catch(() => {});
  const reason = await failure(page);
  run.check(/WebAssembly/.test(reason ?? ''), 'sem WebAssembly a página mostra o motivo', reason);
  await page.screenshot({ path: `${run.out}/3-csp-sem-wasm.png` });
  await page.context().close();
  await host.stop();
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // The blocked WebAssembly is the expected failure of step 3, and the browser reports each CSP refusal.
  await run.finish({ allow: [/o café não abriu/, /Content Security Policy|unsafe-eval|WebAssembly/i] });
}
