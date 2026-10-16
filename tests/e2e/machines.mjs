// Sprint 15b no modo standalone: energia viva no HUD, máquina de café (bebida com
// custo em energia, pronta na própria máquina), despensa com energéticos e peças,
// prateleira de temperos e jukebox montada com peças, ligada com energia.
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('machines');
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
    return (await apiFetch('/api/coffe/player-state')).json();
  });
  const buy = (game, classname, tx, ty) => game.room(async ({ classname, tx, ty }) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const room = await (await apiFetch('/api/coffe/room')).json();
    const item = room.catalog.find((entry) => entry.classname === classname);
    const response = await apiFetch('/api/coffe/room/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, tx, ty, rotation: 0, revision: room.revision, requestId: crypto.randomUUID() }) });
    const body = await response.json();
    return { status: response.status, message: body.message, unit: body.inventory?.find((unit) => unit.itemId === item.id && unit.placed) };
  }, { classname, tx, ty });

  // 1. Moedas, Grana, nível e peças: o save é editado com a página fechada.
  let game = await open();
  const levels = await game.room(() => window.__coffeMania.screens.active.rules.levels);
  await game.page.goto(idle);
  const saved = await game.room(async () => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const record = await new Promise((done) => { const request = db.transaction('saves').objectStore('saves').get('main'); request.onsuccess = () => done(request.result); });
    db.close();
    return record;
  });
  const data = JSON.parse(saved.data);
  Object.assign(data.collections.player_state[0].fields, { gold: 50000, cash: 30, level: 20, experience_current: levels[19].requiredXp, experience_max: levels[20].requiredXp, pantry: { 820001: 3, 810001: 1 } });
  await game.room(async (record) => {
    const db = await new Promise((done, fail) => { const request = indexedDB.open('coffe-mania', 1); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    await new Promise((done, fail) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(record, 'main'); tx.oncomplete = done; tx.onerror = fail; });
    db.close();
    localStorage.removeItem('coffe-standalone-save');
  }, { ...saved, data: JSON.stringify(data) });
  await game.page.close();
  game = await open();

  // 2. Máquina de café, jukebox e prateleira compradas pela rota da loja.
  const coffee = await buy(game, 'coffee_machine', 5, 3);
  const jukebox = await buy(game, 'jukebox', 1, 4);
  const shelf = await buy(game, 'spice_shelf', 1, 6);
  run.check([coffee, jukebox, shelf].every((result) => result.status === 200), 'máquina de café, jukebox e prateleira compradas', { coffee, jukebox, shelf });
  await game.page.close({ runBeforeUnload: true });
  game = await open();
  const hudBefore = await game.texts('room-top-bars');
  run.check(hudBefore.includes('50/50'), 'a barra de energia começa cheia (50/50)', hudBefore);

  // 3. Café expresso: o livro da máquina só tem bebidas; a bebida gasta energia.
  const machinePoint = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const [, views] = [...screen.stoveViews.entries()].find(([item]) => item.kind === 'machine');
    const bounds = views[0].getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.45 };
  });
  await game.page.mouse.click(machinePoint.x, machinePoint.y);
  await game.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 30000);
  await sleep(600);
  const cards = await game.room(() => window.__coffeMania.app.stage.getChildByLabel('cook-modal-window', true).children
    .flatMap((layer) => layer.children ?? []).filter((child) => child.label?.startsWith('cook-card-')).map((child) => child.label.slice(10)));
  run.check(cards.length > 0 && cards.every((id) => ['cafe_expresso', 'cappuccino', 'mocha_gelado'].includes(id)), 'o livro da máquina de café lista só cafés', cards);
  await game.shot('1-livro-cafe');
  await game.click('cook-card-cafe_expresso');
  await sleep(300);
  await game.click('cook-button');
  await game.waitFor(() => [...window.__coffeMania.screens.active.occupiedStoves.values()].some((job) => job.recipeId === 'cafe_expresso'), undefined, 40000);
  const brewing = await state(game);
  run.check(brewing.energy.current === 48, 'o café gastou 2 de energia', brewing.energy);
  await sleep(2000);
  const hudAfter = await game.texts('room-top-bars');
  run.check(hudAfter.includes('48/50'), 'o HUD mostra a energia gasta', hudAfter);
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active;
    const job = [...screen.occupiedStoves.values()].find((entry) => entry.recipeId === 'cafe_expresso');
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
  await sleep(800);
  await game.page.mouse.click(machinePoint.x, machinePoint.y);
  await game.waitFor(() => window.__coffeMania.screens.active.foods.some((food) => food.recipeId === 'cafe_expresso'), undefined, 30000);
  const onMachine = await game.room((unitId) => window.__coffeMania.screens.active.foods.find((food) => food.recipeId === 'cafe_expresso')?.counterId === unitId, coffee.unit.unitId);
  run.check(onMachine, 'o café pronto fica na própria máquina', coffee.unit.unitId);
  await sleep(1500);
  await game.room(() => window.__coffeMania.screens.active.resetCamera?.());
  await sleep(1500);
  await game.shot('2-cafe-na-maquina');

  // 4. Despensa: aba de energia e peças, energético usado, limite de temperos com a prateleira.
  await game.click('room-action-bar-icon-mortar');
  await game.waitFor(() => window.__coffeMania.screens.active.pantryModal?.isOpen, undefined, 15000);
  await sleep(600);
  const spicesTab = await game.texts('pantry-modal');
  run.check(spicesTab.includes('Guarda até 15 de cada (com a Prateleira de Temperos)'), 'com a prateleira a despensa guarda 15 de cada tempero', spicesTab);
  await game.click('pantry-tab-items');
  await sleep(500);
  await game.shot('3-despensa-energia');
  await game.click('pantry-use-810001');
  await game.waitFor(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    return (await (await apiFetch('/api/coffe/player-state')).json()).energy.current === 58;
  }, undefined, 15000);
  run.check(true, 'o Cafezinho Turbo devolveu 10 de energia (58)');
  await game.page.keyboard.press('Escape');
  await sleep(500);

  // 5. Jukebox: três peças montam o nível 1; ligada, gasta energia e mostra as notas.
  await game.room((unitId) => window.__coffeMania.screens.active.openMachine(unitId), jukebox.unit.unitId);
  await game.waitFor(() => window.__coffeMania.screens.active.machineModal?.isOpen, undefined, 15000);
  await sleep(600);
  await game.shot('4-jukebox-montagem');
  for (let i = 0; i < 3; i++) {
    await game.click('machine-install');
    await sleep(1500);
  }
  const built = await game.texts('machine-modal');
  run.check(built.includes('Nível 1 de 3'), 'três peças montaram a jukebox', built);
  await game.click('machine-start');
  await game.waitFor(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const body = await (await apiFetch('/api/coffe/machines')).json();
    return body.machines.some((machine) => machine.state === 'running');
  }, undefined, 15000);
  const after = await state(game);
  run.check(after.energy.current === 53 && after.pantry['820001'] === undefined, 'ligar gastou 5 de energia e as peças acabaram', { energy: after.energy, pantry: after.pantry });
  await game.shot('5-jukebox-ligada');
  await game.page.keyboard.press('Escape');
  await sleep(2500);
  const badge = await game.room(() => Boolean(window.__coffeMania.app.stage.getChildByLabel('machine-effects-running', true)));
  run.check(badge, 'a jukebox ligada mostra as notas musicais no salão');
  await game.shot('6-salao-com-jukebox');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
