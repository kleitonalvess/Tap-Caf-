// Subida de nível (Sprint 8) no modo servidor com banco novo: o pagamento de um
// cliente que cruza o XP do nível traz levelUp e o prêmio de rules.levels, o banco
// credita o prêmio junto com a refeição, a janela "Nível N!" mostra o prêmio, os
// cartões do que abriu (receitas, nova vaga de funcionário, expansão; vários níveis
// de uma vez somam tudo e passam de quatro cartões com "e mais N") e os próximos
// objetivos; os atalhos "Ver receitas" (livro com a receita nova liberada),
// "Contratar" (equipe com a vaga nova) e "Expandir" (próximo passo da expansão);
// com outra janela aberta a subida cai no aviso curto; cada nível é celebrado uma
// vez (a fanfarra toca uma vez) e recarregar a página não repete a celebração.
import { login, scenario, sleep } from './lib/browser.mjs';
import { startServers } from './lib/stack.mjs';

const stack = await startServers();
const run = await scenario('level-up');

try {
  const game = await run.page();
  await login(game, stack.web);
  await game.skipDaily();
  const [owner] = await stack.admin.list('player_state');
  const state = async () => (await stack.admin.list('player_state', `id = "${owner.id}"`))[0];
  const rules = await game.room(() => {
    const { levels, recipes, employeeLocks, expansions } = window.__coffeMania.screens.active.rules;
    return { levels, recipes, employeeLocks, expansions };
  });
  const startTiles = await game.room(() => Math.max(window.__coffeMania.screens.active.model.tilesX, window.__coffeMania.screens.active.model.tilesY));

  // O que as regras dizem de cada subida: XP exigido, prêmio somado, receitas,
  // vagas e expansões entre dois níveis, e os próximos objetivos.
  const requiredXp = (level) => rules.levels.find((row) => row.level === level).requiredXp;
  const reward = (from, to) => rules.levels.filter((row) => row.level > from && row.level <= to).reduce((sum, row) => sum + row.rewardCoins, 0);
  const slots = (level) => rules.employeeLocks.reduce((count, lock) => (level >= lock.level ? lock.employees : count), 0);
  const opened = (from, to) => ({
    recipes: rules.recipes.filter((recipe) => recipe.level > from && recipe.level <= to),
    slot: slots(to) > slots(from),
    expansions: rules.expansions.steps.filter((step) => step.level > from && step.level <= to && step.tiles > startTiles),
  });
  const goals = (level) => {
    const upcoming = rules.recipes.filter((recipe) => recipe.level > level);
    const recipeLevel = Math.min(...upcoming.map((recipe) => recipe.level));
    const lines = upcoming.filter((recipe) => recipe.level === recipeLevel).map((recipe) => `${recipe.name}`).join(', ');
    const lock = rules.employeeLocks.find((entry) => entry.level > level);
    const step = rules.expansions.steps.find((entry) => entry.level > level && entry.tiles > startTiles);
    return [`${lines} no nível ${recipeLevel}`, `nova vaga no nível ${lock.level}`, `expansão ${step.tiles}×${step.tiles} no nível ${step.level}`];
  };

  // Gravador: pagamentos, cada janela de nível e aviso curto pedidos pela tela e a fanfarra.
  await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const log = window.__levels = { payments: [], modals: [], toasts: [], fanfares: 0 };
    screen.realtime.onEvent((event) => { if (event.type === 'payment') log.payments.push(event.payment); });
    const show = screen.levelUpModal.show.bind(screen.levelUpModal);
    screen.levelUpModal.show = (content) => { log.modals.push({ level: content.level, rewardCoins: content.rewardCoins }); return show(content); };
    const toast = screen.levelUpToast.show.bind(screen.levelUpToast);
    screen.levelUpToast.show = (level, rewardCoins) => { log.toasts.push({ level, rewardCoins }); return toast(level, rewardCoins); };
    const audio = window.__coffeMania.audio;
    const play = audio.play.bind(audio);
    audio.play = (name, ...rest) => { if (name === 'levelUp') log.fanfares++; return play(name, ...rest); };
  });
  const levels = () => game.room(() => window.__levels);

  // Três mesas no café inicial: cada refeição suja uma. Uma faxineira (1ª vaga,
  // grátis) limpa as mesas entre as fornadas; o autosserviço continua igual.
  const hired = await game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    const response = await apiFetch('/api/coffe/staff/hire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'dona_cida', role: 'cleaner' }) });
    return { status: response.status, staff: (await response.json()).staff?.length };
  });
  run.check(hired.status === 201 && hired.staff === 1, 'a faxineira é contratada na vaga do nível 1', hired);

  // Uma fornada de Pão de Queijo: cozinhar, esperar o fogo e tocar no fogão para servir.
  const recipe = rules.recipes.find((entry) => entry.id === 'pao_de_queijo');
  const cookAndServe = async () => {
    await game.cook(recipe.id);
    const gold = (await state()).gold;
    await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [job] = screen.occupiedStoves.values();
      return job && Date.parse(job.readyAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 120000);
    await sleep(500);
    const mark = (await levels()).payments.length;
    const stove = await game.stovePoint();
    await game.page.mouse.click(stove.x, stove.y);
    run.log('toque no fogão pronto');
    return { gold, mark };
  };
  // A fornada acaba no pagamento que zera o balcão; o banco recebeu as refeições e os prêmios.
  const settle = async (batch, label) => {
    await game.waitFor((mark) => window.__levels.payments.slice(mark).some((payment) => payment.servingsLeft === 0), batch.mark, 300000);
    await sleep(1500);
    const payments = (await levels()).payments.slice(batch.mark);
    const gold = (await state()).gold;
    const earned = payments.reduce((sum, payment) => sum + payment.coins + (payment.levelReward ?? 0), 0);
    run.check(payments.length === recipe.servings && gold - batch.gold === earned,
      `${label}: o banco credita as ${recipe.servings} refeições e o prêmio do nível`, { before: batch.gold, after: gold, payments: payments.map(({ coins, xp, level, levelUp, levelReward }) => ({ coins, xp, level, levelUp, levelReward })) });
    return payments;
  };
  // Deixa o jogador a 1 XP do nível `to` (o nível guardado continua o atual).
  const nearLevel = async (to) => {
    await stack.admin.update('player_state', owner.id, { experience_current: requiredXp(to) - 1, experience_max: requiredXp(to) });
    run.log(`XP ajustado para ${requiredXp(to) - 1}, a 1 do nível ${to}`);
    await game.waitFor((xp) => window.__coffeMania.screens.active.topBars.labelTexts[2] === String(xp), requiredXp(to) - 1, 30000);
  };
  // Cartões e botões visíveis na janela de nível.
  const modalLabels = () => game.room(() => {
    const labels = [];
    const walk = (node) => { if (node.visible === false) return; if (node.label?.startsWith('level-up-')) labels.push(node.label); (node.children ?? []).forEach(walk); };
    walk(window.__coffeMania.app.stage.getChildByLabel('level-up-modal', true));
    return { cards: labels.filter((label) => /^level-up-(recipe-|staff-slot|expansion-)/.test(label)), buttons: labels.filter((label) => /^level-up-(recipes|staff|expand|continue)$/.test(label)) };
  });
  // Confere a janela "Nível N!" contra as regras.
  const checkModal = async (from, to) => {
    const unlocks = opened(from, to);
    const cards = [...(unlocks.slot ? ['level-up-staff-slot'] : []), ...unlocks.expansions.map((step) => `level-up-expansion-${step.tiles}`), ...unlocks.recipes.map((entry) => `level-up-recipe-${entry.id}`)];
    const buttons = [...(unlocks.recipes.length ? ['level-up-recipes'] : []), ...(unlocks.slot ? ['level-up-staff'] : []), ...(unlocks.expansions.length ? ['level-up-expand'] : []), 'level-up-continue'];
    const shown = await modalLabels();
    const text = await game.texts('level-up-modal');
    const prize = reward(from, to);
    run.check(text.includes(`Nível ${to}!`) && text.includes(`+${prize} moedas`), `a janela mostra "Nível ${to}!" e +${prize} moedas`, text);
    run.check(JSON.stringify(shown.cards) === JSON.stringify(cards.slice(0, 4)), `nível ${to}: os cartões são o que abriu (vaga e expansão primeiro, até quatro)`, { shown: shown.cards, expected: cards });
    const extra = cards.length - 4;
    run.check(extra > 0 ? text.includes(`e mais ${extra}`) : !text.includes('e mais'), extra > 0 ? `nível ${to}: "e mais ${extra}" conta os cartões que não cabem` : `nível ${to}: todos os cartões cabem`, text);
    run.check(JSON.stringify(shown.buttons) === JSON.stringify(buttons), `nível ${to}: os atalhos acompanham o que abriu`, { shown: shown.buttons, expected: buttons });
    const next = goals(to);
    run.check(next.every((goal) => text.includes(goal)), `nível ${to}: os próximos objetivos vêm das regras`, { text, next });
    if (unlocks.slot) {
      const slot = await game.texts('level-up-staff-slot');
      run.check(slot.includes(`Agora: ${slots(to)} vagas`), `o cartão da vaga diz ${slots(to)} vagas`, slot);
    }
    for (const step of unlocks.expansions.slice(0, 4)) {
      const card = await game.texts(`level-up-expansion-${step.tiles}`);
      if (cards.indexOf(`level-up-expansion-${step.tiles}`) < 4) run.check(card.includes(`${step.tiles}×${step.tiles}`) && card.includes(`${step.coins.toLocaleString('pt-BR')} moedas`), `o cartão da expansão ${step.tiles}×${step.tiles} mostra o preço em moedas`, card);
    }
  };
  const payment = async (mark, level) => (await levels()).payments.slice(mark).find((entry) => entry.levelUp && entry.level === level);

  // 1. Nível 1 → 2 pelo pagamento: a janela abre com a receita nova e "Ver receitas".
  const start = await state();
  run.check(start.level === 1 && start.experience_current === 0, 'o jogador novo começa no nível 1 sem XP', { level: start.level, xp: start.experience_current });
  await nearLevel(2);
  const first = await cookAndServe();
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal.isOpen, undefined, 300000);
  await sleep(1200);
  await game.shot('1-nivel-2');
  const paid2 = await payment(first.mark, 2);
  run.check(paid2 && paid2.xp === recipe.xpPerServing && paid2.levelReward === reward(1, 2), `o pagamento que cruza ${requiredXp(2)} XP traz levelUp e o prêmio de ${reward(1, 2)} moedas`, paid2);
  await checkModal(1, 2);
  await game.waitFor(() => window.__coffeMania.screens.active.topBars.blueLevel === 2, undefined, 30000);
  run.check((await state()).level === 2, 'o banco guarda o nível 2');
  await game.click('level-up-recipes');
  await game.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 20000);
  await sleep(800);
  await game.shot('2-ver-receitas');
  const unlocked = opened(1, 2).recipes[0];
  const locked = rules.recipes.find((entry) => entry.level > 2);
  const book = { unlocked: await game.texts(`cook-card-${unlocked.id}`), locked: await game.texts(`cook-card-${locked.id}`) };
  run.check(!await game.room(() => window.__coffeMania.screens.active.levelUpModal.isOpen) && book.unlocked.includes(`${unlocked.servings} porções`) && !book.unlocked.includes(`Nível ${unlocked.level}`),
    `"Ver receitas" fecha a janela e abre o livro com ${unlocked.name} liberada`, book.unlocked);
  run.check(book.locked.includes(`Nível ${locked.level}`), `${locked.name} continua bloqueada até o nível ${locked.level}`, book.locked);
  await game.click('cook-close-button');
  await game.waitFor(() => !window.__coffeMania.screens.active.cookModal.isOpen, undefined, 15000);
  await settle(first, 'nível 2');

  // 2. Nível 2 → 3 com a janela Funcionários aberta: cai no aviso curto, sem a janela de nível.
  await nearLevel(3);
  const second = await cookAndServe();
  await game.waitFor(() => window.__coffeMania.screens.active.servingProcess, undefined, 30000);
  await game.click('room-action-bar-icon-waiter');
  await game.waitFor(() => window.__coffeMania.screens.active.staffModal.isOpen, undefined, 15000);
  run.log('janela Funcionários aberta antes do pagamento');
  await game.waitFor(() => window.__levels.toasts.length > 0 || window.__levels.modals.some((entry) => entry.level === 3), undefined, 300000);
  await sleep(300);
  const notice = await game.toast();
  await game.shot('3-aviso-com-janela-aberta');
  const third = await levels();
  run.check(third.toasts.length === 1 && third.toasts[0].level === 3 && third.toasts[0].rewardCoins === reward(2, 3) && !third.modals.some((entry) => entry.level === 3),
    'com outra janela aberta a subida vira o aviso curto', { toasts: third.toasts, modals: third.modals });
  run.check((notice ?? '').includes('Subiu de nível!') && (notice ?? '').includes(`Nível 3 · +${reward(2, 3)} moedas`), 'o aviso diz o nível e o prêmio', notice);
  run.check(await game.room(() => window.__coffeMania.screens.active.staffModal.isOpen && !window.__coffeMania.screens.active.levelUpModal.isOpen), 'a janela aberta continua e a de nível não aparece');
  await game.click('staff-modal-close');
  await settle(second, 'nível 3');
  await sleep(2000);
  run.check(!(await levels()).modals.some((entry) => entry.level === 3) && !await game.room(() => window.__coffeMania.screens.active.levelUpModal.isOpen),
    'fechar a janela não repete a celebração do nível 3');
  run.check((await state()).level === 3, 'o banco guarda o nível 3');

  // 3. Nível 3 → 7 de uma vez: vaga nova, expansão e receita; "Contratar" abre a equipe.
  await nearLevel(7);
  const fourth = await cookAndServe();
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal.isOpen, undefined, 300000);
  await sleep(1200);
  await game.shot('4-nivel-7');
  const paid7 = await payment(fourth.mark, 7);
  run.check(paid7 && paid7.levelReward === reward(3, 7), `pular do nível 3 ao 7 paga os prêmios somados (${reward(3, 7)} moedas)`, paid7);
  await checkModal(3, 7);
  await game.click('level-up-staff');
  await game.waitFor(() => { const modal = window.__coffeMania.screens.active.staffModal; return modal.isOpen && modal.snapshot && !modal.busy; }, undefined, 20000);
  await sleep(800);
  await game.shot('5-contratar');
  const team = await game.room(() => ({ slots: window.__coffeMania.screens.active.staffModal.snapshot.slots, staff: window.__coffeMania.screens.active.staffModal.snapshot.staff.length,
    free: Boolean(window.__coffeMania.app.stage.getChildByLabel('staff-slot-free', true)?.visible) }));
  run.check(team.slots === slots(7) && team.staff === 1 && team.free, `"Contratar" abre a equipe com ${slots(7)} vagas e uma livre`, team);
  await game.click('staff-modal-close');
  await settle(fourth, 'nível 7');
  run.check((await state()).level === 7, 'o banco guarda o nível 7');

  // 4. Nível 7 → 15: mais de quatro cartões ("e mais N"); "Expandir" abre o próximo passo.
  await nearLevel(15);
  const fifth = await cookAndServe();
  await game.waitFor(() => window.__coffeMania.screens.active.levelUpModal.isOpen, undefined, 300000);
  await sleep(1200);
  await game.shot('6-nivel-15');
  const paid15 = await payment(fifth.mark, 15);
  run.check(paid15 && paid15.levelReward === reward(7, 15), `pular do nível 7 ao 15 paga ${reward(7, 15)} moedas`, paid15);
  await checkModal(7, 15);
  await game.click('level-up-expand');
  await game.waitFor(() => window.__coffeMania.screens.active.expansionModal.isOpen, undefined, 15000);
  await sleep(800);
  await game.shot('7-expandir');
  const step = rules.expansions.steps.find((entry) => entry.tiles > startTiles);
  const expansion = await game.texts('expansion-modal');
  run.check(!await game.room(() => window.__coffeMania.screens.active.levelUpModal.isOpen) && expansion.includes(`${step.tiles}×${step.tiles}`),
    `"Expandir" fecha a janela de nível e oferece ${step.tiles}×${step.tiles}`, expansion);
  await game.click('expansion-modal-close');
  await settle(fifth, 'nível 15');
  const final = await state();
  run.check(final.level === 15, 'o banco guarda o nível 15', final.level);
  const totals = await levels();
  run.check(JSON.stringify(totals.modals.map((entry) => entry.level)) === '[2,7,15]' && totals.toasts.length === 1 && totals.fanfares === 4,
    'cada nível é celebrado uma vez, com uma fanfarra', { modals: totals.modals, toasts: totals.toasts, fanfares: totals.fanfares });
  await game.waitFor((gold) => window.__coffeMania.screens.active.topBars.labelTexts[1] === String(gold), final.gold, 30000).catch(() => {});
  const hud = await game.room(() => ({ gold: window.__coffeMania.screens.active.topBars.labelTexts[1], level: window.__coffeMania.screens.active.topBars.blueLevel }));
  run.check(hud.gold === String(final.gold) && hud.level === 15, 'o HUD mostra as moedas e o nível do banco', { hud, gold: final.gold });

  // 5. Recarregar: o nível vem no carregamento e nenhuma celebração se repete.
  await game.page.reload();
  await game.connected();
  await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    window.__reloaded = { modals: 0, toasts: 0 };
    const show = screen.levelUpModal.show.bind(screen.levelUpModal);
    screen.levelUpModal.show = (content) => { window.__reloaded.modals++; return show(content); };
    const toast = screen.levelUpToast.show.bind(screen.levelUpToast);
    screen.levelUpToast.show = (...args) => { window.__reloaded.toasts++; return toast(...args); };
  });
  await game.skipDaily();
  await sleep(5000);
  await game.shot('8-recarregado');
  const reloaded = await game.room(() => ({ ...window.__reloaded, open: window.__coffeMania.screens.active.levelUpModal.isOpen, level: window.__coffeMania.screens.active.topBars.blueLevel }));
  run.check(!reloaded.open && reloaded.modals === 0 && reloaded.toasts === 0 && reloaded.level === 15, 'recarregar não repete a subida de nível', reloaded);
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  // 401 before the login.
  await run.finish({ allow: [/status of 401/] });
  await stack.stop();
}
