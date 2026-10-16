// Sprint 16 no modo standalone: barra de vizinhos com as setas, mapa do bairro,
// presentes (abrir o de um vizinho NPC e enviar um), pote de gorjetas coletado,
// acelerar um prato com energia, Sálvia Salvadora num prato estragado e a visita
// ao café do Papa dos Pudins com as ajudas do dia (limpar mesa, temperar e animar
// um cliente) e a volta para casa.
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('sprint16');
const idle = `${site.url}/assets/items/catalog.json`;
const PAPA = 'npcneighbor0001';
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ');

try {
  const context = await run.browser.newContext({ viewport: { width: 1600, height: 900 } });
  const open = async (query = '') => {
    const game = await run.page({ context });
    await game.page.goto(`${site.url}/?screen=room${query}`);
    await game.connected();
    if (!query) await game.skipDaily();
    await sleep(1500);
    return game;
  };
  const api = (game, path, body) => game.room(async ({ path, body }) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { path, body });
  // The save is edited with the page closed (the worker would write over it).
  const editSave = async (game, change) => {
    await game.page.goto(idle);
    const saved = await game.room(async () => {
      const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
      const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); });
      db.close();
      return record;
    });
    const data = JSON.parse(saved.data);
    change(data.collections);
    await game.room(async (record) => {
      const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
      await new Promise((done, fail) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(record, 'main'); tx.oncomplete = done; tx.onerror = fail; });
      db.close();
      localStorage.removeItem('coffe-standalone-save');
    }, { ...saved, data: JSON.stringify(data) });
    await game.page.close();
  };
  const owner = (collections, name) => collections[name].find((row) => row.fields.user === collections.player_state[0].fields.user) ?? collections[name][0];

  // 1. Barra de vizinhos: os NPCs do nível 1 (o Papa dos Pudins, sem a Tia Cotinha do nível 69) e as setas.
  let game = await open();
  const bar = await game.texts('room-action-bar-neighbors');
  run.check(bar.includes('Papa dos Pudins') && !bar.includes('Tia Cotinha') && bar.includes('Ajudar: 3'), 'a barra mostra os vizinhos NPC do nível com as ajudas do dia', bar);
  const pages = await game.room(() => window.__coffeMania.screens.active.neighborBar.pageCount);
  await game.click('room-action-bar-right-arrow');
  await game.click('room-action-bar-right-edge-arrow');
  const page = await game.room(() => window.__coffeMania.screens.active.neighborBar.page);
  run.check(page === pages - 1, 'as setas paginam até a última página', { page, pages });
  await game.click('room-action-bar-left-edge-arrow');
  await game.shot('1-vizinhos');

  // 2. Mapa: meu café, Fazenda, Discoteca e os cafés vizinhos; a Fazenda abre a janela dela.
  await game.click('room-action-bar-icon-map');
  await game.waitFor(() => window.__coffeMania.screens.active.mapModal?.isOpen, undefined, 15000);
  await sleep(600);
  const map = await game.texts('map-modal');
  run.check(['Meu café', 'Fazenda', 'Discoteca', 'Doceria do Papa'].every((text) => map.includes(text)), 'o mapa mostra a rua e os cafés vizinhos', map);
  await game.shot('2-mapa');
  await game.click('map-farm');
  const farm = await game.waitFor(() => window.__coffeMania.screens.active.streetModal?.isOpen, undefined, 15000).then(() => true, () => false);
  run.check(farm, 'o atalho da Fazenda abre a janela dela');
  await game.click('street-modal-close');
  await sleep(400);

  // 3. Presentes: abrir o do Papa dos Pudins e enviar um de volta.
  const beforeGift = await game.player();
  await game.click('room-action-bar-icon-gift');
  await game.waitFor(() => window.__coffeMania.screens.active.giftsModal?.isOpen, undefined, 15000);
  await sleep(600);
  const giftList = await game.texts('gifts-modal');
  run.check(giftList.includes('Papa dos Pudins mandou'), 'o vizinho NPC mandou o presente do dia', giftList);
  const gift = await game.room((papa) => window.__coffeMania.screens.active.giftsModal.gifts.received.find((entry) => entry.from === papa), PAPA);
  await game.shot('3-presentes');
  await game.click(`gift-open-${gift.id}`);
  await game.waitFor(() => window.__coffeMania.screens.active.giftsModal.message.startsWith('Você abriu'), undefined, 15000);
  const afterGift = await game.player();
  run.check(afterGift.xp - beforeGift.xp === 3 && afterGift.gold - beforeGift.gold === (gift.item.coins ?? 0), 'abrir o presente dá o item e 3 XP', { gift: gift.item, beforeGift, afterGift });
  await game.click('gifts-tab-send');
  await sleep(500);
  await game.click(`gift-send-${PAPA}`);
  await game.waitFor(() => window.__coffeMania.screens.active.giftsModal.message.startsWith('Presente enviado'), undefined, 15000);
  await sleep(500);
  const sent = await game.texts('gifts-modal');
  run.check(sent.includes('Enviado ✓') && sent.includes('Enviados hoje: 1/5'), 'o presente enviado aparece como enviado e conta no limite', sent);
  await game.shot('4-presente-enviado');
  await game.click('gifts-close');
  await sleep(400);

  // 4. Pote de gorjetas cheio, energia, moedas e uma Sálvia na despensa.
  await editSave(game, (collections) => {
    Object.assign(collections.player_state[0].fields, { gold: 5000, energy_current: 50, energy_at: stamp(Date.now()), pantry: { 800003: 1 } });
    owner(collections, 'player_rooms').fields.tip_jar = 80;
  });
  game = await open();
  const jar = await game.texts('tip-jar');
  run.check(jar.includes('80'), 'o pote de gorjetas mostra as 80 moedas guardadas', jar);
  const beforeJar = await game.player();
  await game.click('tip-jar');
  await game.waitFor(() => (window.__coffeMania.screens.active.roomSnapshot?.tipJar?.coins ?? 0) === 0, undefined, 15000).catch(() => {});
  await sleep(800);
  const afterJar = await game.player();
  run.check(afterJar.gold - beforeJar.gold === 80, 'tocar o pote coleta as gorjetas', { beforeJar: beforeJar.gold, afterJar: afterJar.gold });
  await game.shot('5-pote');

  // 5. Acelerar: metade do tempo que falta sai do fogo por energia.
  const recipe = await game.room(() => {
    const recipes = window.__coffeMania.screens.active.rules.recipes.filter((entry) => entry.level <= 1);
    return recipes.sort((a, b) => b.cookSeconds - a.cookSeconds)[0];
  });
  await game.cook(recipe.id);
  await sleep(3500);
  const readyBefore = await game.room(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0].readyAt);
  const energyBefore = (await api(game, '/api/coffe/player-state')).body.energy;
  const stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('stove-action-boost', true)?.visible, undefined, 15000);
  const menu = await game.texts('stove-action-menu');
  await game.click('stove-action-boost');
  await game.waitFor((before) => [...window.__coffeMania.screens.active.occupiedStoves.values()][0].readyAt !== before, readyBefore, 15000);
  const readyAfter = await game.room(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0].readyAt);
  const energyAfter = (await api(game, '/api/coffe/player-state')).body.energy;
  run.check(Date.parse(readyAfter) < Date.parse(readyBefore) && /Acelerar \(\d+ de energia\)/.test(menu), 'acelerar adianta o prato', { menu, readyBefore, readyAfter });
  run.check(JSON.stringify(energyAfter) !== JSON.stringify(energyBefore), 'acelerar gasta energia', { energyBefore, energyAfter });
  await game.shot('6-acelerado');

  // 6. Sálvia Salvadora: o prato estragado volta a ficar pronto.
  await editSave(game, (collections) => {
    const job = collections.stove_cooking.at(-1).fields;
    Object.assign(job, { ready_at: stamp(Date.now() - 20 * 60_000), spoils_at: stamp(Date.now() - 10 * 60_000) });
  });
  game = await open();
  const spoiled = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const job = [...screen.occupiedStoves.values()][0];
    return job && Date.parse(job.spoilsAt) < screen.serverNow();
  });
  run.check(spoiled, 'o prato está estragado depois do save editado');
  const point = await game.stovePoint();
  await game.page.mouse.click(point.x, point.y);
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('stove-action-rescue-800003', true)?.visible, undefined, 15000);
  await game.shot('7-salvia-menu');
  await game.click('stove-action-rescue-800003');
  await game.waitFor(() => {
    const screen = window.__coffeMania.screens.active;
    const job = [...screen.occupiedStoves.values()][0];
    return job && Date.parse(job.spoilsAt) > screen.serverNow();
  }, undefined, 15000);
  const left = (await api(game, '/api/coffe/player-state')).body.pantry?.['800003'] ?? 0;
  run.check(left === 0, 'a Sálvia sai da despensa e o prato volta a ficar pronto', { left });
  await game.shot('8-salvia');

  // 7. Visita ao Papa dos Pudins pela barra: voltar, limpar mesa, temperar e animar.
  await game.click(`room-action-bar-neighbor-${PAPA}`);
  await game.page.waitForURL((url) => url.searchParams.get('room') === PAPA, { timeout: 30000 });
  await game.connected();
  await sleep(2500);
  const visit = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    return { canEdit: screen.roomSnapshot?.canEdit, dirt: screen.dirt.length, home: Boolean(window.__coffeMania.app.stage.getChildByLabel('room-home-button', true)?.visible) };
  });
  run.check(visit.canEdit === false && visit.home && visit.dirt > 0, 'o café do vizinho abre como visita, com mesas sujas e o botão de voltar', visit);
  await game.shot('9-visita');
  // The balance is read before the tap: a fast answer must not be counted in it.
  const helpGold = async (action, tap, timeout = 60000) => {
    const before = (await game.player()).gold;
    await tap();
    await game.waitFor((before) => window.__coffeMania.screens.active.roomSnapshot?.playerState?.gold > before, before, timeout);
    const toast = await game.toast();
    run.check(/Ajuda ao vizinho!/.test(toast ?? '') && /\+20 moedas/.test(toast ?? ''), `${action} paga a ajuda do dia`, toast);
  };
  // A dirty table nobody is eating at (a plate view under a meal stays hidden).
  const dirtPoint = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const eating = new Set([...screen.realtime.actors.values()].filter((actor) => actor.food).map((actor) => actor.tableId));
    const [, view] = [...screen.tableDirt.entries()].find(([id, entry]) => !eating.has(id) && !entry.vanishing && screen.dirt.some((dirt) => dirt.tableId === id));
    const bounds = view.view.getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await helpGold('limpar a mesa do vizinho', () => game.page.mouse.click(dirtPoint.x, dirtPoint.y));
  await game.shot('10-mesa-limpa');
  await sleep(2500);
  const neighborStove = await game.stovePoint();
  await game.page.mouse.click(neighborStove.x, neighborStove.y);
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('stove-action-season', true)?.visible, undefined, 15000);
  await helpGold('temperar o prato do vizinho', () => game.click('stove-action-season'));
  // A customer waiting at a table: tapping the patience balloon cheers them up.
  const waiting = await game.waitFor(() => {
    const screen = window.__coffeMania.screens.active;
    return [...screen.patienceMeters.keys()].find((id) => screen.realtime.actors.get(id)?.patience && screen.realtime.actors.get(id)?.state === 'seated') ?? false;
  }, undefined, 180000).then(() => true, () => false);
  if (waiting) {
    const meter = await game.room(() => {
      const screen = window.__coffeMania.screens.active;
      const [, view] = [...screen.patienceMeters.entries()].find(([id]) => screen.realtime.actors.get(id)?.state === 'seated');
      const bounds = view.view.getBounds();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await helpGold('animar o cliente do vizinho', () => game.page.mouse.click(meter.x, meter.y), 20000);
    await game.shot('11-animado');
  } else {
    run.log('aviso', 'nenhum cliente sentou no café do vizinho em 3 min; animar não foi conferido');
  }
  const barAfter = await game.texts('room-action-bar-neighbors');
  run.check(barAfter.includes(waiting ? 'Ajudado hoje' : 'Ajudar: 1'), 'a barra acompanha as ajudas restantes', barAfter);
  await game.click('room-home-button');
  await game.page.waitForURL((url) => !url.searchParams.has('room'), { timeout: 30000 });
  await game.connected();
  run.check(await game.room(() => window.__coffeMania.screens.active.roomSnapshot?.canEdit !== false), '"Voltar ao meu café" leva de volta ao próprio café');
  await game.shot('12-de-volta');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
