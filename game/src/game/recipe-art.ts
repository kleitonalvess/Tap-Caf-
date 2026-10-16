import { Texture } from 'pixi.js';

/**
 * Dish images per recipe. Recipes with processed PNGs (game/public/assets/foods/<id>/)
 * use them; the rest get a canvas illustration so the book, stoves and counters
 * stay readable. Registering real art only means adding it to `images`.
 */
export interface RecipeArt {
  /** On the stove, while cooking. */
  stage1: Texture;
  /** Ready dish: stove, counter, table and recipe book. */
  stage2: Texture;
  placeholder: boolean;
}

type Shape = 'balls' | 'drops' | 'slab' | 'layers' | 'bowl' | 'flan' | 'steak' | 'rolls' | 'noodles' | 'corn' | 'fish' | 'halfmoon' | 'pot' | 'cup';

interface Look {
  shape: Shape;
  base: string;
  light: string;
  dark: string;
  accent?: string;
}

/** Placeholder looks for the provisional catalogue; unknown ids get a colour from their name. */
const LOOKS: Readonly<Record<string, Look>> = {
  pao_de_queijo: { shape: 'balls', base: '#eebd5f', light: '#fbe3a6', dark: '#b97f30' },
  coxinha: { shape: 'drops', base: '#d98c3a', light: '#f5bd6e', dark: '#9c5a24' },
  brigadeiro: { shape: 'balls', base: '#5a3420', light: '#8a5a3a', dark: '#2e1a10', accent: '#f2d7a0' },
  misto_quente: { shape: 'slab', base: '#e2b26b', light: '#f3d49a', dark: '#a8763a', accent: '#f7d046' },
  torta_de_frango: { shape: 'slab', base: '#e7b45f', light: '#f6d68f', dark: '#b07a33', accent: '#f0d27a' },
  lasanha: { shape: 'layers', base: '#e8a24a', light: '#f5d36b', dark: '#9a4a22', accent: '#c4402c' },
  feijoada: { shape: 'bowl', base: '#3b2418', light: '#6a4430', dark: '#1d110b', accent: '#f4efe4' },
  pudim: { shape: 'flan', base: '#f0c060', light: '#f8dc95', dark: '#c8923a', accent: '#a55d1c' },
  moqueca: { shape: 'bowl', base: '#d8662b', light: '#f0975a', dark: '#9b3f17', accent: '#3f8f3a' },
  // The historical batch (names and levels from the 2010 blog posts).
  mousse_maracuja: { shape: 'cup', base: '#f6d24a', light: '#fbe88f', dark: '#c99a1e', accent: '#3a2a12' },
  pamonha: { shape: 'halfmoon', base: '#e9d27a', light: '#f6e7a8', dark: '#9a8a3a', accent: '#7fae4a' },
  vatapa: { shape: 'bowl', base: '#e8a93a', light: '#f5cd75', dark: '#a8701e', accent: '#d8452c' },
  bolo_cenoura: { shape: 'slab', base: '#f0973a', light: '#f7c07a', dark: '#b8661e', accent: '#4a2a14' },
  bobo_camarao: { shape: 'bowl', base: '#f2b45a', light: '#f8d690', dark: '#b8762a', accent: '#f26b4a' },
  empadao_frango: { shape: 'flan', base: '#e7b45f', light: '#f6d68f', dark: '#b07a33', accent: '#c48a3a' },
  churrasco: { shape: 'steak', base: '#9a4a2a', light: '#c8704a', dark: '#5a2614', accent: '#3f8f3a' },
  fondue: { shape: 'pot', base: '#f3cf6a', light: '#fbe7a6', dark: '#b8922a', accent: '#d8a24a' },
  picanha: { shape: 'steak', base: '#b4553a', light: '#e08a6a', dark: '#6a2a1a', accent: '#f4efe4' },
  pastel: { shape: 'halfmoon', base: '#efc06a', light: '#f8de9e', dark: '#b8862e', accent: '#c8923a' },
  pudim_banana: { shape: 'flan', base: '#f2d27a', light: '#f9e6a8', dark: '#c8a23a', accent: '#8a5a1e' },
  carne_assada: { shape: 'steak', base: '#7a3a22', light: '#a8603a', dark: '#4a2010', accent: '#e8a24a' },
  milho_cozido: { shape: 'corn', base: '#f6cf3a', light: '#fbe38a', dark: '#c99a14', accent: '#7fae4a' },
  salgados_festa: { shape: 'drops', base: '#e4993a', light: '#f5c77a', dark: '#a8601e' },
  sushi: { shape: 'rolls', base: '#f26b4a', light: '#fbfaf5', dark: '#1f2a22', accent: '#7fae4a' },
  peixe_frito: { shape: 'fish', base: '#d99a3a', light: '#f2c870', dark: '#9a6020', accent: '#f6e27a' },
  yakisoba: { shape: 'noodles', base: '#e2b25a', light: '#f3d48a', dark: '#9a6a28', accent: '#3f8f3a' },
};

const SIZE = 240;

function lookFor(id: string): Look {
  const known = LOOKS[id];
  if (known) return known;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { shape: 'slab', base: `hsl(${hue} 55% 55%)`, light: `hsl(${hue} 65% 72%)`, dark: `hsl(${hue} 50% 35%)` };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = SIZE;
  element.height = SIZE;
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível.');
  return [element, context];
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.lineWidth = 4; g.strokeStyle = stroke; g.stroke(); }
}

function ball(g: CanvasRenderingContext2D, x: number, y: number, r: number, look: Look): void {
  const gradient = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
  gradient.addColorStop(0, look.light);
  gradient.addColorStop(0.55, look.base);
  gradient.addColorStop(1, look.dark);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = gradient;
  g.fill();
}

function poly4(g: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>, fill: string): void {
  g.beginPath();
  g.moveTo(points[0]![0], points[0]![1]);
  for (const [x, y] of points.slice(1)) g.lineTo(x, y);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function plate(g: CanvasRenderingContext2D): void {
  ellipse(g, 120, 168, 96, 38, 'rgba(0,0,0,0.18)');
  ellipse(g, 120, 160, 100, 40, '#efe9dd', '#b9b0a0');
  ellipse(g, 120, 158, 74, 28, '#ffffff');
}

function drawDish(g: CanvasRenderingContext2D, look: Look): void {
  switch (look.shape) {
    case 'balls':
      plate(g);
      for (const [x, y, r] of [[92, 140, 24], [148, 140, 24], [120, 152, 26], [104, 116, 22], [138, 116, 22], [121, 98, 21]]) ball(g, x, y, r, look);
      if (look.accent) {
        g.fillStyle = look.accent;
        for (let i = 0; i < 26; i++) g.fillRect(92 + ((i * 37) % 58), 92 + ((i * 53) % 62), 4, 2);
      }
      break;
    case 'drops':
      plate(g);
      for (const [x, y] of [[90, 150], [150, 150], [120, 130]]) {
        const gradient = g.createLinearGradient(x - 26, y - 60, x + 26, y + 20);
        gradient.addColorStop(0, look.light);
        gradient.addColorStop(0.6, look.base);
        gradient.addColorStop(1, look.dark);
        g.beginPath();
        g.moveTo(x, y - 62);
        g.quadraticCurveTo(x + 34, y - 10, x + 24, y + 6);
        g.quadraticCurveTo(x, y + 22, x - 24, y + 6);
        g.quadraticCurveTo(x - 34, y - 10, x, y - 62);
        g.fillStyle = gradient;
        g.fill();
      }
      break;
    case 'slab':
    case 'layers': {
      plate(g);
      // A wedge seen from above at the game's 2:1 angle.
      const top = [[70, 128], [120, 104], [176, 124], [126, 150]];
      g.beginPath();
      g.moveTo(top[0][0], top[0][1]);
      for (const [x, y] of top.slice(1)) g.lineTo(x, y);
      g.closePath();
      g.fillStyle = look.light;
      g.fill();
      const sides: Array<[number[][], string]> = [
        [[[70, 128], [126, 150], [126, 180], [70, 156]], look.base],
        [[[126, 150], [176, 124], [176, 152], [126, 180]], look.dark],
      ];
      for (const [points, fill] of sides) {
        g.beginPath();
        g.moveTo(points[0][0], points[0][1]);
        for (const [x, y] of points.slice(1)) g.lineTo(x, y);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
      }
      if (look.accent) {
        g.strokeStyle = look.accent;
        g.lineWidth = look.shape === 'layers' ? 6 : 5;
        const bands = look.shape === 'layers' ? [140, 160] : [156];
        for (const y of bands) {
          g.beginPath();
          g.moveTo(72, y - 12);
          g.lineTo(126, y + 10);
          g.lineTo(174, y - 14);
          g.stroke();
        }
      }
      break;
    }
    case 'bowl': {
      ellipse(g, 120, 186, 84, 24, 'rgba(0,0,0,0.18)');
      g.beginPath();
      g.moveTo(40, 128);
      g.bezierCurveTo(46, 196, 194, 196, 200, 128);
      g.closePath();
      g.fillStyle = '#c9a27a';
      g.fill();
      ellipse(g, 120, 128, 80, 28, '#8f6a48');
      ellipse(g, 120, 130, 70, 22, look.base);
      g.fillStyle = look.light;
      for (const [x, y] of [[96, 126], [132, 134], [116, 122], [146, 124], [104, 136]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
      if (look.accent) {
        g.fillStyle = look.accent;
        for (const [x, y] of [[84, 130], [154, 130], [124, 140]]) { g.beginPath(); g.ellipse(x, y, 9, 4, 0.5, 0, Math.PI * 2); g.fill(); }
      }
      break;
    }
    case 'steak': {
      plate(g);
      // A grilled cut with char lines, a slice off and a herb sprig.
      g.beginPath(); g.ellipse(112, 146, 56, 26, -0.15, 0, Math.PI * 2);
      const meat = g.createLinearGradient(60, 120, 170, 172);
      meat.addColorStop(0, look.light); meat.addColorStop(0.5, look.base); meat.addColorStop(1, look.dark);
      g.fillStyle = meat; g.fill(); g.lineWidth = 3; g.strokeStyle = look.dark; g.stroke();
      g.strokeStyle = 'rgba(30,12,6,0.65)'; g.lineWidth = 5;
      for (const x of [86, 108, 130]) { g.beginPath(); g.moveTo(x, 130); g.lineTo(x + 20, 160); g.stroke(); }
      ellipse(g, 166, 150, 14, 9, look.light, look.dark);
      if (look.accent) { g.fillStyle = look.accent; for (const [x, y] of [[150, 126], [160, 122], [156, 132]]) { g.beginPath(); g.ellipse(x, y, 6, 3, 0.6, 0, Math.PI * 2); g.fill(); } }
      break;
    }
    case 'rolls':
      plate(g);
      // Sushi: rolls with seaweed and rice, two nigiri with fish on top.
      for (const [x, y] of [[84, 150], [110, 160], [136, 150]]) {
        ellipse(g, x, y, 16, 10, look.dark); ellipse(g, x, y - 4, 13, 8, look.light); ellipse(g, x, y - 4, 6, 4, look.base);
      }
      for (const [x, y] of [[100, 124], [138, 126]]) {
        ellipse(g, x, y + 4, 18, 8, look.light, '#d9d2c3'); ellipse(g, x, y, 18, 7, look.base);
        g.fillStyle = look.dark; g.fillRect(x - 3, y - 6, 6, 14);
      }
      if (look.accent) ellipse(g, 166, 140, 9, 6, look.accent);
      break;
    case 'noodles': {
      ellipse(g, 120, 186, 84, 24, 'rgba(0,0,0,0.18)');
      g.beginPath(); g.moveTo(40, 128); g.bezierCurveTo(46, 196, 194, 196, 200, 128); g.closePath();
      g.fillStyle = '#c23b2c'; g.fill();
      ellipse(g, 120, 128, 80, 28, '#8f2a20');
      ellipse(g, 120, 130, 70, 22, look.base);
      g.strokeStyle = look.light; g.lineWidth = 4;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(60 + i * 12, 122 + (i % 3) * 4); g.bezierCurveTo(70 + i * 12, 110, 80 + i * 12, 146, 92 + i * 12, 130); g.stroke(); }
      if (look.accent) for (const [x, y] of [[96, 124], [140, 132], [118, 140]]) ellipse(g, x, y, 8, 4, look.accent);
      for (const [x, y] of [[132, 120], [104, 136]]) ellipse(g, x, y, 7, 5, '#f26b4a');
      g.strokeStyle = '#8a5a32'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(150, 90); g.lineTo(196, 140); g.moveTo(160, 86); g.lineTo(204, 132); g.stroke();
      break;
    }
    case 'corn':
      plate(g);
      // Two cobs with kernels and their husks.
      for (const [x, y, angle] of [[104, 146, -0.35], [138, 140, -0.2]] as const) {
        g.save(); g.translate(x, y); g.rotate(angle);
        g.fillStyle = look.accent ?? '#7fae4a';
        g.beginPath(); g.moveTo(-48, 0); g.quadraticCurveTo(-30, -26, 0, -6); g.quadraticCurveTo(-30, 18, -48, 0); g.fill();
        g.beginPath(); g.ellipse(4, 0, 44, 16, 0, 0, Math.PI * 2); g.fillStyle = look.base; g.fill(); g.lineWidth = 2; g.strokeStyle = look.dark; g.stroke();
        g.fillStyle = look.light;
        for (let i = -36; i <= 40; i += 8) for (const k of [-8, 0, 8]) { g.beginPath(); g.arc(4 + i, k * Math.sqrt(Math.max(0, 1 - (i / 44) ** 2)), 2.6, 0, Math.PI * 2); g.fill(); }
        g.restore();
      }
      break;
    case 'fish':
      plate(g);
      // A golden fried fish with its tail, a lemon wedge.
      g.beginPath(); g.moveTo(66, 150); g.bezierCurveTo(90, 112, 150, 112, 166, 146); g.bezierCurveTo(150, 176, 90, 180, 66, 150); g.closePath();
      g.fillStyle = look.base; g.fill(); g.lineWidth = 3; g.strokeStyle = look.dark; g.stroke();
      poly4(g, [[166, 146], [192, 126], [186, 150], [192, 172]], look.dark);
      g.strokeStyle = look.light; g.lineWidth = 3;
      for (const x of [96, 116, 136]) { g.beginPath(); g.moveTo(x, 132); g.quadraticCurveTo(x + 8, 148, x, 164); g.stroke(); }
      ellipse(g, 82, 144, 4, 4, '#1f1410');
      if (look.accent) { g.beginPath(); g.moveTo(170, 182); g.arc(170, 182, 18, Math.PI, Math.PI * 1.5); g.closePath(); g.fillStyle = look.accent; g.fill(); }
      break;
    case 'halfmoon':
      plate(g);
      // Half-moon pastries with crimped edges (pastel, pamonha wrapped in husk).
      for (const [x, y] of [[96, 152], [146, 146]]) {
        g.beginPath(); g.moveTo(x - 38, y + 6); g.quadraticCurveTo(x, y - 54, x + 38, y + 6); g.closePath();
        const crust = g.createLinearGradient(x, y - 40, x, y + 6);
        crust.addColorStop(0, look.light); crust.addColorStop(1, look.base);
        g.fillStyle = crust; g.fill(); g.lineWidth = 3; g.strokeStyle = look.dark; g.stroke();
        g.fillStyle = look.accent ?? look.dark;
        for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x - 33 + k * 11, y + 4, 3, 0, Math.PI * 2); g.fill(); }
      }
      break;
    case 'pot': {
      // Fondue: a pot of melted cheese over a little burner, bread on forks.
      ellipse(g, 120, 186, 70, 20, 'rgba(0,0,0,0.18)');
      g.fillStyle = '#3a3d42'; g.fillRect(84, 160, 72, 14);
      ellipse(g, 120, 174, 14, 5, '#f28a2a');
      g.beginPath(); g.moveTo(66, 112); g.bezierCurveTo(70, 168, 170, 168, 174, 112); g.closePath();
      g.fillStyle = '#b8322a'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#6e1a14'; g.stroke();
      ellipse(g, 120, 112, 54, 16, '#6e1a14');
      ellipse(g, 120, 113, 48, 13, look.base);
      ellipse(g, 110, 110, 18, 5, look.light);
      g.strokeStyle = '#9aa5ad'; g.lineWidth = 3;
      for (const [x0, y0, x1, y1] of [[100, 108, 70, 56], [136, 110, 172, 60]] as const) {
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        poly4(g, [[x1 - 9, y1 - 6], [x1 + 9, y1 - 8], [x1 + 10, y1 + 8], [x1 - 8, y1 + 9]], look.accent ?? '#d8a24a');
      }
      break;
    }
    case 'cup':
      // Mousse in a glass cup with seeds on top.
      ellipse(g, 120, 178, 54, 16, 'rgba(0,0,0,0.18)');
      g.beginPath(); g.moveTo(74, 80); g.lineTo(166, 80); g.lineTo(154, 172); g.lineTo(86, 172); g.closePath();
      g.fillStyle = 'rgba(220,240,250,0.45)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#9fb7c4'; g.stroke();
      g.beginPath(); g.moveTo(78, 96); g.lineTo(162, 96); g.lineTo(152, 168); g.lineTo(88, 168); g.closePath();
      g.fillStyle = look.base; g.fill();
      ellipse(g, 120, 96, 42, 10, look.light);
      g.fillStyle = look.accent ?? look.dark;
      for (const [x, y] of [[104, 94], [116, 98], [130, 93], [138, 99], [122, 92]]) { g.beginPath(); g.ellipse(x, y, 2.6, 1.8, 0, 0, Math.PI * 2); g.fill(); }
      break;
    case 'flan':
      plate(g);
      g.beginPath();
      g.moveTo(66, 154);
      g.bezierCurveTo(70, 92, 170, 92, 174, 154);
      g.closePath();
      g.fillStyle = look.base;
      g.fill();
      ellipse(g, 120, 154, 54, 14, look.dark);
      ellipse(g, 120, 104, 34, 12, look.accent ?? look.dark);
      g.fillStyle = look.accent ?? look.dark;
      for (const x of [94, 120, 144]) { g.beginPath(); g.ellipse(x, 116, 6, 12, 0, 0, Math.PI * 2); g.fill(); }
      break;
  }
}

/** Raw ingredients in a pan: same silhouette for every recipe, coloured by its look. */
function drawPan(g: CanvasRenderingContext2D, look: Look): void {
  ellipse(g, 120, 170, 92, 30, 'rgba(0,0,0,0.2)');
  g.fillStyle = '#3a3d42';
  g.fillRect(196, 132, 40, 12);
  ellipse(g, 120, 140, 96, 40, '#4b4f56', '#2a2c30');
  ellipse(g, 120, 136, 80, 30, '#2f3236');
  g.globalAlpha = 0.85;
  for (const [x, y, r] of [[96, 134, 16], [132, 140, 18], [116, 124, 14], [146, 126, 12], [100, 146, 12]]) ball(g, x, y, r, look);
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (const [x, y] of [[84, 128], [150, 134], [122, 146]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
}

/** Drinks are served in a cup or a glass instead of on a plate. */
const DRINKS: Readonly<Record<string, { vessel: 'cup' | 'glass'; drink: string; top?: string }>> = {
  cafe_expresso: { vessel: 'cup', drink: '#4a2a16', top: '#8a5a32' },
  cappuccino: { vessel: 'cup', drink: '#8a5a32', top: '#f3e6cf' },
  mocha_gelado: { vessel: 'glass', drink: '#6b3f22', top: '#f3e6cf' },
  suco_laranja: { vessel: 'glass', drink: '#f39a1e' },
  suco_maracuja: { vessel: 'glass', drink: '#f2cc3a' },
  vitamina_acai: { vessel: 'glass', drink: '#5b2a6e', top: '#a477b8' },
};

/** A cup on a saucer or a tall glass with a straw, in the 240 × 200 dish space. */
function drawDrink(g: CanvasRenderingContext2D, style: { vessel: 'cup' | 'glass'; drink: string; top?: string }, empty: boolean): void {
  ellipse(g, 120, 172, 70, 20, 'rgba(0,0,0,0.18)');
  if (style.vessel === 'cup') {
    ellipse(g, 120, 160, 74, 22, '#f4efe4', '#b9b0a0');
    g.beginPath(); g.moveTo(66, 92); g.lineTo(174, 92); g.quadraticCurveTo(170, 158, 120, 160); g.quadraticCurveTo(70, 158, 66, 92); g.closePath();
    g.fillStyle = '#fbf8f1'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#b9b0a0'; g.stroke();
    g.lineWidth = 10; g.strokeStyle = '#fbf8f1'; g.beginPath(); g.arc(178, 116, 18, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.lineWidth = 3; g.strokeStyle = '#b9b0a0'; g.beginPath(); g.arc(178, 116, 23, -Math.PI / 2, Math.PI / 2); g.stroke();
    ellipse(g, 120, 92, 54, 14, empty ? '#e9e2d4' : style.drink, '#b9b0a0');
    if (!empty && style.top) ellipse(g, 120, 92, 36, 9, style.top);
    if (!empty) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; for (const x of [104, 120, 136]) { g.beginPath(); g.moveTo(x, 70); g.bezierCurveTo(x - 8, 58, x + 8, 48, x, 36); g.stroke(); } }
    return;
  }
  g.beginPath(); g.moveTo(80, 50); g.lineTo(160, 50); g.lineTo(150, 168); g.lineTo(90, 168); g.closePath();
  g.fillStyle = 'rgba(220,240,250,0.45)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#9fb7c4'; g.stroke();
  if (!empty) {
    g.beginPath(); g.moveTo(84, 74); g.lineTo(156, 74); g.lineTo(149, 164); g.lineTo(91, 164); g.closePath();
    g.fillStyle = style.drink; g.fill();
    if (style.top) ellipse(g, 120, 74, 36, 8, style.top);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(94, 82, 8, 70);
  }
  g.lineWidth = 7; g.strokeStyle = '#e8473c'; g.beginPath(); g.moveTo(132, 160); g.lineTo(150, 26); g.lineTo(176, 18); g.stroke();
}

export class RecipeArtLibrary {
  private readonly cache = new Map<string, RecipeArt>();

  constructor(private readonly images: Readonly<Record<string, { stage1?: Texture; stage2?: Texture }>> = {}) {}

  get(recipeId: string): RecipeArt {
    let art = this.cache.get(recipeId);
    if (art) return art;
    const real = this.images[recipeId];
    if (real?.stage1 && real.stage2) {
      art = { stage1: real.stage1, stage2: real.stage2, placeholder: false };
    } else if (DRINKS[recipeId]) {
      const [cup, cupContext] = canvas();
      drawDrink(cupContext, DRINKS[recipeId]!, false);
      const [brewing, brewingContext] = canvas();
      drawDrink(brewingContext, DRINKS[recipeId]!, true);
      art = { stage1: Texture.from(brewing), stage2: Texture.from(cup), placeholder: true };
    } else {
      const look = lookFor(recipeId);
      const [dish, dishContext] = canvas();
      drawDish(dishContext, look);
      const [pan, panContext] = canvas();
      drawPan(panContext, look);
      art = { stage1: Texture.from(pan), stage2: Texture.from(dish), placeholder: true };
    }
    this.cache.set(recipeId, art);
    return art;
  }

  destroy(): void {
    for (const art of this.cache.values()) if (art.placeholder) { art.stage1.destroy(true); art.stage2.destroy(true); }
    this.cache.clear();
  }
}
