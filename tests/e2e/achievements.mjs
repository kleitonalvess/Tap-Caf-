// Sprint 11 (fechamento) e Sprint 12 no modo standalone: troféu com conquistas e
// missões, XP do tempero do dono só ao servir no balcão, livro com as abas de
// filtro, botões "+" de Moedas e Grana, painel de Popularidade com renomear o
// café, retrato nas Configurações, exportar e importar o save (o arquivo
// importado traz contadores que deixam prêmios prontos), resgate de missão e
// conquista com o selo do troféu, aba "Rosto" do guarda-roupa e HUD de
// depuração escondido sem ?debug=1.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenario, sleep } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('achievements');
const progress = (game) => game.room(async () => {
  const { apiFetch } = await import('/src/game/backend.ts');
  return (await apiFetch('/api/coffe/progress')).json();
});
const badge = (game) => game.room(() => {
  const view = window.__coffeMania.app.stage.getChildByLabel('room-action-bar-trophy-badge', true);
  return view?.visible ? view.children.find((child) => child.text !== undefined)?.text ?? '' : null;
});
/** The São Paulo date (UTC−3, no DST), as the server counts days. */
const saoPauloDate = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

try {
  const game = await run.page();
  await game.page.goto(`${site.url}/?screen=room`);
  await game.connected();
  await game.skipDaily();
  // Customers pay XP too; the seasoning check discounts what they paid meanwhile.
  await game.room(() => {
    window.__paidXp = 0;
    window.__coffeMania.screens.active.realtime.onEvent((event) => { if (event.type === 'payment') window.__paidXp += event.payment.xp; });
  });
  const paidXp = () => game.room(() => window.__paidXp);
  const rules = await game.room(() => window.__coffeMania.screens.active.rules);
  run.check(await game.room(() => !window.__coffeMania.screens.active.hud), 'sem ?debug=1 o HUD de depuração não aparece');

  // 1. Troféu: janela com as conquistas e as três missões do dia.
  await game.click('room-action-bar-icon-trophy');
  await game.waitFor(() => window.__coffeMania.screens.active.achievementsModal?.isOpen, undefined, 15000);
  await sleep(600);
  const first = await progress(game);
  run.check(first.achievements.length === 9 && first.missions.length === 3, 'o troféu lista 9 conquistas e 3 missões', { achievements: first.achievements.length, missions: first.missions.length });
  run.check(!first.achievements.some((a) => a.id === 'amount_neighbors' || a.id === 'sent_gifts'), 'as conquistas sociais ficam escondidas até existirem vizinhos');
  run.check((await badge(game)) === null && first.ready === 0, 'sem prêmios o troféu não tem selo', first.ready);
  await game.shot('1-conquistas');
  await game.click('achievements-tab-missions');
  await sleep(500);
  run.check((await game.texts('achievements-modal')).includes('meia-noite de São Paulo'), 'a aba de missões mostra quando elas renovam');
  await game.shot('2-missoes');
  await game.page.keyboard.press('Escape');
  await sleep(400);
  run.check(!await game.room(() => window.__coffeMania.screens.active.achievementsModal.isOpen), 'Esc fecha o troféu');

  // 2. Livro de receitas: Todas, Rápidas, Lucrativas e Desbloqueadas.
  const stove = await game.stovePoint();
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.cookModal?.state === 'open', undefined, 20000);
  await sleep(500);
  const tabs = await Promise.all([1, 2, 3, 4].map((index) => game.texts(`cook-tab-${index}`)));
  run.check(tabs.join(',') === 'Todas,Rápidas,Lucrativas,Desbloqueadas', 'as quatro abas do livro são filtros', tabs);
  const cards = async () => game.room(() => window.__coffeMania.app.stage.getChildByLabel('cook-modal-window', true).children
    .flatMap((layer) => layer.children ?? []).filter((child) => child.label?.startsWith('cook-card-')).map((child) => child.label.slice(10)));
  const all = await cards();
  await game.click('cook-tab-2'); await sleep(400);
  const quick = await cards();
  const quickRules = rules.recipes.filter((recipe) => recipe.cookSeconds <= 600).sort((a, b) => a.cookSeconds - b.cookSeconds).map((recipe) => recipe.id);
  run.check(JSON.stringify(quick) === JSON.stringify(quickRules.slice(0, 6)), 'Rápidas: até 10 min, da mais rápida', { quick, quickRules });
  await game.click('cook-tab-3'); await sleep(400);
  const profit = (recipe) => recipe.servings * recipe.pricePerServing - recipe.costCoins;
  const best = [...rules.recipes].sort((a, b) => profit(b) - profit(a))[0].id;
  run.check((await cards())[0] === best, 'Lucrativas começa pelo maior lucro por lote', { best });
  await game.click('cook-tab-4'); await sleep(400);
  const unlocked = await cards();
  run.check(unlocked.every((id) => rules.recipes.find((recipe) => recipe.id === id).level <= 1) && unlocked.length > 0, 'Desbloqueadas mostra só o que o nível libera', unlocked);
  await game.shot('3-livro-desbloqueadas');
  await game.click('cook-tab-1'); await sleep(400);
  run.check(all.length === 6 && await game.center('cook-page-next') !== null, 'Todas pagina de seis em seis', all);
  await game.page.keyboard.press('Escape');
  await sleep(600);

  // 3. Temperar o próprio prato: porções na hora, XP só ao servir no balcão.
  const pao = rules.recipes.find((recipe) => recipe.id === 'pao_de_queijo');
  const beforeCook = await game.player();
  const paidAtCook = await paidXp();
  await game.cook(pao.id);
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('stove-action-season', true)?.visible, undefined, 10000);
  await game.click('stove-action-season');
  await game.waitFor(() => [...window.__coffeMania.screens.active.occupiedStoves.values()][0]?.seasoned, undefined, 15000);
  const seasoned = await game.player();
  const paidAtSeason = await paidXp();
  run.check(seasoned.xp === beforeCook.xp + paidAtSeason - paidAtCook, 'o tempero do dono não dá XP com o prato no fogo', { before: beforeCook.xp, after: seasoned.xp });
  await game.waitFor(() => {
    const job = [...window.__coffeMania.screens.active.occupiedStoves.values()][0];
    return job && Date.parse(job.readyAt.replace(' ', 'T')) <= window.__coffeMania.screens.active.cookingClient.serverNowMs();
  }, undefined, 90000);
  await sleep(800);
  await game.page.mouse.click(stove.x, stove.y);
  await game.waitFor(() => window.__coffeMania.screens.active.occupiedStoves.size === 0, undefined, 60000);
  await sleep(1500);
  const served = await game.player();
  const paidMeanwhile = (await paidXp()) - paidAtSeason;
  run.check(served.xp - seasoned.xp - paidMeanwhile === rules.stove.seasonXp, `servir no balcão credita os ${rules.stove.seasonXp} XP do tempero`, { before: seasoned.xp, after: served.xp, paidMeanwhile });
  const afterServe = await progress(game);
  const dishes = afterServe.achievements.find((a) => a.id === 'served_dishes');
  run.check(dishes.progress === 1 && afterServe.achievements.find((a) => a.id === 'unique_dishes').progress === 1, 'o prato no balcão conta para Mestre-Cuca e Cardápio Variado', dishes);
  const dishMission = afterServe.missions.find((m) => m.goals.some((g) => g.stat === 'dishes' || g.stat === 'seasoned'));
  if (dishMission) run.check(dishMission.goals.some((g) => g.progress >= 1), 'a missão do dia conta o prato servido ou temperado', dishMission);

  // 4. Botões "+" de Moedas e Grana.
  await game.click('room-top-bar-plus-gold');
  await game.waitFor(() => window.__coffeMania.screens.active.currencyModal?.isOpen, undefined, 10000);
  await sleep(500);
  const goldText = await game.texts('currency-modal');
  run.check(/Cozinhando/.test(goldText) && /Bônus diário/.test(goldText) && /Conquistas/.test(goldText) && /Expansões/.test(goldText), 'o "+" das moedas explica as fontes', goldText);
  await game.shot('4-como-ganhar-moedas');
  await game.page.keyboard.press('Escape'); await sleep(400);
  await game.click('room-top-bar-plus-cash');
  await sleep(600);
  const cashText = await game.texts('currency-modal');
  const sixth = rules.daily.days.find((day) => day.day === 6);
  run.check(cashText.includes(`6º dia: +${sixth.cash}`) && /Missões diárias: \+1 Grana/.test(cashText), 'o "+" da Grana mostra o bônus e as missões', cashText);
  await game.page.keyboard.press('Escape'); await sleep(400);

  // 5. Popularidade: explicação e renomear o café.
  await game.click('room-action-bar-mood');
  await game.waitFor(() => window.__coffeMania.screens.active.popularityModal?.isOpen, undefined, 10000);
  await sleep(500);
  const input = game.page.locator('[data-testid="popularity-name-input"]');
  run.check(await input.isVisible(), 'o dono vê o campo do nome do café');
  await input.fill('<script>');
  await game.click('popularity-rename');
  await sleep(1200);
  run.check((await game.texts('popularity-modal')).includes('Use de 3 a 24'), 'um nome inválido é recusado com o motivo');
  await input.fill('  Café   do Teste ');
  await game.click('popularity-rename');
  await game.waitFor(() => window.__coffeMania.screens.active.roomSnapshot.playerState.cafeName === 'Café do Teste', undefined, 10000);
  run.check((await game.texts('room-action-bar-mood')).includes('Café do Teste'), 'o nome novo aparece na barra');
  await game.shot('5-popularidade');
  await game.page.keyboard.press('Escape'); await sleep(400);
  run.check(await input.count() === 0, 'fechar a janela remove o campo de texto');

  // 6. Configurações: retrato e exportar o save.
  await game.click('room-action-bar-settings');
  await game.waitFor(() => window.__coffeMania.screens.active.settingsModal.isOpen, undefined, 10000);
  await sleep(500);
  run.check(await game.room(() => Boolean(window.__coffeMania.app.stage.getChildByLabel('settings-modal-portrait-avatar', true))), 'o retrato do avatar aparece na moldura');
  await game.shot('6-configuracoes');
  const downloading = game.page.waitForEvent('download', { timeout: 30000 });
  await game.click('settings-export-save-button');
  const download = await downloading;
  const file = join(run.out, download.suggestedFilename());
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  run.check(exported.format === 'coffe-mania-save' && /^coffe-mania-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), 'o save sai como .json com data no nome', download.suggestedFilename());
  const data = JSON.parse(exported.save.data);
  run.check(data.collections.player_state[0].fields.cafe_name === 'Café do Teste', 'o arquivo leva o café atual');

  // 7. Importar: o arquivo errado é recusado; o certo pede confirmação e recarrega.
  const bad = join(run.out, 'nao-e-save.json');
  writeFileSync(bad, JSON.stringify({ format: 'outro', save: {} }));
  const pick = async (path) => {
    const chooser = game.page.waitForEvent('filechooser', { timeout: 15000 });
    await game.click('settings-import-save-button');
    await (await chooser).setFiles(path);
    await sleep(1200);
  };
  await pick(bad);
  run.check((await game.texts('settings-modal')).includes('não é um save'), 'um arquivo que não é save é recusado');
  // Counters that make the missions and the first tier of Clientela Fiel claimable.
  const today = saoPauloDate();
  const daily = { dishes: 50, customers: 50, tables: 50, seasoned: 50, harvests: 50, parties: 50, spent_coins: 5000 };
  const stats = data.collections.player_stats?.[0];
  const seq = Math.max(...Object.values(data.collections).flat().map((row) => row.seq)) + 1;
  const fields = { ...(stats?.fields ?? {}), user: exported.save.profile.id, counts: { ...(stats?.fields?.counts ?? {}), customers: 30 }, day: today, day_counts: daily, day_claimed: [] };
  data.collections.player_stats = [{ id: stats?.id ?? 'e2estats0000001', created: stats?.created ?? '', seq, fields }];
  const good = join(run.out, 'save-com-metas.json');
  writeFileSync(good, JSON.stringify({ ...exported, save: { ...exported.save, data: JSON.stringify(data) } }));
  await pick(good);
  const summary = await game.texts('settings-modal');
  run.check(summary.includes('Café do Teste') && summary.includes('Substituir café'), 'o save escolhido mostra o resumo e pede a confirmação', summary);
  await game.shot('7-importar-confirmar');
  const reloaded = game.page.waitForNavigation({ timeout: 60000 });
  await game.click('settings-import-save-button');
  await reloaded;
  await game.connected();
  await game.skipDaily();

  // 8. O selo do troféu mostra os prêmios; resgatar missão e conquista.
  await game.waitFor(() => window.__coffeMania.app.stage.getChildByLabel('room-action-bar-trophy-badge', true)?.visible, undefined, 30000);
  const ready = await progress(game);
  run.check(ready.ready >= 4 && Number(await badge(game)) === ready.ready, 'o troféu ganha o selo com os prêmios prontos', { ready: ready.ready, badge: await badge(game) });
  run.check((await game.room(() => window.__coffeMania.screens.active.roomSnapshot.playerState.cafeName)) === 'Café do Teste', 'o café importado volta com o nome');
  await game.click('room-action-bar-icon-trophy');
  await game.waitFor(() => window.__coffeMania.screens.active.achievementsModal?.isOpen, undefined, 15000);
  await sleep(600);
  await game.shot('8-premios-prontos');
  const mission = ready.missions[0];
  const beforeMission = await game.player();
  await game.click('achievements-tab-missions'); await sleep(400);
  await game.click(`mission-claim-${mission.id}`);
  await game.waitFor((id) => window.__coffeMania.screens.active.achievementsModal.progress.missions.find((m) => m.id === id)?.claimed, mission.id, 15000);
  const afterMission = await game.player();
  run.check(afterMission.cash - beforeMission.cash === mission.cash && mission.cash === 1 && afterMission.gold >= beforeMission.gold + mission.coins,
    `resgatar a missão paga ${mission.coins} moedas, ${mission.xp} XP e +1 Grana`, { beforeMission, afterMission, mission });
  await game.click('achievements-tab-achievements'); await sleep(400);
  const customers = ready.achievements.find((a) => a.id === 'customers');
  await game.click('achievement-claim-customers');
  await game.waitFor(() => window.__coffeMania.screens.active.achievementsModal.progress.achievements.find((a) => a.id === 'customers')?.claimed === 1, undefined, 15000);
  const afterAchievement = await game.player();
  run.check(afterAchievement.xp - afterMission.xp === customers.goals[0].xp && afterAchievement.gold >= afterMission.gold + customers.goals[0].coins,
    'resgatar o Bronze de Clientela Fiel paga moedas e XP', { afterMission, afterAchievement });
  await sleep(500);
  run.check(Number(await badge(game)) === ready.ready - 2, 'o selo diminui a cada resgate', { badge: await badge(game), before: ready.ready });
  await game.shot('9-resgatados');
  await game.page.keyboard.press('Escape'); await sleep(400);

  // 9. Guarda-roupa: aba "Rosto" e nenhuma aba vazia de calçados.
  await game.click('room-action-bar-icon-shirt');
  await game.waitFor(() => window.__coffeMania.screens.active.wardrobeModal?.isOpen, undefined, 15000);
  await sleep(2500);
  const face = await game.center('wardrobe-icon-face');
  run.check(face !== null && await game.center('wardrobe-icon-sneaker') === null, 'a aba "Rosto" existe e a de calçados fica escondida');
  if (face) {
    await game.page.mouse.move(face.x, face.y);
    await sleep(400);
    run.check((await game.texts('wardrobe-category-caption')) === 'Rosto', 'a aba do rosto se chama "Rosto"');
  }
  await game.shot('10-guarda-roupa-rosto');
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
