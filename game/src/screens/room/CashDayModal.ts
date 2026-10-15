import type { SoundPlayer } from '../../audio/sound-events';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

export interface CashDay {
  /** Today's counters (São Paulo date) from the progress route. */
  today: Record<string, number>;
  /** A cash register is placed in the café. */
  register: boolean;
}

const number = (value: number) => value.toLocaleString('pt-BR');

/** Caixa do dia: what the café took in today, from the store's cash register button. */
export class CashDayModal extends RoomDialog {
  private day?: CashDay;

  constructor(options: { audio?: SoundPlayer }) {
    super('cash-day-modal', 1000, 680, options.audio);
  }

  show(day: CashDay): void {
    this.day = day;
    this.render();
    this.reveal();
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
      const y = 150 + index * 62;
      this.text(label, 110, y, 30, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', weight: '600' });
      this.text(amount, this.width - 110, y, 34, color, { anchorX: 1, align: 'left' });
    });
    this.text(day.register
      ? 'Sua Caixa Registradora faz quem se serve sozinho também deixar gorjeta.'
      : 'Coloque uma Caixa Registradora (aba dos balcões) e quem se serve sozinho também deixa gorjeta.',
    this.width / 2, 470, 22, day.register ? DIALOG_COLORS.cash : DIALOG_COLORS.grey, { weight: '600', wrap: this.width - 160 });
    this.text('Os números zeram à meia-noite de São Paulo.', this.width / 2, 530, 20, DIALOG_COLORS.grey, { weight: '600' });
    this.button({ label: 'cash-day-ok', caption: 'Fechar', color: DIALOG_COLORS.green, width: 300, onTap: () => this.close() },
      (this.width - 300) / 2, this.height - 110, 64);
    this.closeButton('cash-day-close');
  }

  protected override confirmKey(): void { this.close(); }
}
