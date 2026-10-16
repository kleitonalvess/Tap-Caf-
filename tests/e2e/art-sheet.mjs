// Folha de contato da arte procedural (placeholder-art.ts): cada estilo desenhado
// no enquadramento do Asset Studio, para conferir silhueta, escala e sombreamento.
import { scenario } from './lib/browser.mjs';
import { startStandalone } from './lib/stack.mjs';

const site = await startStandalone();
const run = await scenario('art-sheet');
try {
  const game = await run.page({ width: 1600, height: 1200 });
  await game.page.goto(`${site.url}/assets/items/catalog.json`);
  await game.page.goto(`${site.url}/?screen=room`);
  await game.page.waitForFunction(() => window.__coffeMania, null, { timeout: 120000 });
  const result = await game.page.evaluate(async () => {
    const { placeholderItemArt } = await import('/src/game/placeholder-art.ts');
    const { items } = await (await fetch('/assets/items/catalog.json')).json();
    const manifests = await Promise.all(items.map(async ({ manifest }) => (await fetch(`/assets/items/${manifest}`)).json()));
    const drawn = manifests.filter((item) => item.placeholder && item.art);
    const cell = 200, columns = 7;
    const sheet = document.createElement('canvas');
    sheet.width = cell * columns; sheet.height = cell * Math.ceil(drawn.length / columns) + 10;
    const g = sheet.getContext('2d');
    g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, sheet.width, sheet.height);
    const missing = [];
    drawn.forEach((item, index) => {
      const frames = placeholderItemArt(item.art, item.itemHeight, item.classname);
      if (!frames.length) { missing.push(item.classname); return; }
      const x = (index % columns) * cell, y = Math.floor(index / columns) * cell;
      const source = frames[0].texture.source.resource;
      const scale = Math.min(1, (cell - 30) / source.width, (cell - 30) / source.height);
      // A floor diamond under each drawing shows the tile it stands on.
      g.fillStyle = '#c4baa6'; g.beginPath();
      const bx = x + cell / 2, by = y + cell - 40;
      g.moveTo(bx - 80 * scale, by); g.lineTo(bx, by - 40 * scale); g.lineTo(bx + 80 * scale, by); g.lineTo(bx, by + 40 * scale); g.fill();
      g.drawImage(source, bx - source.width * scale / 2, by + 40 * scale - source.height * scale, source.width * scale, source.height * scale);
      g.fillStyle = '#222'; g.font = '12px sans-serif'; g.fillText(item.classname, x + 4, y + 14);
    });
    return { url: sheet.toDataURL('image/png'), count: drawn.length, missing };
  });
  run.check(result.missing.length === 0, `toda arte procedural desenha (${result.count} itens)`, result.missing);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const out = process.env.COFFE_E2E_OUT ?? (await import('node:os')).tmpdir() + '/coffe-e2e/art-sheet';
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/sheet.png`, Buffer.from(result.url.split(',')[1], 'base64'));
  run.log('folha', `${out}/sheet.png`);
} catch (error) {
  run.check(false, `o roteiro terminou: ${error.message}`);
} finally {
  await run.finish();
  await site.stop();
}
