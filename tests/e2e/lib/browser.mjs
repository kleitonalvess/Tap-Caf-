// Browser side of the E2E roteiros: Chromium through Playwright, clicks on Pixi
// objects by label and checks that fail the run. The `__coffeMania` hooks the
// roteiros read only exist in the Vite dev client (servers or --mode standalone).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEV_ACCOUNT } from './stack.mjs';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Playwright is not a project dependency: COFFE_PLAYWRIGHT (the package
 * folder or its index.mjs), then the project's node_modules, then the global one. */
async function loadPlaywright() {
  const candidates = [];
  if (process.env.COFFE_PLAYWRIGHT) candidates.push(process.env.COFFE_PLAYWRIGHT);
  candidates.push('playwright');
  try { candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm unavailable */ }
  for (const candidate of candidates) {
    try {
      if (candidate === 'playwright') return await import('playwright');
      const entry = candidate.endsWith('.mjs') ? candidate : join(candidate, 'index.mjs');
      if (existsSync(entry)) return await import(pathToFileURL(entry).href);
    } catch { /* next candidate */ }
  }
  throw new Error('Playwright não encontrado. Instale com "npm install --no-save playwright@1.56.1" e "npx playwright install chromium", ou aponte COFFE_PLAYWRIGHT para a pasta do pacote.');
}

/**
 * One roteiro: a Chromium (software WebGL, as on a machine without GPU), a log
 * with timestamps, screenshots in a folder of its own and checks that set a
 * failing exit code. COFFE_E2E_HEADED=1 shows the browser.
 */
export async function scenario(name) {
  const { chromium } = await loadPlaywright();
  const started = Date.now();
  const out = process.env.COFFE_E2E_OUT ? join(process.env.COFFE_E2E_OUT, name) : join(tmpdir(), 'coffe-e2e', name);
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    headless: process.env.COFFE_E2E_HEADED !== '1',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const failures = [];
  const errors = [];
  const run = {
    browser,
    out,
    errors,
    log: (...parts) => console.log(`[${name} ${((Date.now() - started) / 1000).toFixed(1)}s]`, ...parts),
    /** A check that does not stop the roteiro; the run fails at the end. */
    check(condition, message, detail) {
      if (condition) run.log('ok:', message);
      else {
        failures.push(message);
        run.log('FALHOU:', message, detail === undefined ? '' : JSON.stringify(detail));
      }
      return condition;
    },
    async page({ width = 1600, height = 900, context } = {}) {
      const owner = context ?? await browser.newContext({ viewport: { width, height } });
      const page = await owner.newPage();
      page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      return pixi(page, run);
    },
    /** Closes the browser and reports; console errors not in `allow` fail the run. */
    async finish({ allow = [] } = {}) {
      await browser.close();
      const unexpected = errors.filter((text) => !allow.some((pattern) => pattern.test(text)));
      run.check(unexpected.length === 0, 'nenhum erro inesperado no console', unexpected);
      run.log(failures.length ? `${failures.length} verificação(ões) falharam` : 'tudo certo', `| capturas em ${out}`);
      if (failures.length) process.exitCode = 1;
    },
  };
  return run;
}

/** Helpers bound to one page of the game. */
function pixi(page, run) {
  const helpers = {
    page,
    room: (fn, arg) => page.evaluate(fn, arg),
    waitFor: (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 200 }),
    async shot(name) {
      await page.screenshot({ path: join(run.out, `${name}.png`) });
      run.log('captura', name);
    },
    /** Center of a visible Pixi object found by its label, in page pixels. */
    center: (label) => page.evaluate((label) => {
      const target = window.__coffeMania.app.stage.getChildByLabel(label, true);
      if (!target || !target.visible) return null;
      const bounds = target.getBounds();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }, label),
    async click(label) {
      const point = await helpers.center(label);
      if (!point) throw new Error(`objeto ${label} não encontrado ou invisível`);
      await page.mouse.click(point.x, point.y);
      run.log('clique', label);
    },
    /** Title and lines of the short notice above the windows, or null. */
    toast: () => page.evaluate(() => {
      const toast = window.__coffeMania.app.stage.getChildByLabel('level-up-toast', true);
      return toast?.visible ? toast.children.filter((child) => child.text !== undefined).map((child) => child.text).join(' | ') : null;
    }),
    /** HUD values as the server reports them. */
    player: () => page.evaluate(async () => {
      const { apiFetch } = await import('/src/game/backend.ts');
      const state = await (await apiFetch('/api/coffe/player-state')).json();
      return { gold: state.gold, cash: state.cash, level: state.level, xp: state.experience.current, popularity: state.satisfaction.current };
    }),
    /** Every visible text inside a Pixi object, joined. */
    texts: (label) => page.evaluate((label) => {
      const lines = [];
      const walk = (node) => { if (node.visible === false) return; if (node.text !== undefined) lines.push(node.text); (node.children ?? []).forEach(walk); };
      const target = window.__coffeMania.app.stage.getChildByLabel(label, true);
      if (target) walk(target);
      return lines.join(' | ');
    }, label),
    /** The room screen is up and its WebSocket (or the local one) is connected. */
    connected: () => page.waitForFunction(() => window.__coffeMania?.screens?.active?.realtime?.connected, null, { timeout: 120000, polling: 250 }),
    /** Point on the first stove, where a tap opens its menu. */
    stovePoint: () => page.evaluate(() => {
      const [, views] = [...window.__coffeMania.screens.active.stoveViews.entries()][0];
      const bounds = views[0].getBounds();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.35 };
    }),
    /** Closes the daily bonus if it opens (it does once a day on entry). */
    async skipDaily(timeout = 20000) {
      const opened = await page.waitForFunction(() => window.__coffeMania.screens.active.dailyModal?.isOpen, null, { timeout, polling: 200 }).then(() => true, () => false);
      if (opened) {
        await page.evaluate(() => window.__coffeMania.screens.active.dailyModal.close());
        await sleep(600);
        run.log('bônus diário fechado sem coletar');
      }
      return opened;
    },
    /** Taps the first stove, picks a recipe in the book and cooks it. */
    async cook(recipeId) {
      const point = await helpers.stovePoint();
      await page.mouse.click(point.x, point.y);
      await helpers.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 20000);
      await sleep(500);
      await helpers.click(`cook-card-${recipeId}`);
      await sleep(300);
      await helpers.click('cook-button');
      await helpers.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size > 0, undefined, 40000);
    },
  };
  return helpers;
}

/** Logs in with the dev account and opens the room screen directly. */
export async function login(game, web, account = DEV_ACCOUNT) {
  await game.page.goto(`${web}/`);
  await game.page.fill('#login-email', account.email);
  await game.page.fill('#login-password', account.password);
  await game.page.click('button[type=submit]');
  await game.page.waitForURL(/\/play/, { timeout: 30000 });
  await game.page.goto(game.page.url().replace(/\?.*$/, '') + '?screen=room');
  await game.connected();
}
