import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import type { Neighbor } from '../../game/neighbors';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const THEME_ROOFS: Record<string, number> = { japan: 0xd23b2a, italy: 0x2f9e44, noble: 0x6a3fa0 };
const CARD_W = 236;
const CARD_H = 196;
const PAGE = 8;

export type MapPlace = 'home' | 'farm' | 'disco';

/** A little café front: walls, a roof in the theme's colour, door and awning. */
function drawCafe(g: Graphics, roof: number, own: boolean): void {
  g.rect(-56, -10, 112, 64).fill(own ? 0xfff1d0 : 0xf6efe4).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  g.poly([-66, -10, 0, -50, 66, -10]).fill(roof).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  g.roundRect(-14, 18, 28, 36, 4).fill(0x8a5a32).stroke({ color: DIALOG_COLORS.ink, width: 2 });
  for (let k = 0; k < 4; k++) g.rect(-56 + k * 28, -10, 28, 12).fill(k % 2 ? 0xffffff : roof);
  g.rect(-46, 12, 22, 18).fill(0xbfe3f2).stroke({ color: DIALOG_COLORS.ink, width: 2 });
  g.rect(24, 12, 22, 18).fill(0xbfe3f2).stroke({ color: DIALOG_COLORS.ink, width: 2 });
}

function drawFarm(g: Graphics): void {
  g.rect(-56, -6, 112, 60).fill(0xc0392b).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  g.poly([-64, -6, 0, -46, 64, -6]).fill(0x8e2b20).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  g.rect(-16, 18, 32, 36).fill(0xffffff).stroke({ color: DIALOG_COLORS.ink, width: 2 });
  g.moveTo(-16, 18).lineTo(16, 54).moveTo(16, 18).lineTo(-16, 54).stroke({ color: 0xc0392b, width: 3 });
}

function drawDisco(g: Graphics): void {
  g.rect(-56, -30, 112, 84).fill(0x2b2350).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  g.circle(0, -2, 20).fill(0xd7dde3).stroke({ color: 0x6b7280, width: 2 });
  for (let k = -16; k <= 16; k += 8) g.moveTo(k, -20).lineTo(k, 16).stroke({ color: 0x9aa5ad, width: 1 });
  const lights = [0xff4d8d, 0x4dd2ff, 0xffd43b, 0x7cff6b];
  lights.forEach((color, index) => g.circle(-42 + index * 28, 40, 6).fill(color));
}

/**
 * Mapa do bairro: the street with the player's café, the Farm, the Disco and
 * the neighbours' cafés, each a shortcut. Farm and Disco open from the
 * player's own café; a visitor is taken home first.
 */
export class MapModal extends RoomDialog {
  private neighbors: Neighbor[] = [];
  private visiting = false;
  private page = 0;

  constructor(private readonly options: {
    onPlace: (place: MapPlace) => void;
    onVisit: (neighbor: Neighbor) => void;
    audio?: SoundPlayer;
  }) {
    super('map-modal', 1260, 880, options.audio);
  }

  show(neighbors: readonly Neighbor[], visiting: boolean): void {
    this.neighbors = [...neighbors];
    this.visiting = visiting;
    this.page = 0;
    this.render();
    this.reveal();
  }

  private place(label: string, x: number, y: number, title: string, caption: string, draw: (g: Graphics) => void, onTap: () => void, highlight = false): void {
    const card = new Container();
    card.label = label;
    card.position.set(x, y);
    card.addChild(new Graphics().roundRect(0, 0, CARD_W, CARD_H, 18).fill(highlight ? 0xfff3d6 : 0xffffff)
      .stroke({ color: highlight ? 0xe0a526 : DIALOG_COLORS.frame, width: highlight ? 5 : 3 }));
    const art = new Graphics();
    art.position.set(CARD_W / 2, 74);
    draw(art);
    card.addChild(art);
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerover', () => { card.scale.set(1.03); });
    card.on('pointerout', () => { card.scale.set(1); });
    card.on('pointertap', (event) => {
      event.stopPropagation();
      this.audio?.play('click');
      onTap();
    });
    this.content.addChild(card);
    this.text(title, x + CARD_W / 2, y + 136, 22, DIALOG_COLORS.ink, { wrap: CARD_W - 16 });
    this.text(caption, x + CARD_W / 2, y + 166, 17, DIALOG_COLORS.grey, { wrap: CARD_W - 16, weight: '600' });
  }

  private render(): void {
    this.clear();
    this.text('Mapa do bairro', this.width / 2, 30, 60, DIALOG_COLORS.title);
    // The street: a band behind the first row.
    this.content.addChild(new Graphics().roundRect(60, 236, this.width - 120, 36, 10).fill(0x9aa5ad)
      .moveTo(90, 254).lineTo(this.width - 90, 254).stroke({ color: 0xffffff, width: 4 }));
    const row = (count: number) => (this.width - count * CARD_W - (count - 1) * 40) / 2;
    const x0 = row(3);
    const go = (place: MapPlace) => { this.close(); this.options.onPlace(place); };
    this.place('map-home', x0, 110, 'Meu café', this.visiting ? 'Voltar para casa' : 'Você está aqui', (g) => drawCafe(g, DIALOG_COLORS.title, true), () => go('home'), !this.visiting);
    this.place('map-farm', x0 + CARD_W + 40, 110, 'Fazenda', 'Ingredientes frescos', drawFarm, () => go('farm'));
    this.place('map-disco', x0 + (CARD_W + 40) * 2, 110, 'Discoteca', 'Festa do Bairro', drawDisco, () => go('disco'));
    this.text('Cafés vizinhos', this.width / 2, 336, 30, DIALOG_COLORS.ink);
    const pages = Math.max(1, Math.ceil(this.neighbors.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    const items = this.neighbors.slice(this.page * PAGE, this.page * PAGE + PAGE);
    if (items.length === 0) this.text('Nenhum vizinho por enquanto.', this.width / 2, 470, 24, DIALOG_COLORS.grey, { weight: '600' });
    const perRow = 4;
    items.forEach((neighbor, index) => {
      const columns = Math.min(perRow, items.length - Math.floor(index / perRow) * perRow);
      const x = row(columns) + (index % perRow) * (CARD_W + 40);
      const y = 376 + Math.floor(index / perRow) * (CARD_H + 12);
      const roof = (neighbor.theme && THEME_ROOFS[neighbor.theme]) || (neighbor.kind === 'player' ? 0x2b7bb9 : 0xb7791f);
      const caption = neighbor.helpsLeft > 0 ? `Nível ${neighbor.level} · ajudar ${neighbor.helpsLeft}×` : `Nível ${neighbor.level} · ajudado hoje`;
      this.place(`map-neighbor-${neighbor.id}`, x, y, neighbor.cafeName || neighbor.name, caption,
        (g) => drawCafe(g, roof, false), () => { this.close(); this.options.onVisit(neighbor); }, Boolean(neighbor.special));
    });
    if (pages > 1) {
      this.button({ label: 'map-page-previous', caption: '◀', width: 80, color: DIALOG_COLORS.grey, enabled: this.page > 0,
        onTap: () => { this.page--; this.render(); } }, this.width / 2 - 150, this.height - 74, 52);
      this.text(`${this.page + 1}/${pages}`, this.width / 2, this.height - 62, 24, DIALOG_COLORS.ink);
      this.button({ label: 'map-page-next', caption: '▶', width: 80, color: DIALOG_COLORS.grey, enabled: this.page < pages - 1,
        onTap: () => { this.page++; this.render(); } }, this.width / 2 + 70, this.height - 74, 52);
    }
    this.closeButton('map-close');
  }
}
