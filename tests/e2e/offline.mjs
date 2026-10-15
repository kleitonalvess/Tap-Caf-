// Modo standalone (Sprint 10), sem PocketBase nem servidor Go: conta local nova,
// cozinhar, pagamento, recarga com o save, aba escondida (slept_at), ausência de
// 1 h com "Bem-vindo de volta!" antes do bônus diário, aba fechada sem o último
// save (ausência contada do último instante visto) e uma aba por café.
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('offline');
const network = [];
// Any page of the origin reads and edits the save; this one does not start the game.
const idle = `${site.url}/assets/items/catalog.json`;
const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ');

try {
  const context = await run.browser.newContext({ viewport: { width: 1600, height: 900 } });
  const open = async (label) => {
    const game = await run.page({ context });
    game.page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api') || path.startsWith('/game/')) network.push(path);
    });
    await game.page.goto(`${site.url}/?screen=room`);
    await game.connected();
    await game.room(() => {
      window.__payments = [];
      window.__coffeMania.screens.active.realtime.onEvent((event) => { if (event.type === 'payment') window.__payments.push(event.payment); });
    });
    await sleep(2000);
    run.log('café aberto:', label);
    return game;
  };
  const readSave = (game) => game.room(async () => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); });
    db.close();
    return record;
  });
  const writeSave = (game, record) => game.room(async (record) => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    await new Promise((done, fail) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(record, 'main'); tx.oncomplete = done; tx.onerror = fail; });
    db.close();
    localStorage.removeItem('coffe-standalone-save');
  }, record);
  const room = (record) => JSON.parse(record.data).collections.player_rooms[0].fields;
  // Servings of cake on the counter, as if cooked before the absence.
  const addFood = (data, servings, tag) => {
    const counter = data.collections.player_inventory.find((row) => row.fields.item_id === 3080000 && row.fields.placed);
    const seq = Math.max(...Object.values(data.collections).flat().map((row) => row.seq)) + 1;
    data.collections.room_food = data.collections.room_food ?? [];
    data.collections.room_food.push({
      id: `e2e${tag}food000000000`.slice(0, 15), created: fmt(Date.now() - 3600_000), seq,
      fields: { user: data.collections.player_rooms[0].fields.user, recipe_id: 'cake_1', job_id: `e2e-${tag}`, servings, counter: counter.id, fresh_servings: 0 },
    });
  };

  // 1. Primeira visita: conta local nova; o bônus diário abre na entrada.
  let game = await open('primeira visita');
  run.check(await game.skipDaily(), 'o bônus diário abre na primeira visita');
  const start = await game.player();
  run.check(start.gold === 100 && start.cash === 25 && start.level === 1, 'conta nova com 100 moedas, 25 de Grana e nível 1', start);
  await game.shot('1-cafe-offline');

  // 2. Cozinhar pão de queijo, servir no balcão e receber um pagamento.
  await game.cook('pao_de_queijo');
  run.check((await game.player()).gold < start.gold, 'cozinhar debita o custo');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
  await sleep(500);
  const stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
  run.log('prato servido no balcão');
  await game.waitFor(() => window.__payments.length > 0, undefined, 240000);
  const payment = await game.room(() => window.__payments[0]);
  run.check(payment.coins > 0 && payment.xp > 0, 'um cliente paga moedas e XP', payment);
  await sleep(1500);
  await game.shot('2-pagamento');
  const paid = await game.player();

  // 3. Recarregar: o save volta igual, sem janela de ausência.
  await game.page.close({ runBeforeUnload: true });
  game = await open('recarga');
  await game.skipDaily(5000);
  const reloaded = await game.player();
  run.check(reloaded.gold >= paid.gold && reloaded.xp >= paid.xp, 'a recarga mantém moedas e XP', { paid, reloaded });
  run.check(!await game.room(() => window.__coffeMania.screens.active.welcomeBack?.isOpen), 'ausência curta não abre "Bem-vindo de volta!"');

  // 4. Aba escondida: o café dorme e grava slept_at.
  await game.room(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  let saved;
  for (let i = 0; i < 40; i++) { saved = await readSave(game); if (room(saved).slept_at) break; await sleep(250); }
  run.check(Boolean(room(saved).slept_at), 'esconder a aba grava slept_at', room(saved).slept_at);

  // 5. Ausência de 1 h com 8 porções no balcão: expediente e "Bem-vindo de volta!" antes do bônus.
  await game.page.goto(idle);
  saved = await readSave(game);
  let data = JSON.parse(saved.data);
  data.collections.player_rooms[0].fields.slept_at = fmt(Date.now() - 3600_000);
  addFood(data, 8, 'a');
  data.collections.room_dirt = [];
  await writeSave(game, { ...saved, data: JSON.stringify(data) });
  await game.page.close();
  game = await open('volta depois de 1 h');
  await game.waitFor(() => window.__coffeMania.screens.active.welcomeBack?.isOpen, undefined, 30000);
  await sleep(800);
  await game.shot('3-bem-vindo-de-volta');
  const summary = await game.room(() => window.__coffeMania.screens.active.welcomeBack.summary);
  const after = await game.player();
  run.check(summary.served > 0 && after.gold > reloaded.gold, 'o expediente offline serve e rende moedas', { summary, before: reloaded, after });
  run.check(!await game.room(() => window.__coffeMania.screens.active.dailyModal?.isOpen), 'o bônus diário espera o resumo da ausência');
  await game.click('welcome-back-collect');
  run.check(await game.skipDaily(15000), 'o bônus diário abre depois do Coletar');
  await sleep(2000);
  await game.shot('4-coletado');

  // 6. Aba fechada sem o último save: a ausência conta do último instante visto.
  for (let i = 0; i < 40; i++) { saved = await readSave(game); if (!room(saved).slept_at) break; await sleep(250); }
  await game.page.goto(idle);
  saved = await readSave(game);
  run.check(!room(saved).slept_at && !room(saved).away_summary, 'depois do Coletar o save tem o quarto acordado e sem resumo pendente', room(saved));
  data = JSON.parse(saved.data);
  addFood(data, 4, 'b');
  data.collections.room_dirt = [];
  const seen = Date.now() - 30 * 60_000;
  await writeSave(game, { ...saved, savedAt: seen - 60_000, data: JSON.stringify(data) });
  await game.room((seen) => localStorage.setItem('coffe-standalone-seen', String(seen)), seen);
  await game.page.close();
  game = await open('volta depois de fechar a aba');
  await game.waitFor(() => window.__coffeMania.screens.active.welcomeBack?.isOpen, undefined, 30000);
  await sleep(800);
  await game.shot('5-volta-sem-salvamento-final');
  const crash = await game.room(() => window.__coffeMania.screens.active.welcomeBack.summary);
  run.check(Math.abs(crash.from - seen) <= 1000 && crash.served > 0, 'a ausência começa no último instante visto', { from: crash.from, seen, served: crash.served });

  // 7. Uma aba por café.
  const second = await context.newPage();
  await second.goto(`${site.url}/?screen=room`);
  await second.waitForSelector('.login-error:not(:empty)', { timeout: 30000 });
  const refusal = await second.textContent('.login-error');
  run.check(/outra aba/.test(refusal), 'a segunda aba é recusada', refusal);
  await second.screenshot({ path: `${run.out}/6-segunda-aba.png` });

  run.check(network.length === 0, 'nenhuma requisição a /api ou /game', network.slice(0, 5));
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // The refused second tab logs why the café did not open.
  await run.finish({ allow: [/o café não abriu/] });
  await site.stop();
}
