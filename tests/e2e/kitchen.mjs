// Cozinha e clientes (Sprints 1, 3 e 4) no modo servidor com banco novo: balcão
// no café inicial, cozinha parada (um cliente "olhando o cardápio", que ganha a
// paciência inteira quando o primeiro prato vai ao fogo), livro de receitas
// (bloqueio por nível, moedas insuficientes, um toque no cartão pré-selecionado
// não cozinha, dois toques cozinham), ajuda de emergência (grátis só sem moedas,
// sem preparo vivo e sem comida no balcão), tempero, paciência de 40 s que
// acaba em reclamação (−0,3), servir no balcão, autosserviço com pagamento de
// moedas e XP, mesma receita somando porções, servir sem balcão livre (409),
// prato urgente, estragado e limpeza do fogão, popularidade no fim e os sons
// ligados à cozinha.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('kitchen');

try {
  const game = await run.page();
  await login(game, stack.web);
  await game.skipDaily();

  // Room events and the sounds the screen asks for, from here to the end.
  await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const log = window.__kitchen = {
      payments: [], foods: [], verdicts: {}, browsing: {}, patience: {}, fetches: [], meals: [], sounds: [],
      idle: true, maxIdle: 0, maxInside: 0,
    };
    screen.realtime.onEvent((event) => {
      if (event.type === 'payment') log.payments.push(event.payment);
      if (event.type === 'food') log.foods.push(event.foods ?? []);
      // Hot updates leave out static fields such as `kind`; the merged state has them.
      for (const update of event.actors ?? []) {
        const actor = screen.realtime.actors.get(update.id) ?? update;
        if (actor.kind !== 'npc') continue;
        if (actor.browsing) log.browsing[actor.id] = true;
        if (actor.state === 'seated' && actor.patience) {
          const seen = log.patience[actor.id] ??= [];
          if (!seen.some((entry) => entry.startedAt === actor.patience.startedAt)) seen.push(actor.patience);
        }
        if (actor.action?.kind === 'fetching' && !log.fetches.some((entry) => entry.actor === actor.id && entry.startedAt === actor.action.startedAt)) {
          log.fetches.push({ actor: actor.id, startedAt: actor.action.startedAt, duration: actor.action.duration });
        }
        if (actor.state === 'eating' && actor.food && !log.meals.some((entry) => entry.actor === actor.id)) log.meals.push({ actor: actor.id, recipeId: actor.food.recipeId });
        if (actor.emotion) log.verdicts[actor.emotion.id] = { actor: actor.id, kind: actor.emotion.kind };
      }
      const inside = [...screen.realtime.actors.values()].filter((actor) => actor.kind === 'npc' && actor.state !== 'leaving').length;
      log.maxInside = Math.max(log.maxInside, inside);
      if (log.idle) log.maxIdle = Math.max(log.maxIdle, inside);
    });
    const audio = window.__coffeMania.audio;
    const play = audio.play.bind(audio);
    audio.play = (name, ...rest) => { log.sounds.push(name); return play(name, ...rest); };
  });

  const rules = await game.room(() => window.__coffeMania.screens.active.rules);
  const recipe = (id) => rules.recipes.find((entry) => entry.id === id);
  const pao = recipe('pao_de_queijo');
  const bolo = recipe('cake_1');
  const coxinha = recipe('coxinha');
  const cheapest = Math.min(...rules.recipes.filter((entry) => entry.level <= 1).map((entry) => entry.costCoins));
  const seasonBonus = Math.max(1, Math.ceil(pao.servings * rules.stove.seasonBonusPercent / 100));
  const [owner] = await stack.admin.list('player_state');
  const popularity = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0].satisfaction_current_tenths;
  const startPopularity = await popularity();
  const kitchen = () => game.room(() => window.__kitchen);
  const penalized = (log) => Object.values(log.verdicts).filter((verdict) => verdict.kind === 'dissatisfied');
  const decimal = (value) => String(value).replace('.', ',');
  const up = Math.round(rules.popularity.satisfiedDelta * 10);
  const down = Math.round(rules.popularity.unsatisfiedDelta * 10);
  // Popularity in the database against the verdicts seen in the room (the
  // complaint is saved off the room goroutine, so it may take a moment).
  const balance = async () => {
    let state = {};
    for (let i = 0; i < 30; i++) {
      const log = await kitchen();
      const tenths = await popularity();
      state = { start: startPopularity, tenths, payments: log.payments.length, complaints: penalized(log).length };
      state.ok = tenths === startPopularity + state.payments * up - state.complaints * down;
      if (state.ok) break;
      await sleep(500);
    }
    return state;
  };
  const job = () => game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const [current] = screen.occupiedStoves.values();
    return current ? { ...current } : null;
  });
  // The stove's dish has reached `field` (startedAt, readyAt, spoilsAt) plus `extra` ms, on the server clock.
  const reached = (field, timeout, extra = 0) => game.waitFor(([field, extra]) => {
    const screen = window.__coffeMania.screens.active;
    const [current] = screen.occupiedStoves.values();
    return current && Date.parse(current[field].replace(' ', 'T')) + extra <= screen.cookingClient.serverNowMs();
  }, [field, extra], timeout);
  const tapStove = async () => {
    const point = await game.stovePoint();
    await game.page.mouse.click(point.x, point.y);
  };
  const openBook = async () => {
    await tapStove();
    await game.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 30000);
    await sleep(600);
  };
  const openMenu = async () => {
    await tapStove();
    await game.waitFor(() => Boolean(window.__coffeMania.screens.active.stoveActions), undefined, 15000);
    await sleep(500);
    return game.room(() => window.__coffeMania.screens.active.stoveActions.view.children.map((child) => child.label));
  };
  const emergency = () => game.room(async () => (await window.__coffeMania.screens.active.cookingClient.refresh()).emergencyRecipeId ?? null);
  // The room's short notice line (it stays up for 3 s) once it matches.
  const notice = (pattern, timeout) => game.waitFor((source) => {
    const hint = window.__coffeMania.screens.active.connectionHint;
    return hint?.visible && new RegExp(source).test(hint.text) ? hint.text : null;
  }, pattern.source, timeout).then((handle) => handle.jsonValue(), () => null);
  const hudGold = (gold) => game.waitFor((gold) => window.__coffeMania.screens.active.topBars.labelTexts[1] === String(gold), gold, 20000).then(() => true, () => false);

  // 1. O café nasce com fogão, balcão e cadeiras com mesa (todas as do café inicial têm uma).
  const furniture = await game.room(() => {
    const items = window.__coffeMania.screens.active.model.items;
    return { counter: items.find((item) => item.kind === 'counter')?.inventoryUnitId ?? null, stoves: items.filter((item) => item.kind === 'stove').length, chairs: items.filter((item) => item.kind === 'chair').length };
  });
  run.check(Boolean(furniture.counter) && furniture.stoves === 1, 'o café inicial tem um fogão e um balcão', furniture);
  const start = await game.player();
  run.check(start.level === 1 && start.xp === 0, 'a conta nova começa no nível 1 sem XP', start);
  await game.shot('1-cafe-com-balcao');

  // 2. Ajuda de emergência: sem moedas para a receita mais barata e sem nada no fogo ou no balcão.
  await stack.admin.update('player_state', owner.id, { gold: cheapest - 1 });
  run.check(await hudGold(cheapest - 1), `o HUD recebe as ${cheapest - 1} moedas pelo SSE`);
  await openBook();
  const preselected = await game.room(() => window.__coffeMania.screens.active.cookModal.selectedId);
  await game.click(`cook-card-${pao.id}`);
  await sleep(1200);
  const oneTap = await game.room(() => ({ open: window.__coffeMania.screens.active.cookModal.isOpen, stoves: window.__coffeMania.screens.active.occupiedStoves.size }));
  run.check(preselected === pao.id && oneTap.open && oneTap.stoves === 0, 'um toque no cartão pré-selecionado não cozinha', { preselected, oneTap });
  const freeCard = await game.texts(`cook-card-${pao.id}`);
  const freeDetails = await game.texts('cook-details');
  run.check(freeCard.includes('GRÁTIS') && freeDetails.includes('Grátis (Ajuda de Emergência)'), `${pao.name} sai grátis pela ajuda de emergência`, { freeCard, freeDetails });
  await game.shot('2-livro-ajuda-emergencia');
  await game.click(`cook-card-${bolo.id}`);
  await sleep(800);
  const broke = await game.texts('cook-details');
  run.check(broke.includes('Moedas insuficientes') && broke.includes(`${bolo.costCoins} moedas`), `${bolo.name} custa ${bolo.costCoins} moedas e fica indisponível`, broke);
  await game.click(`cook-card-${coxinha.id}`);
  await sleep(800);
  const locked = await game.texts('cook-details');
  run.check(locked.includes(`Bloqueada até o nível ${coxinha.level}`), `${coxinha.name} fica bloqueada até o nível ${coxinha.level}`, locked);
  await game.shot('3-livro-receita-bloqueada');
  await game.click('cook-close-button');
  await game.waitFor(() => !window.__coffeMania.screens.active.cookModal.isOpen, undefined, 15000);

  // Cozinha parada: entra um só cliente, que senta para olhar o cardápio.
  const looker = await game.waitFor(() => {
    const screen = window.__coffeMania.screens.active;
    const now = screen.realtime.serverNowMs();
    const actor = [...screen.realtime.actors.values()].find((entry) => entry.kind === 'npc' && entry.browsing && entry.state === 'seated' &&
      entry.patience && entry.patience.startedAt + entry.patience.duration - now > 25000);
    return actor ? { id: actor.id, patience: actor.patience } : null;
  }, undefined, 150000).then((handle) => handle.jsonValue());
  const idle = await kitchen();
  run.check(idle.maxIdle === 1, 'com a cozinha parada entra no máximo um cliente', { maxIdle: idle.maxIdle });
  run.check(looker.patience.duration === rules.customers.patienceSeconds * 1000, `o cliente sentado espera ${rules.customers.patienceSeconds} s`, looker.patience);
  await game.shot('4-cliente-olhando-o-cardapio');

  // Two taps on the same card cook it; the 15 s on the fire leave little time to season.
  const beforeSeason = await game.player();
  await game.room(() => { window.__kitchen.idle = false; });
  await openBook();
  await game.click(`cook-card-${pao.id}`);
  await sleep(500);
  await game.click(`cook-card-${pao.id}`);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size > 0, undefined, 60000);

  // 3. Temperar uma vez no fogo: mais porções na hora; o XP do dono só ao servir no balcão.
  const actions = await openMenu();
  const seasonCaption = await game.texts('stove-action-season');
  await game.click('stove-action-season');
  await game.waitFor(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0]?.seasoned, undefined, 15000);
  await sleep(500);
  await game.shot('5-temperado');
  run.check(actions.includes('stove-action-season') && seasonCaption.includes(`+${seasonBonus}`), `o fogo aceso oferece "Temperar (+${seasonBonus})"`, { actions, seasonCaption });
  const seasoned = await job();
  const afterSeason = await game.player();
  run.check(seasoned.servings === pao.servings + seasonBonus, `o tempero rende ${pao.servings + seasonBonus} porções`, seasoned);
  run.check(afterSeason.xp === beforeSeason.xp, 'o tempero do dono não dá XP enquanto o prato está no fogo', { before: beforeSeason.xp, after: afterSeason.xp });

  // The free batch: nothing charged, and the help is gone while it cooks.
  run.check(seasoned.recipeId === pao.id && seasoned.costCoins === 0 && afterSeason.gold === cheapest - 1, 'dois toques no cartão cozinham sem cobrar', { job: seasoned, gold: afterSeason.gold });
  run.check(await emergency() === null, 'com um preparo vivo a ajuda de emergência some');
  const restored = await game.waitFor(([id, before]) => {
    const actor = window.__coffeMania.screens.active.realtime.actors.get(id);
    return actor?.patience && actor.patience.startedAt > before ? actor.patience : null;
  }, [looker.id, looker.patience.startedAt], 20000).then((handle) => handle.jsonValue(), () => null);
  run.check(restored !== null && restored.startedAt >= Date.parse(seasoned.preparingAt.replace(' ', 'T')) - 2000 && restored.duration === looker.patience.duration,
    'o cliente que olhava o cardápio ganha a paciência inteira quando o prato vai ao fogo', { before: looker.patience, restored, preparingAt: seasoned.preparingAt });

  // 4. Pronto e sem servir: quem se sentou depois do fogo aceso perde a paciência e reclama.
  await reached('readyAt', 60000, 500);
  await game.waitFor(() => window.__coffeMania.screens.active.patienceMeters.size > 0, undefined, 60000);
  await sleep(600);
  await game.shot('6-pronto-clientes-esperando');
  await game.waitFor(() => {
    const log = window.__kitchen;
    return Object.values(log.verdicts).some((verdict) => verdict.kind === 'dissatisfied' && log.patience[verdict.actor]);
  }, undefined, 150000);
  const angry = await kitchen();
  const waits = Object.values(angry.patience).flat();
  run.check(waits.every((entry) => entry.duration === rules.customers.patienceSeconds * 1000), 'todo cliente sentado recebe a paciência das regras', waits);
  run.check(penalized(angry).every((verdict) => !angry.browsing[verdict.actor]), 'quem só olhava o cardápio nunca reclama', penalized(angry));
  const afterComplaint = await balance();
  run.check(afterComplaint.complaints > 0 && afterComplaint.payments === 0 && afterComplaint.ok,
    `cada reclamação tira ${decimal(rules.popularity.unsatisfiedDelta)} de popularidade`, afterComplaint);
  await game.shot('7-cliente-reclama');

  // 5. Servir no balcão: as porções vão para o balcão do café.
  const foodsBefore = (await kitchen()).foods.length;
  await tapStove();
  await game.waitFor((count) => window.__kitchen.foods.length > count && window.__kitchen.foods.at(-1).length > 0, foodsBefore, 60000);
  const counterCheck = await game.room(async () => {
    const screen = window.__coffeMania.screens.active;
    const snapshot = await screen.cookingClient.refresh();
    return { emergency: snapshot.emergencyRecipeId ?? null, gold: screen.roomSnapshot.playerState.gold, food: window.__kitchen.foods.at(-1) };
  });
  const [served] = counterCheck.food;
  run.check(counterCheck.food.length === 1 && served.recipeId === pao.id && served.servings === pao.servings + seasonBonus && served.counterId === furniture.counter,
    `o balcão recebe as ${pao.servings + seasonBonus} porções`, counterCheck.food);
  const afterServe = await game.player();
  run.check(afterServe.xp - afterSeason.xp === rules.stove.seasonXp, `servir o prato temperado credita os ${rules.stove.seasonXp} XP do tempero`, { before: afterSeason.xp, after: afterServe.xp });
  run.check(await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 15000).then(() => true, () => false), 'servir libera o fogão');
  run.check(counterCheck.gold < cheapest && counterCheck.emergency === null, 'com comida no balcão não há ajuda de emergência, mesmo sem moedas', counterCheck);
  const badge = await game.waitFor(() => {
    const [food] = window.__kitchen.foods.at(-1);
    const dish = window.__coffeMania.app.stage.getChildByLabel('counter-dish', true);
    const count = dish?.children[1]?.children.find((child) => child.text !== undefined)?.text;
    return food && dish.visible && count === `×${food.servings}` ? count : null;
  }, undefined, 15000).then((handle) => handle.jsonValue(), () => null);
  run.check(badge !== null, 'o balcão mostra o prato e as porções restantes', badge);
  await game.shot('8-balcao-com-porcoes');

  // 6. Autosserviço: cada cliente busca a porção, come e paga; cada mesa fica com o prato sujo.
  await game.waitFor(() => window.__coffeMania.screens.active.mealViews.size > 0, undefined, 120000);
  await sleep(600);
  await game.shot('9-cliente-comendo');
  const seats = furniture.chairs;
  await game.waitFor((seats) => window.__kitchen.payments.length >= seats, seats, 240000);
  await sleep(8000);
  const meals = await kitchen();
  run.check(meals.payments.length === seats && meals.payments.every((payment) => payment.recipeId === pao.id && payment.coins === pao.pricePerServing && payment.xp === pao.xpPerServing && !payment.tip),
    `cada uma das ${seats} mesas paga ${pao.pricePerServing} moedas e ${pao.xpPerServing} XP pela porção`, meals.payments);
  run.check(meals.fetches.length > 0 && meals.fetches.every((fetch) => fetch.duration === rules.service.selfPickupMs), `buscar a porção leva ${rules.service.selfPickupMs} ms`, meals.fetches);
  run.check(meals.meals.length > 0 && meals.meals.every((meal) => meal.recipeId === pao.id), 'o cliente come a receita que pegou no balcão', meals.meals);
  run.check(meals.maxInside <= seats, 'a lotação acompanha as cadeiras com mesa', { maxInside: meals.maxInside, seats });
  const left = meals.foods.at(-1);
  run.check(left.length === 1 && left[0].servings === pao.servings + seasonBonus - seats, 'com as mesas sujas a porção que sobrou espera no balcão', left);
  const paid = await game.player();
  run.check(paid.gold === cheapest - 1 + seats * pao.pricePerServing && paid.xp === rules.stove.seasonXp + seats * pao.xpPerServing,
    'o banco credita as moedas e o XP dos pagamentos', paid);
  run.check(await hudGold(paid.gold), 'o HUD mostra as moedas do PocketBase', paid.gold);

  // 7. Mesma receita: o custo normal é cobrado e o balcão soma as porções.
  await openBook();
  const normal = await game.texts('cook-details');
  run.check(!normal.includes('Grátis') && normal.includes(`${pao.costCoins} moedas`), `com moedas ${pao.name} custa ${pao.costCoins}`, normal);
  await game.click(`cook-card-${pao.id}`);
  await sleep(400);
  await game.click('cook-button');
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size > 0, undefined, 60000);
  const second = await job();
  const charged = await game.player();
  run.check(second.costCoins === pao.costCoins && paid.gold - charged.gold === pao.costCoins, `o segundo preparo cobra ${pao.costCoins} moedas`, { cost: second.costCoins, before: paid.gold, after: charged.gold });
  await reached('readyAt', 60000, 500);
  await sleep(500);
  const mergeFrom = (await kitchen()).foods.length;
  await tapStove();
  await game.waitFor((count) => window.__kitchen.foods.length > count, mergeFrom, 60000);
  const merged = (await kitchen()).foods.at(-1);
  run.check(merged.length === 1 && merged[0].id === left[0].id && merged[0].servings === left[0].servings + pao.servings, 'servir a mesma receita soma as porções no balcão', { before: left, after: merged });

  // 8. Outra receita com o balcão ocupado: o servidor recusa e o prato fica no fogão.
  await game.cook(bolo.id);
  const cake = await job();
  const afterCake = await game.player();
  run.check(cake.recipeId === bolo.id && charged.gold - afterCake.gold === bolo.costCoins, `${bolo.name} cobra ${bolo.costCoins} moedas`, { before: charged.gold, after: afterCake.gold });
  await reached('readyAt', 90000, 500);
  await sleep(500);
  await tapStove();
  const refused = await notice(/balcão livre/, 60000);
  run.check(refused === 'Nenhum balcão livre para este prato. Coloque ou libere um balcão.', 'sem balcão livre o servir é recusado com o motivo', refused);
  await sleep(1500);
  run.check((await job())?.recipeId === bolo.id, 'o prato recusado continua no fogão');
  await game.shot('10-sem-balcao-livre');

  // 9. Pronto há tempo demais: urgente, depois estragado; só resta limpar o fogão.
  await game.waitFor(() => window.__coffeMania.screens.active.stovesUrgent, undefined, (bolo.spoilSeconds + 30) * 1000);
  const urgentAt = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const [current] = screen.occupiedStoves.values();
    const ready = Date.parse(current.readyAt.replace(' ', 'T'));
    return (screen.cookingClient.serverNowMs() - ready) / (Date.parse(current.spoilsAt.replace(' ', 'T')) - ready);
  });
  run.check(urgentAt > 0.6 && urgentAt < 1, 'o prato pronto fica urgente perto de estragar', urgentAt);
  await game.shot('11-pronto-urgente');
  const spoiledNotice = await notice(/estragou/, (bolo.spoilSeconds + 30) * 1000);
  run.check(spoiledNotice === 'Um prato estragou no fogão! Clique nele para limpar.', 'o dono é avisado quando o prato estraga', spoiledNotice);
  const spoiled = await job();
  run.check(Date.parse(spoiled.spoilsAt.replace(' ', 'T')) === Date.parse(spoiled.readyAt.replace(' ', 'T')) + bolo.spoilSeconds * 1000,
    `o prato estraga ${bolo.spoilSeconds} s depois de pronto`, { readyAt: spoiled.readyAt, spoilsAt: spoiled.spoilsAt });
  await sleep(1500);
  await game.shot('12-estragado');
  const spoiledActions = await openMenu();
  run.check(spoiledActions.length === 1 && spoiledActions[0] === 'stove-action-clean', 'o fogão estragado só oferece "Limpar fogão"', spoiledActions);
  await game.shot('13-menu-limpar');
  const beforeClean = await game.player();
  await game.click('stove-action-clean');
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 15000);
  await sleep(1000);
  const cleaned = await game.player();
  run.check(cleaned.xp - beforeClean.xp === rules.stove.cleaningXp && beforeClean.gold - cleaned.gold === rules.stove.cleaningCoins,
    `limpar dá ${rules.stove.cleaningXp} XP e custa ${rules.stove.cleaningCoins} moedas`, { before: beforeClean, after: cleaned });
  await game.shot('14-fogao-limpo');

  // 10. Popularidade: sobe a cada cliente que pagou e cai a cada reclamação; os sons da cozinha.
  const final = await balance();
  run.check(final.ok, `a popularidade soma +${decimal(rules.popularity.satisfiedDelta)} por pagamento e −${decimal(rules.popularity.unsatisfiedDelta)} por reclamação`, final);
  const sounds = new Set((await kitchen()).sounds);
  const expected = ['bookPage', 'cookStart', 'season', 'coin', 'buzzer', 'broom', 'doorBell'];
  run.check(expected.every((name) => sounds.has(name)), 'livro, chiado, tempero, moeda, buzzer, vassoura e sininho tocam', [...sounds]);
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 before the login and the deliberate 409 of serving without a free counter.
  await run.finish({ allow: [/status of 40[19]/] });
  await stack.stop();
}
