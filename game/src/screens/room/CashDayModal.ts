import { Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

export interface CashDay {
  /** Today's counters (São Paulo date) from the progress route. */
  today: Record<string, number>;
  /** A cash register is placed in the café. */
  register: boolean;
  /** The café's tip jar: coins waiting and the <tips> limit of the level band. */
  jar?: { coins: number; cap: number };
}

const number = (value: number) => value.toLocaleString('pt-BR');

/** Caixa do dia: what the café took in today and the tip jar, from the cash register in the café. */
export class CashDayModal extends RoomDialog {
  private day?: CashDay;
  private collecting = false;

  constructor(private readonly options: { audio?: SoundPlayer; onCollect?: () => void }) {
    super('cash-day-modal', 1000, 780, options.audio);
  }

  show(day: CashDay): void {
    this.day = day;
    this.collecting = false;
    this.render();
    this.reveal();
  }

  /** The jar changed (a payment dropped coins, or it was collected). */
  setJar(jar: { coins: number; cap: number }): void {
    if (!this.day) return;
    this.day = { ...this.day, jar };
    this.collecting = false;
    this.render();
  }

  private render(): void {
    const day = this.day;
    if (!day) return;
    this.clear();
    this.text('Caixa do dia', this.width / 2, 44, 64, DIALOG_COLORS.title);
    const value = (stat: string) => Math.max(0, day.today[stat] ?? 0);
    const rows: Array<[string, string, number]> = [
      ['Porções vendidas', number(value('customers')), DIALOG_COLORS.ink],
      ['Moedas recebidas', number(value('earned_coins')), DIALOG_COLORS.gold],
      ['Gorjetas (já somadas)', number(value('tips')), DIALOG_COLORS.cash],
      ['Pratos levados ao balcão', number(value('dishes')), DIALOG_COLORS.ink],
      ['Moedas gastas', number(value('spent_coins')), DIALOG_COLORS.red],
    ];
    rows.forEach(([label, amount, color], index) => {
      const y = 140 + index * 56;
      this.text(label, 110, y, 28, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', weight: '600' });
      this.text(amount, this.width - 110, y, 32, color, { anchorX: 1, align: 'left' });
    });
    if (day.jar) this.jarRow(day.jar, 438);
    this.text(day.register
      ? 'Sua Caixa Registradora faz quem se serve sozinho também deixar gorjeta.'
      : 'Coloque uma Caixa Registradora (aba dos balcões) e quem se serve sozinho também deixa gorjeta.',
    this.width / 2, 590, 21, day.register ? DIALOG_COLORS.cash : DIALOG_COLORS.grey, { weight: '600', wrap: this.width - 160 });
    this.text('Os números zeram à meia-noite de São Paulo; o pote só esvazia quando você coleta.', this.width / 2, 638, 19, DIALOG_COLORS.grey, { weight: '600', wrap: this.width - 160 });
    this.button({ label: 'cash-day-ok', caption: 'Fechar', color: DIALOG_COLORS.green, width: 300, onTap: () => this.close() },
      (this.width - 300) / 2, this.height - 100, 64);
    this.closeButton('cash-day-close');
  }

  /** "Pote de gorjetas 45/100" with a fill bar and the collect button. */
  private jarRow(jar: { coins: number; cap: number }, y: number): void {
    const card = new Graphics().roundRect(80, y, this.width - 160, 120, 18).fill(0xfff8ea).stroke({ color: DIALOG_COLORS.frame, width: 3 });
    card.label = 'cash-day-jar';
    this.content.addChild(card);
    this.text('Pote de gorjetas', 110, y + 16, 28, DIALOG_COLORS.ink, { anchorX: 0, align: 'left' });
    this.text(`${number(jar.coins)} / ${number(jar.cap)} moedas`, 110, y + 56, 24, DIALOG_COLORS.gold, { anchorX: 0, align: 'left', weight: '700' });
    const bar = new Graphics();
    const width = 360, fill = jar.cap > 0 ? Math.min(1, jar.coins / jar.cap) : 0;
    bar.roundRect(110, y + 92, width, 14, 7).fill(0xe7dcc6);
    if (fill > 0) bar.roundRect(110, y + 92, Math.max(14, width * fill), 14, 7).fill(fill >= 1 ? DIALOG_COLORS.green : 0xf2c230);
    this.content.addChild(bar);
    this.button({
      label: 'cash-day-collect', caption: this.collecting ? 'Coletando…' : jar.coins > 0 ? `Coletar +${number(jar.coins)}` : 'Pote vazio',
      color: DIALOG_COLORS.green, width: 260, enabled: jar.coins > 0 && !this.collecting && !!this.options.onCollect,
      onTap: () => { this.collecting = true; this.render(); this.options.onCollect?.(); },
    }, this.width - 110 - 260, y + 28, 64);
  }

  protected override confirmKey(): void { this.close(); }
}
