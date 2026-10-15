import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import type { PantryResult, PantrySnapshot, Spice } from '../../game/pantry';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const ROW_HEIGHT = 150;
const JAR_COLORS: Record<Spice['effect'], number> = { double: 0x3f9a4a, rush: 0xd2541b, preserve: 0x7b4fc9 };

/** Despensa (pilão): the special spices, how many are stored and what each does. */
export class PantryModal extends RoomDialog {
  private pantry?: PantrySnapshot;
  private buying?: number;
  private message = '';
  private messageError = false;

  constructor(private readonly options: {
    gold: () => number;
    onBuy: (code: number) => Promise<PantryResult>;
    onBought: (result: PantryResult) => void;
    audio?: SoundPlayer;
  }) {
    super('pantry-modal', 1200, 760, options.audio);
  }

  show(pantry: PantrySnapshot): void {
    this.pantry = pantry;
    this.message = '';
    this.render();
    this.reveal();
  }

  private render(): void {
    const pantry = this.pantry;
    if (!pantry) return;
    this.clear();
    this.text('Despensa', this.width / 2, 40, 64, DIALOG_COLORS.title);
    this.text('Temperos especiais: escolha um ao temperar um prato no fogo (no menu do fogão). O tempero normal continua valendo.',
      this.width / 2, 122, 22, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    pantry.spices.forEach((spice, index) => this.row(spice, 196 + index * (ROW_HEIGHT + 14)));
    if (this.message) this.text(this.message, this.width / 2, this.height - 70, 24, this.messageError ? DIALOG_COLORS.red : DIALOG_COLORS.green, { weight: '600' });
    this.closeButton('pantry-close');
  }

  private row(spice: Spice, y: number): void {
    const card = new Container();
    card.label = `pantry-spice-${spice.code}`;
    card.position.set(70, y);
    card.addChild(new Graphics().roundRect(0, 0, this.width - 140, ROW_HEIGHT, 20).fill(0xffffff).stroke({ color: DIALOG_COLORS.frame, width: 3 }));
    // A little jar in the spice's colour.
    const jar = new Graphics();
    jar.position.set(70, ROW_HEIGHT / 2);
    jar.roundRect(-26, -22, 52, 50, 10).fill(JAR_COLORS[spice.effect]).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    jar.roundRect(-20, -36, 40, 16, 5).fill(0xb7863b).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    jar.roundRect(-16, -6, 32, 18, 4).fill(0xfff8ea);
    card.addChild(jar);
    this.content.addChild(card);
    const left = card.x + 140;
    this.text(spice.name, left, y + 18, 32, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
    this.text(spice.description, left, y + 62, 22, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', weight: '600', wrap: 560 });
    this.text(`Na despensa: ${spice.count}`, left, y + ROW_HEIGHT - 42, 22, spice.count > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.grey, { anchorX: 0, align: 'left' });
    const right = card.x + this.width - 140 - 250;
    const busy = this.buying === spice.code;
    this.button({
      label: `pantry-buy-${spice.code}`, caption: busy ? 'Comprando…' : `Comprar · ${spice.priceCoins.toLocaleString('pt-BR')} moedas`,
      color: DIALOG_COLORS.green, width: 230, enabled: !this.buying && this.options.gold() >= spice.priceCoins,
      onTap: () => this.buy(spice),
    }, right, y + (ROW_HEIGHT - 64) / 2, 64);
  }

  private buy(spice: Spice): void {
    if (this.buying) return;
    this.buying = spice.code;
    this.message = '';
    this.render();
    this.options.onBuy(spice.code).then((result) => {
      this.buying = undefined;
      this.pantry = result.pantry;
      this.message = `${spice.name} guardado na despensa.`;
      this.messageError = false;
      this.render();
      this.options.audio?.play('coin');
      this.options.onBought(result);
    }, (error: unknown) => {
      this.buying = undefined;
      this.message = error instanceof Error ? error.message : 'Não foi possível comprar.';
      this.messageError = true;
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}
