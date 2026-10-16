// Sprint 11 no modo standalone: bônus diário e Correio (créditos e selo), ícones
// do presente e do mapa (Sprint 16), pilão e caixa que abrem as janelas da Sprint 14, a galinha que abre a Fazenda, barra de XP dentro do nível, aviso
// sem fogão livre, cancelar com confirmação (reembolso pago pelo servidor, texto
// do preparo, prato que fica pronto com a janela aberta), selo offline durante a
// festa, Configurações e as 16 cores do guarda-roupa.
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('retention');

try {
  const game = await run.page();
  await game.page.goto(`${site.url}/?screen=room`);
  await game.connected();
  const start = await game.player();

  // 1. Bônus diário na entrada: o 1º dia credita uma vez.
  await game.waitFor(() => window.__coffeMania.screens.active.dailyModal?.isOpen, undefined, 30000);
  await sleep(800);
  await game.shot('1-bonus-diario');
  const day1 = await game.room(() => window.__coffeMania.screens.active.dailyModal.state.days[0]);
  await game.click('daily-bonus-claim');
  await game.waitFor(() => !window.__coffeMania.screens.active.dailyModal.state?.claimable, undefined, 15000);
  await sleep(1200);
  await game.shot('2-bonus-coletado');
  const afterDaily = await game.player();
  run.check(afterDaily.gold - start.gold === day1.coins && afterDaily.cash - start.cash === day1.cash, `o 1º dia credita ${day1.coins} moedas`, { start, afterDaily });
  await game.click('daily-bonus-close');
  await sleep(500);

  // 2. Correio: selo de não lida e a Carta de Boas-Vindas, que credita uma vez.
  const badge = () => game.room(() => { const node = window.__coffeMania.app.stage.getChildByLabel('room-action-bar-mail-badge', true); return node?.visible ? node.children[1].text : null; });
  run.check(await badge() === '1', 'o envelope mostra 1 carta não lida', await badge());
  await game.click('room-action-bar-icon-mail');
  await game.waitFor(() => window.__coffeMania.screens.active.mailModal?.isOpen, undefined, 15000);
  await sleep(700);
  await game.shot('3-correio');
  const letter = await game.room(() => window.__coffeMania.screens.active.mailModal.mail.letters.find((item) => item.key === 'welcome'));
  await game.click('mail-claim-welcome');
  await game.waitFor(() => window.__coffeMania.screens.active.mailModal.mail.unread === 0, undefined, 15000);
  await sleep(900);
  await game.shot('4-carta-coletada');
  const afterMail = await game.player();
  run.check(afterMail.gold - afterDaily.gold === letter.coins && letter.coins === 50, 'a Carta de Boas-Vindas credita 50 moedas', { letter, afterMail });
  run.check(await badge() === null, 'o selo some depois de abrir a carta');
  await game.click('mail-close');
  await sleep(400);

  // 3. Ícones: desde a Sprint 16 o presente e o mapa abrem as janelas deles, como o
  // pilão (despensa) e a caixa amarela (caixas) desde a Sprint 14; a galinha abre a Fazenda.
  for (const [icon, modal] of [['gift', 'giftsModal'], ['map', 'mapModal'], ['mortar', 'pantryModal'], ['yellow-box', 'cratesModal']]) {
    await game.click(`room-action-bar-icon-${icon}`);
    const opened = await game.waitFor((modal) => window.__coffeMania.screens.active[modal]?.isOpen, modal, 15000).then(() => true, () => false);
    run.check(opened, `${icon} abre a sua janela`);
    await game.page.keyboard.press('Escape');
    await sleep(500);
  }
  await game.shot('5-icones');
  await game.click('room-action-bar-icon-striped-chicken');
  await sleep(600);
  run.check(await game.room(() => window.__coffeMania.screens.active.streetModal?.isOpen), 'a galinha abre a Fazenda');
  await game.click('street-modal-close');
  await sleep(400);

  // 4. Barra de XP dentro do nível: 23,5 XP no nível 2 (7 → 40) é a metade.
  const bar = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const state = screen.roomSnapshot.playerState;
    screen.topBars.setState({ ...state, level: 2, experience: { current: 23.5, maximum: 40 } }, true);
    const value = screen.topBars.values[2];
    screen.topBars.setState(state, true);
    return value;
  });
  run.check(bar === 50, 'a barra de XP enche dentro do nível', bar);

  // 5. Cozinhar e tentar outro prato sem fogão livre.
  await game.cook('cake_1');
  const cooking = await game.player();
  const job = await game.room(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0]);
  run.check(job.costCoins > 0 && afterMail.gold - cooking.gold === job.costCoins, 'o fogão guarda o custo do preparo', { cost: job.costCoins });
  await game.room(() => window.__coffeMania.screens.active.startCooking({ id: 'pao_de_queijo', name: 'Pão de Queijo' }));
  await sleep(500);
  const busy = await game.toast();
  run.check(/^Nenhum fogão livre/.test(busy ?? ''), 'cozinhar sem fogão livre avisa', busy);
  await game.shot('6-sem-fogao-livre');

  // 6. Cancelar com o fogo aceso: confirmação e o reembolso que o servidor pagou.
  const openCancel = () => game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const stove = screen.model.items.find((item) => screen.occupiedStoves.has(item.instanceId));
    screen.confirmCancel(stove, screen.occupiedStoves.get(stove.instanceId));
  });
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [current] = screen.occupiedStoves.values();
    return current && Date.parse(current.startedAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 20000);
  await openCancel();
  await game.waitFor(() => window.__coffeMania.screens.active.confirmDialog.isOpen, undefined, 10000);
  const percent = await game.room(() => window.__coffeMania.screens.active.rules.stove.cancelRefundPercent);
  const expected = Math.floor(job.costCoins * percent / 100);
  const cookingText = await game.texts('confirm-dialog');
  run.check(cookingText.includes(`${percent}% do custo`), 'a confirmação diz a parte devolvida com o fogo aceso', cookingText);
  await game.shot('7-confirmar-cancelamento');
  await game.click('confirm-dialog-confirm');
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 15000);
  await sleep(700);
  const refunded = await game.player();
  const refundNotice = await game.toast();
  run.check(refunded.gold - cooking.gold === expected && (refundNotice ?? '').includes(`${expected} moedas devolvidas`),
    `cancelar devolve ${expected} moedas e o aviso mostra o valor pago`, { before: cooking.gold, after: refunded.gold, refundNotice });
  await game.shot('8-reembolso');

  // 7. Texto no preparo: promete o custo todo só enquanto o preparo dura.
  const preparingText = await game.room(() => {
    const screen = window.__coffeMania.screens.active;
    const stove = screen.model.items.find((item) => screen.stoveViews.has(item.instanceId));
    const iso = (ms) => new Date(ms).toISOString().replace('T', ' ');
    const now = screen.cookingClient.serverNowMs();
    screen.confirmCancel(stove, { id: 'e2e', recipeId: 'coxinha', preparingAt: iso(now), startedAt: iso(now + 60000), readyAt: iso(now + 120000), spoilsAt: iso(now + 300000), servings: 10, costCoins: 15 });
    return null;
  }).then(() => game.texts('confirm-dialog'));
  run.check(preparingText.includes('Ainda no preparo, 15 moedas voltam') && preparingText.includes('com o fogo já aceso, 7 moedas'), 'no preparo a confirmação mostra as duas partes', preparingText);
  await game.room(() => window.__coffeMania.screens.active.confirmDialog.close());
  await sleep(3000);

  // 8. O prato fica pronto com a confirmação aberta: nada é cancelado.
  await game.cook('cake_1');
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [current] = screen.occupiedStoves.values();
    return current && Date.parse(current.startedAt.replace(' ', 'T')) <= screen.cookingClient.serverNowMs(); }, undefined, 20000);
  await openCancel();
  await game.waitFor(() => { const screen = window.__coffeMania.screens.active; const [current] = screen.occupiedStoves.values();
    return current && Date.parse(current.readyAt.replace(' ', 'T')) + 500 <= screen.cookingClient.serverNowMs(); }, undefined, 90000);
  const readyGold = (await game.player()).gold;
  await game.click('confirm-dialog-confirm');
  await sleep(800);
  const readyNotice = await game.toast();
  run.check(/^O prato ficou pronto/.test(readyNotice ?? '') && await game.room(() => window.__coffeMania.screens.active.occupiedStoves.size) === 1 && (await game.player()).gold === readyGold,
    'um prato pronto com a janela aberta não é cancelado', readyNotice);
  await game.shot('9-pronto-com-a-confirmacao-aberta');

  // 9. Festa do Bairro no modo offline: o selo da festa fica abaixo do selo "Offline".
  const party = await game.room(async () => {
    const { apiFetch } = await import('/src/game/backend.ts');
    return (await apiFetch('/api/coffe/street/disco/party', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status;
  });
  run.check(party === 200, 'a festa começa no modo offline', party);
  await game.waitFor(() => window.__coffeMania.screens.active.partyBadge.view.visible, undefined, 20000);
  await sleep(1000);
  const bands = await game.room(() => {
    const vertical = (node) => { const bounds = node.getBounds(); return [bounds.y, bounds.y + bounds.height]; };
    return { note: vertical(window.__coffeMania.app.stage.getChildByLabel('room-top-bars-note', true)), badge: vertical(window.__coffeMania.screens.active.partyBadge.view) };
  });
  run.check(bands.note[1] <= bands.badge[0], 'o selo da festa não cobre o selo offline', bands);
  await game.shot('10-festa-offline');

  // 10. Configurações: mudo e faixa mudam as preferências; no modo offline não há "Sair".
  await game.click('room-action-bar-settings');
  await game.waitFor(() => window.__coffeMania.screens.active.settingsModal.isOpen, undefined, 10000);
  await sleep(500);
  const before = await game.room(() => window.__coffeMania.screens.active.settingsModal.preferences);
  await game.click('settings-mute-button'); await sleep(300);
  await game.click('settings-track-button'); await sleep(300);
  const after = await game.room(() => window.__coffeMania.screens.active.settingsModal.preferences);
  run.check(after.muted !== before.muted && after.track !== before.track, 'mudo e faixa mudam nas Configurações', { before, after });
  run.check(!await game.center('settings-logout-button'), 'o modo offline não mostra "Sair"');
  await game.shot('11-configuracoes');
  await game.click('settings-mute-button'); await sleep(200);
  await game.page.keyboard.press('Escape');
  await sleep(400);

  // 11. Guarda-roupa: as 16 cores de cada paleta.
  await game.click('room-action-bar-icon-shirt');
  await game.waitFor(() => window.__coffeMania.screens.active.wardrobeModal?.isOpen, undefined, 15000);
  await sleep(2500);
  const colours = await game.room(() => ['SkinColour', 'HairColour'].map((group) => window.__coffeMania.app.stage.getChildByLabel(`wardrobe-${group}-colours`, true)?.children.length));
  run.check(colours.every((count) => count === 16), 'cada paleta mostra 16 cores', colours);
  await game.shot('12-guarda-roupa');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
