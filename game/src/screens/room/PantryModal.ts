import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { itemPrice, type PantryItem, type PantryResult, type PantrySnapshot, type Spice } from '../../game/pantry';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const ROW_HEIGHT = 140;
const ROW_TOP = 236;
const JAR_COLORS: Record<Spice['effect'], number> = { double: 0x3f9a4a, rush: 0xd2541b, preserve: 0x7b4fc9 };
type Tab = 'spices' | 'items';

/**
 * Despensa (pilão or the spice shelf): the special spices on one tab, energy
 * drinks and machine parts on the other, with how many are stored.
 */
export class PantryModal extends RoomDialog {
  private pantry?: PantrySnapshot;
  private busy?: number;
  private tab: Tab = 'spices';
  private message = '';
  private messageError = false;

  constructor(private readonly options: {
    wallet: () => { gold: number; cash: number };
    onBuy: (code: number) => Promise<PantryResult>;
    onUse: (code: number) => Promise<PantryResult>;
    onChanged: (result: PantryResult) => void;
    audio?: SoundPlayer;
  }) {
    super('pantry-modal', 1200, 780, options.audio);
  }

  show(pantry: PantrySnapshot, tab: Tab = 'spices'): void {
    this.pantry = pantry;
    this.tab = tab;
    this.message = '';
    this.render();
    this.reveal();
  }

  private render(): void {
    const pantry = this.pantry;
    if (!pantry) return;
    this.clear();
    this.text('Despensa', this.width / 2, 34, 60, DIALOG_COLORS.title);
    const tabs: Array<[Tab, string]> = [['spices', 'Temperos'], ['items', 'Energia e peças']];
    tabs.forEach(([id, caption], index) => this.button({
      label: `pantry-tab-${id}`, caption, width: 260, color: this.tab === id ? DIALOG_COLORS.title : DIALOG_COLORS.grey,
      onTap: () => { if (this.tab !== id) { this.tab = id; this.message = ''; this.render(); } },
    }, this.width / 2 - 270 + index * 280, 104, 56));
    const limit = pantry.spiceLimit ?? 0;
    const hint = this.tab === 'spices'
      ? `Escolha um ao temperar um prato no fogo (menu do fogão). Guarda até ${limit} de cada${pantry.shelf ? ' (com a Prateleira de Temperos)' : '; uma Prateleira de Temperos no café guarda mais'}.`
      : 'Energéticos devolvem energia na hora. Peças de Máquina montam e melhoram a jukebox e o fliperama.';
    this.text(hint, this.width / 2, 176, 20, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    if (this.tab === 'spices') pantry.spices.forEach((spice, index) => this.spiceRow(spice, limit, ROW_TOP + index * (ROW_HEIGHT + 12)));
    else (pantry.items ?? []).forEach((item, index) => this.itemRow(item, ROW_TOP + index * (ROW_HEIGHT + 12)));
    if (this.message) this.text(this.message, this.width / 2, this.height - 52, 22, this.messageError ? DIALOG_COLORS.red : DIALOG_COLORS.green, { weight: '600' });
    this.closeButton('pantry-close');
  }

  private card(label: string, y: number, icon: (g: Graphics) => void): number {
    const card = new Container();
    card.label = label;
    card.position.set(70, y);
    card.addChild(new Graphics().roundRect(0, 0, this.width - 140, ROW_HEIGHT, 20).fill(0xffffff).stroke({ color: DIALOG_COLORS.frame, width: 3 }));
    const picture = new Graphics();
    picture.position.set(70, ROW_HEIGHT / 2);
    icon(picture);
    card.addChild(picture);
    this.content.addChild(card);
    return card.x + 140;
  }

  private spiceRow(spice: Spice, limit: number, y: number): void {
    const left = this.card(`pantry-spice-${spice.code}`, y, (jar) => {
      jar.roundRect(-26, -22, 52, 50, 10).fill(JAR_COLORS[spice.effect]).stroke({ color: DIALOG_COLORS.ink, width: 3 });
      jar.roundRect(-20, -36, 40, 16, 5).fill(0xb7863b).stroke({ color: DIALOG_COLORS.ink, width: 3 });
      jar.roundRect(-16, -6, 32, 18, 4).fill(0xfff8ea);
    });
    this.text(spice.name, left, y + 16, 30, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
    this.text(spice.description, left, y + 56, 21, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', weight: '600', wrap: 560 });
    const full = limit > 0 && spice.count >= limit;
    this.text(`Na despensa: ${spice.count}${limit > 0 ? `/${limit}` : ''}`, left, y + ROW_HEIGHT - 40, 21, spice.count > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.grey, { anchorX: 0, align: 'left' });
    this.button({
      label: `pantry-buy-${spice.code}`, caption: this.busy === spice.code ? 'Comprando…' : full ? 'Despensa cheia' : `Comprar · ${spice.priceCoins.toLocaleString('pt-BR')} moedas`,
      color: DIALOG_COLORS.green, width: 240, enabled: !this.busy && !full && this.options.wallet().gold >= spice.priceCoins,
      onTap: () => this.act(spice.code, 'buy', `${spice.name} guardado na despensa.`),
    }, 70 + this.width - 140 - 260, y + (ROW_HEIGHT - 64) / 2, 64);
  }

  private itemRow(item: PantryItem, y: number): void {
    const left = this.card(`pantry-item-${item.code}`, y, (g) => {
      if (item.kind === 'energy') {
        // A can (or a cup for the coffee) with a lightning bolt.
        g.roundRect(-20, -30, 40, 60, 10).fill(item.code === 810001 ? 0x8a5a32 : 0x2f9e44).stroke({ color: DIALOG_COLORS.ink, width: 3 });
        g.poly([4, -20, -10, 2, 0, 2, -4, 22, 12, -4, 2, -4]).fill(0xffd43b).stroke({ color: 0x7a5a00, width: 1.5 });
      } else {
        // A gear.
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 24, Math.sin(a) * 24, 8).fill(0x9aa5ad).stroke({ color: 0x4f5a63, width: 2 });
        }
        g.circle(0, 0, 24).fill(0xb8c2ca).stroke({ color: 0x4f5a63, width: 3 });
        g.circle(0, 0, 9).fill(0xffffff).stroke({ color: 0x4f5a63, width: 2 });
      }
    });
    this.text(item.name, left, y + 16, 30, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
    this.text(item.description, left, y + 56, 21, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', weight: '600', wrap: 440 });
    this.text(`Na despensa: ${item.count}`, left, y + ROW_HEIGHT - 40, 21, item.count > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.grey, { anchorX: 0, align: 'left' });
    const wallet = this.options.wallet();
    const affordable = (item.priceCash ?? 0) > 0 ? wallet.cash >= (item.priceCash ?? 0) : wallet.gold >= (item.priceCoins ?? 0);
    // Side by side, vertically centred: buy (price) on the left, use (energy) on the right.
    const right = 70 + this.width - 140 - 20, top = y + (ROW_HEIGHT - 60) / 2;
    const useWidth = item.kind === 'energy' ? 150 : 0, buyWidth = 200;
    this.button({
      label: `pantry-buy-${item.code}`, caption: this.busy === item.code ? '…' : itemPrice(item),
      color: (item.priceCash ?? 0) > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.green, width: buyWidth, enabled: !this.busy && affordable,
      onTap: () => this.act(item.code, 'buy', `${item.name} guardado na despensa.`),
    }, right - useWidth - (useWidth ? 16 : 0) - buyWidth, top, 60);
    if (item.kind === 'energy') {
      this.button({
        label: `pantry-use-${item.code}`, caption: `Usar +${item.amount}`, color: DIALOG_COLORS.title, width: useWidth,
        enabled: !this.busy && item.count > 0, onTap: () => this.act(item.code, 'use', `+${item.amount} de energia.`),
      }, right - useWidth, top, 60);
    }
    this.text('comprar', right - useWidth - (useWidth ? 16 : 0) - buyWidth / 2, top - 22, 16, DIALOG_COLORS.grey, { weight: '600' });
  }

  private act(code: number, action: 'buy' | 'use', done: string): void {
    if (this.busy) return;
    this.busy = code;
    this.message = '';
    this.render();
    (action === 'buy' ? this.options.onBuy(code) : this.options.onUse(code)).then((result) => {
      this.busy = undefined;
      this.pantry = result.pantry;
      this.message = done;
      this.messageError = false;
      // The wallet first: the buttons below are enabled from the new balance.
      this.options.onChanged(result);
      this.render();
      this.options.audio?.play(action === 'buy' ? 'coin' : 'season');
    }, (error: unknown) => {
      this.busy = undefined;
      this.message = error instanceof Error ? error.message : 'Não foi possível concluir.';
      this.messageError = true;
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}
