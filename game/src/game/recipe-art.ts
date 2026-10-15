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

type Shape = 'balls' | 'drops' | 'slab' | 'layers' | 'bowl' | 'flan';

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

export class RecipeArtLibrary {
  private readonly cache = new Map<string, RecipeArt>();

  constructor(private readonly images: Readonly<Record<string, { stage1?: Texture; stage2?: Texture }>> = {}) {}

  get(recipeId: string): RecipeArt {
    let art = this.cache.get(recipeId);
    if (art) return art;
    const real = this.images[recipeId];
    if (real?.stage1 && real.stage2) {
      art = { stage1: real.stage1, stage2: real.stage2, placeholder: false };
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
