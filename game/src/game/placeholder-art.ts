import { Texture } from 'pixi.js';

import type { IndoorArtFrame } from './indoor-art';

/** Native tile at ROOM_ASSET_SCALE 2: a 160×80 diamond whose top corner is the tile origin. */
const TILE_W = 160;
const TILE_H = 80;
const INSET = 0.9;

type Ctx = CanvasRenderingContext2D;
interface BoxPalette { top: string; edge: string; left: string; right: string; trim: string }

/** Box-shaped furniture (counters, stoves): worktop and two visible faces. */
const BOXES: Readonly<Record<string, BoxPalette>> = {
  counter: { top: '#f3ead8', edge: '#c8b89a', left: '#a0703f', right: '#7c5331', trim: '#5e3c22' },
  'counter-wood': { top: '#c98a4b', edge: '#8c5a2b', left: '#9b6232', right: '#7a4a24', trim: '#5a3418' },
  'counter-marble': { top: '#f4f2ee', edge: '#b9b4ac', left: '#d9d4cc', right: '#bfb8ae', trim: '#8f877c' },
  'counter-glass': { top: '#e8f6ff', edge: '#8fb9d6', left: '#cfe8f7', right: '#a9d0ea', trim: '#5f8fb3' },
  'stove-steel': { top: '#d6dde3', edge: '#8e9aa4', left: '#b8c2ca', right: '#98a4ae', trim: '#5f6b75' },
  'stove-master': { top: '#3a3a40', edge: '#c9a13b', left: '#8e2b22', right: '#6e1f18', trim: '#e3bd52' },
  register: { top: '#7a4a24', edge: '#5a3418', left: '#9b6232', right: '#7a4a24', trim: '#5a3418' },
  'counter-sushi': { top: '#e9d2a6', edge: '#a8855a', left: '#c9a26c', right: '#a9844f', trim: '#6e4c26' },
  'stove-teppan': { top: '#c9d1d7', edge: '#7e8a93', left: '#aab4bc', right: '#8a959e', trim: '#4f5a63' },
  'stove-multi': { top: '#e3e8ec', edge: '#97a3ac', left: '#c2cbd2', right: '#a3aeb7', trim: '#b8322a' },
  'stove-oven': { top: '#b8613a', edge: '#7a3a1f', left: '#c8724a', right: '#a5552f', trim: '#5e2a14' },
  'counter-italy': { top: '#f1e6cf', edge: '#b59b6b', left: '#2f7a3d', right: '#24602f', trim: '#7a1f18' },
};

/** Wall decoration: a flat picture sheared onto either wall, framed like basic_window. */
const WALL_ART = new Set(['painting-landscape', 'wall-clock', 'painting-coffee', 'scroll', 'painting-canal', 'curtain-velvet', 'neon-sign']);
const WALL_FRAME = { width: 146, height: 125, left: -74, top: -120.1 };

function canvas(width: number, height: number): { element: HTMLCanvasElement; g: Ctx } | null {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const g = element.getContext('2d');
  return g ? { element, g } : null;
}

function poly(g: Ctx, points: number[][], fill: string, stroke?: string, width = 3): void {
  g.beginPath();
  g.moveTo(points[0]![0]!, points[0]![1]!);
  for (const [x, y] of points.slice(1)) g.lineTo(x!, y!);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.lineWidth = width; g.strokeStyle = stroke; g.stroke(); }
}

function ellipse(g: Ctx, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, width = 2): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.lineWidth = width; g.strokeStyle = stroke; g.stroke(); }
}

/** A box on the tile: w/h are the half diagonals of its top, `rise` its height. */
function box(g: Ctx, cx: number, top: number, w: number, h: number, rise: number, p: BoxPalette): void {
  poly(g, [[cx - w, top], [cx, top + h], [cx, top + h + rise], [cx - w, top + rise]], p.left, p.trim, 2);
  poly(g, [[cx, top + h], [cx + w, top], [cx + w, top + rise], [cx, top + h + rise]], p.right, p.trim, 2);
  poly(g, [[cx - w, top], [cx, top - h], [cx + w, top], [cx, top + h]], p.top, p.edge);
}

/** Recessed panels on both faces of a box, following each face's slope. */
function panels(g: Ctx, cx: number, top: number, w: number, h: number, rise: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = 2;
  for (const left of [true, false]) {
    const x0 = left ? cx - w + 10 : cx + 10;
    const x1 = left ? cx - 10 : cx + w - 10;
    const slope = left ? 0.5 : -0.5;
    const y0 = left ? top + (x0 - (cx - w)) * 0.5 : top + h - (x0 - cx) * 0.5;
    g.beginPath();
    g.moveTo(x0, y0 + 12);
    g.lineTo(x1, y0 + 12 + (x1 - x0) * slope);
    g.lineTo(x1, y0 + rise - 8 + (x1 - x0) * slope);
    g.lineTo(x0, y0 + rise - 8);
    g.closePath();
    g.stroke();
  }
}

function drawBox(g: Ctx, style: string, height: number): void {
  const p = BOXES[style] ?? BOXES.counter!;
  const w = (TILE_W / 2) * INSET;
  const h = (TILE_H / 2) * INSET;
  const cx = TILE_W / 2;
  const top = TILE_H / 2;
  if (style === 'register') {
    // A short stand with the register on top.
    const sw = w * 0.62, sh = h * 0.62, stand = height - 30;
    box(g, cx, top + 30, sw, sh, stand, p);
    panels(g, cx, top + 30, sw, sh, stand, p.trim);
    const machine: BoxPalette = { top: '#d9d2c3', edge: '#6b6b6b', left: '#c7c0b1', right: '#a9a293', trim: '#5c5c5c' };
    box(g, cx, top + 16, sw * 0.7, sh * 0.7, 18, machine);
    poly(g, [[cx - 14, top - 6], [cx + 10, top - 18], [cx + 10, top - 2], [cx - 14, top + 10]], '#2f3b35', '#5c5c5c', 2);
    g.fillStyle = '#7ee08c';
    g.font = 'bold 9px sans-serif';
    g.fillText('$', cx - 6, top + 2);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ellipse(g, cx - 18 + i * 9 + j * 6, top + 22 + j * 5 - i * 4, 3, 2, '#f4efe2', '#5c5c5c', 1);
    return;
  }
  if (style === 'stove-oven') { drawOven(g, cx, top, w, h, height, p); return; }
  box(g, cx, top, w, h, height, p);
  if (style === 'stove-teppan') {
    // A flat steel griddle with a grease gutter, two spatulas and front knobs.
    poly(g, [[cx - w + 12, top], [cx, top - h + 6], [cx + w - 12, top], [cx, top + h - 6]], '#3b4248', p.trim, 2);
    poly(g, [[cx - w + 22, top], [cx, top - h + 12], [cx + w - 22, top], [cx, top + h - 12]], '#4d565d');
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
    for (const k of [-1, 0, 1]) { g.beginPath(); g.moveTo(cx - 30 + k * 12, top + 4 + k * 6); g.lineTo(cx + 2 + k * 12, top - 12 + k * 6); g.stroke(); }
    for (const [x, y] of [[cx - 18, top - 2], [cx + 16, top + 4]] as const) {
      poly(g, [[x - 8, y - 3], [x + 6, y - 10], [x + 9, y - 6], [x - 5, y + 1]], '#e9eef1', '#5f6b75', 1.5);
      poly(g, [[x + 6, y - 10], [x + 20, y - 17], [x + 22, y - 14], [x + 9, y - 6]], '#7a4a24', '#4a2a12', 1.5);
    }
    for (let i = 0; i < 3; i++) ellipse(g, cx + 18 + i * 16, top + h + 4 - i * 8, 4, 4, '#e3352a', '#222', 1);
    poly(g, [[cx - w + 12, top + 16], [cx - 12, top + h + 4], [cx - 12, top + h + height - 14], [cx - w + 12, top + height - 4]], '#68737c', p.trim, 2);
    return;
  }
  if (style === 'stove-multi') {
    // Six burners in two rows of three along the worktop, a red rail and two oven doors.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const bx = cx - 34 + col * 24 + row * 22, by = top + 10 - col * 12 + row * 11 - 16;
      ellipse(g, bx, by, 12, 6, '#2b2f33', p.edge, 2);
      ellipse(g, bx, by, 7, 3.5, 'transparent', '#e8572a', 2);
    }
    g.strokeStyle = p.trim; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx - w, top + 8); g.lineTo(cx, top + h + 8); g.lineTo(cx + w, top + 8); g.stroke();
    for (const shift of [0, 30]) {
      poly(g, [[cx - w + 10 + shift, top + 20 + shift / 2], [cx - w + 34 + shift, top + 32 + shift / 2], [cx - w + 34 + shift, top + height - 2 + shift / 2], [cx - w + 10 + shift, top + height - 14 + shift / 2]], '#4b565f', '#2f363c', 2);
    }
    for (let i = 0; i < 4; i++) ellipse(g, cx + 14 + i * 14, top + h + 6 - i * 7, 3.5, 3.5, '#2f363c', '#111', 1);
    return;
  }
  if (style.startsWith('stove')) {
    // Burners on the top, knobs on the front and the oven window.
    const master = style === 'stove-master';
    for (const [dx, dy] of [[-30, 0], [0, -14], [0, 14], [30, 0]] as const) {
      ellipse(g, cx + dx, top + dy, 15, 7.5, master ? '#1e1e22' : '#2b2f33', p.edge, 2);
      ellipse(g, cx + dx, top + dy, 9, 4.5, 'transparent', master ? '#e85a2a' : '#7a858e', 2);
    }
    poly(g, [[cx - w + 12, top + 18], [cx - 12, top + h + 6], [cx - 12, top + h + height - 12], [cx - w + 12, top + height - 2]],
      master ? '#2a1410' : '#4b565f', p.trim, 2);
    for (let i = 0; i < 3; i++) ellipse(g, cx + 18 + i * 16, top + h + 4 - i * 8, 4, 4, p.trim, '#222', 1);
    if (master) {
      g.strokeStyle = p.trim;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - w, top + 6); g.lineTo(cx, top + h + 6); g.lineTo(cx + w, top + 6);
      g.stroke();
    }
    return;
  }
  panels(g, cx, top, w, h, height, p.trim);
  if (style === 'counter-sushi') {
    // A glass case along the back of the worktop with nigiri, and a noren cloth on the front.
    poly(g, [[cx - w + 16, top - 4], [cx + 6, top - h - 2], [cx + 6, top - h - 22], [cx - w + 16, top - 24]], 'rgba(185,225,245,0.55)', '#6e8fa3', 1.5);
    poly(g, [[cx + 6, top - h - 2], [cx + w - 16, top - 4], [cx + w - 16, top - 24], [cx + 6, top - h - 22]], 'rgba(160,210,235,0.5)', '#6e8fa3', 1.5);
    for (const [x, y, fish] of [[cx - 34, top - 14, '#f26b4a'], [cx - 18, top - 22, '#f59a7a'], [cx - 2, top - 28, '#e9483a'], [cx + 16, top - 24, '#f6b39b'], [cx + 32, top - 16, '#f26b4a']] as const) {
      ellipse(g, x, y + 3, 7, 3.5, '#fbfaf5', '#c9c3b5', 1);
      ellipse(g, x, y, 7, 3, fish);
      g.fillStyle = '#1f2a22'; g.fillRect(x - 1.5, y - 2, 3, 6);
    }
    for (let i = 0; i < 3; i++) {
      const x0 = cx - w + 14 + i * 20;
      poly(g, [[x0, top + 10 + i * 10], [x0 + 18, top + 19 + i * 10], [x0 + 18, top + 44 + i * 10], [x0, top + 35 + i * 10]], i % 2 ? '#1d3f73' : '#24508f', '#13284a', 1.5);
    }
    ellipse(g, cx - w + 42, top + 34, 6, 6, '#f4efe2');
    return;
  }
  if (style === 'counter-italy') {
    // Pequena Itália: a tricolour band on the front, a red-and-white awning along
    // the back of the worktop, a pizza and a breadstick jar on top.
    for (const [i, color] of ['#2f9e44', '#f4efe2', '#d63a2c'].entries()) {
      const x0 = cx - w + 12 + i * 14;
      poly(g, [[x0, top + 14 + i * 7], [x0 + 14, top + 21 + i * 7], [x0 + 14, top + 46 + i * 7], [x0, top + 39 + i * 7]], color, '#3d2614', 1);
    }
    for (let i = 0; i < 6; i++) {
      const x0 = cx - w + 18 + i * 10, y0 = top - 6 - i * 5;
      poly(g, [[x0, y0], [x0 + 10, y0 - 5], [x0 + 10, y0 - 22], [x0, y0 - 17]], i % 2 ? '#f4efe2' : '#d63a2c', '#7a1f18', 1);
    }
    ellipse(g, cx + 10, top + 2, 20, 9, '#e8a24a', '#9a5a22', 1.5);
    ellipse(g, cx + 10, top + 1, 16, 7, '#d8452c');
    for (const [x, y] of [[cx + 4, top], [cx + 14, top + 3], [cx + 12, top - 2], [cx + 20, top + 1]] as const) ellipse(g, x, y, 2.5, 1.5, '#f6e6b0');
    poly(g, [[cx + 30, top - 10], [cx + 40, top - 10], [cx + 39, top + 6], [cx + 31, top + 6]], 'rgba(200,230,245,0.7)', '#6e8fa3', 1.2);
    g.strokeStyle = '#d9a35a'; g.lineWidth = 2;
    for (const dx of [-3, 0, 3]) { g.beginPath(); g.moveTo(cx + 35 + dx, top + 4); g.lineTo(cx + 35 + dx * 1.6, top - 22); g.stroke(); }
    return;
  }
  if (style === 'counter-glass') {
    // A glass front with cakes inside.
    poly(g, [[cx - w + 8, top + 8], [cx - 8, top + h + 2], [cx - 8, top + h + height - 18], [cx - w + 8, top + height - 12]], 'rgba(160,215,245,0.65)', p.trim, 2);
    for (const [x, y, color] of [[cx - 48, top + 26, '#f29ab8'], [cx - 28, top + 36, '#c98a4b'], [cx - 46, top + 44, '#f6d36b']] as const) {
      ellipse(g, x, y, 9, 5, color, '#ffffff', 1.5);
    }
  }
  if (style === 'counter-marble') {
    g.strokeStyle = 'rgba(140,130,120,0.55)';
    g.lineWidth = 1.5;
    for (const [x0, y0, x1, y1] of [[cx - 40, top - 4, cx - 10, top + 10], [cx + 6, top - 18, cx + 36, top - 2], [cx - 14, top + 14, cx + 20, top + 6]] as const) {
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 - 6, x1, y1); g.stroke();
    }
  }
}

function drawTable(g: Ctx, height: number): void {
  const cx = TILE_W / 2;
  const top = TILE_H / 2;
  const w = (TILE_W / 2) * 0.82, h = (TILE_H / 2) * 0.82;
  const legs: Array<[number, number]> = [[cx - w + 12, top], [cx + w - 12, top], [cx, top + h - 6]];
  for (const [x, y] of legs) poly(g, [[x - 4, y], [x + 4, y], [x + 4, y + height], [x - 4, y + height]], '#6b3f1c', '#4a2a12', 1.5);
  // Thick top with plank lines.
  poly(g, [[cx - w, top], [cx, top + h], [cx, top + h + 8], [cx - w, top + 8]], '#8a5428', '#4a2a12', 2);
  poly(g, [[cx, top + h], [cx + w, top], [cx + w, top + 8], [cx, top + h + 8]], '#74451f', '#4a2a12', 2);
  poly(g, [[cx - w, top], [cx, top - h], [cx + w, top], [cx, top + h]], '#b27238', '#5a3418');
  g.strokeStyle = 'rgba(80,45,20,0.45)';
  g.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    g.beginPath();
    g.moveTo(cx - w + w * t, top - h * t);
    g.lineTo(cx + w * t, top + h - h * t);
    g.stroke();
  }
}

/** Floor ornaments stand on the tile centre (cx, floor). */
function drawOrnament(g: Ctx, style: string, height: number): void {
  const cx = TILE_W / 2;
  const floor = height + TILE_H / 2;
  ellipse(g, cx, floor, 34, 13, 'rgba(0,0,0,0.18)');
  const pot = (top: number, width: number, color: string, rim: string) => {
    poly(g, [[cx - width, top], [cx + width, top], [cx + width * 0.72, floor], [cx - width * 0.72, floor]], color, rim, 2);
    ellipse(g, cx, top, width, width * 0.36, rim, '#3d2614', 1.5);
  };
  switch (style) {
    case 'vase-flowers': {
      pot(floor - 30, 18, '#3e8fc9', '#2c6a96');
      for (const [x, y, color] of [[-14, -46, '#e84a6a'], [0, -56, '#f6c544'], [14, -46, '#c46ad6'], [-6, -38, '#ff8a3d'], [8, -36, '#e84a6a']] as const) {
        g.strokeStyle = '#3a8a3a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, floor - 30); g.lineTo(cx + x, floor + y); g.stroke();
        for (let k = 0; k < 5; k++) ellipse(g, cx + x + Math.cos(k * 1.26) * 5, floor + y + Math.sin(k * 1.26) * 5, 4, 4, color);
        ellipse(g, cx + x, floor + y, 3, 3, '#fff2a8');
      }
      break;
    }
    case 'fern': {
      pot(floor - 26, 20, '#b8562f', '#8e3f20');
      g.strokeStyle = '#2f8a3c';
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const angle = -Math.PI / 2 + (i - 4) * 0.32;
        const length = 44 + (i % 2) * 14;
        const ex = cx + Math.cos(angle) * length, ey = floor - 26 + Math.sin(angle) * length * 0.95;
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx, floor - 26); g.quadraticCurveTo(cx + Math.cos(angle) * length * 0.4, ey + 10, ex, ey); g.stroke();
        for (let k = 1; k < 6; k++) {
          const t = k / 6, lx = cx + (ex - cx) * t, ly = floor - 26 + (ey - floor + 26) * t;
          ellipse(g, lx - 4, ly, 5, 2, '#3fae4c');
          ellipse(g, lx + 4, ly, 5, 2, '#46b955');
        }
      }
      break;
    }
    case 'floor-lamp': {
      ellipse(g, cx, floor - 4, 18, 7, '#3a3a3a', '#1f1f1f');
      g.fillStyle = '#4a4a4a';
      g.fillRect(cx - 2.5, floor - height + 30, 5, height - 34);
      const shadeTop = floor - height + 4;
      g.fillStyle = 'rgba(255,236,160,0.35)';
      g.beginPath(); g.moveTo(cx - 22, shadeTop + 30); g.lineTo(cx + 22, shadeTop + 30); g.lineTo(cx + 46, floor); g.lineTo(cx - 46, floor); g.closePath(); g.fill();
      poly(g, [[cx - 14, shadeTop], [cx + 14, shadeTop], [cx + 24, shadeTop + 30], [cx - 24, shadeTop + 30]], '#f6e1a6', '#c79b3c', 2);
      ellipse(g, cx, shadeTop + 30, 24, 6, '#fff3c4', '#c79b3c', 1.5);
      break;
    }
    case 'statue': {
      const base = floor - 34;
      poly(g, [[cx - 28, base], [cx, base + 14], [cx, floor], [cx - 28, floor - 14]], '#b9b2a6', '#7a7368', 2);
      poly(g, [[cx, base + 14], [cx + 28, base], [cx + 28, floor - 14], [cx, floor]], '#9e978b', '#7a7368', 2);
      poly(g, [[cx - 28, base], [cx, base - 14], [cx + 28, base], [cx, base + 14]], '#d7d1c6', '#7a7368', 2);
      ellipse(g, cx, base - 26, 16, 22, '#e9e5dd', '#8a8478');
      ellipse(g, cx, base - 56, 11, 11, '#efe9df', '#8a8478');
      ellipse(g, cx, base - 72, 13, 9, '#ffffff', '#8a8478');
      ellipse(g, cx - 8, base - 76, 7, 6, '#ffffff', '#8a8478', 1.5);
      ellipse(g, cx + 8, base - 76, 7, 6, '#ffffff', '#8a8478', 1.5);
      g.strokeStyle = '#8a8478'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + 12, base - 32); g.lineTo(cx + 26, base - 46); g.stroke();
      ellipse(g, cx + 28, base - 48, 6, 3, '#c9c3b8', '#8a8478', 1.5);
      break;
    }
    case 'fountain': {
      ellipse(g, cx, floor - 14, 54, 22, '#b7b0a3', '#7a7368');
      ellipse(g, cx, floor - 18, 46, 17, '#6cc3ea', '#4a9cc4');
      poly(g, [[cx - 7, floor - 18], [cx + 7, floor - 18], [cx + 5, floor - 58], [cx - 5, floor - 58]], '#cfc8bb', '#7a7368', 1.5);
      ellipse(g, cx, floor - 58, 20, 8, '#b7b0a3', '#7a7368');
      ellipse(g, cx, floor - 60, 15, 5, '#8fd6f5');
      g.strokeStyle = 'rgba(120,200,240,0.9)';
      g.lineWidth = 2.5;
      for (const dx of [-1, 1]) {
        g.beginPath(); g.moveTo(cx, floor - 70); g.quadraticCurveTo(cx + dx * 22, floor - 84, cx + dx * 30, floor - 24); g.stroke();
      }
      ellipse(g, cx, floor - 72, 4, 6, '#bfe8fa');
      break;
    }
    default:
      drawThemedOrnament(g, style, cx, floor, height);
  }
}

/** Wall pictures drawn flat (art space 60 × 64). */
function drawWallPicture(g: Ctx, style: string): void {
  if (THEMED_WALL_ART.has(style)) { drawThemedWallPicture(g, style); return; }
  if (style === 'wall-clock') {
    ellipse(g, 30, 32, 28, 28, '#7a4a24', '#4a2a12', 3);
    ellipse(g, 30, 32, 22, 22, '#fffaf0', '#4a2a12', 1.5);
    g.strokeStyle = '#3d2614';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineWidth = i % 3 === 0 ? 2.5 : 1.2;
      g.beginPath(); g.moveTo(30 + Math.cos(a) * 17, 32 + Math.sin(a) * 17); g.lineTo(30 + Math.cos(a) * 20, 32 + Math.sin(a) * 20); g.stroke();
    }
    g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(30, 32); g.lineTo(30, 18); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(30, 32); g.lineTo(41, 37); g.stroke();
    ellipse(g, 30, 32, 2.5, 2.5, '#c0392b');
    return;
  }
  // A gilded frame with a landscape or a steaming cup.
  g.fillStyle = '#c99a3c'; g.fillRect(0, 0, 60, 64);
  g.fillStyle = '#e8c467'; g.fillRect(3, 3, 54, 58);
  if (style === 'painting-landscape') {
    const sky = g.createLinearGradient(0, 7, 0, 40);
    sky.addColorStop(0, '#8fd0f5'); sky.addColorStop(1, '#d9f0fb');
    g.fillStyle = sky; g.fillRect(7, 7, 46, 50);
    poly(g, [[7, 44], [22, 22], [34, 40], [44, 28], [53, 40], [53, 57], [7, 57]], '#5aa25a');
    poly(g, [[16, 34], [22, 22], [28, 32]], '#f4f4f4');
    ellipse(g, 44, 16, 6, 6, '#ffe066');
  } else {
    g.fillStyle = '#5b3b26'; g.fillRect(7, 7, 46, 50);
    ellipse(g, 30, 46, 16, 5, '#f4efe2', '#d8cfbf', 1.5);
    poly(g, [[18, 30], [42, 30], [39, 46], [21, 46]], '#ffffff', '#d8cfbf', 1.5);
    ellipse(g, 30, 30, 12, 3.5, '#6b3f1c');
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.arc(44, 37, 5, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    for (const x of [24, 30, 36]) { g.beginPath(); g.moveTo(x, 26); g.bezierCurveTo(x - 4, 20, x + 4, 16, x, 10); g.stroke(); }
  }
}

/** Floor ornaments drawn by drawOrnament (the older five plus the themed sets). */
const ORNAMENTS = new Set(['vase-flowers', 'fern', 'floor-lamp', 'statue', 'fountain',
  'shoji', 'bonsai', 'paper-lantern', 'amphora', 'olive-tree', 'candelabra', 'piano', 'vespa', 'wine-rack', 'spiral-post']);
const TABLES = new Set(['table-low', 'table-checker', 'table-imperial']);
const MACHINES = new Set(['machine-coffee', 'machine-juice', 'jukebox', 'arcade', 'spice-shelf']);
const THEMED_WALL_ART = new Set(['scroll', 'painting-canal', 'curtain-velvet', 'neon-sign']);

/** Brick oven (Itália): a brick base, a domed chamber with the fire and a chimney. */
function drawOven(g: Ctx, cx: number, top: number, w: number, h: number, height: number, p: BoxPalette): void {
  const base = height * 0.42;
  box(g, cx, top + height - base, w, h, base, p);
  // Mortar lines on both faces of the base.
  g.strokeStyle = 'rgba(70,30,12,0.45)'; g.lineWidth = 1.2;
  for (let row = 1; row < 3; row++) {
    const y = top + height - base + row * base / 3;
    g.beginPath(); g.moveTo(cx - w, y); g.lineTo(cx, y + h); g.lineTo(cx + w, y); g.stroke();
  }
  // The dome sits on the base's top: an ellipse footprint and a half-ellipse vault.
  const domeY = top + height - base;
  const rx = w * 0.82, ry = h * 0.82, rise = height * 0.85;
  g.beginPath();
  g.ellipse(cx, domeY, rx, ry, 0, 0, Math.PI);
  g.lineTo(cx - rx, domeY);
  g.ellipse(cx, domeY - 2, rx, rise, 0, Math.PI, Math.PI * 2);
  g.closePath();
  const vault = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  vault.addColorStop(0, '#e2a173'); vault.addColorStop(0.55, '#c8784a'); vault.addColorStop(1, '#9c4f2a');
  g.fillStyle = vault; g.fill();
  g.lineWidth = 2; g.strokeStyle = p.trim; g.stroke();
  // Arched mouth on the left face with the fire inside.
  const mx = cx - rx * 0.45, my = domeY + ry * 0.35;
  g.beginPath(); g.moveTo(mx - 20, my); g.quadraticCurveTo(mx - 20, my - 34, mx, my - 36); g.quadraticCurveTo(mx + 18, my - 30, mx + 18, my + 8); g.closePath();
  g.fillStyle = '#2a120a'; g.fill(); g.strokeStyle = '#5e2a14'; g.stroke();
  const fire = g.createRadialGradient(mx, my - 6, 2, mx, my - 6, 18);
  fire.addColorStop(0, '#fff3a6'); fire.addColorStop(0.45, '#ffb13b'); fire.addColorStop(1, 'rgba(232,74,26,0)');
  g.fillStyle = fire; g.beginPath(); g.ellipse(mx, my - 6, 14, 16, 0, 0, Math.PI * 2); g.fill();
  // Chimney at the back.
  poly(g, [[cx + 8, domeY - rise + 6], [cx + 22, domeY - rise], [cx + 22, domeY - rise - 26], [cx + 8, domeY - rise - 20]], '#8e4426', p.trim, 1.5);
  poly(g, [[cx + 22, domeY - rise], [cx + 32, domeY - rise + 5], [cx + 32, domeY - rise - 21], [cx + 22, domeY - rise - 26]], '#6e321a', p.trim, 1.5);
  g.fillStyle = 'rgba(210,210,210,0.55)';
  for (const [dx, dy, r] of [[22, -34, 6], [28, -46, 8], [20, -60, 9]] as const) { g.beginPath(); g.arc(cx + dx, domeY - rise + dy, r, 0, Math.PI * 2); g.fill(); }
}

/**
 * A box on a rectangular footprint: `origin` is its back corner on the floor
 * plane, `along` and `deep` its lengths on the two iso axes ((2, 1) and (-2, 1)
 * per unit) and `rise` its height. Draws the two front faces and the top.
 */
function prism(g: Ctx, origin: { x: number; y: number }, along: number, deep: number, rise: number,
  c: { top: string; left: string; right: string; edge: string }): void {
  const p0 = [origin.x, origin.y - rise];
  const p1 = [p0[0]! + 2 * along, p0[1]! + along];
  const p3 = [p0[0]! - 2 * deep, p0[1]! + deep];
  const p2 = [p1[0]! - 2 * deep, p1[1]! + deep];
  const down = (p: number[]) => [p[0]!, p[1]! + rise];
  poly(g, [p3, p2, down(p2), down(p3)], c.left, c.edge, 1.5);
  poly(g, [p2, p1, down(p1), down(p2)], c.right, c.edge, 1.5);
  poly(g, [p0, p1, p2, p3], c.top, c.edge, 1.5);
}

/** Themed tables: the top's diamond, faces and legs follow drawTable's frame. */
function drawStyledTable(g: Ctx, style: string, height: number): void {
  const cx = TILE_W / 2, top = TILE_H / 2;
  const w = (TILE_W / 2) * 0.82, h = (TILE_H / 2) * 0.82;
  if (style === 'table-low') {
    // Japanese low table: black lacquer, red edge, short block legs and a tea set.
    for (const [x, y] of [[cx - w + 10, top + 2], [cx + w - 10, top + 2], [cx, top + h - 4]] as const) {
      poly(g, [[x - 6, y], [x + 6, y], [x + 6, y + height - 4], [x - 6, y + height - 4]], '#2a1a14', '#120a06', 1.5);
    }
    poly(g, [[cx - w, top], [cx, top + h], [cx, top + h + 7], [cx - w, top + 7]], '#a3221b', '#4a0f0b', 2);
    poly(g, [[cx, top + h], [cx + w, top], [cx + w, top + 7], [cx, top + h + 7]], '#7f1913', '#4a0f0b', 2);
    poly(g, [[cx - w, top], [cx, top - h], [cx + w, top], [cx, top + h]], '#2b211d', '#120a06');
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx - w * 0.6, top - 4); g.lineTo(cx - w * 0.1, top - h * 0.7); g.stroke();
    // Teapot and two cups on a bamboo mat.
    poly(g, [[cx - 26, top + 2], [cx + 4, top - 13], [cx + 24, top - 3], [cx - 6, top + 12]], '#c9b07a', '#7a6438', 1);
    ellipse(g, cx - 2, top - 8, 11, 9, '#4e7a5e', '#23382a', 1.5);
    ellipse(g, cx - 2, top - 16, 6, 2.5, '#3b5e48');
    g.strokeStyle = '#23382a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx + 8, top - 8); g.lineTo(cx + 16, top - 14); g.stroke();
    for (const [x, y] of [[cx - 18, top + 2], [cx + 12, top + 2]] as const) { ellipse(g, x, y, 5, 4, '#efe7d6', '#8f8775', 1); ellipse(g, x, y - 2, 4, 1.5, '#8bb07a'); }
    return;
  }
  if (style === 'table-checker') {
    // Cantina table: turned legs and a red-white checked cloth with a candle in a bottle.
    for (const [x, y] of [[cx - w + 12, top + 6], [cx + w - 12, top + 6], [cx, top + h]] as const) {
      poly(g, [[x - 4, y], [x + 4, y], [x + 4, y + height - 6], [x - 4, y + height - 6]], '#6b3f1c', '#4a2a12', 1.5);
    }
    const drop = 18;
    poly(g, [[cx - w - 4, top], [cx, top + h + 2], [cx, top + h + drop], [cx - w - 4, top + drop - 2]], '#f3eee6', '#a32a22', 1.5);
    poly(g, [[cx, top + h + 2], [cx + w + 4, top], [cx + w + 4, top + drop - 2], [cx, top + h + drop]], '#e2dbd0', '#a32a22', 1.5);
    poly(g, [[cx - w - 4, top], [cx, top - h - 2], [cx + w + 4, top], [cx, top + h + 2]], '#f6f1e9', '#a32a22', 1.5);
    // Red checks in the cloth's own diagonal grid.
    g.save();
    g.beginPath(); g.moveTo(cx - w - 4, top); g.lineTo(cx, top - h - 2); g.lineTo(cx + w + 4, top); g.lineTo(cx, top + h + 2); g.closePath(); g.clip();
    g.fillStyle = 'rgba(200,40,32,0.78)';
    const n = 6;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i + j) % 2) continue;
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      const at = (u: number, v: number): [number, number] => [cx - w - 4 + (w + 4) * (u + v), top - (h + 2) * u + (h + 2) * v];
      poly(g, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], 'rgba(200,40,32,0.78)');
    }
    g.restore();
    // The hanging cloth keeps the checks: every other band down both visible faces.
    for (let k = 0; k < n; k += 2) {
      const t0 = k / n, t1 = (k + 1) / n;
      const left = (t: number): [number, number] => [cx - w - 4 + (w + 4) * t, top + (h + 2) * t];
      const right = (t: number): [number, number] => [cx + (w + 4) * t, top + h + 2 - (h + 2) * t];
      for (const at of [left, right]) {
        const [x0, y0] = at(t0), [x1, y1] = at(t1);
        poly(g, [[x0, y0], [x1, y1], [x1, y1 + drop - 2], [x0, y0 + drop - 2]], 'rgba(200,40,32,0.72)');
      }
    }
    // Candle in a straw-wrapped bottle.
    poly(g, [[cx - 7, top - 4], [cx + 7, top - 4], [cx + 5, top - 26], [cx - 5, top - 26]], '#2f6b3a', '#1b3d22', 1.5);
    poly(g, [[cx - 8, top - 2], [cx + 8, top - 2], [cx + 7, top - 12], [cx - 7, top - 12]], '#d9b86a', '#8a6d2c', 1);
    g.fillStyle = '#fbf6e8'; g.fillRect(cx - 2.5, top - 40, 5, 14);
    ellipse(g, cx, top - 44, 3.5, 6, '#ffcf4a');
    ellipse(g, cx, top - 43, 1.8, 3, '#fff7d0');
    g.fillStyle = 'rgba(255,214,120,0.18)'; g.beginPath(); g.arc(cx, top - 40, 22, 0, Math.PI * 2); g.fill();
    return;
  }
  // Imperial table: marble top with a gold rim on curved gilded legs and a rose vase.
  for (const [x, y, dir] of [[cx - w + 14, top + 4, -1], [cx + w - 14, top + 4, 1], [cx, top + h - 2, 0]] as const) {
    g.strokeStyle = '#a77d18'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + dir * 8, y + height * 0.35, x - dir * 6, y + height * 0.7, x + dir * 4, y + height - 6); g.stroke();
    g.strokeStyle = '#f1cf5a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + dir * 8, y + height * 0.35, x - dir * 6, y + height * 0.7, x + dir * 4, y + height - 6); g.stroke();
    ellipse(g, x + dir * 4, y + height - 4, 5, 3, '#c99a2a', '#7a5a10', 1);
  }
  poly(g, [[cx - w, top], [cx, top + h], [cx, top + h + 9], [cx - w, top + 9]], '#d4a62a', '#7a5a10', 2);
  poly(g, [[cx, top + h], [cx + w, top], [cx + w, top + 9], [cx, top + h + 9]], '#b38a1e', '#7a5a10', 2);
  poly(g, [[cx - w, top], [cx, top - h], [cx + w, top], [cx, top + h]], '#f4f1ea', '#c99a2a', 3);
  g.strokeStyle = 'rgba(150,140,128,0.5)'; g.lineWidth = 1.2;
  for (const [x0, y0, x1, y1] of [[cx - 44, top - 2, cx - 8, top + 12], [cx + 4, top - 20, cx + 40, top - 4]] as const) {
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 - 8, x1, y1); g.stroke();
  }
  poly(g, [[cx - 6, top - 2], [cx + 6, top - 2], [cx + 4, top - 18], [cx - 4, top - 18]], '#e8e4f5', '#8a84a8', 1.5);
  g.strokeStyle = '#3a8a3a'; g.lineWidth = 1.5;
  for (const dx of [-5, 0, 5]) { g.beginPath(); g.moveTo(cx, top - 16); g.lineTo(cx + dx, top - 28); g.stroke(); ellipse(g, cx + dx, top - 30, 4, 4, '#d6264a', '#8e1430', 1); }
}

/** The themed floor ornaments (Japão, Itália, Nobreza), standing on (cx, floor). */
function drawThemedOrnament(g: Ctx, style: string, cx: number, floor: number, height: number): void {
  switch (style) {
    case 'shoji': {
      // Three folding panels in a zigzag: dark wood frames over translucent paper.
      const panelH = height - 10, panelW = 26;
      const panels: Array<[number, number, number]> = [[cx - 40, floor - 12, 1], [cx - 14, floor - 4, -1], [cx + 12, floor - 12, 1]];
      for (const [x, y, slope] of panels) {
        const dy = slope * panelW * 0.4;
        poly(g, [[x, y], [x + panelW, y + dy], [x + panelW, y + dy - panelH], [x, y - panelH]], slope > 0 ? '#f7efdc' : '#e9dfc6', '#3d2614', 3);
        g.strokeStyle = 'rgba(61,38,20,0.75)'; g.lineWidth = 1.2;
        for (let k = 1; k < 3; k++) { const fx = x + panelW * k / 3; g.beginPath(); g.moveTo(fx, y + dy * k / 3); g.lineTo(fx, y + dy * k / 3 - panelH); g.stroke(); }
        for (let k = 1; k < 6; k++) { const fy = -panelH * k / 6; g.beginPath(); g.moveTo(x, y + fy); g.lineTo(x + panelW, y + dy + fy); g.stroke(); }
      }
      ellipse(g, cx - 2, floor - 40, 7, 7, 'rgba(214,38,52,0.55)');
      break;
    }
    case 'bonsai': {
      // Glazed tray pot, a twisted trunk and cloud-shaped foliage pads.
      poly(g, [[cx - 34, floor - 18], [cx + 34, floor - 18], [cx + 28, floor - 4], [cx - 28, floor - 4]], '#2f5f8f', '#1c3a57', 2);
      ellipse(g, cx, floor - 18, 34, 7, '#3f74a6', '#1c3a57', 1.5);
      ellipse(g, cx, floor - 18, 28, 5, '#6b4a2e');
      g.strokeStyle = '#5a3a22'; g.lineCap = 'round';
      g.lineWidth = 9; g.beginPath(); g.moveTo(cx - 4, floor - 18); g.bezierCurveTo(cx - 20, floor - 34, cx + 14, floor - 42, cx - 2, floor - 58); g.stroke();
      g.lineWidth = 5; g.beginPath(); g.moveTo(cx + 2, floor - 40); g.quadraticCurveTo(cx + 18, floor - 44, cx + 26, floor - 50); g.stroke();
      g.beginPath(); g.moveTo(cx - 6, floor - 48); g.quadraticCurveTo(cx - 20, floor - 52, cx - 28, floor - 60); g.stroke();
      for (const [x, y, rx] of [[cx - 28, floor - 64, 16], [cx + 26, floor - 54, 15], [cx - 2, floor - 70, 18]] as const) {
        ellipse(g, x, y + 2, rx, rx * 0.5, '#2f6b2f');
        ellipse(g, x - 2, y - 1, rx * 0.85, rx * 0.42, '#4b9a3e');
        ellipse(g, x - 4, y - 3, rx * 0.5, rx * 0.22, '#6fbf55');
      }
      break;
    }
    case 'paper-lantern': {
      // A wooden stand with an arm and a red paper lantern glowing on it.
      poly(g, [[cx - 14, floor - 6], [cx + 14, floor - 6], [cx + 10, floor], [cx - 10, floor]], '#3d2614');
      g.fillStyle = '#4a2e18'; g.fillRect(cx - 3, floor - height + 10, 6, height - 16);
      g.fillRect(cx - 3, floor - height + 10, 28, 5);
      g.strokeStyle = '#2a1a0e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx + 22, floor - height + 15); g.lineTo(cx + 22, floor - height + 24); g.stroke();
      const ly = floor - height + 52;
      const glow = g.createRadialGradient(cx + 22, ly, 4, cx + 22, ly, 46);
      glow.addColorStop(0, 'rgba(255,170,80,0.45)'); glow.addColorStop(1, 'rgba(255,170,80,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(cx + 22, ly, 46, 0, Math.PI * 2); g.fill();
      ellipse(g, cx + 22, ly, 20, 26, '#d8342a', '#7a1410', 2);
      g.strokeStyle = 'rgba(122,20,16,0.65)'; g.lineWidth = 1.2;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(cx + 22, ly + k * 8, Math.sqrt(1 - (k * 8 / 26) ** 2) * 20, 3, 0, 0, Math.PI); g.stroke(); }
      ellipse(g, cx + 22, ly - 25, 10, 3.5, '#1f1410'); ellipse(g, cx + 22, ly + 25, 10, 3.5, '#1f1410');
      g.fillStyle = '#ffe9b0'; g.font = 'bold 13px serif'; g.fillText('茶', cx + 15, ly + 5);
      break;
    }
    case 'amphora': {
      // Terracotta amphora with two handles and a black meander band.
      const body = g.createLinearGradient(cx - 22, 0, cx + 22, 0);
      body.addColorStop(0, '#e08a52'); body.addColorStop(0.6, '#c8693a'); body.addColorStop(1, '#9a4a22');
      g.beginPath();
      g.moveTo(cx - 8, floor - height + 10); g.bezierCurveTo(cx - 34, floor - height + 34, cx - 28, floor - 18, cx - 8, floor - 4);
      g.lineTo(cx + 8, floor - 4); g.bezierCurveTo(cx + 28, floor - 18, cx + 34, floor - height + 34, cx + 8, floor - height + 10); g.closePath();
      g.fillStyle = body; g.fill(); g.strokeStyle = '#6e3418'; g.lineWidth = 2; g.stroke();
      ellipse(g, cx, floor - height + 9, 11, 4, '#b85a2e', '#6e3418', 1.5);
      g.strokeStyle = '#6e3418'; g.lineWidth = 3.5;
      for (const dir of [-1, 1]) { g.beginPath(); g.moveTo(cx + dir * 8, floor - height + 14); g.quadraticCurveTo(cx + dir * 26, floor - height + 12, cx + dir * 22, floor - height + 32); g.stroke(); }
      g.fillStyle = '#2b1a10'; g.fillRect(cx - 24, floor - height + 40, 48, 8);
      g.strokeStyle = '#e8a46a'; g.lineWidth = 1.2;
      for (let k = 0; k < 6; k++) { const x = cx - 22 + k * 8; g.beginPath(); g.moveTo(x, floor - height + 46); g.lineTo(x, floor - height + 42); g.lineTo(x + 5, floor - height + 42); g.lineTo(x + 5, floor - height + 45); g.stroke(); }
      break;
    }
    case 'vespa': {
      // A mint scooter at the game's angle: two small wheels, the curved body
      // and leg shield, a brown seat, chrome handlebar and a round headlight.
      ellipse(g, cx + 24, floor - 12, 12, 12, '#2a2a2e', '#111', 2); ellipse(g, cx + 24, floor - 12, 5, 5, '#c9cfd4');
      ellipse(g, cx - 26, floor - 4, 11, 11, '#2a2a2e', '#111', 2); ellipse(g, cx - 26, floor - 4, 5, 5, '#c9cfd4');
      g.beginPath();
      g.moveTo(cx - 8, floor - 16); g.bezierCurveTo(cx + 2, floor - 36, cx + 34, floor - 44, cx + 40, floor - 22);
      g.lineTo(cx + 36, floor - 12); g.lineTo(cx + 6, floor - 8); g.closePath();
      g.fillStyle = '#7fd3c0'; g.fill(); g.strokeStyle = '#2f7a6a'; g.lineWidth = 2; g.stroke();
      poly(g, [[cx - 22, floor - 14], [cx - 8, floor - 16], [cx - 4, floor - 58], [cx - 18, floor - 62]], '#8fdccb', '#2f7a6a', 2);
      ellipse(g, cx + 20, floor - 40, 18, 6, '#6b3f1c', '#3d2412', 1.5);
      g.strokeStyle = '#c9cfd4'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx - 26, floor - 66); g.lineTo(cx - 2, floor - 72); g.stroke();
      ellipse(g, cx - 13, floor - 66, 7, 7, '#fff6c2', '#8a8f93', 2);
      g.lineCap = 'butt';
      break;
    }
    case 'wine-rack': {
      // Vinoteca: a tall wooden cabinet of diagonal cells full of bottles, with a
      // bottle and two glasses on top.
      const top = floor - height + 28;
      poly(g, [[cx - 30, top], [cx + 4, top + 10], [cx + 4, floor - 2], [cx - 30, floor - 12]], '#7a4a24', '#3d2412', 2);
      poly(g, [[cx + 4, top + 10], [cx + 32, top - 2], [cx + 32, floor - 14], [cx + 4, floor - 2]], '#5e3418', '#3d2412', 2);
      poly(g, [[cx - 30, top], [cx - 2, top - 12], [cx + 32, top - 2], [cx + 4, top + 10]], '#9b6232', '#3d2412', 2);
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        const x = cx - 24 + col * 10, y = top + 14 + row * 18 + col * 3;
        ellipse(g, x, y, 4, 4, row % 2 === col % 2 ? '#5a1022' : '#1f4a2a', '#111', 1);
      }
      g.fillStyle = '#1f4a2a'; g.fillRect(cx - 4, top - 30, 7, 22); g.fillRect(cx - 2, top - 38, 3, 9);
      for (const x of [cx + 12, cx + 22]) {
        g.strokeStyle = 'rgba(220,240,250,0.9)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, top - 6); g.lineTo(x, top - 14); g.stroke();
        ellipse(g, x, top - 18, 4, 5, 'rgba(160,20,40,0.75)', 'rgba(220,240,250,0.9)', 1);
      }
      break;
    }
    case 'spiral-post': {
      // Poste Espiral: a black iron post twisted in a spiral, two glowing lamps.
      ellipse(g, cx, floor - 4, 16, 6, '#26262a', '#111', 1.5);
      poly(g, [[cx - 10, floor - 6], [cx + 10, floor - 6], [cx + 6, floor - 22], [cx - 6, floor - 22]], '#2f2f34', '#111', 1.5);
      const postTop = floor - height + 40;
      g.fillStyle = '#2f2f34'; g.fillRect(cx - 3, postTop, 6, floor - 22 - postTop);
      g.strokeStyle = '#55555c'; g.lineWidth = 2;
      for (let y = floor - 26; y > postTop + 6; y -= 10) { g.beginPath(); g.moveTo(cx - 4, y); g.quadraticCurveTo(cx + 8, y - 5, cx - 4, y - 10); g.stroke(); }
      g.strokeStyle = '#2f2f34'; g.lineWidth = 3.5;
      for (const dir of [-1, 1]) {
        g.beginPath(); g.moveTo(cx, postTop + 8); g.bezierCurveTo(cx + dir * 10, postTop - 8, cx + dir * 26, postTop - 4, cx + dir * 24, postTop + 10); g.stroke();
        const lx = cx + dir * 24, ly = postTop + 20;
        const glow = g.createRadialGradient(lx, ly, 2, lx, ly, 22);
        glow.addColorStop(0, 'rgba(255,214,120,0.5)'); glow.addColorStop(1, 'rgba(255,214,120,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(lx, ly, 22, 0, Math.PI * 2); g.fill();
        poly(g, [[lx - 7, ly - 8], [lx + 7, ly - 8], [lx + 5, ly + 8], [lx - 5, ly + 8]], '#ffe39a', '#2f2f34', 2);
      }
      break;
    }
    case 'olive-tree': {
      // Terracotta pot, slender trunk and silvery leaves with black olives.
      poly(g, [[cx - 20, floor - 28], [cx + 20, floor - 28], [cx + 14, floor - 2], [cx - 14, floor - 2]], '#c8693a', '#7a3a1a', 2);
      ellipse(g, cx, floor - 28, 20, 6, '#d47a46', '#7a3a1a', 1.5);
      g.strokeStyle = '#6b5a44'; g.lineCap = 'round'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(cx, floor - 28); g.bezierCurveTo(cx - 6, floor - 54, cx + 8, floor - 70, cx, floor - height + 34); g.stroke();
      for (const [x, y, rx] of [[cx - 22, floor - height + 36, 22], [cx + 20, floor - height + 30, 20], [cx, floor - height + 20, 24], [cx - 6, floor - height + 46, 18]] as const) {
        ellipse(g, x, y, rx, rx * 0.6, '#7d9a6a');
        for (let k = 0; k < 7; k++) ellipse(g, x + Math.cos(k * 0.9) * rx * 0.6, y + Math.sin(k * 0.9) * rx * 0.35, 5, 1.8, k % 2 ? '#b8c9a8' : '#9db48a');
      }
      for (const [x, y] of [[cx - 14, floor - height + 40], [cx + 12, floor - height + 34], [cx + 2, floor - height + 26]] as const) ellipse(g, x, y, 2.6, 3.2, '#2a2430');
      break;
    }
    case 'candelabra': {
      // Gilded candelabra: round base, a turned stem, five arms with lit candles.
      ellipse(g, cx, floor - 4, 20, 7, '#b88a1e', '#6e5010', 1.5);
      g.fillStyle = '#d4a62a'; g.fillRect(cx - 3, floor - height + 36, 6, height - 40);
      for (const y of [floor - 30, floor - 54]) ellipse(g, cx, y, 7, 4, '#e8c050', '#8a6a14', 1);
      const armY = floor - height + 38;
      g.strokeStyle = '#c99a2a'; g.lineWidth = 3.5;
      for (const dx of [-30, -15, 15, 30]) { g.beginPath(); g.moveTo(cx, armY + 8); g.quadraticCurveTo(cx + dx, armY + 14, cx + dx, armY - 2); g.stroke(); }
      for (const dx of [-30, -15, 0, 15, 30]) {
        const y = armY - (dx === 0 ? 10 : 2);
        ellipse(g, cx + dx, y, 5, 2, '#e8c050', '#8a6a14', 1);
        g.fillStyle = '#fbf6e8'; g.fillRect(cx + dx - 2, y - 16, 4, 16);
        const glow = g.createRadialGradient(cx + dx, y - 21, 1, cx + dx, y - 21, 12);
        glow.addColorStop(0, 'rgba(255,214,120,0.75)'); glow.addColorStop(1, 'rgba(255,214,120,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(cx + dx, y - 21, 12, 0, Math.PI * 2); g.fill();
        ellipse(g, cx + dx, y - 21, 2.6, 4.5, '#ffcf4a');
      }
      break;
    }
    case 'piano': {
      // Upright piano in black lacquer: a slim cabinet whose long face looks to the
      // lower left, a keyboard ledge in front of it and sheet music on that face.
      const lacquer = { top: '#34343a', left: '#24242b', right: '#16161b', edge: '#060608' };
      const along = 32, deep = 11, rise = Math.round(height * 0.72);
      // Back corner placed so the footprint is centred on the tile (cx, floor).
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, deep, rise, lacquer);
      const face = { x: back.x - 2 * deep, y: back.y + deep }; // front-left corner on the floor
      const onFace = (t: number, up: number): [number, number] => [face.x + 2 * along * t, face.y + along * t - up];
      // Keyboard ledge at hand height, 7 units deep.
      const lift = rise * 0.4, keyDeep = 7, inset = 2;
      const ledge = { x: face.x + 2 * inset, y: face.y + inset - lift };
      prism(g, ledge, along - 2 * inset, keyDeep, 5, { top: '#f6f3ec', left: '#1d1d22', right: '#121216', edge: '#5a5650' });
      const keyTop = (t: number, d: number): [number, number] => [ledge.x + 2 * (along - 2 * inset) * t - 2 * d, ledge.y - 5 + (along - 2 * inset) * t + d];
      g.strokeStyle = '#8a857c'; g.lineWidth = 0.8;
      for (let k = 1; k < 18; k++) { const [x0, y0] = keyTop(k / 18, 0), [x1, y1] = keyTop(k / 18, keyDeep); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      for (const k of [1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 15, 16]) {
        const t0 = (k + 0.25) / 18, t1 = (k + 0.75) / 18;
        poly(g, [keyTop(t0, 0), keyTop(t1, 0), keyTop(t1, keyDeep * 0.55), keyTop(t0, keyDeep * 0.55)], '#151517');
      }
      // Sheet music on the cabinet face above the keys.
      const [ax, ay] = onFace(0.32, lift + 14), [bx, by] = onFace(0.62, lift + 14);
      poly(g, [[ax, ay], [bx, by], [bx, by - 20], [ax, ay - 20]], '#fbf8ef', '#a8a294', 1);
      g.strokeStyle = '#444'; g.lineWidth = 0.7;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(ax + 2, ay - 16 + k * 4); g.lineTo(bx - 2, by - 16 + k * 4); g.stroke(); }
      // A gold candle on the lid, near its right end.
      const lid = { x: back.x + 2 * along * 0.75 - deep, y: back.y + along * 0.75 + deep / 2 - rise };
      ellipse(g, lid.x, lid.y, 4, 2, '#e8c050', '#8a6a14', 1);
      g.fillStyle = '#fbf6e8'; g.fillRect(lid.x - 1.5, lid.y - 12, 3, 12);
      ellipse(g, lid.x, lid.y - 14, 2, 3.5, '#ffcf4a');
      break;
    }
  }
}

/** Themed wall pictures, drawn flat in the 60 × 64 art space. */
function drawThemedWallPicture(g: Ctx, style: string): void {
  switch (style) {
    case 'scroll': {
      // Hanging scroll: silk border, ink mountains, a red seal and wooden rods.
      g.fillStyle = '#5a6b4a'; g.fillRect(14, 4, 32, 56);
      g.fillStyle = '#f4ecd8'; g.fillRect(18, 10, 24, 44);
      g.strokeStyle = 'rgba(40,40,40,0.8)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(18, 40); g.lineTo(25, 28); g.lineTo(30, 35); g.lineTo(36, 24); g.lineTo(42, 34); g.stroke();
      g.fillStyle = 'rgba(40,40,40,0.25)'; g.beginPath(); g.moveTo(18, 46); g.lineTo(27, 38); g.lineTo(34, 44); g.lineTo(42, 40); g.lineTo(42, 48); g.lineTo(18, 48); g.fill();
      ellipse(g, 34, 16, 4, 4, 'rgba(240,240,240,0.9)');
      g.fillStyle = '#c0392b'; g.fillRect(21, 47, 5, 5);
      g.fillStyle = '#4a2e18'; g.fillRect(11, 1, 38, 4); g.fillRect(11, 59, 38, 4);
      ellipse(g, 11, 61, 2.5, 2.5, '#2a1a0e'); ellipse(g, 49, 61, 2.5, 2.5, '#2a1a0e');
      return;
    }
    case 'painting-canal': {
      // Gilded frame: a canal between warm houses, a bridge and a gondola.
      g.fillStyle = '#c99a3c'; g.fillRect(0, 0, 60, 64);
      g.fillStyle = '#e8c467'; g.fillRect(3, 3, 54, 58);
      const sky = g.createLinearGradient(0, 7, 0, 34);
      sky.addColorStop(0, '#f6c98a'); sky.addColorStop(1, '#fbe8c8');
      g.fillStyle = sky; g.fillRect(7, 7, 46, 50);
      for (const [x, w, hgt, color] of [[7, 12, 26, '#d9774a'], [19, 8, 20, '#f0c25a'], [37, 9, 22, '#e39b6a'], [46, 7, 28, '#c8604a']] as const) {
        g.fillStyle = color; g.fillRect(x, 40 - hgt, w, hgt);
        g.fillStyle = 'rgba(60,40,30,0.55)'; for (let k = 0; k < 3; k++) g.fillRect(x + 2, 40 - hgt + 4 + k * 7, 2, 3);
      }
      g.fillStyle = '#3f8fb5'; g.fillRect(7, 40, 46, 17);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      for (const y of [44, 49, 53]) { g.beginPath(); g.moveTo(10, y); g.lineTo(22, y); g.moveTo(32, y + 1); g.lineTo(48, y + 1); g.stroke(); }
      g.strokeStyle = '#d9cbb0'; g.lineWidth = 3; g.beginPath(); g.arc(30, 44, 10, Math.PI, 0); g.stroke();
      poly(g, [[16, 50], [36, 50], [33, 53], [19, 53]], '#1f1f24');
      g.strokeStyle = '#1f1f24'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(31, 50); g.lineTo(34, 40); g.stroke();
      return;
    }
    case 'curtain-velvet': {
      // Velvet drapes with a gold valance and tiebacks; the middle stays open.
      g.fillStyle = '#7a1d2c';
      g.beginPath(); g.moveTo(2, 8); g.lineTo(22, 8); g.quadraticCurveTo(14, 34, 20, 38); g.quadraticCurveTo(10, 50, 14, 62); g.lineTo(2, 62); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(58, 8); g.lineTo(38, 8); g.quadraticCurveTo(46, 34, 40, 38); g.quadraticCurveTo(50, 50, 46, 62); g.lineTo(58, 62); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,6,12,0.55)'; g.lineWidth = 1.5;
      for (const x of [6, 11, 16, 44, 49, 54]) { g.beginPath(); g.moveTo(x, 10); g.quadraticCurveTo(x + (x < 30 ? 2 : -2), 36, x, 62); g.stroke(); }
      g.strokeStyle = 'rgba(255,170,180,0.25)'; g.lineWidth = 1;
      for (const x of [8, 13, 46, 51]) { g.beginPath(); g.moveTo(x, 10); g.lineTo(x, 60); g.stroke(); }
      for (const [x, dir] of [[18, 1], [42, -1]] as const) { ellipse(g, x, 38, 5, 3, '#e3bd52', '#8a6a14', 1); g.strokeStyle = '#e3bd52'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 40); g.lineTo(x + dir * 3, 48); g.stroke(); }
      g.fillStyle = '#9a2638'; g.beginPath(); g.moveTo(0, 2); g.lineTo(60, 2);
      for (let k = 5; k >= 0; k--) g.quadraticCurveTo(k * 10 + 5, 18, k * 10, 10);
      g.closePath(); g.fill();
      g.fillStyle = '#e3bd52'; g.fillRect(0, 0, 60, 3);
      return;
    }
    case 'neon-sign': {
      // A dark board with glowing "CAFÉ" letters and a steaming cup.
      g.fillStyle = '#1d1a2a'; g.fillRect(2, 12, 56, 40);
      g.strokeStyle = '#3c3654'; g.lineWidth = 2; g.strokeRect(2, 12, 56, 40);
      g.save();
      g.shadowColor = '#ff4fb8'; g.shadowBlur = 8;
      g.fillStyle = '#ff8ad4'; g.font = 'bold 15px sans-serif'; g.fillText('CAFÉ', 9, 31);
      g.shadowColor = '#49e3ff';
      g.strokeStyle = '#a9f2ff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(20, 38); g.lineTo(38, 38); g.lineTo(36, 47); g.lineTo(22, 47); g.closePath(); g.stroke();
      g.beginPath(); g.arc(40, 42, 3, -Math.PI / 2, Math.PI / 2); g.stroke();
      for (const x of [25, 30, 35]) { g.beginPath(); g.moveTo(x, 36); g.quadraticCurveTo(x - 2, 33, x, 30); g.stroke(); }
      g.restore();
      g.fillStyle = '#6b6680'; g.fillRect(14, 4, 2, 8); g.fillRect(44, 4, 2, 8);
      return;
    }
  }
}

/** Points on the two visible faces of a prism (see prism): `front` runs along the
 * long axis (lower-left face), `side` along the depth (lower-right face). */
function faces(back: { x: number; y: number }, along: number, deep: number) {
  const fx = back.x - 2 * deep, fy = back.y + deep;
  const px = fx + 2 * along, py = fy + along;
  return {
    front: (t: number, up: number): [number, number] => [fx + 2 * along * t, fy + along * t - up],
    side: (t: number, up: number): [number, number] => [px + 2 * deep * t, py - deep * t - up],
  };
}

function quad(g: Ctx, at: (t: number, up: number) => [number, number], t0: number, t1: number, u0: number, u1: number, fill: string, stroke?: string, width = 1.5): void {
  poly(g, [at(t0, u0), at(t1, u0), at(t1, u1), at(t0, u1)], fill, stroke, width);
}

/** Coffee and juice machines, the jukebox, the arcade and the spice shelf. */
function drawMachine(g: Ctx, style: string, cx: number, floor: number, height: number): void {
  ellipse(g, cx, floor, 44, 16, 'rgba(0,0,0,0.16)');
  switch (style) {
    case 'machine-coffee': {
      // An espresso machine: red body, steel top with cups warming, two group heads.
      const along = 26, deep = 18, rise = height - 12;
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, deep, rise, { top: '#d9dfe4', left: '#b8322a', right: '#8e2620', edge: '#3d1410' });
      const f = faces(back, along, deep);
      quad(g, f.front, 0.06, 0.94, rise - 12, rise - 4, '#e8edf0', '#5f6b75', 1);
      quad(g, f.front, 0.08, 0.92, 6, 12, '#5f6b75', '#2f363c', 1);
      for (const t of [0.3, 0.7]) {
        const [x, y] = f.front(t, rise * 0.62);
        ellipse(g, x, y, 7, 4, '#c9d1d7', '#4f5a63', 1.5);
        poly(g, [[x - 2, y + 2], [x + 2, y + 2], [x + 2, y + 10], [x - 2, y + 10]], '#2b2f33');
        g.strokeStyle = '#2b2f33'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 2, y + 6); g.lineTo(x + 12, y + 10); g.stroke();
        const [cupX, cupY] = f.front(t, 13);
        poly(g, [[cupX - 5, cupY - 8], [cupX + 5, cupY - 8], [cupX + 4, cupY], [cupX - 4, cupY]], '#fbf8f1', '#9b9284', 1);
      }
      const [gx, gy] = f.front(0.5, rise * 0.86);
      ellipse(g, gx, gy, 6, 6, '#fbf8f1', '#4f5a63', 1.5);
      g.strokeStyle = '#c0392b'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 3, gy - 3); g.stroke();
      for (const [dx, dy] of [[-10, 2], [4, -5], [16, 2]] as const) {
        const tx = back.x + dx, ty = back.y + along / 2 - rise + 8 + dy;
        poly(g, [[tx - 5, ty - 7], [tx + 5, ty - 7], [tx + 4, ty], [tx - 4, ty]], '#fbf8f1', '#9b9284', 1);
      }
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      for (const k of [-6, 4]) { g.beginPath(); g.moveTo(cx + k, floor - rise - 26); g.bezierCurveTo(cx + k - 5, floor - rise - 34, cx + k + 5, floor - rise - 40, cx + k, floor - rise - 48); g.stroke(); }
      break;
    }
    case 'machine-juice': {
      // A juice dispenser: white base with two clear tanks of orange and yellow juice.
      const along = 26, deep = 18, rise = Math.round(height * 0.45);
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, deep, rise, { top: '#f4f6f2', left: '#e7ebe4', right: '#c9d0c4', edge: '#5f6b5a' });
      const f = faces(back, along, deep);
      quad(g, f.front, 0.08, 0.92, 4, 10, '#5f6b5a', '#33402f', 1);
      quad(g, f.front, 0.1, 0.9, rise - 10, rise - 3, '#3f9a4a');
      for (const [t, juice] of [[0.3, '#f39a1e'], [0.72, '#f2cc3a']] as const) {
        const [x, y] = f.front(t, rise);
        const tank = height - rise - 14;
        g.fillStyle = 'rgba(220,240,250,0.55)'; g.fillRect(x - 12, y - tank - 8, 24, tank);
        g.fillStyle = juice; g.fillRect(x - 12, y - tank * 0.7 - 8, 24, tank * 0.7);
        ellipse(g, x, y - tank - 8, 12, 4, 'rgba(235,248,252,0.8)', '#8fb1c0', 1.2);
        g.strokeStyle = '#8fb1c0'; g.lineWidth = 1.5; g.strokeRect(x - 12, y - tank - 8, 24, tank);
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x - 9, y - tank - 4, 4, tank - 6);
        const [tapX, tapY] = f.front(t, rise * 0.55);
        poly(g, [[tapX - 3, tapY - 4], [tapX + 3, tapY - 4], [tapX + 3, tapY + 4], [tapX - 3, tapY + 4]], '#4f5a63');
        const [cupX, cupY] = f.front(t, 11);
        poly(g, [[cupX - 5, cupY - 10], [cupX + 5, cupY - 10], [cupX + 4, cupY], [cupX - 4, cupY]], 'rgba(220,240,250,0.7)', '#8fb1c0', 1);
        poly(g, [[cupX - 4.5, cupY - 6], [cupX + 4.5, cupY - 6], [cupX + 4, cupY], [cupX - 4, cupY]], juice);
      }
      break;
    }
    case 'jukebox': {
      // A retro jukebox: wooden cabinet, glowing arch, record window and speaker grille.
      const along = 26, deep = 16, rise = height - 34;
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, deep, rise, { top: '#a0582a', left: '#8a4a22', right: '#6a3618', edge: '#2e160a' });
      const f = faces(back, along, deep);
      // The arch rises over the front face.
      const [ax0, ay0] = f.front(0, rise), [ax1, ay1] = f.front(1, rise);
      const mx = (ax0 + ax1) / 2, my = (ay0 + ay1) / 2;
      g.save();
      g.translate(mx, my); g.transform(1, 0.5, 0, 1, 0, 0);
      const span = along;
      g.beginPath(); g.ellipse(0, 0, span, 34, 0, Math.PI, 0); g.closePath();
      g.fillStyle = '#8a4a22'; g.fill(); g.strokeStyle = '#2e160a'; g.lineWidth = 1.5; g.stroke();
      for (const [r, color] of [[30, '#ff6fb5'], [24, '#ffd166'], [18, '#6fd3ff']] as const) {
        g.beginPath(); g.ellipse(0, 0, span * r / 34, r, 0, Math.PI, 0); g.strokeStyle = color; g.lineWidth = 4; g.stroke();
      }
      g.beginPath(); g.ellipse(0, 0, span * 0.42, 12, 0, Math.PI, 0); g.closePath(); g.fillStyle = 'rgba(255,240,200,0.85)'; g.fill();
      g.restore();
      quad(g, f.front, 0.12, 0.88, rise * 0.55, rise - 4, 'rgba(255,236,190,0.9)', '#2e160a', 1.5);
      const [rx, ry] = f.front(0.5, rise * 0.75);
      ellipse(g, rx, ry, 9, 6, '#1d1d22', '#555', 1); ellipse(g, rx, ry, 3, 2, '#e8473c');
      quad(g, f.front, 0.15, 0.85, 8, rise * 0.45, '#3a2414', '#2e160a', 1.5);
      g.strokeStyle = 'rgba(210,170,110,0.6)'; g.lineWidth = 1;
      for (let k = 1; k < 6; k++) { const [x0, y0] = f.front(0.15, 8 + k * rise * 0.07), [x1, y1] = f.front(0.85, 8 + k * rise * 0.07); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      for (const t of [0.04, 0.96]) {
        const [x0, y0] = f.front(t, 4), [x1, y1] = f.front(t, rise + 4);
        g.strokeStyle = t < 0.5 ? '#ff6fb5' : '#6fd3ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      break;
    }
    case 'arcade': {
      // An arcade cabinet: marquee, glowing screen with pixel aliens, joystick and buttons.
      const along = 20, deep = 24, rise = height - 10;
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, deep, rise, { top: '#3b2a6b', left: '#2a1d52', right: '#4c35a0', edge: '#120a2a' });
      const f = faces(back, along, deep);
      // The player faces the depth side: screen, marquee and controls on the right face.
      quad(g, f.side, 0.1, 0.9, rise - 4, rise - 18, '#ffd166', '#120a2a', 1.5);
      quad(g, f.side, 0.12, 0.88, rise * 0.52, rise - 26, '#0f1a2e', '#120a2a', 2);
      const glow = (t: number, up: number, color: string) => { const [x, y] = f.side(t, up); poly(g, [[x - 2, y - 2], [x + 2, y - 4], [x + 2, y], [x - 2, y + 2]], color); };
      for (const [t, up, color] of [[0.3, rise * 0.82, '#49e3ff'], [0.5, rise * 0.86, '#ff6fb5'], [0.7, rise * 0.82, '#49e3ff'], [0.4, rise * 0.68, '#a9f27a'], [0.6, rise * 0.62, '#ffd166']] as const) glow(t, up, color);
      quad(g, f.side, 0.08, 0.92, rise * 0.4, rise * 0.48, '#6b4fd1', '#120a2a', 1.5);
      const [jx, jy] = f.side(0.32, rise * 0.48);
      g.strokeStyle = '#111'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(jx, jy); g.lineTo(jx, jy - 9); g.stroke();
      ellipse(g, jx, jy - 10, 3.5, 3.5, '#e8473c');
      for (const [t, color] of [[0.58, '#ffd166'], [0.7, '#49e3ff'], [0.82, '#ff6fb5']] as const) { const [bx, by] = f.side(t, rise * 0.47); ellipse(g, bx, by, 3, 2, color, '#111', 1); }
      g.fillStyle = '#120a2a'; g.font = 'bold 8px sans-serif';
      const [lx, ly] = f.side(0.22, rise - 9);
      g.save(); g.translate(lx, ly); g.transform(1, -0.5, 0, 1, 0, 0); g.fillText('ARCADE', 0, 0); g.restore();
      quad(g, f.front, 0.1, 0.9, 10, rise - 10, '#33246a');
      g.strokeStyle = '#ff6fb5'; g.lineWidth = 2;
      const [s0x, s0y] = f.front(0.15, rise * 0.3), [s1x, s1y] = f.front(0.85, rise * 0.7);
      g.beginPath(); g.moveTo(s0x, s0y); g.lineTo(s1x, s1y); g.stroke();
      break;
    }
    case 'spice-shelf': {
      // A standing wooden shelf: back panel, three shelves of colourful spice jars.
      const along = 28, deep = 10, rise = height - 8;
      const back = { x: cx - (along - deep), y: floor - (along + deep) / 2 };
      prism(g, back, along, 2, rise, { top: '#a0663a', left: '#7a4a24', right: '#5a3418', edge: '#2e1a0a' });
      const f = faces({ x: back.x - 4, y: back.y + 2 }, along, deep - 2);
      const jars = ['#3f9a4a', '#d2541b', '#7b4fc9', '#f2cc3a', '#c0392b', '#2f6fd0'];
      [0.08, 0.38, 0.68].forEach((level, row) => {
        const up = rise * level;
        prism(g, { x: back.x - 4, y: back.y + 2 - up }, along, deep - 2, 4, { top: '#c98a4b', left: '#9b6232', right: '#7a4a24', edge: '#2e1a0a' });
        for (let k = 0; k < 4; k++) {
          const [x, y] = f.front(0.16 + k * 0.22, up + 6);
          const color = jars[(row * 2 + k) % jars.length]!;
          g.fillStyle = color; g.fillRect(x - 4, y - 14, 8, 12);
          g.strokeStyle = '#2e1a0a'; g.lineWidth = 1; g.strokeRect(x - 4, y - 14, 8, 12);
          g.fillStyle = '#b7863b'; g.fillRect(x - 4, y - 17, 8, 3);
          g.fillStyle = '#fff8ea'; g.fillRect(x - 2.5, y - 10, 5, 3);
        }
      });
      for (const t of [0, 1]) quad(g, f.front, t === 0 ? 0 : 0.97, t === 0 ? 0.03 : 1, 0, rise, '#8a5428', '#2e1a0a', 1);
      break;
    }
  }
}

function texture(element: HTMLCanvasElement): Texture {
  const result = Texture.from(element);
  result.source.scaleMode = 'linear';
  return result;
}

/**
 * Canvas art for catalogue items registered without PNG parts (`placeholder: true`):
 * `style` is the manifest's `art` (or the kind, for older placeholders). It
 * returns the frames the Asset Studio exports, one per rotation (two for wall
 * pictures, like basic_window), so placement, depth and the store treat them
 * like real art until a PNG replaces them.
 */
export function placeholderItemArt(style: string, itemHeight: number, file: string): Array<{ frame: IndoorArtFrame; texture: Texture }> {
  if (WALL_ART.has(style)) {
    const flat = canvas(60, 64);
    if (!flat) return [];
    drawWallPicture(flat.g, style);
    // Same geometry as basic_window: rotation 0 hangs on the x = 0 wall (rising to
    // the right on screen), rotation 1 on the y = 0 wall.
    return [0, 1].flatMap((rotation) => {
      const target = canvas(WALL_FRAME.width, WALL_FRAME.height);
      if (!target) return [];
      if (rotation === 0) target.g.setTransform(1, -0.5, 0, 1, 82, 54);
      else target.g.setTransform(1, 0.5, 0, 1, 4, 22);
      target.g.drawImage(flat.element, 0, 0);
      return [{ frame: { ...WALL_FRAME, file: `${file}:${rotation}` }, texture: texture(target.element) }];
    });
  }
  const height = Math.max(8, Math.round(itemHeight));
  const target = canvas(TILE_W, TILE_H + height);
  if (!target) return [];
  if (BOXES[style]) drawBox(target.g, style, height);
  else if (style === 'table-wood') drawTable(target.g, height);
  else if (TABLES.has(style)) drawStyledTable(target.g, style, height);
  else if (ORNAMENTS.has(style)) drawOrnament(target.g, style, height);
  else if (MACHINES.has(style)) drawMachine(target.g, style, TILE_W / 2, height + TILE_H / 2, height);
  else return [];
  return [{ frame: { file, left: -TILE_W / 2, top: -height, width: TILE_W, height: TILE_H + height }, texture: texture(target.element) }];
}
