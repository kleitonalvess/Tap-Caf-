import { Texture } from 'pixi.js';

import type { IndoorArtFrame } from './indoor-art';

/** Native tile at ROOM_ASSET_SCALE 2: a 160×80 diamond whose top corner is the tile origin. */
const TILE_W = 160;
const TILE_H = 80;
const INSET = 0.9;

interface Palette { top: string; edge: string; left: string; right: string; trim: string }

const PALETTES: Readonly<Record<string, Palette>> = {
  counter: { top: '#f3ead8', edge: '#c8b89a', left: '#a0703f', right: '#7c5331', trim: '#5e3c22' },
};

/**
 * Canvas art for catalogue items registered without PNG parts (`placeholder: true`).
 * It returns the same frame shape the Asset Studio exports, so placement,
 * depth and the store treat it like real art until the PNG replaces it.
 */
export function placeholderItemArt(kind: string, itemHeight: number, file: string): { frame: IndoorArtFrame; texture: Texture } | null {
  const palette = PALETTES[kind];
  if (!palette) return null;
  const height = Math.max(8, Math.round(itemHeight));
  const element = document.createElement('canvas');
  element.width = TILE_W;
  element.height = TILE_H + height;
  const g = element.getContext('2d');
  if (!g) return null;
  const w = (TILE_W / 2) * INSET;
  const h = (TILE_H / 2) * INSET;
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;
  const poly = (points: number[][], fill: string, stroke?: string) => {
    g.beginPath();
    g.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) g.lineTo(x, y);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); }
  };
  // Sides first, then the worktop over them.
  poly([[cx - w, cy], [cx, cy + h], [cx, cy + h + height], [cx - w, cy + height]], palette.left);
  poly([[cx, cy + h], [cx + w, cy], [cx + w, cy + height], [cx, cy + h + height]], palette.right);
  g.strokeStyle = palette.trim;
  g.lineWidth = 2;
  for (const [x0, x1] of [[cx - w + 10, cx - 10], [cx + 10, cx + w - 10]]) {
    // Recessed front panels, following each face's slope.
    const slope = x0 < cx ? 0.5 : -0.5;
    const yAt = (x: number) => (x < cx ? cy + (x - (cx - w)) * 0.5 : cy + h - (x - cx) * 0.5);
    g.beginPath();
    g.moveTo(x0, yAt(x0) + 14);
    g.lineTo(x1, yAt(x0) + 14 + (x1 - x0) * slope);
    g.lineTo(x1, yAt(x0) + height - 8 + (x1 - x0) * slope);
    g.lineTo(x0, yAt(x0) + height - 8);
    g.closePath();
    g.stroke();
  }
  poly([[cx - w, cy], [cx, cy - h], [cx + w, cy], [cx, cy + h]], palette.top, palette.edge);
  const texture = Texture.from(element);
  texture.source.scaleMode = 'linear';
  return { frame: { file, left: -TILE_W / 2, top: -height, width: TILE_W, height: TILE_H + height }, texture };
}
