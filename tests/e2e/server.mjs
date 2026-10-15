// Modo servidor com banco novo: PocketBase (migrações reais), servidor do jogo e o
// cliente Vite. Login com a conta dev, bônus diário e Carta de Boas-Vindas
// gravados no banco (bônus repetido no mesmo dia → 409), cozinhar, servir,
// pagamento pelo WebSocket e HUD pelo SSE, cancelamento com o reembolso decidido
// pelo servidor, nenhum download do motor offline e "Sair" de volta ao login.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('server');

try {
  const game = await run.page();
  const engine = [];
  game.page.on('request', (request) => { if (/coffe-[\w-]*\.wasm|engine\.worker|wasm_exec/.test(request.url())) engine.push(request.url()); });
  await login(game, stack.web);
  run.check(!await game.room(async () => (await import('/src/game/backend.ts')).isOffline()), 'o cliente fala com os servidores');
  await game.room(() => {
    window.__payments = [];
    window.__coffeMania.screens.active.realtime.onEvent((event) => { if (event.type === 'payment') window.__payments.push(event.payment); });
  });
  const start = await game.player();
  const [owner] = await stack.admin.list('player_state');

  // 1. Bônus diário e Carta de Boas-Vindas, gravados pelo PocketBase.
  await game.waitFor(() => window.__coffeMania.screens.active.dailyModal?.isOpen, undefined, 30000);
  await sleep(600);
  const day1 = await game.room(() => window.__coffeMania.screens.active.dailyModal.state.days[0]);
  await game.click('daily-bonus-claim');
  await game.waitFor(() => !window.__coffeMania.screens.active.dailyModal.state?.claimable, undefined, 15000);
  await sleep(500);
  await game.shot('1-bonus');
  const afterDaily = await game.player();
  run.check(afterDaily.gold - start.gold === day1.coins, `o bônus do 1º dia credita ${day1.coins} moedas`, { start, afterDaily });
  const [claimed] = await stack.admin.list('player_state', `id = "${owner.id}"`);
  run.check(Boolean(claimed.daily_claimed_on) && claimed.daily_streak === 1, 'o banco guarda a data e a sequência do bônus', { on: claimed.daily_claimed_on, streak: claimed.daily_streak });
  await game.click('daily-bonus-close');
  await sleep(400);
  await game.click('room-action-bar-icon-mail');
  await game.waitFor(() => window.__coffeMania.screens.active.mailModal?.isOpen, undefined, 15000);
  await sleep(500);
  await game.click('mail-claim-welcome');
  await game.waitFor(() => window.__coffeMania.screens.active.mailModal.mail.unread === 0, undefined, 15000);
  const afterMail = await game.player();
  run.check(afterMail.gold - afterDaily.gold === 50, 'a Carta de Boas-Vindas credita 50 moedas', afterMail);
  const letters = await stack.admin.list('player_mail', `user = "${owner.user}"`);
  run.check(letters.length === 1 && Boolean(letters[0].claimed_at), 'o banco tem uma carta, aberta', letters.map((row) => ({ key: row.key, claimed: row.claimed_at })));
  await game.click('mail-close');
  await sleep(400);
  const again = await game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch('/api/coffe/daily/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: response.status, message: (await response.json()).message };
  });
  run.check(again.status === 409, 'o bônus repetido no mesmo dia é recusado', again);

  // 2. Cozinhar, servir e receber o pagamento pelo WebSocket; o HUD chega pelo SSE.
  await game.cook('pao_de_queijo');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
  await sleep(500);
  let stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
  await game.waitFor(() => window.__payments.length > 0, undefined, 240000);
  const payment = await game.room(() => window.__payments[0]);
  run.check(payment.coins > 0 && payment.xp > 0, 'um cliente paga pelo servidor', payment);
  await sleep(2500);
  const hud = await game.room(() => window.__coffeMania.screens.active.topBars.labelTexts[1]);
  const paid = await game.player();
  run.check(hud === String(paid.gold), 'o HUD mostra as moedas do PocketBase', { hud, gold: paid.gold });
  await game.shot('2-pagamento');

  // 3. Despensa pelo PocketBase: comprar um tempero e temperar com ele pelo servidor do jogo.
  const api = (path, body) => game.room(async ({ path, body }) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  // Coins from the superuser, so the cake below is paid (never the emergency help).
  await stack.admin.update('player_state', owner.id, { gold: paid.gold + 1000 });
  await sleep(1000);
  const bought = await api('/api/coffe/pantry/buy', { code: 800001 });
  run.check(bought.status === 200 && bought.body.state.pantry['800001'] === 1, 'comprar um tempero grava a despensa no banco', bought.body.state?.pantry ?? bought.body);
  await game.cook('cake_1');
  const cooking = await game.player();
  const job = await game.room(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0]);
  const seasoned = await api('/api/coffe/cooking/season', { stoveId: await game.room(() => [...window.__coffeMania.screens.active.occupiedStoves.keys()][0]), spice: 800001 });
  const stoves = await api('/api/coffe/cooking');
  const spiced = stoves.body.stoves.find((entry) => entry.cooking)?.cooking;
  const rows = await stack.admin.list('player_state', `user = "${owner.user}"`);
  run.check(seasoned.status === 200 && spiced?.spice === 800001 && !rows[0].pantry?.['800001'], 'temperar com a despensa passa pelo servidor do jogo e gasta a carga', { status: seasoned.status, message: seasoned.body.message, spice: spiced?.spice, pantry: rows[0].pantry });

  // 4. Cancelar com o fogo aceso: o servidor do jogo decide e informa o reembolso.
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [current] = screen.occupiedStoves.values();
    return current && Date.parse(current.startedAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 20000);
  await sleep(700);
  stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await sleep(600);
  await game.click('stove-action-cancel');
  await game.waitFor(() => window.__coffeMania.screens.active.confirmDialog.isOpen, undefined, 10000);
  await sleep(400);
  await game.click('confirm-dialog-confirm');
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 15000);
  await sleep(1000);
  const refund = (await game.player()).gold - cooking.gold;
  const notice = await game.toast();
  run.check(refund === Math.floor(job.costCoins / 2) && (notice ?? '').includes(`${refund} moedas devolvidas`), 'o reembolso pago pelo servidor é o que o aviso mostra', { cost: job.costCoins, refund, notice });
  run.check(engine.length === 0, 'o modo servidor não baixa o motor offline', engine);

  // 5. Sair do jogo volta ao login.
  await game.click('room-action-bar-settings');
  await game.waitFor(() => window.__coffeMania.screens.active.settingsModal.isOpen, undefined, 10000);
  await sleep(500);
  await game.shot('3-configuracoes');
  await game.click('settings-logout-button');
  await game.page.waitForURL((url) => !url.pathname.startsWith('/play'), { timeout: 20000 });
  await sleep(1500);
  run.check(await game.page.isVisible('#login-email'), '"Sair" volta ao formulário de login');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 before the login and the deliberate 409 of the repeated bonus.
  await run.finish({ allow: [/status of 40[19]/] });
  await stack.stop();
}
