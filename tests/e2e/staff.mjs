// Funcionários (Sprint 6) no modo servidor com banco novo: janela "Funcionários"
// com 1 vaga grátis no nível 1, contratar o garçom com clientes ainda comendo
// (registro em room_staff com a aparência sorteada uma vez, vaga paga em
// player_rooms.staff_slots), o garçom recolhe os pratos sem XP para o dono, entrega
// na bandeja (pegar no balcão, levar com o prato desenhado, paciência do cliente
// pausada, nenhum autosserviço) com gorjeta no pagamento e "+N gorjeta" subindo,
// trocar para faxineiro (assa os clipes de novo, só limpa mesas, os clientes voltam
// a se servir sozinhos), 2ª vaga no nível 7 pelo atalho "Contratar" do modal de
// nível com taxa única (bloqueada sem moedas, debitada uma vez), dispensar e
// recontratar na vaga já paga sem custo, e o funcionário nunca fica parado na porta
// (nem os clientes presos na saída).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

// doorwayGrace (CLAUDE.md, "Funcionários"): parado na porta por 2 s, o funcionário
// é posto dentro do salão. A folga cobre o tick de 333 ms, o evento e a amostragem
// do Chromium a 2–3 quadros por segundo.
const DOORWAY_GRACE_MS = 2000;
const DOORWAY_SLACK_MS = 1500;
// Uma saída normal leva uns 15 s (caminho até a porta e 14 passos de 667 ms na
// calçada); o travamento visto na Sprint 9 prendeu clientes por mais de 2 min.
const EXIT_LIMIT_MS = 60000;
// Prazo para os pratos sumirem depois de contratar, como no roteiro da Sprint 9.
const BUSING_LIMIT_MS = 90000;

const stack = await startServers();
const run = await scenario('staff');
let game;

try {
  game = await run.page();
  await login(game, stack.web);
  await game.skipDaily();
  const [owner] = await stack.admin.list('player_state');
  const staffRows = () => stack.admin.list('room_staff', `user = "${owner.user}"`);
  const plates = () => stack.admin.list('room_dirt', `user = "${owner.user}"`);
  const roomRow = async () => (await stack.admin.list('player_rooms', `user = "${owner.user}"`))[0];
  // Read from the database on this side: page calls crawl at 2–3 frames per second.
  const stateRow = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0];
  const rules = await game.room(() => {
    const { staff, service, employeeLocks, levels, recipes } = window.__coffeMania.screens.active.rules;
    return { staff, service, employeeLocks, levels, recipe: recipes.find((recipe) => recipe.id === 'pao_de_queijo') };
  });
  const { recipe } = rules;
  const tip = Math.max(rules.service.waiterTipMin, Math.floor(recipe.pricePerServing * rules.service.waiterTipPercent / 100));
  run.log('regras', { hireCoins: rules.staff.hireCoins, locks: rules.employeeLocks, service: rules.service, tip });

  // Gravador: pagamentos, estados dos funcionários, autosserviço, saídas dos
  // clientes e, a cada quadro (depois da tela), o funcionário parado na porta, a
  // paciência de quem espera o garçom, o prato na bandeja e o clipe de cada estado.
  const shots = new Set();
  await game.page.exposeFunction('__staffShot', async (state) => {
    if (shots.has(state)) return;
    shots.add(state);
    if (state !== 'carrying') await sleep(400);
    await game.shot(`estado-${state}`);
  });
  // The exact frame Pixi just drew (page screenshots lag behind a short walk).
  await game.page.exposeFunction('__staffFrame', (name, url) => {
    writeFileSync(join(run.out, `${name}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    run.log('quadro', name);
  });
  await game.room(async () => {
    const { CLIP } = await import('/src/avatar/clips.ts');
    const screen = window.__coffeMania.screens.active;
    const door = screen.model.items.find((item) => item.kind === 'door');
    const opening = door.rotation % 2 === 0 ? { tx: 0, ty: door.ty } : { tx: door.tx, ty: 0 };
    const doorway = (tx, ty) => (tx === opening.tx && ty === opening.ty) || Math.abs(tx - door.tx) + Math.abs(ty - door.ty) <= 1;
    const rec = window.__staff = {
      clip: CLIP, door: { tx: door.tx, ty: door.ty, opening }, payments: [], states: [], fetches: [], dirt: [...screen.dirt],
      leaving: {}, exits: [], free: {}, worst: null, waiting: [], trays: [], clips: {}, floats: [],
    };
    screen.realtime.onEvent((event) => {
      const now = event.serverNow;
      if (event.type === 'dirt') rec.dirt = event.dirt ?? [];
      if (event.type === 'payment') rec.payments.push({ ...event.payment, at: now });
      // Updates leave out the identity (kind, role); the merged state keeps it.
      for (const actor of (event.actors ?? []).map((state) => screen.realtime.actors.get(state.id) ?? state)) {
        if (actor.kind === 'staff') {
          const last = rec.states.findLast((entry) => entry.id === actor.id);
          if (!last || last.state !== actor.state || last.role !== actor.role) rec.states.push({ id: actor.id, role: actor.role, state: actor.state, at: now });
          if (['picking', 'carrying', 'busing', 'cleaning'].includes(actor.state) && !screen.isModalOpen) void window.__staffShot(actor.state);
        } else if (actor.kind === 'npc') {
          if (actor.action?.kind === 'fetching' && !rec.fetches.some((fetch) => fetch.id === actor.id && fetch.startedAt === actor.action.startedAt)) {
            rec.fetches.push({ id: actor.id, startedAt: actor.action.startedAt });
          }
          if (actor.state === 'leaving' && rec.leaving[actor.id] === undefined) rec.leaving[actor.id] = now;
        }
      }
      for (const id of event.removed ?? []) {
        if (rec.leaving[id] === undefined) continue;
        rec.exits.push({ id, ms: now - rec.leaving[id] });
        delete rec.leaving[id];
      }
    });
    const rewards = screen.floatingRewards;
    const spawn = rewards.spawn.bind(rewards);
    rewards.spawn = (...args) => {
      const count = rewards.active.length;
      spawn(...args);
      const row = rewards.active.length > count ? rewards.active.at(-1).view.children.find((child) => child.label === 'floating-tip') : undefined;
      rec.floats.push({ coins: args[3], tip: args[5] ?? 0, text: row?.children.find((child) => child.text !== undefined)?.text ?? null });
    };
    window.__coffeMania.app.ticker.add(() => {
      const now = screen.realtime.serverNowMs();
      const actors = [...screen.realtime.actors.values()];
      const delivering = actors.some((actor) => actor.kind === 'staff' && (actor.state === 'picking' || actor.state === 'carrying'));
      for (const actor of actors) {
        if (actor.kind === 'npc' && delivering && actor.state === 'seated' && !actor.food && rec.waiting.length < 6000) {
          rec.waiting.push({ id: actor.id, now, patience: Boolean(actor.patience) });
        }
        if (actor.kind !== 'staff') continue;
        // Standing still (no step, no work) on the door tile or beside it.
        const moveEnd = actor.move ? actor.move.startedAt + actor.move.duration : 0;
        const actionEnd = actor.action ? actor.action.startedAt + actor.action.duration : 0;
        rec.free[actor.id] ??= now;
        if (now < moveEnd || now < actionEnd || !doorway(actor.tx, actor.ty)) rec.free[actor.id] = now;
        else {
          const ms = now - Math.max(moveEnd, actionEnd, rec.free[actor.id]);
          if (!rec.worst || ms > rec.worst.ms) rec.worst = { id: actor.id, ms, tx: actor.tx, ty: actor.ty, state: actor.state };
        }
        const entry = screen.liveActors.get(actor.id);
        const clip = entry?.view.currentClip;
        if (clip !== undefined) {
          const counts = rec.clips[`${actor.role}:${actor.state}`] ??= {};
          counts[clip] = (counts[clip] ?? 0) + 1;
        }
        if (actor.state === 'carrying' && entry) {
          const dish = entry.view.view.children.find((child) => child.label === 'tray-dish' && !child.destroyed);
          const shown = Boolean(dish?.visible && dish.renderable && dish.getBounds().width > 0);
          rec.trays.push(shown);
          // This listener runs after the render, so the canvas still holds the frame.
          if (shown && !rec.trayFrame && now < moveEnd) {
            rec.trayFrame = true;
            void window.__staffFrame('estado-carrying-quadro', window.__coffeMania.app.canvas.toDataURL('image/png'));
          }
        }
      }
    }, undefined, -50);
  });
  const door = await game.room(() => window.__staff.door);
  run.log('porta', door);

  const serve = async () => {
    await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
      return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
    await sleep(500);
    const stove = await game.stovePoint();
    await game.page.mouse.click(stove.x, stove.y);
    await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
    run.log('prato servido no balcão');
  };
  const modal = () => game.room(() => {
    const { snapshot, busy, message } = window.__coffeMania.screens.active.staffModal;
    return { ...snapshot, busy, message };
  });
  const openStaff = async () => {
    await game.click('room-action-bar-icon-waiter');
    await game.waitFor(() => { const staff = window.__coffeMania.screens.active.staffModal;
      return staff.isOpen && !staff.busy && staff.message !== 'Carregando equipe…' && staff.snapshot; }, undefined, 20000);
    await sleep(500);
  };
  // A team change is done when the window holds `count` employees again.
  const settled = (count) => game.waitFor((count) => { const staff = window.__coffeMania.screens.active.staffModal;
    return !staff.busy && staff.snapshot?.staff.length === count; }, count, 20000);
  const closeStaff = async () => {
    await game.click('staff-modal-close');
    await game.waitFor(() => !window.__coffeMania.screens.active.staffModal.isOpen, undefined, 10000);
    await sleep(400);
  };
  const closeLevelUp = async (timeout) => {
    const open = await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal?.isOpen, undefined, timeout).then(() => true, () => false);
    if (!open) return;
    await sleep(800);
    await game.click('level-up-continue');
    await game.waitFor(() => !window.__coffeMania.screens.active.levelUpModal.isOpen, undefined, 10000);
  };
  const clipCounts = (key) => game.room((key) => window.__staff.clips[key] ?? {}, key);
  const mostly = (counts, allowed) => { const values = Object.entries(counts);
    return values.length > 0 && values.filter(([clip]) => !allowed.includes(Number(clip))).reduce((sum, [, count]) => sum + count, 0) <= 1; };
  const CLIP = await game.room(() => window.__staff.clip);

  // 1. A janela do nível 1: uma vaga, grátis, a próxima no nível do employeeLocks.
  await openStaff();
  const empty = await modal();
  const [firstLock, secondLock] = rules.employeeLocks;
  run.check(empty.level === 1 && empty.slots === firstLock.employees && empty.nextSlotLevel === secondLock.level && empty.staff.length === 0,
    `no nível 1 há ${firstLock.employees} vaga e a próxima abre no nível ${secondLock.level}`, empty);
  run.check(empty.hireCoins === rules.staff.hireCoins[0] && empty.profiles.length === rules.staff.profiles.length,
    `a 1ª vaga custa ${rules.staff.hireCoins[0]} e todos os perfis podem ser contratados`, { hireCoins: empty.hireCoins, profiles: empty.profiles.length });
  const emptyText = await game.texts('staff-modal');
  run.check(emptyText.includes(`Vagas ocupadas: 0 de ${firstLock.employees} · próxima vaga no nível ${secondLock.level}`) && emptyText.includes('Esta vaga não tem taxa'),
    'a janela mostra as vagas e que a vaga não tem taxa', emptyText);
  const cards = await game.room(() => {
    const count = (label) => { let total = 0; const walk = (node) => { if (node.label === label) total++; (node.children ?? []).forEach(walk); };
      walk(window.__coffeMania.screens.active.staffModal.view); return total; };
    return { free: count('staff-slot-free'), locked: count('staff-slot-locked') };
  });
  run.check(cards.free === 1 && cards.locked === rules.employeeLocks.length - 1, 'uma vaga livre e as outras trancadas por nível', cards);
  await game.shot('1-janela-sem-equipe');
  await closeStaff();

  // 2. Sem funcionários os clientes se servem sozinhos. A janela abre logo depois de
  // servir, para contratar enquanto eles comem (as três porções saem juntas).
  await game.cook('pao_de_queijo');
  await serve();
  await openStaff();

  // 3. Contratar o garçom logo depois da 3ª refeição, com clientes comendo: a 1ª vaga não cobra nada.
  await game.waitFor(() => window.__staff.payments.length >= 3, undefined, 240000);
  const beforeHire = await stateRow();
  await game.click('staff-hire-vostu-waiter');
  const eating = await game.room(() => [...window.__coffeMania.screens.active.realtime.actors.values()].filter((actor) => actor.kind === 'npc' && actor.food).length);
  await settled(1);
  run.log('clientes comendo na contratação', eating);
  const hireAt = await game.room(() => window.__staff.payments[2].at);
  const selfServed = await game.room(() => window.__staff.payments.slice(0, 3).map((payment) => ({
    ...payment, fetched: window.__staff.fetches.some((fetch) => fetch.id === payment.actorId && fetch.startedAt < payment.at) })));
  run.check(selfServed.every((payment) => payment.fetched && !payment.tip && payment.coins === recipe.pricePerServing),
    `sem garçom o cliente busca a porção e paga ${recipe.pricePerServing} moedas, sem gorjeta`, selfServed);
  const hiredText = await game.texts('staff-modal');
  run.check(hiredText.includes('Amigo Vostu contratado(a) como Garçom!'), 'a janela confirma a contratação', hiredText);
  await game.shot('2-garcom-contratado');
  const [waiterRow, ...extra] = await staffRows();
  run.check(extra.length === 0 && waiterRow?.profile === 'vostu' && waiterRow.role === 'waiter' && Boolean(waiterRow.appearance),
    'room_staff guarda o Amigo Vostu como garçom, com aparência sorteada', { profile: waiterRow?.profile, role: waiterRow?.role, appearance: waiterRow?.appearance });
  const afterHire = await stateRow();
  run.check(afterHire.gold === beforeHire.gold && (await roomRow()).staff_slots === 1, 'a 1ª vaga é grátis e fica paga em player_rooms.staff_slots',
    { before: beforeHire.gold, after: afterHire.gold });
  await closeStaff();
  const vostu = `staff:${waiterRow.id}`;
  await game.waitFor((id) => window.__coffeMania.screens.active.realtime.actors.has(id), vostu, 20000);
  const waiterActor = await game.room((id) => window.__coffeMania.screens.active.realtime.actors.get(id), vostu);
  run.check(waiterActor.kind === 'staff' && waiterActor.role === 'waiter' && waiterActor.appearance === waiterRow.appearance,
    'o garçom aparece no café com a aparência do banco', { kind: waiterActor.kind, role: waiterActor.role });

  // 4. O garçom recolhe os pratos das refeições, sem XP para o dono.
  await game.waitFor(() => window.__staff.dirt.length === 0 && !window.__coffeMania.screens.active.dirt.length, undefined, BUSING_LIMIT_MS);
  const busedIn = (await game.room(() => window.__coffeMania.screens.active.realtime.serverNowMs())) - hireAt;
  run.log('pratos recolhidos em', `${(busedIn / 1000).toFixed(1)} s`);
  const busing = await game.room((id) => window.__staff.states.filter((entry) => entry.id === id && entry.state === 'busing').length, vostu);
  run.check(busing > 0 && (await plates()).length === 0, `o garçom recolhe os pratos em menos de ${BUSING_LIMIT_MS / 1000} s e room_dirt esvazia`, { busing, seconds: busedIn / 1000 });
  const afterBusing = await stateRow();
  run.check(afterBusing.experience_current === afterHire.experience_current, 'recolher pratos não dá XP ao dono',
    { before: afterHire.experience_current, after: afterBusing.experience_current });
  await game.shot('3-pratos-recolhidos');

  // 5. Com o garçom em serviço, o prato vai do balcão à mesa na bandeja, com gorjeta.
  await game.cook('pao_de_queijo');
  await serve();
  await game.waitFor(() => window.__staff.payments.length >= 5, undefined, 240000);
  await openStaff();
  await game.waitFor(() => window.__staff.payments.length >= 6, undefined, 120000);
  const bundle = await game.room((id) => { window.__staff.oldBundle = window.__coffeMania.screens.active.liveActors.get(id)?.bundle; return Boolean(window.__staff.oldBundle); }, vostu);
  const switchAt = await game.room(() => window.__coffeMania.screens.active.realtime.serverNowMs());
  const goldBeforeSwitch = (await game.player()).gold;
  await game.click('staff-role-vostu');
  await game.waitFor(() => { const staff = window.__coffeMania.screens.active.staffModal; return !staff.busy && staff.snapshot?.staff[0]?.role === 'cleaner'; }, undefined, 20000);
  const goldAfterSwitch = (await game.player()).gold;
  run.log('mesas sujas na troca', await game.room(() => window.__staff.dirt.map((dirt) => `${dirt.tableId}×${dirt.plates}`)));
  const delivered = await game.room(({ hireAt, id }) => {
    const rec = window.__staff;
    return rec.payments.slice(3, 6).map((payment) => {
      const pick = rec.states.filter((entry) => entry.id === id && entry.state === 'picking' && entry.at <= payment.at).at(-1);
      const waits = pick ? rec.waiting.filter((sample) => sample.id === payment.actorId && sample.now >= pick.at && sample.now < payment.at) : [];
      return { ...payment, fetched: rec.fetches.some((fetch) => fetch.id === payment.actorId && fetch.startedAt > hireAt),
        picked: Boolean(pick), samples: waits.length, paused: waits.every((sample) => !sample.patience) };
    });
  }, { hireAt, id: vostu });
  run.log('entregas do garçom', delivered.map(({ coins, tip, samples, paused }) => ({ coins, tip, samples, paused })));
  run.check(delivered.length === 3 && delivered.every((payment) => payment.tip === tip && payment.coins === recipe.pricePerServing + tip && payment.xp === recipe.xpPerServing),
    `cada entrega do garçom paga ${recipe.pricePerServing} + ${tip} de gorjeta`, delivered.map(({ coins, tip, xp }) => ({ coins, tip, xp })));
  const selfService = await game.room(({ from, to }) => window.__staff.fetches.filter((fetch) => fetch.startedAt > from && fetch.startedAt < to), { from: hireAt, to: switchAt });
  run.check(selfService.length === 0 && delivered.every((payment) => !payment.fetched), 'com garçom em serviço nenhum cliente se serve sozinho', selfService);
  run.check(delivered.every((payment) => payment.picked && payment.samples > 0 && payment.paused), 'a paciência do cliente fica pausada enquanto o garçom traz o prato',
    delivered.map(({ actorId, picked, samples, paused }) => ({ actorId, picked, samples, paused })));
  const deliveryStates = await game.room((id) => window.__staff.states.filter((entry) => entry.id === id).map((entry) => entry.state), vostu);
  const picking = deliveryStates.indexOf('picking');
  run.check(picking >= 0 && deliveryStates.indexOf('carrying', picking) > picking, 'o garçom pega no balcão (picking) e depois leva o prato (carrying)', deliveryStates);
  const trays = await game.room(() => window.__staff.trays);
  run.check(trays.length > 0 && trays.every(Boolean), 'enquanto leva o prato, a bandeja mostra o prato', { frames: trays.length, without: trays.filter((tray) => !tray).length });
  const floats = await game.room(() => window.__staff.floats.filter((float) => float.tip > 0));
  run.check(floats.length >= 3 && floats.every((float) => float.text === `+${float.tip} gorjeta`), 'a gorjeta sobe em verde como "+N gorjeta"', floats);
  const waiterClips = { carrying: await clipCounts('waiter:carrying'), picking: await clipCounts('waiter:picking'), busing: await clipCounts('waiter:busing') };
  run.check(mostly(waiterClips.carrying, [CLIP.WAITOR_WALK]) && mostly(waiterClips.picking, [CLIP.WAITOR_WORKING]) && mostly(waiterClips.busing, [CLIP.WAITOR_WORKING]),
    'o garçom usa WAITOR_WALK com a bandeja e WAITOR_WORKING no balcão e na mesa', waiterClips);

  // 6. Trocar para faxineiro: grátis, a mesma aparência e os clipes assados de novo.
  const switchedText = await game.texts('staff-modal');
  run.check(switchedText.includes('Amigo Vostu agora é Faxineiro.'), 'a janela confirma a troca de função', switchedText);
  run.check(goldAfterSwitch === goldBeforeSwitch, 'trocar de função é grátis', { before: goldBeforeSwitch, after: goldAfterSwitch });
  await game.shot('4-virou-faxineiro');
  await closeStaff();
  const [cleanerRow] = await staffRows();
  run.check(cleanerRow.role === 'cleaner' && cleanerRow.appearance === waiterRow.appearance, 'o banco troca só a função, e a aparência continua a mesma', { role: cleanerRow.role });
  await game.waitFor((id) => window.__coffeMania.screens.active.realtime.actors.get(id)?.role === 'cleaner', vostu, 20000);
  const rebaked = bundle && await game.waitFor((id) => { const entry = window.__coffeMania.screens.active.liveActors.get(id);
    return entry?.bundle && entry.bundle !== window.__staff.oldBundle; }, vostu, 90000).then(() => true, () => false);
  run.check(rebaked, 'trocar a função assa os clipes de novo');

  // 7. Só com o faxineiro os clientes se servem sozinhos e ele limpa as mesas.
  await game.cook('pao_de_queijo');
  await serve();
  await game.waitFor(() => window.__staff.payments.length >= 7, undefined, 240000);
  // The 7th serving reaches level 2; its window would hide the cleaner at work.
  await closeLevelUp(5000);
  await game.waitFor(() => window.__staff.payments.length >= 9, undefined, 240000);
  await game.waitFor(() => window.__staff.dirt.length === 0 && ![...window.__coffeMania.screens.active.realtime.actors.values()].some((actor) => actor.food),
    undefined, 120000);
  const cleanerPayments = await game.room((switchAt) => window.__staff.payments.slice(6, 9).map((payment) => ({
    ...payment, fetched: window.__staff.fetches.some((fetch) => fetch.id === payment.actorId && fetch.startedAt > switchAt) })), switchAt);
  run.check(cleanerPayments.every((payment) => payment.fetched && !payment.tip && payment.coins === recipe.pricePerServing),
    'com só o faxineiro os clientes voltam a se servir, sem gorjeta', cleanerPayments.map(({ coins, tip, fetched }) => ({ coins, tip, fetched })));
  const cleanerStates = await game.room((id) => window.__staff.states.filter((entry) => entry.id === id && entry.role === 'cleaner').map((entry) => entry.state), vostu);
  run.check(cleanerStates.includes('cleaning') && !cleanerStates.some((state) => ['picking', 'carrying', 'busing'].includes(state)),
    'o faxineiro só limpa mesas (cleaning), nunca leva pratos', [...new Set(cleanerStates)]);
  run.check((await plates()).length === 0, 'as mesas limpas pelo faxineiro saem de room_dirt');
  const cleanerClips = await clipCounts('cleaner:cleaning');
  run.check(mostly(cleanerClips, [CLIP.CLEAN]), 'o faxineiro limpa com o clipe CLEAN', cleanerClips);
  await game.shot('5-faxineiro-limpou');

  // 8. Nível 7 abre a 2ª vaga: o modal de nível leva à janela, que cobra a taxa única.
  await closeLevelUp(1000);
  const fee = rules.staff.hireCoins[1];
  const level7 = rules.levels.find((entry) => entry.level === secondLock.level);
  const level8 = rules.levels.find((entry) => entry.level === secondLock.level + 1);
  await stack.admin.update('player_state', owner.id, { level: secondLock.level, experience_current: level7.requiredXp, experience_max: level8.requiredXp, gold: fee - 1 });
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal?.isOpen, undefined, 60000);
  await sleep(1500);
  run.check(Boolean(await game.center('level-up-staff-slot')), `o modal do nível ${secondLock.level} mostra a nova vaga de funcionário`);
  await game.shot('6-nivel-7-nova-vaga');
  await game.click('level-up-staff');
  await game.waitFor(() => { const staff = window.__coffeMania.screens.active.staffModal;
    return staff.isOpen && !staff.busy && staff.message !== 'Carregando equipe…'; }, undefined, 20000);
  await sleep(500);
  const second = await modal();
  const thirdLock = rules.employeeLocks[2];
  run.check(second.slots === secondLock.employees && second.hireCoins === fee && second.nextSlotLevel === thirdLock.level,
    `no nível ${secondLock.level} há ${secondLock.employees} vagas e a 2ª custa ${fee}`, { slots: second.slots, hireCoins: second.hireCoins, next: second.nextSlotLevel });
  const poorChip = await game.texts('staff-hire-fee');
  run.check(poorChip === `Taxa desta vaga: ${fee} moedas · faltam 1`, 'sem moedas a janela mostra quanto falta', poorChip);
  await game.click('staff-hire-juninho-waiter');
  await sleep(1500);
  run.check((await staffRows()).length === 1 && (await modal()).staff.length === 1, 'sem moedas o botão de contratar não faz nada');
  await game.shot('7-taxa-sem-moedas');
  await closeStaff();

  await stack.admin.update('player_state', owner.id, { gold: 1000 });
  await game.waitFor(() => window.__coffeMania.screens.active.topBars.labelTexts[1] === '1000', undefined, 30000);
  await openStaff();
  const richChip = await game.texts('staff-hire-fee');
  run.check(richChip === `Taxa desta vaga: ${fee} moedas`, 'com moedas a janela mostra a taxa da vaga', richChip);
  await game.click('staff-hire-juninho-waiter');
  await settled(2);
  const paid = await game.player();
  const paidRoom = await roomRow();
  const team = await staffRows();
  run.check(paid.gold === 1000 - fee && paidRoom.staff_slots === 2 && team.length === 2, `a 2ª vaga cobra ${fee} moedas uma vez`, { gold: paid.gold, slots: paidRoom.staff_slots, team: team.map((row) => row.profile) });
  await game.waitFor((gold) => window.__coffeMania.screens.active.topBars.labelTexts[1] === String(gold), paid.gold, 30000).catch(() => {});
  const hud = await game.room(() => window.__coffeMania.screens.active.topBars.labelTexts[1]);
  run.check(hud === String(paid.gold), 'o HUD mostra as moedas depois da taxa', { hud, gold: paid.gold });
  const full = await game.texts('staff-modal');
  run.check(full.includes('Juninho contratado(a) como Garçom!') && full.includes('Sem vaga livre') && !await game.center('staff-hire-beto-waiter'),
    'com as vagas cheias não há como contratar', full);
  const juninho = `staff:${team.find((row) => row.profile === 'juninho').id}`;
  await game.waitFor((id) => window.__coffeMania.screens.active.realtime.actors.get(id)?.role === 'waiter', juninho, 20000);
  await game.shot('8-segunda-vaga-paga');

  // 9. Dispensar e recontratar na vaga já paga: grátis.
  await game.click('staff-dismiss-juninho');
  await settled(1);
  const dismissed = await modal();
  const dismissedChip = await game.texts('staff-hire-fee');
  run.check(dismissed.hireCoins === 0 && dismissed.paidSlots === 2 && dismissedChip === 'Esta vaga não tem taxa', 'a vaga dispensada continua paga', { hireCoins: dismissed.hireCoins, paidSlots: dismissed.paidSlots, dismissedChip });
  run.check((await staffRows()).length === 1, 'dispensar apaga o registro do funcionário');
  await game.waitFor((id) => !window.__coffeMania.screens.active.realtime.actors.has(id), juninho, 20000).catch(() => {});
  run.check(!await game.room((id) => window.__coffeMania.screens.active.realtime.actors.has(id), juninho), 'o funcionário dispensado sai do café');
  await game.click('staff-hire-marcinha-waiter');
  await settled(2);
  const rehired = await game.player();
  run.check(rehired.gold === paid.gold && (await roomRow()).staff_slots === 2 && (await staffRows()).length === 2, 'recontratar na vaga já paga é grátis', { before: paid.gold, after: rehired.gold });
  await game.shot('9-recontratado-gratis');
  await closeStaff();

  // 10. Ninguém trava a porta: funcionário parado ali sai em 2 s e os clientes saem do café.
  const marcinha = `staff:${(await staffRows()).find((row) => row.profile === 'marcinha').id}`;
  await game.waitFor((id) => window.__coffeMania.screens.active.realtime.actors.has(id), marcinha, 20000);
  await sleep(8000);
  const door2 = await game.room(() => {
    const rec = window.__staff;
    const now = window.__coffeMania.screens.active.realtime.serverNowMs();
    return { worst: rec.worst, exits: rec.exits, stuck: Object.entries(rec.leaving).filter(([, since]) => now - since > 60000) };
  });
  run.log('mais tempo parado na porta', door2.worst);
  run.check(!door2.worst || door2.worst.ms <= DOORWAY_GRACE_MS + DOORWAY_SLACK_MS, `nenhum funcionário fica parado na porta por mais de ${DOORWAY_GRACE_MS / 1000} s`, door2.worst);
  const slowest = door2.exits.reduce((max, exit) => Math.max(max, exit.ms), 0);
  run.check(door2.exits.length > 0 && slowest < EXIT_LIMIT_MS && door2.stuck.length === 0, 'todo cliente que sai chega à rua', { exits: door2.exits.length, slowestMs: slowest, stuck: door2.stuck });
  const finalTeam = await game.room(() => [...window.__coffeMania.screens.active.realtime.actors.values()].filter((actor) => actor.kind === 'staff').map((actor) => actor.role).sort());
  run.check(JSON.stringify(finalTeam) === JSON.stringify(['cleaner', 'waiter']), 'o café termina com o faxineiro e a garçonete', finalTeam);
  await game.shot('10-equipe-final');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
  await game?.shot('falha').catch(() => {});
} finally {
  // Só o 401 antes do login.
  await run.finish({ allow: [/status of 401/] });
  await stack.stop();
}
