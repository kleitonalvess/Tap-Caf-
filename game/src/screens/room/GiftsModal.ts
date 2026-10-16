import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { giftText, type Gift, type GiftClaim, type GiftItem, type GiftsSnapshot, type Neighbor } from '../../game/neighbors';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

type Tab = 'receive' | 'send';
const ROW = 92;
const PAGE = 5;

/** Item icon: a coin, an energy can, a gear or a spice jar. */
function drawItem(g: Graphics, item: GiftItem): void {
  if (item.coins) {
    g.circle(0, 0, 26).fill(0xf6c344).stroke({ color: 0xb7791f, width: 4 });
    g.circle(0, 0, 15).stroke({ color: 0xfff3c4, width: 3 });
  } else if (item.spice) {
    g.roundRect(-18, -16, 36, 36, 8).fill(0x3f9a4a).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    g.roundRect(-14, -26, 28, 12, 4).fill(0xb7863b).stroke({ color: DIALOG_COLORS.ink, width: 3 });
  } else if (item.stock === 820001) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.circle(Math.cos(a) * 20, Math.sin(a) * 20, 6).fill(0x9aa5ad).stroke({ color: 0x4f5a63, width: 2 });
    }
    g.circle(0, 0, 20).fill(0xb8c2ca).stroke({ color: 0x4f5a63, width: 3 });
  } else {
    g.roundRect(-16, -24, 32, 48, 8).fill(0x8a5a32).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    g.poly([3, -16, -8, 2, 0, 2, -3, 18, 10, -3, 2, -3]).fill(0xffd43b);
  }
}

/**
 * Presentes: the gifts waiting (each non-player neighbour sends one a day,
 * players' gifts wait ten days) and today's free gifts to send, up to the
 * daily limit, one per neighbour.
 */
export class GiftsModal extends RoomDialog {
  private gifts?: GiftsSnapshot;
  private neighbors: Neighbor[] = [];
  private tab: Tab = 'receive';
  private item = 'coins';
  private page = 0;
  private busy?: string;
  private message = '';
  private messageError = false;

  constructor(private readonly options: {
    onClaim: (id: string) => Promise<GiftClaim>;
    onSend: (to: string, item: string) => Promise<GiftsSnapshot>;
    onChanged: (claim?: GiftClaim) => void;
    audio?: SoundPlayer;
  }) {
    super('gifts-modal', 1200, 820, options.audio);
  }

  show(gifts: GiftsSnapshot, neighbors: readonly Neighbor[], tab: Tab = 'receive'): void {
    this.gifts = gifts;
    this.neighbors = [...neighbors];
    this.tab = tab;
    this.page = 0;
    this.message = '';
    if (!gifts.items.some((item) => item.id === this.item)) this.item = gifts.items[0]?.id ?? '';
    this.render();
    this.reveal();
  }

  private render(): void {
    const gifts = this.gifts;
    if (!gifts) return;
    this.clear();
    this.text('Presentes', this.width / 2, 30, 60, DIALOG_COLORS.title);
    ([['receive', `Receber (${gifts.received.length})`], ['send', 'Enviar']] as Array<[Tab, string]>).forEach(([id, caption], index) => this.button({
      label: `gifts-tab-${id}`, caption, width: 260, color: this.tab === id ? DIALOG_COLORS.title : DIALOG_COLORS.grey,
      onTap: () => { if (this.tab !== id) { this.tab = id; this.page = 0; this.message = ''; this.render(); } },
    }, this.width / 2 - 270 + index * 280, 100, 56));
    const counters = this.tab === 'receive'
      ? `Abertos hoje: ${gifts.claimedToday}/${gifts.limit} · cada presente aberto rende +${gifts.xp} XP`
      : `Enviados hoje: ${gifts.sentToday}/${gifts.limit} · um presente grátis por vizinho a cada dia`;
    this.text(counters, this.width / 2, 172, 21, DIALOG_COLORS.ink, { weight: '600' });
    if (this.tab === 'receive') this.renderReceived(gifts);
    else this.renderSend(gifts);
    if (this.message) this.text(this.message, this.width / 2, this.height - 54, 22, this.messageError ? DIALOG_COLORS.red : DIALOG_COLORS.green, { weight: '600' });
    this.closeButton('gifts-close');
  }

  private pager(total: number, y: number): void {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (pages <= 1) return;
    this.button({ label: 'gifts-page-previous', caption: '◀', width: 80, color: DIALOG_COLORS.grey, enabled: this.page > 0,
      onTap: () => { this.page--; this.render(); } }, this.width / 2 - 150, y, 52);
    this.text(`${this.page + 1}/${pages}`, this.width / 2, y + 12, 24, DIALOG_COLORS.ink);
    this.button({ label: 'gifts-page-next', caption: '▶', width: 80, color: DIALOG_COLORS.grey, enabled: this.page < pages - 1,
      onTap: () => { this.page++; this.render(); } }, this.width / 2 + 70, y, 52);
  }

  private row(label: string, y: number, item: GiftItem): number {
    const card = new Container();
    card.label = label;
    card.position.set(80, y);
    card.addChild(new Graphics().roundRect(0, 0, this.width - 160, ROW - 10, 16).fill(0xffffff).stroke({ color: DIALOG_COLORS.frame, width: 3 }));
    const icon = new Graphics();
    icon.position.set(52, (ROW - 10) / 2);
    drawItem(icon, item);
    card.addChild(icon);
    this.content.addChild(card);
    return card.x + 110;
  }

  private renderReceived(gifts: GiftsSnapshot): void {
    if (gifts.received.length === 0) {
      this.text('Nenhum presente esperando. Os vizinhos mandam um novo amanhã!', this.width / 2, 320, 26, DIALOG_COLORS.grey, { weight: '600' });
      return;
    }
    const full = gifts.claimedToday >= gifts.limit;
    gifts.received.slice(this.page * PAGE, this.page * PAGE + PAGE).forEach((gift: Gift, index) => {
      const y = 214 + index * ROW;
      const left = this.row(`gift-${gift.id}`, y, gift.item);
      this.text(`${gift.fromName} mandou`, left, y + 12, 24, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
      this.text(giftText(gift.item, gifts.xp), left, y + 46, 20, DIALOG_COLORS.gold, { anchorX: 0, align: 'left', weight: '600' });
      this.button({
        label: `gift-open-${gift.id}`, caption: this.busy === gift.id ? 'Abrindo…' : full ? 'Amanhã' : 'Abrir',
        width: 180, color: DIALOG_COLORS.green, enabled: !this.busy && !full,
        onTap: () => this.claim(gift),
      }, this.width - 80 - 200, y + 12, 58);
    });
    this.pager(gifts.received.length, 214 + PAGE * ROW + 6);
  }

  private renderSend(gifts: GiftsSnapshot): void {
    // Item choice, then the neighbours with a "Enviar" button each.
    gifts.items.forEach((item, index) => {
      const x = this.width / 2 - (gifts.items.length * 230) / 2 + index * 230;
      this.button({ label: `gift-item-${item.id}`, caption: item.name, width: 216, color: this.item === item.id ? DIALOG_COLORS.title : DIALOG_COLORS.grey,
        onTap: () => { this.item = item.id; this.render(); } }, x, 206, 52);
    });
    const item = gifts.items.find((entry) => entry.id === this.item);
    const full = gifts.sentToday >= gifts.limit;
    this.neighbors.slice(this.page * PAGE, this.page * PAGE + PAGE).forEach((neighbor, index) => {
      const y = 276 + index * ROW;
      const left = item ? this.row(`gift-to-${neighbor.id}`, y, item) : 110;
      this.text(neighbor.name, left, y + 12, 24, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
      this.text(`${neighbor.cafeName} · nível ${neighbor.level}`, left, y + 46, 19, DIALOG_COLORS.grey, { anchorX: 0, align: 'left', weight: '600' });
      this.button({
        label: `gift-send-${neighbor.id}`, caption: neighbor.giftSent ? 'Enviado ✓' : this.busy === neighbor.id ? 'Enviando…' : 'Enviar',
        width: 180, color: DIALOG_COLORS.green, enabled: !this.busy && !neighbor.giftSent && !full && !!item,
        onTap: () => this.send(neighbor),
      }, this.width - 80 - 200, y + 12, 58);
    });
    this.pager(this.neighbors.length, 276 + PAGE * ROW + 6);
  }

  private claim(gift: Gift): void {
    if (this.busy) return;
    this.busy = gift.id;
    this.render();
    this.options.onClaim(gift.id).then((claim) => {
      this.busy = undefined;
      this.gifts = claim.gifts;
      this.page = Math.min(this.page, Math.max(0, Math.ceil(claim.gifts.received.length / PAGE) - 1));
      this.message = `Você abriu: ${giftText(claim.gift.item, claim.xp)}.`;
      this.messageError = false;
      this.options.onChanged(claim);
      this.render();
      this.options.audio?.play('coin');
    }, (error: unknown) => this.fail(error));
  }

  private send(neighbor: Neighbor): void {
    if (this.busy) return;
    this.busy = neighbor.id;
    this.render();
    this.options.onSend(neighbor.id, this.item).then((gifts) => {
      this.busy = undefined;
      this.gifts = gifts;
      this.neighbors = this.neighbors.map((entry) => entry.id === neighbor.id ? { ...entry, giftSent: true } : entry);
      this.message = `Presente enviado para ${neighbor.name}!`;
      this.messageError = false;
      this.options.onChanged();
      this.render();
      this.options.audio?.play('click');
    }, (error: unknown) => this.fail(error));
  }

  private fail(error: unknown): void {
    this.busy = undefined;
    this.message = error instanceof Error ? error.message : 'Não foi possível concluir.';
    this.messageError = true;
    this.render();
    this.options.audio?.play('buzzer');
  }
}
