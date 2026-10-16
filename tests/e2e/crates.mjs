// Sprint 14 no modo standalone: caixas misteriosas (grátis, contador "Caixas" do
// HUD, prêmio e pedido repetido) e despensa de temperos (comprar e temperar um
// prato com o efeito do tempero).
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('crates');
const idle = `${site.url}/assets/items/catalog.json`;

try {
  const context = await run.browser.newContext({ viewport: { width: 1600, height: 900 } });
  const open = async () => {
    const game = await run.page({ context });
    await game.page.goto(`${site.url}/?screen=room`);
    await game.connected();
    await game.skipDaily();
    await sleep(1500);
    return game;
  };
  const state = (game) => game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const body = await (await apiFetch('/api/coffe/player-state')).json();
    return { gold: body.gold, cash: body.cash, crates: body.crates, pantry: body.pantry ?? {} };
  });

  // 1. Caixa grátis: o contador do HUD desce e o prêmio aparece na janela.
  let game = await open();
  const before = await state(game);
  const hud = await game.texts('room-top-bars');
  run.check(before.crates.current === 4 && before.crates.maximum === 10, 'conta nova começa com 4 caixas grátis de 10', { crates: before.crates, hud });
  await game.click('room-action-bar-icon-yellow-box');
  await game.waitFor(() => window.__coffeMania.screens.active.cratesModal?.isOpen, undefined, 15000);
  await sleep(800);
  const cards = await game.texts('crates-modal');
  run.check(cards.includes('Grátis (4)') && cards.includes('Grana') && cards.includes('moedas'), 'a janela das caixas mostra a grátis e as pagas', cards);
  await game.shot('1-caixas');
  await game.click('crate-open-surprise');
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('crates-prize', true)?.visible, undefined, 20000);
  await sleep(800);
  const prize = await game.texts('crates-prize');
  const opened = await state(game);
  run.check(opened.crates.current === 3 && prize.length > 0, 'abrir a caixa grátis gasta uma carga e mostra o prêmio', { prize, crates: opened.crates });
  await game.shot('2-premio');
  await sleep(1500);
  const hudAfter = await game.texts('room-top-bars');
  run.check(hudAfter.includes('3/10'), 'o contador "Caixas" do HUD acompanha', hudAfter);

  // A mesma chave de pedido devolve o mesmo prêmio sem cobrar de novo.
  const repeat = await game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const call = () => apiFetch('/api/coffe/crates/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crate: 'surprise', requestId: 'e2e-repeat-000001' }) }).then((r) => r.json());
    const first = await call();
    const second = await call();
    return { first: first.prize?.name, second: second.prize?.name, crates: second.state?.crates?.current };
  });
  run.check(repeat.first && repeat.first === repeat.second && repeat.crates === 2, 'repetir o pedido não abre outra caixa', repeat);
  await game.page.keyboard.press('Escape');
  await sleep(500);

  // 2. Moedas para a despensa: o save é editado com a página fechada.
  await game.page.goto(idle);
  const saved = await game.room(async () => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); });
    db.close();
    return record;
  });
  const data = JSON.parse(saved.data);
  Object.assign(data.collections.player_state[0].fields, { gold: 5000 });
  await game.room(async (record) => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    await new Promise((done, fail) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(record, 'main'); tx.oncomplete = done; tx.onerror = fail; });
    db.close();
    localStorage.removeItem('coffe-standalone-save');
  }, { ...saved, data: JSON.stringify(data) });
  await game.page.close();
  game = await open();

  // 3. Comprar o Sal Turbinado (800001: +5% de porções, pelo menos 1, além do tempero).
  const rules = await game.room(() => window.__coffeMania.screens.active.rules);
  const caseiro = rules.spices.list.find((spice) => spice.code === 800001);
  const rich = await state(game);
  const held = rich.pantry['800001'] ?? 0;
  await game.click('room-action-bar-icon-mortar');
  await game.waitFor(() => window.__coffeMania.screens.active.pantryModal?.isOpen, undefined, 15000);
  await sleep(800);
  run.check((await game.texts('pantry-modal')).includes(caseiro.name), 'a despensa lista os temperos', await game.texts('pantry-modal'));
  await game.click('pantry-buy-800001');
  await game.waitFor(async (held) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const body = await (await apiFetch('/api/coffe/player-state')).json();
    return (body.pantry?.['800001'] ?? 0) === held + 1;
  }, held, 15000);
  const bought = await state(game);
  run.check(bought.gold === rich.gold - caseiro.priceCoins, 'comprar o tempero debita as moedas e guarda uma carga', { rich, bought });
  await game.shot('3-despensa');
  await game.page.keyboard.press('Escape');
  await sleep(1500);

  // 4. Temperar com o tempero da despensa: as porções extras somam e a carga é gasta.
  const recipe = rules.recipes.filter((entry) => entry.level <= 1).sort((a, b) => b.cookSeconds - a.cookSeconds)[0];
  await game.cook(recipe.id);
  const stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('stove-action-spice-800001', true)?.visible, undefined, 15000);
  await game.shot('4-menu-com-tempero');
  await game.click('stove-action-spice-800001');
  await game.waitFor(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0]?.seasoned, undefined, 15000);
  const job = await game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const body = await (await apiFetch('/api/coffe/cooking')).json();
    return body.stoves.find((stove) => stove.cooking)?.cooking;
  });
  const regular = Math.max(1, Math.ceil(recipe.servings * rules.stove.seasonBonusPercent / 100));
  const extra = Math.max(caseiro.minExtra ?? 0, Math.ceil(recipe.servings * (caseiro.percent ?? 0) / 100));
  run.check(job.spice === 800001 && job.servings === recipe.servings + regular + extra, 'o Sal Turbinado soma as porções extras ao tempero', { job, recipe: recipe.servings, regular, extra });
  const spent = await state(game);
  run.check((spent.pantry['800001'] ?? 0) === held, 'a carga do tempero sai da despensa', { held: held + 1, now: spent.pantry });
  await sleep(1000);
  await game.shot('5-temperado');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
