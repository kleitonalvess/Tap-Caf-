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
};

/** Wall decoration: a flat picture sheared onto either wall, framed like basic_window. */
const WALL_ART = new Set(['painting-landscape', 'wall-clock', 'painting-coffee']);
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
  box(g, cx, top, w, h, height, p);
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
  }
}

/** Wall pictures drawn flat (art space 60 × 64). */
function drawWallPicture(g: Ctx, style: string): void {
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
  else if (['vase-flowers', 'fern', 'floor-lamp', 'statue', 'fountain'].includes(style)) drawOrnament(target.g, style, height);
  else return [];
  return [{ frame: { file, left: -TILE_W / 2, top: -height, width: TILE_W, height: TILE_H + height }, texture: texture(target.element) }];
}
