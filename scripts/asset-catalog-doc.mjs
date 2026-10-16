// Renders docs/ASSET_CATALOG.md from the item manifests, so the catalog of
// assets never drifts from game/public/assets/items/*/item.json.

const THEMES = { japan: 'Japão', italy: 'Itália (Mamma Mia)', noble: 'Nobreza Clássica' };

/** Same rule as storeCategory in game/src/game/shop.ts. */
export function storeCategory(item) {
  if (item.type === 0) return 'floor';
  if (item.type === 1) return 'wallpaper';
  if (item.type === 2) return 'door';
  switch (item.kind) {
    case 'stove': return (item.cookSpeedPercent ?? 0) > 0 || (item.servingsBonusPercent ?? 0) > 0 ? 'stove-fire' : 'stove';
    case 'counter': case 'register': return 'counter';
    case 'table': return 'table';
    case 'chair': return 'chair';
    case 'window': case 'panel': case 'curtain': return 'flower-window';
    case 'wall': return 'wallpaper';
    case 'door': return 'door';
    case 'machine': case 'entertainment': case 'shelf': return 'machine';
    default: return 'flower';
  }
}

/**
 * historical_confirmed: PNG art of the original game (provided by the project
 * owner) whose manifest keeps the original class name (legacyClassName).
 * unverified: PNG art without that evidence. project_original: drawn in canvas
 * or tinted by this project. The Portuguese names are always ours.
 */
export function assetOrigin(item) {
  if (item.parts.length > 0) return item.legacyClassName ? 'historical_confirmed' : 'unverified';
  return 'project_original';
}

const FUNCTION_TYPES = {
  chair: 'assento (clientes sentam)', table: 'mesa de refeição (lotação, sujeira)', stove: 'cozinhar receitas',
  counter: 'balcão (porções servidas)', register: 'gorjeta no autosserviço + Caixa do dia', door: 'entrada dos clientes',
  window: 'decoração de parede', panel: 'decoração de parede', curtain: 'decoração de parede', bush: 'decoração',
  ornament: 'decoração', decor: 'piso', wall: 'parede', letterbox: 'Correio', machine: 'máquina de bebidas',
  entertainment: 'entretenimento montável', shelf: 'prateleira de temperos',
};

const VISUAL_STATES = {
  stove: 'vazio, preparando, cozinhando, pronto, estragado', machine: 'vazia, preparando, pronta, estragada',
  counter: 'vazio, com prato ×N', table: 'limpa, suja (pratos, moscas)', chair: 'vazia, ocupada',
  entertainment: 'em montagem, parada, ligada, em manutenção (níveis 1–3)',
};

function rotatable(item, byClass) {
  const source = item.variantOf ? byClass.get(item.variantOf) : item;
  if (source.parts.length > 0) return new Set(source.parts.map((part) => part.rotation ?? 0)).size > 1;
  // Canvas pictures hang on either wall (two frames); floor drawings look the same from every side.
  return item.kind === 'window' || item.kind === 'panel';
}

function spriteSource(item) {
  if (item.parts.length > 0) return `PNG (${item.parts.map((part) => part.file).join(', ')})`;
  if (item.variantOf) return `variante tingida de \`${item.variantOf}\` (${item.tint}, ${item.tintMode ?? 'color'})`;
  return `canvas procedural (\`${item.art ?? item.kind}\`)`;
}

function pivot(item, byClass) {
  const part = (item.variantOf ? byClass.get(item.variantOf) : item).parts[0];
  return part ? `left ${part.left}, top ${part.top}` : 'vértice superior do tile (Asset Studio)';
}

export function renderAssetCatalog(items) {
  const byClass = new Map(items.map((item) => [item.classname, item]));
  const count = (origin) => items.filter((item) => assetOrigin(item) === origin).length;
  const header = '| id | name | category | theme | origin | dimensions | pivot | rotatable | priceCoins | priceCash | minLevel | functionType | visualStates | spriteSource |';
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |';
  const row = (item) => `| ${item.id} | ${item.name}${item.purchasable ? '' : ' (fora da loja)'} | ${storeCategory(item)} | ${THEMES[item.theme] ?? '—'} | ${assetOrigin(item)} | ${item.sizeX}×${item.sizeY} tiles, ${item.itemHeight} px | ${pivot(item, byClass)} | ${rotatable(item, byClass) ? 'sim' : 'não'} | ${item.priceGold} | ${item.priceCash ?? 0} | ${item.level ?? 1} | ${FUNCTION_TYPES[item.kind] ?? item.kind} | ${VISUAL_STATES[item.kind] ?? 'estático'} | ${spriteSource(item)} |`;
  return `# Catálogo de assets

Gerado por \`npm run assets:room\` (\`scripts/asset-catalog-doc.mjs\`) a partir de \`game/public/assets/items/*/item.json\`. Não edite à mão.

## Origem

- **historical_confirmed** (${count('historical_confirmed')}): arte PNG do jogo original, fornecida pelo responsável pelo projeto, cujo manifesto guarda o nome de classe original (\`legacyClassName\`). Confirma a existência do objeto e da arte; o nome em português e os valores de loja são nossos.
- **unverified** (${count('unverified')}): arte PNG sem essa evidência de origem.
- **project_original** (${count('project_original')}): criados para este projeto, desenhados em canvas (\`placeholder-art.ts\`) ou tingidos de um PNG. Nomes, preços, níveis e funções são de design; os temas Japão, Itália e Nobreza seguem a ideia dos conjuntos temáticos do jogo, sem reproduzir itens históricos (ver \`docs/REFERENCE_AUDIT.md\`).

Grade nativa: tiles de 160×80 px, projeção 2:1. \`pivot\` é o deslocamento da imagem em relação ao vértice superior do tile de origem.

## Itens

${header}
${rule}
${items.map(row).join('\n')}
`;
}
