import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { crateContents, crateCost, type Crate, type CrateResult, type PantrySnapshot } from '../../game/pantry';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const CARD = { w: 250, h: 380, gap: 22 };
const CRATE_COLORS: Record<string, [number, number]> = {
  surprise: [0xf2c14e, 0xb7791f], brown: [0xa0703f, 0x6b4423], purple: [0x9a5ad6, 0x5e2d91], gold: [0xf6d36b, 0xc99a3c],
};
const REVEAL_MS = 900;

/** Caixas misteriosas: the HUD's free crates and the ones bought with coins or
 * Grana. Abrir asks the server, which pays, draws and delivers the prize. */
export class CratesModal extends RoomDialog {
  private pantry?: PantrySnapshot;
  private opening?: string;
  private result?: CrateResult;
  private revealMs = 0;
  private message = '';

  constructor(private readonly options: {
    wallet: () => { gold: number; cash: number };
    onOpen: (crate: Crate) => Promise<CrateResult>;
    onOpened: (result: CrateResult) => void;
    audio?: SoundPlayer;
  }) {
    super('crates-modal', 1240, 760, options.audio);
  }

  show(pantry: PantrySnapshot): void {
    this.pantry = pantry;
    this.result = undefined;
    this.message = '';
    this.render();
    this.reveal();
  }

  override update(deltaMs: number): void {
    super.update(deltaMs);
    if (!this.isOpen || !this.result || this.revealMs >= REVEAL_MS) return;
    this.revealMs = Math.min(REVEAL_MS, this.revealMs + deltaMs);
    const prize = this.content.getChildByLabel('crates-prize');
    if (prize) {
      const t = this.revealMs / REVEAL_MS;
      prize.scale.set(0.3 + 0.7 * (1 - Math.pow(1 - t, 3)));
      prize.rotation = (1 - t) * 0.6;
    }
  }

  private render(): void {
    const pantry = this.pantry;
    if (!pantry) return;
    this.clear();
    this.text('Caixas misteriosas', this.width / 2, 40, 60, DIALOG_COLORS.title);
    this.text(`Caixas surpresa grátis: ${pantry.freeCrates}/${pantry.freeMax} (o trio de missões do dia e cada conquista dão mais uma). Itens exclusivos vão para o Inventário da loja.`,
      this.width / 2, 118, 22, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    const crates = pantry.crates;
    const total = crates.length * CARD.w + (crates.length - 1) * CARD.gap;
    crates.forEach((crate, index) => this.card(crate, (this.width - total) / 2 + index * (CARD.w + CARD.gap), 190, pantry.freeCrates));
    if (this.result) this.prize(this.result);
    if (this.message) this.text(this.message, this.width / 2, this.height - 64, 24, DIALOG_COLORS.red, { weight: '600' });
    this.closeButton('crates-close');
  }

  private card(crate: Crate, x: number, y: number, freeCrates: number): void {
    const [face, edge] = CRATE_COLORS[crate.id] ?? [0xc69a60, 0x603a1e];
    const card = new Container();
    card.label = `crate-${crate.id}`;
    card.position.set(x, y);
    card.addChild(new Graphics().roundRect(0, 0, CARD.w, CARD.h, 20).fill(0xffffff).stroke({ color: edge, width: 4 }));
    // The crate: a box with a ribbon and a question mark.
    const box = new Graphics();
    box.position.set(CARD.w / 2, 110);
    box.roundRect(-58, -40, 116, 86, 10).fill(face).stroke({ color: edge, width: 4 });
    box.rect(-66, -54, 132, 24).fill(face).stroke({ color: edge, width: 4 });
    box.rect(-8, -54, 16, 100).fill(0xd2541b);
    box.circle(0, 6, 18).fill(0xfff8ea).stroke({ color: edge, width: 3 });
    card.addChild(box);
    this.content.addChild(card);
    const cx = x + CARD.w / 2;
    this.text(crate.name, cx, y + 172, 28, DIALOG_COLORS.ink, { wrap: CARD.w - 20 });
    this.text(crateContents(crate), cx, y + 210, 18, DIALOG_COLORS.ink, { weight: '600', wrap: CARD.w - 24 });
    const wallet = this.options.wallet();
    const affordable = crate.free ? freeCrates > 0 : (crate.cash ?? 0) > 0 ? wallet.cash >= (crate.cash ?? 0) : wallet.gold >= (crate.coins ?? 0);
    this.text(crateCost(crate, freeCrates), cx, y + 262, 22, (crate.cash ?? 0) > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.gold);
    const busy = this.opening === crate.id;
    this.button({
      label: `crate-open-${crate.id}`, caption: busy ? 'Abrindo…' : 'Abrir', color: DIALOG_COLORS.green, width: 190,
      enabled: affordable && !this.opening, onTap: () => this.open(crate),
    }, x + (CARD.w - 190) / 2, y + CARD.h - 74, 58);
  }

  /** The prize pops over the crates, then stays until the next opening. */
  private prize(result: CrateResult): void {
    const holder = new Container();
    holder.label = 'crates-prize';
    holder.position.set(this.width / 2, this.height - 105);
    const width = 820;
    holder.addChild(new Graphics().roundRect(-width / 2, -40, width, 80, 24).fill(0xfff0b3).stroke({ color: DIALOG_COLORS.gold, width: 5 }));
    const where = result.prize.item ? ' · guardado no Inventário da loja' : result.prize.spice ? ' · guardado na Despensa' : '';
    const text = this.text(`Você ganhou: ${result.prize.name}${where}`, 0, -16, 28, DIALOG_COLORS.ink, { wrap: width - 40 });
    this.content.removeChild(text);
    holder.addChild(text);
    holder.scale.set(this.revealMs >= REVEAL_MS ? 1 : 0.3);
    this.content.addChild(holder);
  }

  private open(crate: Crate): void {
    if (this.opening) return;
    this.opening = crate.id;
    this.message = '';
    this.render();
    this.options.onOpen(crate).then((result) => {
      this.opening = undefined;
      this.pantry = result.pantry;
      this.result = result;
      this.revealMs = 0;
      // The wallet first: the buttons below are enabled from the new balance.
      this.options.onOpened(result);
      this.render();
      this.options.audio?.play('levelUp');
    }, (error: unknown) => {
      this.opening = undefined;
      this.message = error instanceof Error ? error.message : 'Não foi possível abrir a caixa.';
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}
