import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { neighborPage, type Neighbor } from '../../game/neighbors';
import { TOP_BAR_ICON_FRAMES } from './TopBars';

/** The eight squares of the friends bar, in the bar image's coordinates. */
const SLOT_CENTERS = [385, 516, 648, 779, 910, 1041, 1172, 1303] as const;
const SLOT_TOP = 782;
const INK = 0x704721;

const THEME_HATS: Record<string, number> = { japan: 0xd23b2a, italy: 0x2f9e44, noble: 0x6a3fa0 };

/** A neighbour's portrait: face, hair and a hat in the café's theme colour. */
function drawPortrait(g: Graphics, neighbor: Neighbor): void {
  let hash = 0;
  for (const char of neighbor.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const skins = [0xf6d2b0, 0xe8b48c, 0xc98a5c, 0x8d5a3b];
  const hairs = [0x3b2416, 0x6b3f1c, 0xd8a24a, 0x9aa5ad, 0x1f1410];
  const skin = skins[hash % skins.length]!, hair = hairs[(hash >> 3) % hairs.length]!;
  g.roundRect(-40, 28, 80, 80, 6).fill(neighbor.kind === 'player' ? 0xeaf4fb : 0xfff3d6);
  g.circle(0, 72, 24).fill(skin).stroke({ color: INK, width: 2.5 });
  g.ellipse(0, 52, 24, 10).fill(hair);
  if (neighbor.special === -1) {
    // Papa dos Pudins: the chef's hat and a white moustache.
    g.roundRect(-18, 26, 36, 22, 10).fill(0xffffff).stroke({ color: INK, width: 2 });
    g.ellipse(0, 82, 12, 4).fill(0xf4efe4);
  } else if (neighbor.special === -2) {
    // Tia Cotinha: a grey bun and a flower.
    g.circle(0, 42, 11).fill(0x9aa5ad).stroke({ color: INK, width: 2 });
    g.circle(16, 50, 5).fill(0xe84a6a);
  } else if (neighbor.theme && THEME_HATS[neighbor.theme] !== undefined) {
    g.roundRect(-22, 40, 44, 10, 5).fill(THEME_HATS[neighbor.theme]!);
  }
  g.circle(-8, 70, 3).fill(0x2a1a10);
  g.circle(8, 70, 3).fill(0x2a1a10);
  g.moveTo(-8, 80).quadraticCurveTo(0, 87, 8, 80).stroke({ color: 0x7a2a1a, width: 2.5 });
}

/**
 * Neighbours in the friends bar: the non-player neighbours (specials first),
 * then other players, eight per page, with the bar's arrows paging. A tap on
 * a slot visits that café.
 */
export class NeighborBar {
  readonly view = new Container();
  private neighbors: Neighbor[] = [];
  private page = 0;
  private readonly slots: Container[] = [];
  private readonly spatula: Texture;

  constructor(icons: Texture, private readonly onVisit: (neighbor: Neighbor) => void) {
    this.view.label = 'room-action-bar-neighbors';
    const frame = TOP_BAR_ICON_FRAMES[2];
    this.spatula = new Texture({ source: icons.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    for (const [index, center] of SLOT_CENTERS.entries()) {
      const slot = new Container();
      slot.label = `room-action-bar-neighbor-slot-${index + 1}`;
      slot.position.set(center, SLOT_TOP);
      slot.hitArea = new Rectangle(-51, 0, 102, 150);
      this.slots.push(slot);
      this.view.addChild(slot);
    }
    this.render();
  }

  setNeighbors(neighbors: readonly Neighbor[]): void {
    this.neighbors = [...neighbors];
    this.render();
  }

  get pageCount(): number { return neighborPage(this.neighbors, 0, SLOT_CENTERS.length).pages; }

  /** step: −1/+1 a page, or ±Infinity for the first and last page. */
  turn(step: number): void {
    const target = step === -Infinity ? 0 : step === Infinity ? this.pageCount - 1 : this.page + step;
    const next = neighborPage(this.neighbors, target, SLOT_CENTERS.length).page;
    if (next === this.page) return;
    this.page = next;
    this.render();
  }

  private render(): void {
    const { items, page } = neighborPage(this.neighbors, this.page, SLOT_CENTERS.length);
    this.page = page;
    const style = (size: number, fill: number, weight = '700', stroke?: { color: number; width: number }) => new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight as TextStyle['fontWeight'], fill, padding: 3,
      ...(stroke ? { stroke: { ...stroke, join: 'round' as const } } : {}),
    });
    this.slots.forEach((slot, index) => {
      slot.removeChildren().forEach((child) => child.destroy({ children: true }));
      slot.removeAllListeners();
      const neighbor = items[index];
      const card = new Graphics().roundRect(-51, 0, 102, 150, 6).fill(0xffffff);
      if (neighbor?.special) card.roundRect(-49, 2, 98, 146, 6).stroke({ color: 0xe0a526, width: 4 });
      slot.addChild(card);
      if (!neighbor) {
        slot.eventMode = 'none';
        const empty = new Text({ text: 'Vizinho', style: style(17, 0xb9a98f) });
        empty.anchor.set(0.5, 0);
        empty.position.set(0, 2);
        slot.addChild(empty, new Graphics().roundRect(-40, 28, 80, 80, 6).stroke({ color: 0xd9cdb6, width: 4 }));
        return;
      }
      slot.label = `room-action-bar-neighbor-${neighbor.id}`;
      slot.eventMode = 'static';
      slot.cursor = 'pointer';
      const title = new Text({ text: neighbor.name, style: style(16, INK) });
      title.anchor.set(0.5, 0);
      title.position.set(0, 3);
      if (title.width > 96) title.scale.set(96 / title.width);
      const portrait = new Graphics();
      drawPortrait(portrait, neighbor);
      portrait.roundRect(-40, 28, 80, 80, 6).stroke({ color: INK, width: 5 });
      const spatula = new Sprite(this.spatula);
      spatula.anchor.set(0.5);
      spatula.height = 40;
      spatula.scale.x = spatula.scale.y;
      const level = new Text({ text: String(neighbor.level), style: style(23, 0xffd436, '700', { color: INK, width: 6 }) });
      level.anchor.set(0, 0.5);
      const row = spatula.width + 3 + level.width;
      spatula.position.set(-row / 2 + spatula.width / 2, 110);
      level.position.set(-row / 2 + spatula.width + 3, 110);
      const helps = new Text({ text: neighbor.helpsLeft > 0 ? `Ajudar: ${neighbor.helpsLeft}` : 'Ajudado hoje', style: style(14, neighbor.helpsLeft > 0 ? 0x2f7a3d : 0x8a7a64) });
      helps.anchor.set(0.5, 0);
      helps.position.set(0, 131);
      slot.addChild(title, portrait, spatula, level, helps);
      let pressed = false;
      slot.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; slot.scale.set(0.96); });
      slot.on('pointerupoutside', () => { pressed = false; slot.scale.set(1); });
      slot.on('pointerup', (event) => { event.stopPropagation(); slot.scale.set(1); });
      slot.on('pointertap', (event) => {
        event.stopPropagation();
        if (!pressed) return;
        pressed = false;
        this.onVisit(neighbor);
      });
    });
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
