// Sprint 13 no modo standalone: loja com todas as categorias, cadeado por nível,
// aba Novidades, itens da loja no modal de nível, compras com moedas e com
// Grana (arte tingida e desenhada), bônus de decoração na Popularidade e a
// "Caixa do dia" no botão da caixa registradora.
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('shop');
// Any page of the origin reads and edits the save; this one does not start the game.
const idle = `${site.url}/assets/items/catalog.json`;
const CATEGORIES = ['flower', 'stove', 'stove-fire', 'counter', 'table', 'chair', 'door', 'flower-window', 'floor', 'wallpaper'];

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
  const slots = (game) => game.room(() => {
    const labels = [];
    const walk = (node) => { if (node.visible === false) return; if (node.label?.startsWith('store-item-') && node.label !== 'store-item-preview' && !['store-item-price', 'store-item-price-value', 'store-item-gold-icon', 'store-item-cash-icon', 'store-item-lock'].includes(node.label) && !node.label.startsWith('store-item-quantity')) labels.push(node.label.slice(11)); (node.children ?? []).forEach(walk); };
    walk(window.__coffeMania.app.stage.getChildByLabel('store-action-bar', true));
    return labels;
  });
  const locks = (game) => game.room(() => {
    let count = 0;
    const walk = (node) => { if (node.visible === false) return; if (node.label === 'store-item-lock') count++; (node.children ?? []).forEach(walk); };
    walk(window.__coffeMania.app.stage.getChildByLabel('store-action-bar', true));
    return count;
  });

  // 1. Nível 1: os fogões especiais aparecem com cadeado; o modal de nível lista os itens novos da loja.
  let game = await open();
  await game.room(() => window.__coffeMania.screens.active.celebrateLevel(6, 0));
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal?.isOpen, undefined, 10000);
  await sleep(700);
  const unlocked = await game.room(() => {
    const labels = [];
    const walk = (node) => { if (node.label?.startsWith('level-up-item-')) labels.push(node.label.slice(14)); (node.children ?? []).forEach(walk); };
    walk(window.__coffeMania.app.stage.getChildByLabel('level-up-modal', true));
    return labels;
  });
  const more = await game.texts('level-up-more');
  run.check((unlocked.length > 0 || more.includes('Na loja:')) && await game.center('level-up-shop') !== null, 'subir de nível mostra os itens novos da loja e o atalho "Ver loja"', { unlocked, more });
  await game.shot('1-nivel-com-itens');
  await game.click('level-up-continue');
  await sleep(500);
  await game.click('room-action-bar-icon-house');
  await game.waitFor(() => window.__coffeMania.screens.active.storeBar?.isOpen, undefined, 15000);
  await sleep(800);
  await game.click('store-category-stove-fire');
  await sleep(600);
  run.check((await slots(game)).length >= 2 && await locks(game) >= 2, 'os fogões especiais aparecem com cadeado no nível 1', { slots: await slots(game), locks: await locks(game) });
  await game.shot('2-fogoes-bloqueados');

  // 2. Dinheiro e nível para comprar: o save é editado com a página fechada.
  const levels = await game.room(() => window.__coffeMania.screens.active.rules.levels);
  await game.page.goto(idle);
  const saved = await game.room(async () => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); });
    db.close();
    return record;
  });
  const data = JSON.parse(saved.data);
  const state = data.collections.player_state[0].fields;
  Object.assign(state, { gold: 200000, cash: 60, level: 20, experience_current: levels[19].requiredXp, experience_max: levels[20].requiredXp });
  await game.room(async (record) => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    await new Promise((done, fail) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(record, 'main'); tx.oncomplete = done; tx.onerror = fail; });
    db.close();
    localStorage.removeItem('coffe-standalone-save');
  }, { ...saved, data: JSON.stringify(data) });
  await game.page.close();
  game = await open();
  const rich = await game.player();
  run.check(rich.gold === 200000 && rich.level === 20, 'o café volta com moedas e nível para a loja', rich);

  // 3. Todas as categorias têm itens; a aba Novidades também.
  await game.click('room-action-bar-icon-house');
  await game.waitFor(() => window.__coffeMania.screens.active.storeBar?.isOpen, undefined, 15000);
  await sleep(800);
  const counts = {};
  for (const category of CATEGORIES) {
    await game.click(`store-category-${category}`);
    await sleep(500);
    counts[category] = (await slots(game)).length;
    if (['flower', 'counter', 'flower-window', 'stove-fire'].includes(category)) await game.shot(`3-loja-${category}`);
  }
  run.check(CATEGORIES.every((category) => counts[category] > 0), 'todas as categorias da loja têm itens à venda', counts);
  run.check(counts.flower >= 6 && counts.table >= 5 && counts.chair >= 5 && counts.counter >= 4, 'decoração, mesas, cadeiras e balcões têm variedade', counts);
  run.check(await locks(game) === 0, 'no nível 20 nada fica bloqueado');
  await game.click('store-tab-news');
  await sleep(600);
  const news = await slots(game);
  run.check(news.length >= 4, 'a aba Novidades lista os itens recentes e em destaque', news);
  await game.shot('4-novidades');
  await game.click('store-tab-shop');
  await sleep(400);

  // 4. Comprar pelo mesmo caminho da loja (rota de compra), com moedas e com Grana.
  const buy = (classname, tx, ty, rotation = 0) => game.room(async ({ classname, tx, ty, rotation }) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const screen = window.__coffeMania.screens.active;
    const item = screen.roomSnapshot.catalog.find((entry) => entry.classname === classname);
    const room = await (await apiFetch('/api/coffe/room')).json();
    const response = await apiFetch('/api/coffe/room/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, tx, ty, rotation, revision: room.revision, requestId: crypto.randomUUID() }) });
    const body = await response.json();
    return { status: response.status, gold: body.playerState?.gold, cash: body.playerState?.cash, decor: body.decor?.bonusTenths, message: body.message };
  }, { classname, tx, ty, rotation });
  const before = await game.player();
  const purchases = {
    chef_statue: await buy('chef_statue', 6, 7),
    floor_lamp: await buy('floor_lamp', 1, 5),
    fern_pot: await buy('fern_pot', 2, 7),
    garden_fountain: await buy('garden_fountain', 1, 3),
    landscape_painting: await buy('landscape_painting', 0, 4, 0),
    wall_clock: await buy('wall_clock', 7, 0, 1),
    cash_register: await buy('cash_register', 5, 3),
    steel_stove: await buy('steel_stove', 5, 7),
    gold_cloth_table: await buy('gold_cloth_table', 4, 6),
    red_chair: await buy('red_chair', 5, 6),
    royal_tile_floor: await buy('royal_tile_floor', 3, 7),
    rose_wallpaper: await buy('rose_wallpaper', 0, 3, 0),
  };
  const failed = Object.entries(purchases).filter(([, result]) => result.status !== 200);
  run.check(failed.length === 0, 'as compras da loja passam (moedas e Grana)', failed);
  const after = await game.player();
  const fountain = purchases.garden_fountain;
  run.check(after.cash === before.cash - 15 - 4 && after.gold < before.gold, 'itens de Grana debitam Grana; os outros, moedas', { before, after });
  run.check(purchases.rose_wallpaper.decor > purchases.chef_statue.decor && fountain.decor > 0, 'cada peça decorativa soma ao bônus de decoração', purchases);
  await game.page.keyboard.press('Escape');
  await sleep(2500);

  // 5. Recarregar: a sala mostra a arte nova e a Popularidade detalha a decoração.
  await game.page.close({ runBeforeUnload: true });
  game = await open();
  await game.room(() => window.__coffeMania.screens.active.resetCamera?.());
  await sleep(2000);
  await game.shot('5-cafe-decorado');
  const decor = await game.room(() => window.__coffeMania.screens.active.roomSnapshot.decor);
  run.check(decor.bonusTenths > 0 && decor.lines.length >= 6, 'o snapshot traz o bônus de decoração item a item', decor);
  await game.click('room-action-bar-mood');
  await game.waitFor(() => window.__coffeMania.screens.active.popularityModal?.isOpen, undefined, 10000);
  await sleep(600);
  const popularity = await game.texts('popularity-modal');
  run.check(popularity.includes('Decoração: +') && popularity.includes('Estátua do Chef'), 'a Popularidade mostra a parte da decoração', popularity);
  await game.shot('6-popularidade-decoracao');
  await game.page.keyboard.press('Escape');
  await sleep(400);

  // 6. Caixa do dia, pelo botão da caixa registradora da loja.
  await game.click('room-action-bar-icon-house');
  await game.waitFor(() => window.__coffeMania.screens.active.storeBar?.isOpen, undefined, 15000);
  await sleep(600);
  await game.click('store-cash-register-icon');
  await game.waitFor(() => window.__coffeMania.screens.active.cashDayModal?.isOpen, undefined, 10000);
  await sleep(600);
  const cashDay = await game.texts('cash-day-modal');
  run.check(cashDay.includes('Caixa do dia') && cashDay.includes('Sua Caixa Registradora') && cashDay.includes('Moedas gastas'), 'a caixa registradora abre a Caixa do dia', cashDay);
  await game.shot('7-caixa-do-dia');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
