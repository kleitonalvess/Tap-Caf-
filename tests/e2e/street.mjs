// Rua viva e expediente offline (Sprint 9) no modo servidor com banco novo:
// prédios da rua com o cartão (nome e contagem) e o "!" amarelo enquanto há algo
// a colher ou iniciar; Fazenda que colhe uma carga de ingredientes frescos
// (instante e carga no banco, rua transmitida ao quarto; colher na espera ou com
// a carga guardada → 409), livro com "Ingredientes frescos: +20%", preparo que
// consome a carga, folha verde no balcão e cada porção fresca pagando o bônus
// ("+N fresco"); Discoteca com a Festa do Bairro (início no banco, janela de
// 5 min e espera de 30 min depois do fim, transmitida ao quarto, luzes, selo com
// a contagem, trilha própria, festa repetida → 409), quem se serve sozinho dá a
// gorjeta básica e o garçom dá a gorjeta em dobro; ausência de 1 h com garçom
// contada ao acordar o quarto (porções, gorjetas, frescos, XP, popularidade,
// pratos recolhidos, clientes salvos que vão embora, colheita e festa pelos
// instantes), "Bem-vindo de volta!" antes do bônus diário, resumo guardado até
// o Coletar e somado a uma segunda ausência numa janela só.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('street');
const HOUR = 3600_000;
const COUNTER_ITEM = 3080000;
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ');
const instant = (value) => (value ? Date.parse(value.replace(' ', 'T')) : 0);
// "4:05" → 245 s (the countdowns checked here stay under an hour).
const seconds = (text) => { const match = /(\d+):(\d\d)$/.exec(text ?? ''); return match ? Number(match[1]) * 60 + Number(match[2]) : NaN; };

try {
  // Each visit is a new browser context. The recorder keeps the payments, the
  // street the room broadcasts (world events) and the rewards that float.
  const open = async (label) => {
    const game = await run.page();
    await login(game, stack.web);
    await game.page.exposeFunction('__streetShot', async (name) => { await sleep(300); await game.shot(name); });
    await game.room(() => {
      const screen = window.__coffeMania.screens.active;
      const rec = window.__street = { payments: [], worlds: [], floats: [], shots: {}, waiter: false };
      const shoot = (name) => { if (!rec.shots[name]) { rec.shots[name] = true; void window.__streetShot(name); } };
      screen.realtime.onEvent((event) => {
        if (event.type === 'payment') {
          rec.payments.push({ ...event.payment, at: event.serverNow });
          if (event.payment.freshCoins > 0) shoot('10-pagamento-fresco-na-festa');
          if (rec.waiter && event.payment.tip > 0) shoot('11-gorjeta-do-garcom-na-festa');
        }
        if (event.type === 'world' && event.street) rec.worlds.push({ ...event.street, at: event.serverNow });
      });
      const rewards = screen.floatingRewards;
      const spawn = rewards.spawn.bind(rewards);
      rewards.spawn = (...args) => {
        const count = rewards.active.length;
        spawn(...args);
        const view = rewards.active.length > count ? rewards.active.at(-1).view : null;
        rec.floats.push({ coins: args[3], xp: args[4], tip: args[5] ?? 0, fresh: args[6] ?? 0,
          rows: view ? view.children.map((row) => row.children.find((child) => child.text !== undefined)?.text ?? '') : [] });
      };
    });
    run.log('café aberto:', label);
    return game;
  };
  // A building's card, its "!" (ready: something to collect or start) and the street the screen holds.
  const building = (game, id) => game.room((id) => {
    const screen = window.__coffeMania.screens.active;
    const entry = screen.streetScenery.buildings.find((candidate) => candidate.def.id === id);
    return { title: entry.title.text, caption: entry.caption.text, card: entry.label.visible, badge: entry.badge.visible, ready: entry.ready, street: { ...screen.street }, now: screen.serverNow() };
  }, id);
  // The "!" is decided before the card in each frame, so it hides one frame after the card shows.
  const cardShown = async (game, id, prefix) => {
    await game.waitFor(([id, prefix]) => {
      const entry = window.__coffeMania.screens.active.streetScenery.buildings.find((candidate) => candidate.def.id === id);
      return entry.label.visible && entry.caption.text.startsWith(prefix);
    }, [id, prefix], 20000);
    await sleep(1000);
  };
  // Centers the camera on a building; returns a page point inside its silhouette.
  const focus = async (game, id) => {
    const centroid = (view) => {
      const points = view.hitArea.points;
      let x = 0; let y = 0;
      for (let i = 0; i < points.length; i += 2) { x += points[i]; y += points[i + 1]; }
      return { x: x / (points.length / 2), y: y / (points.length / 2) };
    };
    await game.room(([id, source]) => {
      const screen = window.__coffeMania.screens.active;
      const view = window.__coffeMania.app.stage.getChildByLabel(`street-building:${id}`, true);
      const global = view.toGlobal(new Function(`return ${source}`)()(view));
      screen.camera.centerOn(screen.cameraLayer.toLocal(global));
      screen.applyCamera();
    }, [id, centroid.toString()]);
    await sleep(1200);
    return game.room(([id, source]) => {
      const view = window.__coffeMania.app.stage.getChildByLabel(`street-building:${id}`, true);
      const point = view.toGlobal(new Function(`return ${source}`)()(view));
      return { x: point.x, y: point.y };
    }, [id, centroid.toString()]);
  };
  // Leaves the building and comes back, so the card shows on hover again.
  const hover = async (game, point) => {
    await game.page.mouse.move(point.x + 420, point.y + 320);
    await sleep(400);
    await game.page.mouse.move(point.x, point.y);
  };
  const post = (game, path) => game.room(async (path) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: response.status, message: (await response.json()).message };
  }, path);
  const tapStove = async (game) => {
    const point = await game.stovePoint();
    await game.page.mouse.click(point.x, point.y);
  };
  const openBook = async (game, recipeId) => {
    await tapStove(game);
    await game.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 30000);
    await sleep(600);
    await game.click(`cook-card-${recipeId}`);
    await sleep(500);
    return game.texts('cook-details');
  };
  const cookNow = async (game) => {
    await game.click('cook-button');
    await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size > 0, undefined, 40000);
  };
  const serveWhenReady = async (game) => {
    await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
      return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
    await sleep(500);
    await tapStove(game);
    await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
    run.log('prato servido no balcão');
  };
  const dismissLevelUp = async (game) => {
    if (!await game.room(() => window.__coffeMania.screens.active.levelUpModal?.isOpen)) return;
    await sleep(600);
    await game.click('level-up-continue');
    await game.waitFor(() => !window.__coffeMania.screens.active.levelUpModal.isOpen, undefined, 10000);
    await sleep(400);
  };
  const recorded = (game) => game.room(() => window.__street);

  let game = await open('primeira visita');
  await game.skipDaily();
  const rules = await game.room(() => window.__coffeMania.screens.active.rules);
  const { farm, disco } = rules.street;
  const pao = rules.recipes.find((recipe) => recipe.id === 'pao_de_queijo');
  const cake = rules.recipes.find((recipe) => recipe.id === 'cake_1');
  // gamerules.FreshBonus (bonusPercent rounded up) and gamerules.WaiterTip.
  const freshBonus = (value) => (value > 0 ? Math.ceil(value * farm.bonusPercent / 100) : 0);
  const baseTip = (price) => Math.max(rules.service.waiterTipMin, Math.floor(price * rules.service.waiterTipPercent / 100));
  const levelRewards = (from, to) => rules.levels.filter((entry) => entry.level > from && entry.level <= to).reduce((sum, entry) => sum + entry.rewardCoins, 0);
  const [owner] = await stack.admin.list('player_state');
  const roomRow = async () => (await stack.admin.list('player_rooms', `user = "${owner.user}"`))[0];
  const stateRow = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0];
  const [counter] = await stack.admin.list('player_inventory', `user = "${owner.user}" && item_id = ${COUNTER_ITEM} && placed = true`);
  run.log('regras da rua', { farm, disco, service: rules.service, offline: rules.offline });

  // 1. Café novo: os dois prédios têm algo a fazer, então o "!" pula sobre os telhados.
  const farmStart = await building(game, 'farm');
  const discoStart = await building(game, 'disco');
  run.check(farmStart.badge && farmStart.caption === 'Colheita pronta!', 'a Fazenda nova mostra o "!" e "Colheita pronta!" no cartão', farmStart);
  run.check(discoStart.badge && discoStart.caption === 'Pronta para a festa!', 'a Discoteca nova mostra o "!" e "Pronta para a festa!" no cartão', discoStart);

  // 2. Fazenda: cartão no hover, janela no toque, colheita gravada no banco.
  let point = await focus(game, 'farm');
  await game.page.mouse.move(point.x, point.y);
  await cardShown(game, 'farm', 'Colheita pronta!');
  const farmCard = await building(game, 'farm');
  run.check(farmCard.title === 'Fazenda de Ingredientes' && !farmCard.badge, 'passar o mouse mostra o cartão da Fazenda, e o "!" se esconde sob ele', farmCard);
  await game.shot('1-fazenda-cartao');
  await game.page.mouse.click(point.x, point.y);
  await game.waitFor(() => window.__coffeMania.screens.active.streetModal?.isOpen, undefined, 15000);
  await sleep(700);
  const farmWindow = await game.texts('street-modal');
  const farmOpened = await game.room(() => window.__coffeMania.screens.active.streetModal.current);
  run.check(farmOpened === 'farm' && farmWindow.includes(`a cada ${farm.cooldownSeconds / 60} min`) && farmWindow.includes(`+${farm.bonusPercent}% de moedas e XP`) &&
    farmWindow.includes('A colheita está pronta!') && farmWindow.includes('Colher ingredientes'), 'tocar na Fazenda abre a janela com a regra e a colheita pronta', { farmOpened, farmWindow });
  await game.shot('2-fazenda-janela');
  await game.click('street-action-farm');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; return screen.street?.freshCharges === 1 && !screen.streetModal.isOpen; }, undefined, 20000);
  const harvestNotice = await game.toast();
  run.check((harvestNotice ?? '').includes('Ingredientes frescos!') && harvestNotice.includes(`+${farm.bonusPercent}%`), 'o aviso anuncia os ingredientes frescos', harvestNotice);
  const harvested = await roomRow();
  const afterHarvest = await building(game, 'farm');
  const harvestedAt = instant(harvested.farm_harvested_at);
  run.check(harvested.fresh_charges === 1 && harvestedAt > 0 && Math.abs(afterHarvest.street.farmReadyAt - (harvestedAt + farm.cooldownSeconds * 1000)) <= 1,
    `colher grava a carga e o instante; a próxima colheita fica a ${farm.cooldownSeconds / 60} min`, { charges: harvested.fresh_charges, at: harvested.farm_harvested_at, street: afterHarvest.street });
  const farmWorld = await game.waitFor(() => window.__street.worlds.find((street) => street.freshCharges === 1) ?? null, undefined, 15000).then((handle) => handle.jsonValue(), () => null);
  run.check(Boolean(farmWorld), 'o quarto transmite a rua com a carga (evento world)', farmWorld);
  await hover(game, point);
  await cardShown(game, 'farm', 'Ingredientes frescos guardados!');
  const stored = await building(game, 'farm');
  run.check(!stored.ready, 'com a carga guardada o cartão diz "Ingredientes frescos guardados!" e o "!" some', stored);
  await game.shot('3-ingredientes-guardados');
  const growing = await post(game, '/api/coffe/street/farm/harvest');
  run.check(growing.status === 409 && /crescendo/.test(growing.message ?? ''), 'colher de novo antes do fim da espera é recusado (409)', growing);
  // With the wait over in the database but the charge still stored, the farm waits for a recipe.
  await stack.admin.update('player_rooms', harvested.id, { farm_harvested_at: iso(harvestedAt - farm.cooldownSeconds * 1000) });
  const full = await post(game, '/api/coffe/street/farm/harvest');
  await stack.admin.update('player_rooms', harvested.id, { farm_harvested_at: harvested.farm_harvested_at });
  run.check(full.status === 409 && /Use os ingredientes frescos/.test(full.message ?? '') && (await roomRow()).fresh_charges === farm.maxCharges,
    `com ${farm.maxCharges} carga guardada a colheita espera a receita (409)`, full);

  // 3. Discoteca: cartão, janela e a Festa do Bairro com o início gravado no banco.
  point = await focus(game, 'disco');
  await game.page.mouse.move(point.x, point.y);
  await cardShown(game, 'disco', 'Pronta para a festa!');
  const discoCard = await building(game, 'disco');
  run.check(discoCard.title === 'Discoteca' && !discoCard.badge, 'passar o mouse mostra o cartão da Discoteca', discoCard);
  await game.shot('4-discoteca-cartao');
  await game.page.mouse.click(point.x, point.y);
  await game.waitFor(() => window.__coffeMania.screens.active.streetModal?.isOpen, undefined, 15000);
  await sleep(700);
  const discoWindow = await game.texts('street-modal');
  const discoOpened = await game.room(() => window.__coffeMania.screens.active.streetModal.current);
  run.check(discoOpened === 'disco' && discoWindow.includes(`Por ${disco.durationSeconds / 60} min`) && discoWindow.includes(`${String(disco.arrivalFactor).replace('.', ',')}× mais rápido`) &&
    discoWindow.includes('quem se serve sozinho dá gorjeta') && discoWindow.includes(`gorjeta do garçom vale ${disco.tipMultiplier}×`) && discoWindow.includes('Começar a festa'),
  'tocar na Discoteca abre a janela com as regras da festa', { discoOpened, discoWindow });
  await game.shot('5-discoteca-janela');
  await game.click('street-action-disco');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; return screen.partyOn && !screen.streetModal.isOpen; }, undefined, 20000);
  const partyNotice = await game.toast();
  run.check((partyNotice ?? '').includes('Festa do Bairro!'), 'o aviso anuncia a Festa do Bairro', partyNotice);
  const partyRoom = await roomRow();
  const partyCard = await building(game, 'disco');
  const party = partyCard.street;
  run.check(Math.abs(party.partyStartedAt - instant(partyRoom.party_started_at)) <= 1 && party.partyEndsAt - party.partyStartedAt === disco.durationSeconds * 1000 &&
    party.partyReadyAt - party.partyEndsAt === disco.cooldownSeconds * 1000,
  `o início da festa fica no banco; ela dura ${disco.durationSeconds / 60} min e a próxima espera ${disco.cooldownSeconds / 60} min depois do fim`, { db: partyRoom.party_started_at, party });
  const partyWorld = await game.waitFor((at) => window.__street.worlds.find((street) => street.partyStartedAt === at) ?? null, party.partyStartedAt, 15000)
    .then((handle) => handle.jsonValue(), () => null);
  run.check(Boolean(partyWorld), 'o quarto recebe a janela da festa (evento world), que ele usa nas chegadas e gorjetas', partyWorld);
  const lights = await game.room(() => { const screen = window.__coffeMania.screens.active;
    return { lights: screen.partyLights.active, badge: screen.partyBadge.view.visible, music: screen.audio?.override?.id ?? null, now: screen.serverNow() }; });
  const badgeText = await game.texts('party-badge');
  run.check(lights.lights && lights.badge && /^Festa do Bairro · \d+:\d\d$/.test(badgeText) && Math.abs(seconds(badgeText) - (party.partyEndsAt - lights.now) / 1000) <= 3,
    'a festa acende as luzes e o selo "Festa do Bairro" com a contagem', { lights, badgeText });
  run.check(lights.music === 'party', 'a trilha "Festa do Bairro" substitui a música durante a festa', lights.music);
  // The notice sits where the disco's card shows; the capture waits for it to leave.
  await game.waitFor(() => !window.__coffeMania.app.stage.getChildByLabel('level-up-toast', true)?.visible, undefined, 30000).catch(() => {});
  await hover(game, point);
  await cardShown(game, 'disco', 'Festa! Termina em');
  const partying = await building(game, 'disco');
  run.check(!partying.ready && Math.abs(seconds(partying.caption) - (party.partyEndsAt - partying.now) / 1000) <= 3, 'durante a festa o cartão conta o fim e o "!" some', partying);
  await game.shot('6-discoteca-em-festa');
  const again = await post(game, '/api/coffe/street/disco/party');
  run.check(again.status === 409 && again.message === 'A festa já está rolando!', 'começar outra festa durante a festa é recusado (409)', again);
  await game.page.mouse.move(800, 860);
  await game.room(() => window.__coffeMania.screens.active.resetCamera());
  await sleep(1200);
  await game.shot('7-festa-luzes');

  // 4. A receita seguinte sai fresca: o livro avisa, o preparo consome a carga e o balcão ganha a folha.
  const freshBook = await openBook(game, pao.id);
  run.check(freshBook.includes(`Ingredientes frescos: +${farm.bonusPercent}% de moedas e XP`), 'o livro anuncia o bônus dos ingredientes frescos', freshBook);
  await game.shot('8-livro-ingredientes-frescos');
  await cookNow(game);
  const freshJob = await game.room(() => ({ ...[...window.__coffeMania.screens.active.occupiedStoves.values()][0] }));
  const [jobRow] = await stack.admin.list('stove_cooking', `user = "${owner.user}"`);
  const usedCharge = await roomRow();
  run.check(freshJob.fresh === true && jobRow?.fresh === true && usedCharge.fresh_charges === 0, 'o preparo consome a carga e sai marcado como fresco', { job: freshJob.fresh, row: jobRow?.fresh, charges: usedCharge.fresh_charges });
  await game.waitFor(() => window.__coffeMania.screens.active.streetScenery.buildings.find((entry) => entry.def.id === 'farm').caption.text.startsWith('Colheita em'), undefined, 20000);
  const cooling = await building(game, 'farm');
  run.check(!cooling.ready && !cooling.badge && Math.abs(seconds(cooling.caption) - (cooling.street.farmReadyAt - cooling.now) / 1000) <= 3,
    'sem carga, o cartão da Fazenda conta a espera da próxima colheita, sem "!"', cooling);
  await serveWhenReady(game);
  const leaf = await game.waitFor(() => [...window.__coffeMania.screens.active.counterDishes.values()].some((dish) => dish.leaf.visible), undefined, 10000).then(() => true, () => false);
  const [food] = await stack.admin.list('room_food', `user = "${owner.user}"`);
  await game.shot('9-balcao-com-folha');
  run.check(leaf && (!food || food.fresh_servings === food.servings), 'as porções frescas chegam ao balcão marcadas (folha verde, fresh_servings no banco)', { leaf, food: food && { servings: food.servings, fresh: food.fresh_servings } });

  // 5. Na festa, quem se serve sozinho dá a gorjeta básica; cada porção fresca paga o bônus.
  const freshCoins = freshBonus(pao.pricePerServing);
  const freshXp = freshBonus(pao.xpPerServing);
  const selfTip = baseTip(pao.pricePerServing);
  await game.waitFor((count) => window.__street.payments.length >= count, pao.servings, 240000);
  await sleep(1500);
  let rec = await recorded(game);
  const batch = rec.payments.slice(0, pao.servings);
  run.check(batch.every((payment) => payment.recipeId === pao.id && payment.freshCoins === freshCoins && payment.freshXp === freshXp && payment.xp === pao.xpPerServing + freshXp),
    `cada porção fresca paga +${freshCoins} moeda e +${freshXp} XP (+${farm.bonusPercent}%, arredondado para cima)`, batch);
  // freshLeft is omitted from the payment when it reaches 0.
  const freshLeft = batch.map((payment) => payment.freshLeft ?? 0);
  run.check(freshLeft.join() === [...Array(pao.servings).keys()].reverse().join(), 'o lote inteiro sai fresco e as porções frescas acabam com ele', freshLeft);
  run.check(batch.every((payment) => payment.at >= party.partyStartedAt && payment.at < party.partyEndsAt && payment.tip === selfTip && payment.coins === pao.pricePerServing + selfTip + freshCoins),
    `na festa quem se serve sozinho dá a gorjeta básica (+${selfTip}): ${pao.pricePerServing + selfTip + freshCoins} moedas por porção`, batch.map(({ coins, tip, freshCoins: fresh, at }) => ({ coins, tip, fresh, at })));
  const freshFloat = rec.floats.find((entry) => entry.fresh > 0);
  run.check(Boolean(freshFloat) && freshFloat.rows.includes(`+${selfTip} gorjeta`) && freshFloat.rows.includes(`+${freshCoins} fresco`) && freshFloat.rows.includes(`+${pao.xpPerServing + freshXp} XP`),
    `a moeda sobe com "+${selfTip} gorjeta" e "+${freshCoins} fresco"`, freshFloat);

  // 6. O garçom (1ª vaga grátis) entrega na festa com a gorjeta em dobro.
  await dismissLevelUp(game);
  await game.click('room-action-bar-icon-waiter');
  await game.waitFor(() => { const staff = window.__coffeMania.screens.active.staffModal;
    return staff.isOpen && !staff.busy && staff.message !== 'Carregando equipe…' && staff.snapshot; }, undefined, 20000);
  await sleep(500);
  await game.click('staff-hire-vostu-waiter');
  await game.waitFor(() => { const staff = window.__coffeMania.screens.active.staffModal; return !staff.busy && staff.snapshot?.staff.length === 1; }, undefined, 20000);
  await game.click('staff-modal-close');
  await game.waitFor(() => !window.__coffeMania.screens.active.staffModal.isOpen, undefined, 10000);
  const paidBefore = await game.room(() => { window.__street.waiter = true; return window.__street.payments.length; });
  run.log('garçom contratado');
  await dismissLevelUp(game);
  const plainBook = await openBook(game, pao.id);
  run.check(!plainBook.includes('Ingredientes frescos'), 'sem carga, o livro não promete o bônus', plainBook);
  await cookNow(game);
  await serveWhenReady(game);
  await game.waitFor((count) => window.__street.payments.length > count, paidBefore, 240000);
  await sleep(1500);
  rec = await recorded(game);
  const delivered = rec.payments[paidBefore];
  const waiterTip = baseTip(pao.pricePerServing) * disco.tipMultiplier;
  run.log('festa: segundos restantes na entrega do garçom', Math.round((party.partyEndsAt - delivered.at) / 1000));
  run.check(delivered.at < party.partyEndsAt && delivered.tip === waiterTip && delivered.coins === pao.pricePerServing + waiterTip && !delivered.freshCoins,
    `na festa o garçom entrega com a gorjeta em dobro (+${waiterTip})`, delivered);
  const tipFloat = rec.floats.find((entry) => entry.coins === delivered.coins && entry.tip === waiterTip && !entry.fresh);
  run.check(Boolean(tipFloat) && tipFloat.rows.includes(`+${waiterTip} gorjeta`), `a gorjeta sobe em verde ("+${waiterTip} gorjeta")`, tipFloat);
  await dismissLevelUp(game);
  await game.page.context().close();
  run.log('navegador fechado; aguardando o quarto dormir');

  // 7. Sem humanos o quarto dorme e grava slept_at; a ausência é recuada 1 h com 8
  // porções de bolo no balcão (4 frescas), a colheita pronta e a festa terminada há 5 min.
  const waitAsleep = async () => {
    for (let i = 0; i < 90; i++) {
      const room = await roomRow();
      if (room.slept_at) return room;
      await sleep(1000);
    }
    return null;
  };
  const prepareAbsence = async (tag, servings, fresh, fields = {}) => {
    for (const row of await stack.admin.list('room_food', `user = "${owner.user}"`)) await stack.admin.remove('room_food', row.id);
    for (const row of await stack.admin.list('room_dirt', `user = "${owner.user}"`)) await stack.admin.remove('room_dirt', row.id);
    const jobs = await stack.admin.list('stove_cooking', `user = "${owner.user}"`);
    for (const row of jobs) await stack.admin.remove('stove_cooking', row.id);
    await stack.admin.create('room_food', { user: owner.user, recipe_id: cake.id, job_id: `e2e-${tag}`, servings, fresh_servings: fresh, counter: counter.id });
    const sleptAt = Date.now() - HOUR;
    await stack.admin.update('player_rooms', (await roomRow()).id, { slept_at: iso(sleptAt), ...fields });
    run.log('ausência preparada', { tag, servings, fresh, jobsRemoved: jobs.length });
    return { sleptAt, before: await stateRow() };
  };
  // A waiter on duty outside the party: every meal tips the basic tip; fresh servings add their bonus.
  const expectAway = (servings, fresh) => {
    const tip = baseTip(cake.pricePerServing);
    return {
      served: servings, tips: servings * tip, freshCoins: fresh * freshBonus(cake.pricePerServing),
      coins: servings * (cake.pricePerServing + tip) + fresh * freshBonus(cake.pricePerServing),
      xp: servings * cake.xpPerServing + fresh * freshBonus(cake.xpPerServing), cleared: servings,
    };
  };
  const popularityAfter = (from, served) => Math.min(rules.popularity.max * 10, from + served * Math.round(rules.popularity.satisfiedDelta * 10));
  const pick = ({ served, tips, freshCoins: fresh, coins, xp, cleared }) => ({ served, tips, freshCoins: fresh, coins, xp, cleared });

  const slept = await waitAsleep();
  run.check(Boolean(slept), 'sem ninguém no café o quarto dorme e grava slept_at', slept?.slept_at);
  const savedNpcs = (await stack.admin.list('room_npcs', `user = "${owner.user}"`)).map((row) => row.npc_id);
  run.log('clientes salvos na dormência', savedNpcs.length);
  const partyStartedAt = Date.now() - 2 * disco.durationSeconds * 1000;
  const first = await prepareAbsence('ausencia-1', 8, 4, { farm_harvested_at: iso(Date.now() - HOUR), party_started_at: iso(partyStartedAt) });

  // 8. Volta: o quarto acorda, conta o expediente e mostra "Bem-vindo de volta!" antes do bônus diário.
  game = await open('volta depois de 1 h');
  await game.waitFor(() => window.__coffeMania.screens.active.welcomeBack?.isOpen, undefined, 60000);
  await sleep(1000);
  await game.shot('12-bem-vindo-de-volta');
  const away = await game.room(() => window.__coffeMania.screens.active.welcomeBack.summary);
  const want = expectAway(8, 4);
  run.check(away.from === first.sleptAt && away.to - away.from >= HOUR && away.simulatedMs === away.to - away.from && away.cappedMs === 0,
    'a ausência vai de slept_at até o despertar, sem corte (abaixo de 8 h)', { from: away.from, sleptAt: first.sleptAt, to: away.to, simulatedMs: away.simulatedMs, cappedMs: away.cappedMs });
  run.check(JSON.stringify(pick(away)) === JSON.stringify(want), `o garçom serviu as 8 porções: +${want.coins} moedas (${want.tips} de gorjeta, ${want.freshCoins} de frescos) e +${want.xp} XP`, { away: pick(away), want });
  run.check(away.waiters === 1 && away.cleaners === 0 && away.plates === 0 && away.servingsLeft === 0 && away.readyDishes === 0 && away.spoiledDishes === 0,
    'com garçom as mesas ficam limpas e o balcão esvazia', away);
  run.check(away.popularityFrom === first.before.satisfaction_current_tenths && away.popularityTo === popularityAfter(away.popularityFrom, want.served),
    'cada refeição da ausência soma a popularidade de um cliente satisfeito', { from: away.popularityFrom, to: away.popularityTo });
  const woke = await stateRow();
  run.check(woke.gold - first.before.gold === away.coins + levelRewards(away.levelFrom, away.levelTo) && woke.experience_current - first.before.experience_current === away.xp &&
    woke.level === away.levelTo && woke.satisfaction_current_tenths === away.popularityTo, 'o banco já tem as moedas, o XP e a popularidade do expediente', { before: first.before.gold, after: woke.gold, level: woke.level });
  const hudCoins = await game.waitFor((gold) => window.__coffeMania.screens.active.topBars.labelTexts[1] === gold, String(woke.gold), 15000).then(() => true, () => false);
  run.check(hudCoins, 'o HUD já mostra as moedas do expediente antes do Coletar', { hud: await game.room(() => window.__coffeMania.screens.active.topBars.labelTexts[1]), gold: woke.gold });
  const awake = await roomRow();
  run.check(!awake.slept_at && awake.away_summary?.served === want.served, 'acordar limpa slept_at e guarda o resumo até o Coletar', { slept: awake.slept_at, stored: awake.away_summary?.served });
  const actors = await game.room(() => [...window.__coffeMania.screens.active.realtime.actors.keys()]);
  run.check((await stack.admin.list('room_npcs', `user = "${owner.user}"`)).length === 0 && !savedNpcs.some((id) => actors.includes(id)),
    'os clientes salvos na dormência foram embora', { saved: savedNpcs.length });
  const awayText = await game.texts('welcome-back-modal');
  run.check(awayText.includes('Bem-vindo de volta!') && awayText.includes('Enquanto você esteve fora (1 h') && awayText.includes(`Seus garçons serviram ${want.served} porções.`) &&
    awayText.includes(`+${want.coins} moedas (${want.tips} de gorjeta e ${want.freshCoins} de ingredientes frescos) e +${want.xp} XP`) &&
    awayText.includes(`A equipe recolheu ${want.cleared} pratos.`) && awayText.includes('Coletar'), 'a janela "Bem-vindo de volta!" mostra o expediente', awayText);
  run.check(!await game.room(() => window.__coffeMania.screens.active.dailyModal?.isOpen), 'o bônus diário espera o resumo da ausência');
  // The street follows the instants: the crop is ready again, the party is over and resting.
  const farmBack = await building(game, 'farm');
  const discoBack = await building(game, 'disco');
  const quiet = await game.room(() => { const screen = window.__coffeMania.screens.active; return { lights: screen.partyLights.active, badge: screen.partyBadge.view.visible }; });
  run.check(farmBack.ready && farmBack.caption === 'Colheita pronta!', 'na volta a colheita está pronta de novo, com o "!"', farmBack);
  const discoReady = partyStartedAt + (disco.durationSeconds + disco.cooldownSeconds) * 1000;
  run.check(!discoBack.ready && discoBack.street.partyReadyAt === discoReady && Math.abs(seconds(discoBack.caption) - (discoReady - discoBack.now) / 1000) <= 3 &&
    discoBack.caption.startsWith('Próxima festa em') && !quiet.lights && !quiet.badge, 'a festa acabou: sem luzes nem selo, e o cartão conta a próxima', { discoBack, quiet });
  await game.page.context().close();
  run.log('fechou sem coletar; aguardando o quarto dormir de novo');

  // 9. Segunda ausência sem Coletar: o resumo guardado soma a nova, numa janela só.
  run.check(Boolean(await waitAsleep()), 'o quarto dorme de novo');
  const second = await prepareAbsence('ausencia-2', 4, 0);
  game = await open('segunda volta');
  await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const opens = window.__opens = [];
    let shown = false;
    const watch = () => { const now = Boolean(screen.welcomeBack?.isOpen); if (now && !shown) opens.push(screen.welcomeBack.summary?.served); shown = now; };
    watch();
    window.__coffeMania.app.ticker.add(watch);
  });
  await game.waitFor(() => window.__coffeMania.screens.active.welcomeBack?.isOpen, undefined, 60000);
  await sleep(4000);
  await game.shot('13-bem-vindo-somado');
  const merged = await game.room(() => window.__coffeMania.screens.active.welcomeBack.summary);
  const opens = await game.room(() => window.__opens);
  const addition = expectAway(4, 0);
  const total = Object.fromEntries(Object.entries(want).map(([key, value]) => [key, value + addition[key]]));
  run.check(merged.from === away.from && merged.simulatedMs === away.simulatedMs + (merged.to - second.sleptAt) && JSON.stringify(pick(merged)) === JSON.stringify(total),
    `o resumo soma as duas ausências: ${total.served} porções e +${total.coins} moedas`, { merged: pick(merged), total, from: merged.from });
  run.check(merged.popularityFrom === away.popularityFrom && merged.popularityTo === popularityAfter(away.popularityTo, addition.served), 'a popularidade do resumo vai do início da primeira ausência ao fim da segunda',
    { from: merged.popularityFrom, to: merged.popularityTo });
  run.check(opens.length === 1 && opens[0] === total.served, 'uma janela só, já com o resumo somado', opens);
  const secondState = await stateRow();
  run.check(secondState.gold - second.before.gold === addition.coins + levelRewards(away.levelTo, merged.levelTo), 'a segunda ausência credita só a parte nova', { before: second.before.gold, after: secondState.gold, addition: addition.coins });
  const mergedText = await game.texts('welcome-back-modal');
  run.check(mergedText.includes(`Seus garçons serviram ${total.served} porções.`) && mergedText.includes(`+${total.coins} moedas`), 'a janela mostra o resumo somado', mergedText);

  // 10. Coletar: as moedas e o XP sobem sobre o avatar, o resumo sai do banco e o bônus diário abre.
  await game.click('welcome-back-collect');
  await game.waitFor(() => !window.__coffeMania.screens.active.welcomeBack.isOpen, undefined, 10000);
  await sleep(1200);
  await game.shot('14-coletado-e-bonus-diario');
  rec = await recorded(game);
  const collected = rec.floats.find((entry) => entry.coins === merged.coins && entry.xp === merged.xp);
  const base = merged.coins - merged.tips - merged.freshCoins;
  run.check(Boolean(collected) && collected.tip === merged.tips && collected.fresh === merged.freshCoins &&
    ['+' + base, `+${merged.tips} gorjeta`, `+${merged.freshCoins} fresco`, `+${merged.xp} XP`].every((row) => collected.rows.includes(row)),
  'Coletar faz as moedas (gorjeta e frescos à parte) e o XP subirem sobre o avatar', collected);
  let acked;
  for (let i = 0; i < 30; i++) { acked = await roomRow(); if (!acked.away_summary) break; await sleep(500); }
  run.check(!acked.away_summary && !acked.slept_at, 'Coletar apaga o resumo do banco', acked.away_summary);
  run.check(await game.skipDaily(30000), 'o bônus diário abre depois do Coletar');
  await sleep(800);
  await game.shot('15-depois-do-bonus');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 before each login and the deliberate 409s of the farm and the party.
  await run.finish({ allow: [/status of 40[19]/] });
  await stack.stop();
}
