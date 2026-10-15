// Sprint 5 no modo servidor: cada refeição paga deixa um prato na mesa (registro em
// room_dirt na mesma transação do pagamento, evento `dirt` e pratos desenhados só
// depois que o cliente termina de comer, com moscas a partir de 20 s), mesa suja
// não recebe cliente nem pode ser guardada, sem mesa limpa os clientes saem bravos
// só fora da cozinha parada, e a limpeza pelo dono: o servidor exige o avatar ao
// lado da mesa, a pose CLEAN dura tables.cleaningSeconds, os pratos ficam até o fim
// da escova e somem com brilho e som de vassoura, e a mesa limpa volta a receber
// clientes.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('dirt');

try {
  const game = await run.page();
  await login(game, stack.web);
  await game.skipDaily();
  const [owner] = await stack.admin.list('player_state');
  const popularity = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0].satisfaction_current_tenths;
  const plates = (table) => stack.admin.list('room_dirt', `user = "${owner.user}"${table ? ` && table_id = "${table}"` : ''}`);
  const rules = await game.room(() => {
    const { tables, popularity, recipes } = window.__coffeMania.screens.active.rules;
    return { tables, popularity, recipe: recipes.find((recipe) => recipe.id === 'pao_de_queijo') };
  });

  // Gravador: espelho do `dirt`, pagamentos com a mesa de quem pagou, reservas de
  // cadeira, emoções dos clientes, sons e, a cada quadro (depois da tela), os pratos,
  // a lotação e o clipe do avatar durante a limpeza.
  await game.room(async () => {
    const { CLIP } = await import('/src/avatar/clips.ts');
    const screen = window.__coffeMania.screens.active;
    const rec = window.__dirt = {
      clean: CLIP.CLEAN, dirt: [...screen.dirt], payments: [], reservations: [], seen: {}, emotions: {}, sounds: [],
      cleaning: [], shownWhileEating: [], watchCapacity: false, maxActive: 0, target: null, samples: [],
    };
    screen.realtime.onEvent((event) => {
      if (event.type === 'dirt') rec.dirt = event.dirt ?? [];
      if (event.type === 'payment') rec.payments.push({ ...event.payment, tableId: screen.realtime.actors.get(event.payment.actorId)?.tableId, at: event.serverNow });
      // Updates leave out the identity (kind, name); the merged state keeps it.
      for (const actor of (event.actors ?? []).map((state) => screen.realtime.actors.get(state.id) ?? state)) {
        if (actor.id === screen.realtime.selfId && actor.state === 'cleaning') rec.cleaning.push({ tx: actor.tx, ty: actor.ty, action: actor.action, at: event.serverNow });
        if (actor.kind !== 'npc') continue;
        if (actor.tableId && rec.seen[actor.id] !== actor.tableId) {
          rec.reservations.push({ id: actor.id, tableId: actor.tableId, dirty: rec.dirt.some((dirt) => dirt.tableId === actor.tableId), at: event.serverNow });
        }
        rec.seen[actor.id] = actor.tableId;
        if (actor.emotion && !rec.emotions[actor.id]) rec.emotions[actor.id] = { kind: actor.emotion.kind, browsing: actor.browsing === true, at: event.serverNow };
      }
    });
    const play = screen.audio.play.bind(screen.audio);
    screen.audio.play = (name, volume) => { rec.sounds.push({ name, at: screen.realtime.serverNowMs() }); play(name, volume); };
    window.__coffeMania.app.ticker.add(() => {
      const now = screen.realtime.serverNowMs();
      const actors = [...screen.realtime.actors.values()];
      for (const actor of actors) {
        const view = actor.food && actor.tableId && screen.tableDirt.get(actor.tableId);
        if (view && !view.vanishing) rec.shownWhileEating.push({ tableId: actor.tableId, now });
      }
      if (rec.watchCapacity) rec.maxActive = Math.max(rec.maxActive, actors.filter((actor) => actor.kind === 'npc' && actor.state !== 'leaving').length);
      if (rec.target && rec.samples.length < 3000) {
        const view = screen.tableDirt.get(rec.target);
        const self = screen.realtime.actors.get(screen.realtime.selfId);
        rec.samples.push({ now, state: self?.state, clip: screen.playerView.currentClip, inDirt: screen.dirt.some((dirt) => dirt.tableId === rec.target), view: view ? (view.vanishing ? 'vanishing' : 'present') : 'absent' });
      }
    }, undefined, -50);
  });
  const tables = await game.room(() => window.__coffeMania.screens.active.model.items.filter((item) => item.kind === 'table').map((item) => item.inventoryUnitId));
  run.log('mesas no café', tables.length);

  // 1. O café novo começa com as mesas limpas.
  run.check((await game.room(() => window.__dirt.dirt.length)) === 0 && (await plates()).length === 0, 'o café novo começa sem pratos sujos');

  // 2. Cozinhar e servir: a primeira refeição paga deixa um prato na mesa dela.
  await game.cook('pao_de_queijo');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
  await sleep(500);
  let stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
  await game.waitFor(() => window.__dirt.payments.length > 0, undefined, 240000);
  const first = await game.room(() => ({ payment: window.__dirt.payments[0], dirt: window.__dirt.dirt }));
  const firstDirt = first.dirt.find((dirt) => dirt.tableId === first.payment.tableId);
  run.check(Boolean(first.payment.tableId) && firstDirt?.plates === 1, 'o pagamento chega com o evento dirt de 1 prato na mesa do cliente', first);
  const firstRows = await plates(first.payment.tableId);
  run.check(firstRows.length === 1, 'o banco grava o prato em room_dirt junto com o pagamento', firstRows.map((row) => ({ table: row.table_id, created: row.created })));
  await sleep(1500);
  const eating = await game.room((table) => {
    const screen = window.__coffeMania.screens.active;
    const eater = [...screen.realtime.actors.values()].find((actor) => actor.food && actor.tableId === table);
    const view = screen.tableDirt.get(table);
    return { eating: Boolean(eater), plates: view ? (view.vanishing ? 'vanishing' : 'present') : 'absent' };
  }, first.payment.tableId);
  run.check(eating.eating && eating.plates !== 'present', 'enquanto o cliente come, o prato sujo não aparece', eating);
  await game.shot('1-cliente-comendo');

  // O cliente termina e os pratos aparecem na mesa, ainda sem moscas.
  await game.waitFor((table) => { const view = window.__coffeMania.screens.active.tableDirt.get(table); return view && !view.vanishing; }, first.payment.tableId, 60000);
  await sleep(300);
  const shown = await game.room((table) => {
    const screen = window.__coffeMania.screens.active;
    const view = screen.tableDirt.get(table);
    const dirt = screen.dirt.find((item) => item.tableId === table);
    return { plates: view.plates.filter((plate) => plate.visible).length, flies: view.flies.getLocalBounds().width, dirtyForMs: screen.realtime.serverNowMs() - dirt.since };
  }, first.payment.tableId);
  run.check(shown.plates === 1 && (shown.dirtyForMs >= 20000 || shown.flies === 0), 'a mesa mostra 1 prato sujo, sem moscas antes de 20 s', shown);
  await game.shot('2-prato-sujo');

  // 3. Mesa suja não recebe cliente: as porções seguintes vão para as outras mesas.
  await game.waitFor((count) => window.__dirt.dirt.length === count, tables.length, 240000);
  const full = await game.room(() => ({ payments: window.__dirt.payments.map((payment) => payment.tableId), reservations: window.__dirt.reservations, dirt: window.__dirt.dirt }));
  const served = full.payments.slice(0, tables.length);
  run.check(new Set(served).size === tables.length, `as ${tables.length} primeiras refeições sujam ${tables.length} mesas diferentes`, served);
  run.check(full.reservations.length > 0 && full.reservations.every((reservation) => !reservation.dirty), 'nenhum cliente reserva cadeira de mesa suja', full.reservations);
  const allRows = await plates();
  run.check(allRows.length === full.payments.length && full.dirt.every((dirt) => dirt.plates === allRows.filter((row) => row.table_id === dirt.tableId).length),
    'room_dirt tem um prato por refeição paga, agrupados por mesa no evento', { rows: allRows.length, payments: full.payments.length, dirt: full.dirt });
  const lastPaymentAt = await game.room(() => window.__dirt.payments.at(-1).at);

  // Moscas: a primeira mesa passa de 20 s suja.
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; return !screen.dirt.length ? false
    : screen.realtime.serverNowMs() >= Math.min(...screen.dirt.map((dirt) => dirt.since)) + 21000; }, undefined, 60000);
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active;
    return ![...screen.realtime.actors.values()].some((actor) => actor.food) && screen.tableDirt.size === screen.dirt.length; }, undefined, 60000);
  await sleep(400);
  const flies = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const oldest = screen.dirt.reduce((a, b) => (a.since <= b.since ? a : b));
    return { table: oldest.tableId, width: screen.tableDirt.get(oldest.tableId)?.flies.getLocalBounds().width ?? 0 };
  });
  run.check(flies.width > 0, 'depois de 20 s a mesa suja ganha moscas', flies);
  await game.shot('3-todas-as-mesas-sujas');

  // 4. Cozinha parada e todas as mesas sujas: quem entra só olha e sai sem reclamar.
  await game.room(() => { window.__dirt.watchCapacity = true; window.__dirt.maxActive = 0; });
  const idlePopularity = await popularity();
  await game.waitFor((after) => Object.values(window.__dirt.emotions).some((emotion) => emotion.at > after && emotion.kind !== 'satisfied'), lastPaymentAt, 120000);
  await sleep(1500);
  const idleExits = await game.room((after) => Object.values(window.__dirt.emotions).filter((emotion) => emotion.at > after && emotion.kind !== 'satisfied'), lastPaymentAt);
  const idleNow = await popularity();
  run.log('saídas com a cozinha parada', idleExits.map((emotion) => emotion.kind));
  run.check(idleExits.every((emotion) => emotion.kind === 'neutral') && idleNow === idlePopularity, 'com a cozinha parada quem sai sem mesa mostra a cara neutra e a popularidade não cai', { idleExits, idlePopularity, idleNow });

  // 5. Mesa suja não pode ser guardada, e limpar de longe é recusado pelo servidor.
  const target = await game.room(async () => {
    const { footprintTiles } = await import('/src/world/RoomModel.ts');
    const screen = window.__coffeMania.screens.active;
    const self = screen.realtime.actors.get(screen.realtime.selfId);
    const distance = (table) => Math.min(...footprintTiles(table).map((tile) => Math.abs(tile.tx - self.tx) + Math.abs(tile.ty - self.ty)));
    const dirty = screen.model.items.filter((item) => item.kind === 'table' && screen.dirt.some((dirt) => dirt.tableId === item.inventoryUnitId));
    const table = dirty.reduce((a, b) => (distance(a) >= distance(b) ? a : b));
    return { id: table.inventoryUnitId, tx: table.tx, ty: table.ty, distance: distance(table) };
  });
  run.log('mesa escolhida', target);
  const refusals = await game.room(async (table) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const screen = window.__coffeMania.screens.active;
    const post = async (path, body) => {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, message: (await response.json()).message };
    };
    return {
      store: await post('/api/coffe/room/store', { unitId: table, revision: screen.roomSnapshot.revision, requestId: crypto.randomUUID() }),
      clean: await post('/api/coffe/room/tables/clean', { tableId: table }),
    };
  }, target.id);
  run.check(refusals.store.status === 409 && refusals.store.message === 'Limpe a mesa antes de movê-la.', 'guardar a mesa suja é recusado', refusals.store);
  run.check(target.distance > 1 && refusals.clean.status === 409 && refusals.clean.message === 'Aproxime seu personagem da mesa.', 'limpar a mesa de longe é recusado pelo servidor', { distance: target.distance, ...refusals.clean });
  const [unit] = await stack.admin.list('player_inventory', `id = "${target.id}"`);
  run.check(unit.placed === true && (await plates(target.id)).length > 0, 'a mesa continua no lugar e com os pratos', { placed: unit.placed });

  // 6. Com prato no fogo e nenhuma mesa limpa, o cliente entra, não acha mesa e sai bravo.
  await game.cook('pao_de_queijo');
  const cookAt = await game.room(() => window.__coffeMania.screens.active.realtime.serverNowMs());
  const step = Math.round(rules.popularity.unsatisfiedDelta * 10);
  await game.waitFor((after) => Object.values(window.__dirt.emotions).some((emotion) => emotion.at > after && emotion.kind === 'dissatisfied' && !emotion.browsing), cookAt, 120000);
  await game.shot('4-cliente-bravo');
  let complaint;
  for (let attempt = 0; attempt < 30; attempt++) {
    const angry = await game.room((after) => Object.values(window.__dirt.emotions).filter((emotion) => emotion.at > after && emotion.kind === 'dissatisfied' && !emotion.browsing).length, cookAt);
    complaint = { angry, before: idleNow, after: await popularity() };
    if (complaint.after === idleNow - step * angry) break;
    await sleep(500);
  }
  run.check(complaint.angry > 0 && complaint.after === idleNow - step * complaint.angry, `cada cliente bravo tira ${rules.popularity.unsatisfiedDelta} de popularidade`, complaint);
  run.log('reclamações', complaint);
  const capacity = await game.room(() => window.__dirt.maxActive);
  run.check(capacity === 1, 'sem cadeira limpa livre entra um cliente por vez', capacity);

  // 7. Limpar: o dono toca na mesa, o avatar vai até o lado dela e escova.
  const before = await game.player();
  await game.room((table) => { window.__dirt.target = table; window.__dirt.watchCapacity = false; }, target.id);
  const point = await game.room((table) => { const bounds = window.__coffeMania.screens.active.tableDirt.get(table).view.getBounds(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; }, target.id);
  await game.page.mouse.click(point.x, point.y);
  run.log('toque na mesa suja', target.id);
  await game.waitFor(() => window.__dirt.cleaning.length > 0, undefined, 60000);
  await sleep(700);
  await game.shot('5-limpando');
  await game.waitFor((table) => !window.__dirt.dirt.some((dirt) => dirt.tableId === table), target.id, 15000);
  await game.waitFor((table) => !window.__coffeMania.screens.active.tableDirt.has(table), target.id, 20000);
  const cleaning = await game.room(async (table) => {
    const { footprintTiles } = await import('/src/world/RoomModel.ts');
    const screen = window.__coffeMania.screens.active;
    const item = screen.model.items.find((unit) => unit.inventoryUnitId === table);
    const [pose] = window.__dirt.cleaning;
    return { pose, beside: footprintTiles(item).some((tile) => Math.abs(tile.tx - pose.tx) + Math.abs(tile.ty - pose.ty) === 1), samples: window.__dirt.samples, clean: window.__dirt.clean, sounds: window.__dirt.sounds };
  }, target.id);
  const { pose, samples } = cleaning;
  const end = pose.action.startedAt + pose.action.duration;
  run.check(pose.action.kind === 'cleaning' && pose.action.duration === rules.tables.cleaningSeconds * 1000, `a limpeza dura ${rules.tables.cleaningSeconds} s`, pose.action);
  run.check(cleaning.beside, 'o avatar limpa ao lado da mesa', { pose: { tx: pose.tx, ty: pose.ty }, table: target });
  const brushing = samples.filter((sample) => sample.state === 'cleaning');
  run.check(brushing.length > 0 && brushing.filter((sample) => sample.clip !== cleaning.clean).length <= 1, 'o avatar faz o clipe CLEAN durante a limpeza',
    { frames: brushing.length, clips: [...new Set(brushing.map((sample) => sample.clip))] });
  const cleared = samples.filter((sample) => !sample.inDirt);
  run.check(cleared.some((sample) => sample.now < end && sample.view === 'present') && !cleared.some((sample) => sample.now < end - 150 && sample.view !== 'present'),
    'os pratos ficam na mesa até o fim da escova', cleared.filter((sample) => sample.now < end).map((sample) => sample.view));
  run.check(cleared.some((sample) => sample.now >= end && sample.view === 'vanishing'), 'depois da escova os pratos somem com brilho', cleared.slice(-8));
  run.check(cleaning.sounds.some((sound) => sound.name === 'broom' && sound.at >= pose.at - 1000), 'a limpeza toca a vassoura', cleaning.sounds);
  const after = await game.player();
  run.check(after.xp - before.xp === rules.tables.cleaningXp, `limpar a mesa dá ${rules.tables.cleaningXp} XP`, { before: before.xp, after: after.xp });
  const left = await plates();
  run.check((await plates(target.id)).length === 0 && left.length === allRows.length - allRows.filter((row) => row.table_id === target.id).length, 'o banco apaga só os pratos da mesa limpa', left.map((row) => row.table_id));
  await game.shot('6-mesa-limpa');

  // 8. A mesa limpa volta a receber clientes: servir e esperar o pagamento nela.
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 60000);
  await sleep(500);
  stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
  const paidBefore = full.payments.length;
  await game.waitFor(({ table, count }) => window.__dirt.payments.slice(count).some((payment) => payment.tableId === table), { table: target.id, count: paidBefore }, 120000);
  const again = await game.room((count) => window.__dirt.payments.slice(count), paidBefore);
  run.check(again.every((payment) => payment.tableId === target.id), 'só a mesa limpa recebe o cliente seguinte', again.map((payment) => payment.tableId));
  run.check((await plates(target.id)).length === 1, 'a nova refeição deixa um prato novo na mesa limpa');
  const reservations = await game.room(() => window.__dirt.reservations);
  run.check(reservations.every((reservation) => !reservation.dirty), 'em todo o roteiro nenhum cliente reservou mesa suja', reservations.filter((reservation) => reservation.dirty));
  const flashes = await game.room(() => window.__dirt.shownWhileEating);
  run.check(flashes.length === 0, 'os pratos sujos nunca aparecem sob quem está comendo', flashes.slice(0, 5));
  await game.shot('7-cliente-na-mesa-limpa');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 antes do login e os 409 deliberados (guardar a mesa suja e limpar de longe).
  await run.finish({ allow: [/status of 40[19]/] });
  await stack.stop();
}
