// Expansão do café e vagas de funcionário (Sprints 6–7) no modo servidor com
// banco novo: a loja abre a Expansão do Café, que no nível 1 recusa moedas (o
// servidor também) e aceita Grana como atalho sem nível; 8×8 → 10×10 com piso
// e paredes novos no visual atual, prêmio de moedas e XP (com subida de nível),
// a grade cresce ao vivo e brilha; no nível 7 o atalho "Contratar" do modal de
// nível abre a equipe: 1ª vaga grátis, taxa única da 2ª, recontratar na vaga
// paga e trocar de função sem cobrar; no nível 10 o atalho "Expandir" compra
// 12×12 com moedas, o pedido repetido não cobra de novo e o avatar anda até o
// canto novo; por fim, sem garçom, o autosserviço leva selfPickupMs com a
// paciência pausada e paga sem gorjeta.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('expansion');

try {
  const game = await run.page();
  await login(game, stack.web);
  await game.skipDaily();

  // Room events, the expansion answers, the notices and the sounds, from here to the end.
  await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const log = window.__expansion = { worlds: [], results: [], toasts: [], sounds: [], payments: [], fetches: [] };
    screen.realtime.onEvent((event) => {
      if (event.type === 'world' && event.tilesX) log.worlds.push({ tilesX: event.tilesX, tilesY: event.tilesY, revision: event.revision, units: (event.units ?? []).length });
      if (event.type === 'payment') log.payments.push({ ...event.payment, serverNow: event.serverNow });
      // Hot updates leave out static fields such as `kind`; the merged state has them.
      for (const update of event.actors ?? []) {
        const actor = screen.realtime.actors.get(update.id) ?? update;
        if (actor.kind !== 'npc' || actor.action?.kind !== 'fetching') continue;
        if (!log.fetches.some((entry) => entry.actor === actor.id && entry.startedAt === actor.action.startedAt)) {
          log.fetches.push({ actor: actor.id, state: actor.state, startedAt: actor.action.startedAt, duration: actor.action.duration, patience: actor.patience ?? null });
          // The pickup lasts 3.5 s: the first one is captured from here, not by polling.
          if (log.fetches.length === 1) window.__fetchShot?.();
        }
      }
    });
    const client = screen.expansionModal.options.client;
    const expand = client.expand.bind(client);
    client.expand = async (...args) => { const result = await expand(...args); log.results.push(result); return result; };
    const toast = screen.levelUpToast;
    const showMessage = toast.showMessage.bind(toast);
    toast.showMessage = (title, detail) => { log.toasts.push(`${title} | ${detail}`); return showMessage(title, detail); };
    const audio = window.__coffeMania.audio;
    const play = audio.play.bind(audio);
    audio.play = (name, ...rest) => { log.sounds.push(name); return play(name, ...rest); };
  });

  const rules = await game.room(() => window.__coffeMania.screens.active.rules);
  const { startTiles, rewardCoins, steps } = rules.expansions;
  const [first, second] = steps;
  const pao = rules.recipes.find((entry) => entry.id === 'pao_de_queijo');
  const fees = rules.staff.hireCoins;
  const levelRule = (level) => rules.levels.find((entry) => entry.level === level);
  const [owner] = await stack.admin.list('player_state');
  const player = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0];
  const room = async () => (await stack.admin.list('player_rooms', `user = "${owner.user}"`))[0];
  const placed = () => stack.admin.list('player_inventory', `user = "${owner.user}" && placed = true`);
  const expansion = () => game.room(() => window.__expansion);
  const amount = (value) => value.toLocaleString('pt-BR');
  // What Grant (shared/cafe/player.go) does with a reward: XP total, level by the table, level coins.
  const granted = (state, coins, xp) => {
    const total = state.experience_current + xp;
    const byXp = rules.levels.filter((entry) => entry.requiredXp <= total).at(-1).level;
    const level = Math.max(state.level, byXp);
    const levelReward = rules.levels.filter((entry) => entry.level > state.level && entry.level <= level).reduce((sum, entry) => sum + entry.rewardCoins, 0);
    return { gold: state.gold + coins + levelReward, xp: total, level, levelReward };
  };
  const expandApi = (tiles, pay) => game.room(async ([tiles, pay]) => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch('/api/coffe/room/expand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tiles, pay }) });
    return { status: response.status, message: (await response.json()).message };
  }, [tiles, pay]);
  const buyEnabled = (pay) => game.room((pay) => window.__coffeMania.app.stage.getChildByLabel(`expansion-buy-${pay}`, true)?.eventMode === 'static', pay);
  const closeLevelUp = async () => {
    if (await game.room(() => window.__coffeMania.screens.active.levelUpModal.isOpen)) {
      await game.click('level-up-continue');
      await sleep(500);
    }
  };
  // The new floor, walls and wallpapers of one step, against the units placed before it.
  const structure = async (before, from, to) => {
    const after = await placed();
    const known = new Set(before.map((unit) => unit.id));
    const fresh = after.filter((unit) => !known.has(unit.id));
    const mostUsed = (units) => {
      const counts = new Map();
      for (const unit of units) counts.set(unit.item_id, (counts.get(unit.item_id) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    };
    const floor = mostUsed(before.filter((unit) => unit.layer === 'floor'));
    const paper = [0, 1].map((side) => mostUsed(before.filter((unit) => unit.layer === 'wallpaper' && unit.rotation % 2 === side)));
    // The last segment of each back wall before the step: the new walls continue it.
    const segment = [0, 1].map((side) => before.find((unit) => unit.layer === 'structure' && unit.rotation === side &&
      (side === 0 ? unit.tx === 0 && unit.ty === from - 1 : unit.ty === 0 && unit.tx === from - 1))?.item_id);
    const key = (unit) => `${unit.tx},${unit.ty}`;
    const expectedFloor = [];
    for (let ty = 1; ty < to; ty++) for (let tx = 1; tx < to; tx++) if (tx >= from || ty >= from) expectedFloor.push(`${tx},${ty}`);
    const expectedWalls = [];
    for (let i = from; i < to; i++) expectedWalls.push({ tx: 0, ty: i, rotation: 0 }, { tx: i, ty: 0, rotation: 1 });
    const floors = fresh.filter((unit) => unit.layer === 'floor');
    const walls = fresh.filter((unit) => unit.layer === 'structure');
    const papers = fresh.filter((unit) => unit.layer === 'wallpaper');
    const wallAt = (list, wall) => list.filter((unit) => unit.tx === wall.tx && unit.ty === wall.ty && unit.rotation === wall.rotation);
    return {
      fresh: fresh.length,
      floorOk: floors.length === expectedFloor.length && floors.every((unit) => unit.item_id === floor) && expectedFloor.every((tile) => floors.some((unit) => key(unit) === tile)),
      wallsOk: walls.length === expectedWalls.length && expectedWalls.every((wall) => wallAt(walls, wall).length === 1 && wallAt(walls, wall)[0].item_id === segment[wall.rotation]),
      papersOk: papers.length === expectedWalls.length && expectedWalls.every((wall) => wallAt(papers, wall).length === 1 && wallAt(papers, wall)[0].item_id === paper[wall.rotation]),
      floorTotal: after.filter((unit) => unit.layer === 'floor').length,
      detail: { floors: floors.length, expectedFloors: expectedFloor.length, walls: walls.map(key), papers: papers.map(key), floor, paper, segment },
    };
  };
  // Waits for the café to reach `tiles` on screen; the new tiles light up meanwhile.
  const grown = (tiles) => game.waitFor((tiles) => {
    const screen = window.__coffeMania.screens.active;
    return screen.model.tilesX === tiles && screen.model.tilesY === tiles ? { glows: screen.expansionGlows.length } : null;
  }, tiles, 30000).then((handle) => handle.jsonValue());
  const clientFloor = () => game.room(() => {
    const screen = window.__coffeMania.screens.active;
    // Catalog type 0 is the floor layer (roomcatalog.Layer).
    const floors = new Set(screen.roomSnapshot.catalog.filter((item) => item.type === 0).map((item) => item.id));
    return screen.roomSnapshot.inventory.filter((unit) => unit.placed && floors.has(unit.itemId)).length;
  });

  const staffSnapshot = () => game.room(() => window.__coffeMania.screens.active.staffModal.snapshot);
  const hireChip = () => game.texts('staff-hire-fee');
  // The window is open with the team loaded and no request running.
  const staffReady = async () => {
    await game.waitFor(() => { const modal = window.__coffeMania.screens.active.staffModal; return modal.isOpen && modal.snapshot && !modal.busy && modal.message === ''; }, undefined, 20000);
    await sleep(700);
  };
  const waitLabel = (label, present = true) => game.waitFor(([label, present]) => Boolean(window.__coffeMania.app.stage.getChildByLabel(label, true)) === present, [label, present], 20000);

  // 1. Café novo: 8×8, nível 1 e a Grana inicial.
  const start = await player();
  const startRoom = await room();
  run.check(startRoom.tiles_x === startTiles && startRoom.tiles_y === startTiles && start.level === 1, `o café nasce ${startTiles}×${startTiles} no nível 1`, { tiles: [startRoom.tiles_x, startRoom.tiles_y], level: start.level });
  run.check(start.cash >= first.cash && start.gold < first.coins, `a conta nova tem Grana para o atalho (${first.cash}) e não as ${amount(first.coins)} moedas`, { gold: start.gold, cash: start.cash });

  // 2. Loja → "Expandir café": no nível 1 só a Grana compra o 10×10.
  await game.click('room-action-bar-icon-house');
  await game.waitFor(() => window.__coffeMania.screens.active.storeBar?.isOpen, undefined, 15000);
  await sleep(1200);
  await game.shot('1-loja-expandir');
  await game.click('store-expand-button');
  await game.waitFor(() => window.__coffeMania.screens.active.expansionModal?.isOpen, undefined, 15000);
  await sleep(800);
  run.check(!await game.room(() => window.__coffeMania.screens.active.storeBar.isOpen), 'a loja fecha para o café ficar à vista');
  const coinsCard = await game.texts('expansion-card-coins');
  const cashCard = await game.texts('expansion-card-cash');
  const reward = await game.texts('expansion-reward');
  run.check(coinsCard.includes(`${amount(first.coins)} moedas`) && coinsCard.includes(`Requer nível ${first.level} (você: 1)`) && !await buyEnabled('coins'),
    `com moedas o ${first.tiles}×${first.tiles} exige o nível ${first.level}`, coinsCard);
  run.check(cashCard.includes(`${first.cash} Grana`) && cashCard.includes('Sem exigência de nível') && await buyEnabled('cash'), `com Grana (${first.cash}) não há exigência de nível`, cashCard);
  run.check(reward.includes(`Recompensa: +${amount(rewardCoins)} moedas · +${first.xp} XP`), `a recompensa é +${rewardCoins} moedas e +${first.xp} XP`, reward);
  await game.shot('2-expansao-10x10-nivel-1');
  const refused = await expandApi(first.tiles, 'coins');
  const unchanged = await player();
  run.check(refused.status === 409 && /Nível insuficiente/.test(refused.message ?? '') && unchanged.gold === start.gold && unchanged.cash === start.cash,
    'o servidor recusa moedas abaixo do nível e não cobra nada', refused);

  const beforeCash = await player();
  const unitsBefore = await placed();
  await game.click('expansion-buy-cash');
  const glowCash = await grown(first.tiles);
  await sleep(600);
  await game.shot('3-cafe-ampliado-10x10');
  await game.waitFor(() => window.__expansion.results.length >= 1, undefined, 15000);
  await sleep(1500);
  await closeLevelUp();
  await game.shot('4-piso-e-paredes-10x10');
  const cashResult = (await expansion()).results[0];
  const afterCash = await player();
  const expectCash = granted(beforeCash, rewardCoins, first.xp);
  run.check(cashResult.tiles === first.tiles && cashResult.pay === 'cash' && cashResult.cash === first.cash && cashResult.coins === 0 &&
    cashResult.rewardCoins === rewardCoins && cashResult.xp === first.xp && cashResult.level === expectCash.level && (cashResult.levelReward ?? 0) === expectCash.levelReward,
  'o servidor responde com o passo pago em Grana, o prêmio e o nível', cashResult && { ...cashResult, room: undefined });
  run.check(afterCash.cash === beforeCash.cash - first.cash && afterCash.gold === expectCash.gold && afterCash.experience_current === expectCash.xp && afterCash.level === expectCash.level,
    `o banco debita ${first.cash} Grana e credita ${rewardCoins} moedas e ${first.xp} XP${expectCash.levelReward ? ` (mais ${expectCash.levelReward} do nível ${expectCash.level})` : ''}`,
    { before: { gold: beforeCash.gold, cash: beforeCash.cash, xp: beforeCash.experience_current, level: beforeCash.level }, after: { gold: afterCash.gold, cash: afterCash.cash, xp: afterCash.experience_current, level: afterCash.level } });
  const roomCash = await room();
  run.check(roomCash.tiles_x === first.tiles && roomCash.tiles_y === first.tiles && roomCash.revision === startRoom.revision + 1, `o quarto passa a ${first.tiles}×${first.tiles} com uma revisão nova`, { tiles: [roomCash.tiles_x, roomCash.tiles_y], revision: [startRoom.revision, roomCash.revision] });
  const cashStructure = await structure(unitsBefore, startTiles, first.tiles);
  run.check(cashStructure.floorOk, 'os tiles novos recebem o piso mais usado do café', cashStructure.detail);
  run.check(cashStructure.wallsOk && cashStructure.papersOk, 'as paredes novas continuam o segmento e o papel de parede de cada lado', cashStructure.detail);
  const cashWorld = (await expansion()).worlds.find((world) => world.tilesX === first.tiles);
  run.check(cashWorld?.tilesY === first.tiles && cashWorld.units === cashStructure.fresh && cashWorld.revision === roomCash.revision, 'o evento world leva o tamanho novo e as unidades novas a quem está no café', cashWorld);
  run.check(glowCash.glows > 0 && await clientFloor() === cashStructure.floorTotal, 'a tela redesenha o piso sem recarregar e os tiles novos brilham', { glowCash, floor: cashStructure.floorTotal });
  const cashLog = await expansion();
  run.check(cashLog.toasts.includes(`Café ampliado! | ${first.tiles}×${first.tiles} · +${rewardCoins} moedas · +${first.xp} XP`) && cashLog.sounds.includes('levelUp'),
    'o dono vê "Café ampliado!" com o prêmio e ouve a fanfarra', cashLog.toasts);
  run.check(await game.room(() => window.__coffeMania.screens.active.topBars.labelTexts[0]) === String(afterCash.cash), 'o HUD mostra a Grana que sobrou', afterCash.cash);

  // 3. Nível 7: o modal de nível mostra a vaga nova (o 10×10 já foi comprado) e leva à equipe.
  const level7 = levelRule(7);
  await stack.admin.update('player_state', owner.id, { level: 7, experience_current: level7.requiredXp, experience_max: levelRule(8).requiredXp });
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal?.isOpen, undefined, 30000);
  await sleep(900);
  await game.shot('5-nivel-7-vaga-nova');
  const level7Text = await game.texts('level-up-modal');
  run.check(level7Text.includes('Nível 7!') && Boolean(await game.center('level-up-staff-slot')) && !await game.center(`level-up-expansion-${first.tiles}`) &&
    level7Text.includes(`expansão ${second.tiles}×${second.tiles} no nível ${second.level}`), 'no nível 7 abre uma vaga; a expansão já comprada não aparece', level7Text);
  await game.click('level-up-staff');
  await staffReady();

  // 4. Vagas: a 1ª é grátis, a 2ª cobra a taxa uma vez; a vaga paga recontrata sem cobrar.
  const open = await staffSnapshot();
  run.check(open.slots === rules.employeeLocks.filter((lock) => lock.level <= 7).at(-1).employees && open.staff.length === 0 && open.hireCoins === fees[0],
    'no nível 7 o café tem 2 vagas e a 1ª não tem taxa', { slots: open.slots, hireCoins: open.hireCoins });
  run.check(await hireChip() === 'Esta vaga não tem taxa', 'a janela diz que a 1ª vaga não tem taxa', await hireChip());
  const goldStaff = (await player()).gold;
  await game.click('staff-hire-vostu-cleaner');
  await waitLabel('staff-member-vostu');
  await sleep(600);
  run.check((await player()).gold === goldStaff && (await room()).staff_slots === 1, 'contratar na 1ª vaga não cobra', { gold: (await player()).gold, slots: (await room()).staff_slots });
  const secondFee = await staffSnapshot();
  run.check(secondFee.hireCoins === fees[1] && (await hireChip()).startsWith(`Taxa desta vaga: ${amount(fees[1])} moedas`), `a 2ª vaga mostra a taxa de ${fees[1]} moedas`, { hireCoins: secondFee.hireCoins, chip: await hireChip() });
  await game.shot('6-taxa-da-segunda-vaga');
  await game.click('staff-hire-juninho-cleaner');
  await waitLabel('staff-member-juninho');
  await sleep(600);
  const paidGold = (await player()).gold;
  run.check(paidGold === goldStaff - fees[1] && (await room()).staff_slots === 2, `a 2ª vaga cobra ${fees[1]} moedas uma vez`, { before: goldStaff, after: paidGold, slots: (await room()).staff_slots });
  await game.click('staff-dismiss-juninho');
  await waitLabel('staff-member-juninho', false);
  await sleep(600);
  // Reopened, the window explains the fee of the free slot instead of the last action.
  await game.click('staff-modal-close');
  await sleep(500);
  await game.click('room-action-bar-icon-waiter');
  await staffReady();
  const paidSlot = await staffSnapshot();
  const paidNote = await game.texts('staff-modal-panel');
  run.check(paidSlot.hireCoins === 0 && paidSlot.paidSlots === 2 && paidNote.includes('Esta vaga já foi paga: contratar de novo é grátis.') && await hireChip() === 'Esta vaga não tem taxa',
    'depois de dispensar, a vaga paga fica sem taxa', { hireCoins: paidSlot.hireCoins, paidSlots: paidSlot.paidSlots, paidNote });
  await game.shot('7-vaga-ja-paga');
  await game.click('staff-hire-marcinha-cleaner');
  await waitLabel('staff-member-marcinha');
  await sleep(600);
  run.check((await player()).gold === paidGold && (await room()).staff_slots === 2, 'recontratar na vaga paga não cobra', { gold: (await player()).gold, slots: (await room()).staff_slots });
  // Changing role is always free; she ends as a cleaner so customers serve themselves later.
  for (const role of ['waiter', 'cleaner']) {
    await game.click('staff-role-marcinha');
    await game.waitFor((role) => window.__coffeMania.screens.active.staffModal.snapshot?.staff.some((member) => member.profile === 'marcinha' && member.role === role), role, 20000);
    await sleep(500);
  }
  const team = await stack.admin.list('room_staff', `user = "${owner.user}"`);
  run.check((await player()).gold === paidGold && team.length === 2 && team.every((member) => member.role === 'cleaner') && team.map((member) => member.profile).sort().join() === 'marcinha,vostu',
    'trocar de função duas vezes não cobra e a equipe fica com dois faxineiros', { gold: (await player()).gold, team: team.map((member) => [member.profile, member.role]) });
  await game.shot('8-equipe');
  await game.click('staff-modal-close');
  await sleep(500);
  const cleaners = await game.waitFor(() => {
    const staff = [...window.__coffeMania.screens.active.realtime.actors.values()].filter((actor) => actor.kind === 'staff');
    return staff.length === 2 && staff.every((actor) => actor.role === 'cleaner') ? staff.length : null;
  }, undefined, 30000).then((handle) => handle.jsonValue(), () => 0);
  run.check(cleaners === 2, 'os dois faxineiros entram no café');

  // 5. Nível 10: o atalho "Expandir" do modal de nível compra o 12×12 com moedas.
  const level10 = levelRule(10);
  const coinsGold = second.coins + 100;
  await stack.admin.update('player_state', owner.id, { level: 10, experience_current: level10.requiredXp, experience_max: levelRule(11).requiredXp, gold: coinsGold });
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal?.isOpen, undefined, 30000);
  await sleep(900);
  await game.shot('9-nivel-10-com-expansao');
  const card = await game.texts(`level-up-expansion-${second.tiles}`);
  run.check(card.includes(`${second.tiles}×${second.tiles}`) && card.includes(`${amount(second.coins)} moedas`), `no nível ${second.level} o modal mostra a expansão ${second.tiles}×${second.tiles}`, card);
  await game.click('level-up-expand');
  await game.waitFor(() => window.__coffeMania.screens.active.expansionModal?.isOpen, undefined, 15000);
  await sleep(800);
  const beforeCoins = await player();
  const missing = second.cash - beforeCoins.cash;
  const secondCoins = await game.texts('expansion-card-coins');
  const secondCash = await game.texts('expansion-card-cash');
  run.check(secondCoins.includes(`Nível ${second.level} alcançado ✓`) && await buyEnabled('coins'), `no nível ${second.level} as moedas compram o ${second.tiles}×${second.tiles}`, secondCoins);
  run.check(missing > 0 && secondCash.includes(`Faltam ${missing} Grana`) && !await buyEnabled('cash'), `a Grana que sobrou não paga os ${second.cash} do atalho`, { cash: beforeCoins.cash, secondCash });
  await game.shot('10-expansao-12x12-moedas');
  const unitsCoins = await placed();
  const roomBefore = await room();
  await game.click('expansion-buy-coins');
  const glowCoins = await grown(second.tiles);
  await sleep(600);
  await game.shot('11-cafe-ampliado-12x12');
  await game.waitFor(() => window.__expansion.results.length >= 2, undefined, 15000);
  await sleep(1500);
  await closeLevelUp();
  const coinsResult = (await expansion()).results[1];
  const afterCoins = await player();
  const expectCoins = granted({ ...beforeCoins, gold: beforeCoins.gold - second.coins }, rewardCoins, second.xp);
  run.check(coinsResult.pay === 'coins' && coinsResult.coins === second.coins && coinsResult.cash === 0 && coinsResult.rewardCoins === rewardCoins && coinsResult.xp === second.xp,
    'o servidor responde com o passo pago em moedas e o prêmio', coinsResult && { ...coinsResult, room: undefined });
  run.check(afterCoins.gold === expectCoins.gold && afterCoins.cash === beforeCoins.cash && afterCoins.experience_current === expectCoins.xp && afterCoins.level === expectCoins.level,
    `o banco debita ${amount(second.coins)} moedas e credita ${rewardCoins} moedas e ${second.xp} XP`,
    { before: { gold: beforeCoins.gold, cash: beforeCoins.cash, xp: beforeCoins.experience_current }, after: { gold: afterCoins.gold, cash: afterCoins.cash, xp: afterCoins.experience_current } });
  const roomCoins = await room();
  const coinsStructure = await structure(unitsCoins, first.tiles, second.tiles);
  run.check(roomCoins.tiles_x === second.tiles && roomCoins.tiles_y === second.tiles && roomCoins.revision === roomBefore.revision + 1 &&
    coinsStructure.floorOk && coinsStructure.wallsOk && coinsStructure.papersOk && coinsStructure.floorTotal === (second.tiles - 1) ** 2,
  `o ${second.tiles}×${second.tiles} ganha piso e paredes no mesmo visual (${(second.tiles - 1) ** 2} tiles de piso)`, { tiles: roomCoins.tiles_x, ...coinsStructure.detail, floorTotal: coinsStructure.floorTotal });
  run.check(glowCoins.glows > 0 && await clientFloor() === coinsStructure.floorTotal, 'a tela acompanha o 12×12 ao vivo', { glowCoins });
  run.check((await expansion()).toasts.includes(`Café ampliado! | ${second.tiles}×${second.tiles} · +${rewardCoins} moedas · +${second.xp} XP`), `"Café ampliado!" mostra o ${second.tiles}×${second.tiles} e o prêmio`, (await expansion()).toasts);
  const repeated = await expandApi(second.tiles, 'coins');
  const afterRepeat = await player();
  run.check(repeated.status === 409 && /tamanho do café mudou/.test(repeated.message ?? '') && afterRepeat.gold === afterCoins.gold && (await room()).revision === roomCoins.revision,
    'repetir o pedido do mesmo passo não cobra de novo', { repeated, gold: afterRepeat.gold });

  // O avatar anda até o canto da frente, que só existe depois da expansão.
  const corner = second.tiles - 1;
  const walked = await game.room(async (corner) => {
    const realtime = window.__coffeMania.screens.active.realtime;
    try { await realtime.command('walk', { tx: corner, ty: corner }); } catch (error) { return { refused: error.message }; }
    for (let i = 0; i < 240; i++) {
      const self = realtime.actors.get(realtime.selfId);
      if (self?.tx === corner && self.ty === corner) return { tx: self.tx, ty: self.ty };
      await new Promise((done) => setTimeout(done, 250));
    }
    const self = realtime.actors.get(realtime.selfId);
    return { stuck: true, tx: self?.tx, ty: self?.ty };
  }, corner);
  run.check(walked.tx === corner && walked.ty === corner, `o avatar anda até o tile novo (${corner},${corner})`, walked);
  // The front corner sits under the action bar: drag the scene up, as a player would, to see it.
  await game.page.mouse.move(1450, 420);
  await game.page.mouse.down();
  for (let i = 1; i <= 10; i++) { await game.page.mouse.move(1450, 420 - i * 25); await sleep(80); }
  await game.page.mouse.up();
  await sleep(1500);
  await game.shot('12-avatar-no-canto-novo');

  // 6. Sem garçom: o cliente busca a porção no balcão em selfPickupMs, com a paciência pausada.
  await game.page.exposeFunction('__fetchShot', () => game.shot('13-autosservico-balao-azul'));
  await game.cook(pao.id);
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
    return job && Date.parse(job.readyAt.replace(' ', 'T')) + 500 <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
  await sleep(500);
  const stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 30000);
  await game.waitFor(() => window.__expansion.fetches.length > 0, undefined, 240000);
  await game.waitFor(() => { const log = window.__expansion; return log.fetches.some((fetch) => log.payments.some((payment) => payment.actorId === fetch.actor)); }, undefined, 60000);
  const served = await expansion();
  const fetch = served.fetches.find((entry) => served.payments.some((payment) => payment.actorId === entry.actor));
  const payment = served.payments.find((entry) => entry.actorId === fetch.actor);
  const delay = payment.serverNow - fetch.startedAt;
  run.log('autosserviço: do início da busca ao pagamento,', delay, 'ms no relógio do servidor');
  run.check(fetch.duration === rules.service.selfPickupMs && fetch.state === 'seated', `buscar a porção leva ${rules.service.selfPickupMs} ms`, fetch);
  run.check(fetch.patience === null, 'a paciência fica pausada enquanto o cliente busca a porção', fetch.patience);
  // The room ticks every 333 ms and /consume runs after the pickup ends.
  run.check(delay >= rules.service.selfPickupMs && delay < rules.service.selfPickupMs + 1500, `o pagamento sai ${rules.service.selfPickupMs} ms depois do início da busca, no relógio do servidor`, { delay });
  run.check(payment.recipeId === pao.id && payment.coins === pao.pricePerServing && !payment.tip, 'no autosserviço o cliente paga o prato sem gorjeta', payment);
  await sleep(1500);
  await game.shot('14-autosservico-pago');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 before the login and the deliberate 409s (coins below the level, the repeated step).
  await run.finish({ allow: [/status of 40[19]/] });
  await stack.stop();
}
