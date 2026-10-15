// Runs the E2E roteiros one after another (each starts and stops its own
// isolated stack): `npm run e2e` runs them all, `npm run e2e -- offline server`
// only the named ones. Exits non-zero when any roteiro fails.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const folder = import.meta.dirname;
const all = readdirSync(folder).filter((file) => file.endsWith('.mjs') && file !== 'run.mjs').map((file) => file.slice(0, -4)).sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length) {
  console.error(`Roteiros desconhecidos: ${unknown.join(', ')}. Disponíveis: ${all.join(', ')}.`);
  process.exit(2);
}
const results = [];
for (const name of wanted.length ? wanted : all) {
  console.info(`\n=== ${name} ===`);
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [join(folder, `${name}.mjs`)], { stdio: 'inherit' });
  results.push({ name, ok: status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}
console.info('\nResumo:');
for (const { name, ok, seconds } of results) console.info(`  ${ok ? 'ok    ' : 'FALHOU'} ${name} (${seconds} s)`);
if (results.some((result) => !result.ok)) process.exitCode = 1;
