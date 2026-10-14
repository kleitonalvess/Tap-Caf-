import { Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import type { StreetBuildingDef } from '../../world/street-scenery';

/**
 * Canvas art for the street buildings, drawn in the room projection (tiles of
 * 160×80, 2:1). Coordinates are local to the footprint: u runs along tx, v
 * along ty, z is the height in world pixels. The visible faces are the
 * front-left one (v = max) and the front-right one (u = max).
 */
export interface ArtFrame {
  /** Canvas offset from the top vertex of tile (tx, ty), like item parts. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StreetArt {
  frame: ArtFrame;
  base: Texture;
  /** Neon and lamps drawn alone, pulsed with additive blending. */
  glow?: Texture;
  /** Animated props placed by StreetScenery, in local world pixels. */
  props: StreetProp[];
}

export type StreetProp =
  | { kind: 'beam'; x: number; y: number; color: number; phase: number }
  | { kind: 'sparkle'; x: number; y: number; phase: number }
  | { kind: 'wheel'; x: number; y: number; radius: number };

const MARGIN = 28;
const HALF_W = 80;
const HALF_H = 40;

type Ctx = CanvasRenderingContext2D;
interface P { x: number; y: number }

function surface(width: number, height: number): [HTMLCanvasElement, Ctx] {
  const element = document.createElement('canvas');
  element.width = Math.ceil(width);
  element.height = Math.ceil(height);
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível.');
  return [element, context];
}

export function artFrame(def: StreetBuildingDef): ArtFrame {
  return {
    left: -def.sizeY * HALF_W - MARGIN,
    top: -def.height - MARGIN,
    width: (def.sizeX + def.sizeY) * HALF_W + 2 * MARGIN,
    height: (def.sizeX + def.sizeY) * HALF_H + def.height + 2 * MARGIN,
  };
}

/** Local world point (relative to the footprint's back vertex). */
export function localPoint(u: number, v: number, z = 0): P {
  return { x: (u - v) * HALF_W, y: (u + v) * HALF_H - z };
}

class Painter {
  constructor(readonly g: Ctx, readonly frame: ArtFrame) {}

  pt(u: number, v: number, z = 0): P {
    const p = localPoint(u, v, z);
    return { x: p.x - this.frame.left, y: p.y - this.frame.top };
  }

  poly(points: P[], fill: string | CanvasGradient, stroke?: string, width = 2): void {
    const g = this.g;
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.stroke();
    }
  }

  line(a: P, b: P, color: string, width = 2): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.stroke();
  }

  ground(u0: number, v0: number, u1: number, v1: number, fill: string, stroke?: string): void {
    this.poly([this.pt(u0, v0), this.pt(u1, v0), this.pt(u1, v1), this.pt(u0, v1)], fill, stroke);
  }

  /** A prism with its two visible faces and its top. */
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    colors: { left: string | CanvasGradient; right: string | CanvasGradient; top: string }, outline = 'rgba(30,18,40,0.55)'): void {
    this.poly([this.pt(u0, v1, z0), this.pt(u1, v1, z0), this.pt(u1, v1, z1), this.pt(u0, v1, z1)], colors.left, outline);
    this.poly([this.pt(u1, v1, z0), this.pt(u1, v0, z0), this.pt(u1, v0, z1), this.pt(u1, v1, z1)], colors.right, outline);
    this.poly([this.pt(u0, v0, z1), this.pt(u1, v0, z1), this.pt(u1, v1, z1), this.pt(u0, v1, z1)], colors.top, outline);
  }

  /** Draw on the front-left face plane (v fixed): x = u × 80, y = −z. */
  onLeftFace(v: number, draw: (g: Ctx) => void): void {
    const g = this.g;
    g.save();
    g.setTransform(1, 0.5, 0, 1, -v * HALF_W - this.frame.left, v * HALF_H - this.frame.top);
    draw(g);
    g.restore();
  }

  /** Draw on the front-right face plane (u fixed): x = −v × 80, y = −z. */
  onRightFace(u: number, draw: (g: Ctx) => void): void {
    const g = this.g;
    g.save();
    g.setTransform(1, -0.5, 0, 1, u * HALF_W - this.frame.left, u * HALF_H - this.frame.top);
    draw(g);
    g.restore();
  }

  verticalGradient(zBottom: number, zTop: number, u: number, v: number, stops: [number, string][]): CanvasGradient {
    const a = this.pt(u, v, zBottom);
    const b = this.pt(u, v, zTop);
    const gradient = this.g.createLinearGradient(a.x, a.y, b.x, b.y);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }
}

function font(size: number, weight = '700'): string {
  return `${weight} ${size}px ${FONT_FAMILY}, "Arial Rounded MT Bold", sans-serif`;
}

/** Neon tube text: dark tube, coloured core and a soft halo. */
function neonText(g: Ctx, text: string, x: number, y: number, size: number, color: string, halo: number): void {
  g.font = font(size);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.shadowColor = color;
  g.shadowBlur = halo;
  g.lineWidth = Math.max(3, size * 0.12);
  g.strokeStyle = color;
  g.strokeText(text, x, y);
  g.shadowBlur = halo / 2;
  g.fillStyle = '#fff4fd';
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}

// ---------------------------------------------------------------- Disco

const DISCO = { u0: 0.35, v0: 0.3, u1: 3.65, v1: 2.7, wall: 290 };

function paintDiscoNeon(p: Painter, halo: number): void {
  const { u0, u1, v0, v1 } = DISCO;
  p.onLeftFace(v1, (g) => {
    neonText(g, 'DISCO', ((u0 + u1) / 2) * HALF_W, -146, 50, '#ff3fd2', halo);
    g.shadowColor = '#46f3ff';
    g.shadowBlur = halo;
    g.strokeStyle = '#46f3ff';
    g.lineWidth = 4;
    g.strokeRect(u0 * HALF_W + 14, -272, (u1 - u0) * HALF_W - 28, 84);
    g.shadowBlur = 0;
  });
  p.onRightFace(u1, (g) => {
    const colors = ['#46f3ff', '#ff3fd2', '#ffe14a'];
    [v0 + 0.45, (v0 + v1) / 2, v1 - 0.45].forEach((v, i) => {
      g.shadowColor = colors[i];
      g.shadowBlur = halo;
      g.strokeStyle = colors[i];
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(-v * HALF_W, -26);
      g.lineTo(-v * HALF_W, -262);
      g.stroke();
    });
    // A neon note between the tubes.
    g.shadowColor = '#ffe14a';
    g.shadowBlur = halo;
    g.fillStyle = '#fff6c2';
    g.font = font(54);
    g.textAlign = 'center';
    g.fillText('♪', -((v0 + v1) / 2 - 0.42) * HALF_W, -150);
    g.shadowBlur = 0;
  });
  // Marquee bulbs.
  for (let i = 0; i <= 8; i++) {
    const u = 1.25 + (1.5 * i) / 8;
    const b = p.pt(u, v1 + 0.45, 128);
    p.g.shadowColor = '#ffd75a';
    p.g.shadowBlur = halo / 2;
    p.g.fillStyle = '#fff3b0';
    p.g.beginPath();
    p.g.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
    p.g.fill();
  }
  p.g.shadowBlur = 0;
}

function paintDisco(p: Painter): void {
  const { u0, v0, u1, v1, wall } = DISCO;
  const g = p.g;
  // Paved plaza with a kerb.
  p.ground(0, 0, 4, 4, '#4b4563', 'rgba(20,14,30,0.6)');
  for (let i = 1; i < 8; i++) {
    p.line(p.pt(i / 2, 0), p.pt(i / 2, 4), 'rgba(255,255,255,0.06)', 1.5);
    p.line(p.pt(0, i / 2), p.pt(4, i / 2), 'rgba(255,255,255,0.06)', 1.5);
  }
  p.poly([p.pt(0, 3.88), p.pt(4, 3.88), p.pt(4, 4), p.pt(0, 4)], '#8d87a3');
  p.poly([p.pt(3.88, 0), p.pt(4, 0), p.pt(4, 4), p.pt(3.88, 4)], '#7b7592');

  // Building.
  const left = p.verticalGradient(0, wall, u0, v1, [[0, '#24183d'], [1, '#3e2a6a']]);
  const right = p.verticalGradient(0, wall, u1, v1, [[0, '#1a1130'], [1, '#2d1f50']]);
  p.box(u0, v0, u1, v1, 0, wall, { left, right, top: '#3b2d5c' });
  // Parapet.
  p.box(u0, v0, u1, v0 + 0.12, wall, wall + 16, { left: '#4a3a70', right: '#33264f', top: '#5b4a85' });
  p.box(u0, v0, u0 + 0.12, v1, wall, wall + 16, { left: '#4a3a70', right: '#33264f', top: '#5b4a85' });
  p.box(u0, v1 - 0.12, u1, v1, wall, wall + 16, { left: '#4a3a70', right: '#33264f', top: '#5b4a85' });
  p.box(u1 - 0.12, v0, u1, v1, wall, wall + 16, { left: '#4a3a70', right: '#33264f', top: '#5b4a85' });

  // Upper windows: stained party glass behind the neon frame.
  p.onLeftFace(v1, (face) => {
    const colors = ['#7a3cff', '#ff4fb5', '#3fd0ff', '#ffcf3f'];
    const width = ((u1 - u0) * HALF_W - 48) / 4;
    for (let i = 0; i < 4; i++) {
      const x = u0 * HALF_W + 24 + i * width;
      const glass = face.createLinearGradient(0, -262, 0, -192);
      glass.addColorStop(0, colors[i]);
      glass.addColorStop(1, '#1d1233');
      face.fillStyle = glass;
      face.fillRect(x + 4, -262, width - 8, 70);
      face.strokeStyle = 'rgba(10,6,20,0.8)';
      face.lineWidth = 3;
      face.strokeRect(x + 4, -262, width - 8, 70);
    }
    // Door: dark glass in a chrome frame.
    const doorX = 1.5 * HALF_W;
    const doorW = 1.0 * HALF_W;
    face.fillStyle = '#c9c6d8';
    face.fillRect(doorX - 6, -120, doorW + 12, 120);
    const glass = face.createLinearGradient(0, -114, 0, 0);
    glass.addColorStop(0, '#2d2147');
    glass.addColorStop(1, '#0c0716');
    face.fillStyle = glass;
    face.fillRect(doorX, -114, doorW, 114);
    face.fillStyle = '#c9c6d8';
    face.fillRect(doorX + doorW / 2 - 2, -114, 4, 114);
    face.fillStyle = '#ffd75a';
    face.fillRect(doorX + doorW / 2 - 12, -60, 6, 18);
    face.fillRect(doorX + doorW / 2 + 6, -60, 6, 18);
  });
  // Right face: porthole windows between the tubes.
  p.onRightFace(u1, (face) => {
    for (const [v, z] of [[v0 + 0.85, 205], [v1 - 0.85, 205], [v0 + 0.85, 95], [v1 - 0.85, 95]]) {
      face.fillStyle = '#100a1c';
      face.beginPath();
      face.arc(-v * HALF_W, -z, 20, 0, Math.PI * 2);
      face.fill();
      face.strokeStyle = '#8f88a8';
      face.lineWidth = 4;
      face.stroke();
      face.fillStyle = 'rgba(160,110,255,0.55)';
      face.beginPath();
      face.arc(-v * HALF_W, -z, 14, 0, Math.PI * 2);
      face.fill();
    }
  });

  // Red carpet and velvet ropes.
  p.poly([p.pt(1.62, v1), p.pt(2.38, v1), p.pt(2.38, 4), p.pt(1.62, 4)], '#c4163a', '#f2c14e', 2.5);
  for (const u of [1.42, 2.58]) {
    const posts = [v1 + 0.35, 3.75].map((v) => p.pt(u, v));
    for (const post of posts) {
      g.fillStyle = '#d9d6e6';
      g.fillRect(post.x - 2.5, post.y - 34, 5, 34);
      g.beginPath();
      g.arc(post.x, post.y - 36, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#a3122f';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(posts[0].x, posts[0].y - 30);
    g.quadraticCurveTo((posts[0].x + posts[1].x) / 2, (posts[0].y + posts[1].y) / 2 - 12, posts[1].x, posts[1].y - 30);
    g.stroke();
  }

  // Marquee over the door.
  p.box(1.2, v1, 2.8, v1 + 0.45, 120, 136, { left: '#d9a441', right: '#b07f2a', top: '#efe5ff' });

  // "Em breve" easel by the door.
  const easel = p.pt(3.15, 3.35);
  g.fillStyle = '#5a3d1e';
  g.fillRect(easel.x - 20, easel.y - 6, 4, 8);
  g.fillRect(easel.x + 16, easel.y - 6, 4, 8);
  p.onLeftFace(3.35, (face) => {
    face.fillStyle = '#ffe14a';
    face.strokeStyle = '#1b1426';
    face.lineWidth = 3;
    face.fillRect(3.15 * HALF_W - 34, -60, 68, 52);
    face.strokeRect(3.15 * HALF_W - 34, -60, 68, 52);
    face.fillStyle = '#1b1426';
    face.font = font(15);
    face.textAlign = 'center';
    face.fillText('EM', 3.15 * HALF_W, -38);
    face.fillText('BREVE', 3.15 * HALF_W, -19);
  });

  // Rooftop: spotlights and the mirror ball.
  for (const [u, v] of [[u0 + 0.45, v1 - 0.45], [u1 - 0.45, v0 + 0.45]]) {
    p.box(u - 0.12, v - 0.12, u + 0.12, v + 0.12, wall, wall + 22, { left: '#2a2a33', right: '#1c1c22', top: '#55556a' });
  }
  const pole = p.pt((u0 + u1) / 2, (v0 + v1) / 2, wall);
  g.fillStyle = '#9a96ad';
  g.fillRect(pole.x - 3, pole.y - 70, 6, 70);
  const ball = { x: pole.x, y: pole.y - 104, r: 36 };
  const shine = g.createRadialGradient(ball.x - 12, ball.y - 14, 4, ball.x, ball.y, ball.r);
  shine.addColorStop(0, '#ffffff');
  shine.addColorStop(0.35, '#d8dbe8');
  shine.addColorStop(1, '#6f7390');
  g.fillStyle = shine;
  g.beginPath();
  g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = 'rgba(60,62,90,0.55)';
  g.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.ellipse(ball.x, ball.y, Math.abs(Math.cos((i * Math.PI) / 8)) * ball.r, ball.r, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(ball.x - ball.r, ball.y + (i * ball.r) / 3.5);
    g.lineTo(ball.x + ball.r, ball.y + (i * ball.r) / 3.5);
    g.stroke();
  }
  const tiles = ['#ff7ad9', '#7ae8ff', '#fff27a', '#b58cff'];
  for (let i = 0; i < 14; i++) {
    g.fillStyle = tiles[i % tiles.length];
    const angle = i * 2.4;
    g.fillRect(ball.x + Math.cos(angle) * ball.r * 0.6 - 3, ball.y + Math.sin(angle) * ball.r * 0.6 - 3, 6, 6);
  }
  g.restore();
  g.strokeStyle = '#3a3c55';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  g.stroke();

  // Lit tubes in their resting state; the glow layer pulses over them.
  paintDiscoNeon(p, 10);
}

function discoProps(): StreetProp[] {
  const { u0, v0, u1, v1, wall } = DISCO;
  const a = localPoint(u0 + 0.45, v1 - 0.45, wall + 22);
  const b = localPoint(u1 - 0.45, v0 + 0.45, wall + 22);
  const ball = localPoint((u0 + u1) / 2, (v0 + v1) / 2, wall + 104);
  return [
    { kind: 'beam', x: a.x, y: a.y, color: 0xff4fd8, phase: 0 },
    { kind: 'beam', x: b.x, y: b.y, color: 0x46f3ff, phase: Math.PI },
    { kind: 'sparkle', x: ball.x - 26, y: ball.y - 20, phase: 0 },
    { kind: 'sparkle', x: ball.x + 30, y: ball.y + 6, phase: 1.7 },
    { kind: 'sparkle', x: ball.x - 8, y: ball.y + 30, phase: 3.1 },
  ];
}

// ---------------------------------------------------------------- Farm

const BARN = { u0: 0.3, v0: 0.3, u1: 2.6, v1: 2.25, wall: 138, knee: 212, ridge: 252 };

function paintFarm(p: Painter): void {
  const g = p.g;
  const { u0, v0, u1, v1, wall, knee, ridge } = BARN;
  const mid = (v0 + v1) / 2;
  const kneeV = 0.45;

  // Field and yard.
  p.ground(0, 0, 4, 3, '#8fbc45', 'rgba(60,90,20,0.35)');
  p.poly([p.pt(2.7, 0.75), p.pt(4, 0.75), p.pt(4, 2.35), p.pt(2.7, 2.35)], '#caa46b');
  // Water windmill (cata-vento) behind the barn; its wheel is a prop.
  const towerBase = p.pt(0.45, 0.2);
  g.strokeStyle = '#7d5a35';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(towerBase.x - 22, towerBase.y);
  g.lineTo(towerBase.x - 3, towerBase.y - 300);
  g.moveTo(towerBase.x + 22, towerBase.y);
  g.lineTo(towerBase.x + 3, towerBase.y - 300);
  for (let z = 30; z < 300; z += 45) {
    const spread = 22 * (1 - z / 300) + 3;
    const next = 22 * (1 - (z + 45) / 300) + 3;
    g.moveTo(towerBase.x - spread, towerBase.y - z);
    g.lineTo(towerBase.x + next, towerBase.y - z - 45);
    g.moveTo(towerBase.x + spread, towerBase.y - z);
    g.lineTo(towerBase.x - next, towerBase.y - z - 45);
  }
  g.stroke();
  g.fillStyle = '#c0392b';
  g.beginPath();
  g.moveTo(towerBase.x + 4, towerBase.y - 306);
  g.lineTo(towerBase.x + 46, towerBase.y - 318);
  g.lineTo(towerBase.x + 46, towerBase.y - 296);
  g.closePath();
  g.fill();

  // Barn walls: boards on the long side, gambrel gable facing the main street.
  const red = p.verticalGradient(0, wall, u0, v1, [[0, '#a8291f'], [1, '#c63a2c']]);
  p.poly([p.pt(u0, v1, 0), p.pt(u1, v1, 0), p.pt(u1, v1, wall), p.pt(u0, v1, wall)], red, '#5a1610');
  p.onLeftFace(v1, (face) => {
    face.strokeStyle = 'rgba(80,16,10,0.45)';
    face.lineWidth = 2;
    for (let x = u0 * HALF_W + 12; x < u1 * HALF_W; x += 12) {
      face.beginPath();
      face.moveTo(x, 0);
      face.lineTo(x, -wall);
      face.stroke();
    }
    // Side window with white cross.
    const x = ((u0 + u1) / 2) * HALF_W;
    face.fillStyle = '#f4efe4';
    face.fillRect(x - 26, -104, 52, 46);
    face.fillStyle = '#4a2a1a';
    face.fillRect(x - 20, -98, 40, 34);
    face.strokeStyle = '#f4efe4';
    face.lineWidth = 4;
    face.beginPath();
    face.moveTo(x - 20, -98);
    face.lineTo(x + 20, -64);
    face.moveTo(x + 20, -98);
    face.lineTo(x - 20, -64);
    face.stroke();
  });
  const gable = [
    p.pt(u1, v1, 0), p.pt(u1, v0, 0), p.pt(u1, v0, wall), p.pt(u1, v0 + kneeV, knee),
    p.pt(u1, mid, ridge), p.pt(u1, v1 - kneeV, knee), p.pt(u1, v1, wall),
  ];
  p.poly(gable, p.verticalGradient(0, ridge, u1, mid, [[0, '#93241b'], [1, '#b13427']]), '#5a1610');
  p.onRightFace(u1, (face) => {
    face.strokeStyle = 'rgba(70,14,8,0.4)';
    face.lineWidth = 2;
    for (let v = v0 + 0.15; v < v1; v += 0.15) {
      face.beginPath();
      face.moveTo(-v * HALF_W, 0);
      face.lineTo(-v * HALF_W, -wall);
      face.stroke();
    }
    // Double door with white braces.
    const x0 = -(mid + 0.5) * HALF_W;
    const width = 1.0 * HALF_W;
    face.fillStyle = '#f4efe4';
    face.fillRect(x0 - 6, -112, width + 12, 112);
    face.fillStyle = '#9e2a20';
    face.fillRect(x0, -106, width, 106);
    face.strokeStyle = '#f4efe4';
    face.lineWidth = 5;
    face.strokeRect(x0, -106, width / 2, 106);
    face.strokeRect(x0 + width / 2, -106, width / 2, 106);
    face.beginPath();
    face.moveTo(x0, -106);
    face.lineTo(x0 + width / 2, 0);
    face.moveTo(x0 + width / 2, -106);
    face.lineTo(x0, 0);
    face.moveTo(x0 + width / 2, -106);
    face.lineTo(x0 + width, 0);
    face.moveTo(x0 + width, -106);
    face.lineTo(x0 + width / 2, 0);
    face.stroke();
    // Hayloft.
    const hx = -(mid + 0.22) * HALF_W;
    face.fillStyle = '#f4efe4';
    face.fillRect(hx - 4, -204, 0.44 * HALF_W + 8, 54);
    face.fillStyle = '#3c2214';
    face.fillRect(hx, -200, 0.44 * HALF_W, 46);
    face.strokeStyle = '#f2cf5b';
    face.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      face.beginPath();
      face.moveTo(hx + 4 + i * 4.5, -154);
      face.lineTo(hx + 2 + i * 5, -170 - (i % 3) * 5);
      face.stroke();
    }
    // Sign board over the door.
    face.fillStyle = '#7a4e26';
    face.fillRect(-(mid + 0.62) * HALF_W, -138, 1.24 * HALF_W, 24);
    face.fillStyle = '#ffeaa8';
    face.font = font(17);
    face.textAlign = 'center';
    face.fillText('EMPÓRIO RURAL', -mid * HALF_W, -120);
  });

  // Gambrel roof: the two slopes facing the café, with an overhang.
  const shingles = (a: P[], color: string): void => {
    p.poly(a, color, '#3a1d12');
  };
  shingles([p.pt(u0 - 0.1, v1 + 0.08, wall - 4), p.pt(u1 + 0.1, v1 + 0.08, wall - 4),
    p.pt(u1 + 0.1, v1 - kneeV, knee), p.pt(u0 - 0.1, v1 - kneeV, knee)], '#6b3b28');
  shingles([p.pt(u0 - 0.1, v1 - kneeV, knee), p.pt(u1 + 0.1, v1 - kneeV, knee),
    p.pt(u1 + 0.1, mid, ridge), p.pt(u0 - 0.1, mid, ridge)], '#7d4730');
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const lower = (a: number, b: number) => a + (b - a) * t;
    p.line(p.pt(u0 - 0.1, lower(v1 + 0.08, v1 - kneeV), lower(wall - 4, knee)),
      p.pt(u1 + 0.1, lower(v1 + 0.08, v1 - kneeV), lower(wall - 4, knee)), 'rgba(40,18,10,0.35)', 1.5);
    p.line(p.pt(u0 - 0.1, lower(v1 - kneeV, mid), lower(knee, ridge)),
      p.pt(u1 + 0.1, lower(v1 - kneeV, mid), lower(knee, ridge)), 'rgba(40,18,10,0.35)', 1.5);
  }
  // White trim along the gable edge.
  const trim = [p.pt(u1 + 0.1, v0 - 0.08, wall - 4), p.pt(u1 + 0.1, v0 + kneeV, knee), p.pt(u1 + 0.1, mid, ridge),
    p.pt(u1 + 0.1, v1 - kneeV, knee), p.pt(u1 + 0.1, v1 + 0.08, wall - 4)];
  g.strokeStyle = '#f4efe4';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.beginPath();
  trim.forEach((point, i) => (i === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
  g.stroke();
  // Rooster weathervane on the ridge.
  const vane = p.pt(u1 - 0.2, mid, ridge);
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(vane.x, vane.y);
  g.lineTo(vane.x, vane.y - 34);
  g.stroke();
  g.fillStyle = '#2b2b2b';
  g.beginPath();
  g.moveTo(vane.x - 12, vane.y - 34);
  g.quadraticCurveTo(vane.x - 4, vane.y - 52, vane.x + 6, vane.y - 44);
  g.lineTo(vane.x + 14, vane.y - 40);
  g.lineTo(vane.x + 2, vane.y - 34);
  g.closePath();
  g.fill();

  // Crop rows in front of the barn, towards the café (drawn over its wall).
  for (let row = 0; row < 3; row++) {
    const v = 2.42 + row * 0.18;
    p.poly([p.pt(0.2, v), p.pt(2.6, v), p.pt(2.6, v + 0.12), p.pt(0.2, v + 0.12)], '#7a5230');
    for (let i = 0; i < 9; i++) {
      const c = p.pt(0.32 + i * 0.27, v + 0.06);
      g.fillStyle = row === 1 ? '#e8742a' : '#3f9a2f';
      g.beginPath();
      g.ellipse(c.x, c.y - 5, row === 1 ? 4 : 6, row === 1 ? 4 : 7, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#2f7a24';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(c.x, c.y - 6);
      g.lineTo(c.x - 4, c.y - 15);
      g.moveTo(c.x, c.y - 6);
      g.lineTo(c.x + 4, c.y - 14);
      g.stroke();
    }
  }

  // Grain silo beside the barn.
  const silo = { u: 3.3, v: 0.42, r: 0.3, h: 196 };
  const base = p.pt(silo.u, silo.v);
  const rx = silo.r * HALF_W * Math.SQRT2;
  const ry = rx / 2;
  const body = g.createLinearGradient(base.x - rx, 0, base.x + rx, 0);
  body.addColorStop(0, '#e6e8ec');
  body.addColorStop(0.6, '#b8bdc6');
  body.addColorStop(1, '#8c929d');
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(base.x, base.y, rx, ry, 0, 0, Math.PI);
  g.lineTo(base.x - rx, base.y - silo.h);
  g.ellipse(base.x, base.y - silo.h, rx, ry, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(60,64,72,0.6)';
  g.lineWidth = 2;
  g.stroke();
  for (let z = 32; z < silo.h; z += 32) {
    g.beginPath();
    g.ellipse(base.x, base.y - z, rx, ry, 0, 0, Math.PI);
    g.stroke();
  }
  const dome = g.createRadialGradient(base.x - rx / 3, base.y - silo.h - 26, 4, base.x, base.y - silo.h, rx * 1.1);
  dome.addColorStop(0, '#d7dce3');
  dome.addColorStop(1, '#7c8590');
  g.fillStyle = dome;
  g.beginPath();
  g.ellipse(base.x, base.y - silo.h, rx, ry, 0, 0, Math.PI);
  g.quadraticCurveTo(base.x - rx, base.y - silo.h - 40, base.x, base.y - silo.h - 44);
  g.quadraticCurveTo(base.x + rx, base.y - silo.h - 40, base.x + rx, base.y - silo.h);
  g.fill();
  g.stroke();

  // Hay bales in the yard.
  for (const [u, v] of [[3.2, 1.75], [3.45, 2.0], [3.05, 2.05]]) {
    p.box(u - 0.16, v - 0.16, u + 0.16, v + 0.16, 0, 24, { left: '#e2b84f', right: '#c99a35', top: '#f2d47a' }, '#8a6a1e');
  }

  // Wooden fence on the two street sides, with a gate gap to the yard.
  const fenceRun = (from: [number, number], to: [number, number]): void => {
    const steps = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.3));
    for (let i = 0; i <= steps; i++) {
      const u = from[0] + ((to[0] - from[0]) * i) / steps;
      const v = from[1] + ((to[1] - from[1]) * i) / steps;
      const post = p.pt(u, v);
      g.fillStyle = '#7a4e26';
      g.fillRect(post.x - 3, post.y - 34, 6, 34);
    }
    for (const z of [12, 26]) p.line(p.pt(from[0], from[1], z), p.pt(to[0], to[1], z), '#a0703c', 4);
  };
  fenceRun([0.1, 2.97], [3.9, 2.97]);
  fenceRun([3.95, 0.1], [3.95, 0.8]);
  fenceRun([3.95, 2.3], [3.95, 2.95]);
}

function farmProps(): StreetProp[] {
  const hub = localPoint(0.45, 0.2, 306);
  return [{ kind: 'wheel', x: hub.x, y: hub.y, radius: 36 }];
}

// ---------------------------------------------------------------- Shared textures

/** Light cone for the disco spotlights, apex at the bottom centre. */
export function beamTexture(): Texture {
  const [element, g] = surface(140, 520);
  const gradient = g.createLinearGradient(0, 520, 0, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.beginPath();
  g.moveTo(64, 520);
  g.lineTo(0, 0);
  g.lineTo(140, 0);
  g.lineTo(76, 520);
  g.closePath();
  g.fill();
  return Texture.from(element);
}

export function sparkleTexture(): Texture {
  const [element, g] = surface(32, 32);
  g.fillStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 6;
  g.beginPath();
  g.moveTo(16, 0);
  g.quadraticCurveTo(18, 14, 32, 16);
  g.quadraticCurveTo(18, 18, 16, 32);
  g.quadraticCurveTo(14, 18, 0, 16);
  g.quadraticCurveTo(14, 14, 16, 0);
  g.fill();
  return Texture.from(element);
}

/** Multi-blade wheel of the farm windmill, seen face on (StreetScenery squashes it). */
export function wheelTexture(radius: number): Texture {
  const size = radius * 2 + 8;
  const [element, g] = surface(size, size);
  const c = size / 2;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    g.save();
    g.translate(c, c);
    g.rotate(angle);
    g.fillStyle = i % 2 ? '#d7d2c4' : '#f1ede2';
    g.strokeStyle = '#6c665a';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(radius * 0.22, -3);
    g.lineTo(radius, -7);
    g.lineTo(radius, 7);
    g.lineTo(radius * 0.22, 3);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.strokeStyle = '#6c665a';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c, c, radius * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#4b463d';
  g.beginPath();
  g.arc(c, c, radius * 0.18, 0, Math.PI * 2);
  g.fill();
  return Texture.from(element);
}

/** Procedural art for a known building id; unknown ids get a plain block. */
export function paintStreetBuilding(def: StreetBuildingDef): StreetArt {
  const frame = artFrame(def);
  const [baseCanvas, baseContext] = surface(frame.width, frame.height);
  const painter = new Painter(baseContext, frame);
  let glow: Texture | undefined;
  let props: StreetProp[] = [];
  if (def.id === 'disco') {
    paintDisco(painter);
    const [glowCanvas, glowContext] = surface(frame.width, frame.height);
    paintDiscoNeon(new Painter(glowContext, frame), 26);
    glow = Texture.from(glowCanvas);
    props = discoProps();
  } else if (def.id === 'farm') {
    paintFarm(painter);
    props = farmProps();
  } else {
    painter.box(0.2, 0.2, def.sizeX - 0.2, def.sizeY - 0.2, 0, def.height * 0.6,
      { left: '#c9b8a0', right: '#a99880', top: '#e2d6c4' });
  }
  return { frame, base: Texture.from(baseCanvas), glow, props };
}
