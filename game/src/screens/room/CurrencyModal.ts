import { Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

export type Currency = 'gold' | 'cash';

/** The "+" of the Moedas and Grana bars: how to earn each, with a shortcut to the trophies. */
export class CurrencyModal extends RoomDialog {
  private kind: Currency = 'gold';

  constructor(private readonly options: {
    sources: (kind: Currency) => string[];
    onAchievements?: () => void;
    audio?: SoundPlayer;
  }) {
    super('currency-modal', 1100, 700, options.audio);
  }

  show(kind: Currency): void {
    this.kind = kind;
    this.render();
    this.reveal();
  }

  private render(): void {
    this.clear();
    const gold = this.kind === 'gold';
    this.text(gold ? 'Como ganhar Moedas' : 'Como ganhar Grana', this.width / 2, 44, 60, DIALOG_COLORS.title);
    const icon = new Graphics();
    icon.position.set(this.width / 2, 170);
    if (gold) {
      icon.circle(0, 0, 34).fill(0xf6c344).stroke({ color: 0xb7791f, width: 5 }).circle(0, 0, 19).stroke({ color: 0xfff3c4, width: 3 });
    } else {
      icon.roundRect(-40, -26, 80, 52, 8).fill(0x58b84f).stroke({ color: 0x276c1f, width: 4 }).circle(0, 0, 14).stroke({ color: 0xe8f4e3, width: 4 });
    }
    icon.eventMode = 'none';
    this.content.addChild(icon);
    let y = 236;
    for (const line of this.options.sources(this.kind)) {
      const text = this.text(`• ${line}`, 90, y, 25, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: this.width - 180, weight: '600' });
      y += text.height + 14;
    }
    const buttons = this.options.onAchievements ? 2 : 1;
    const width = 340;
    const left = (this.width - (buttons * width + (buttons - 1) * 30)) / 2;
    if (this.options.onAchievements) {
      this.button({ label: 'currency-achievements', caption: 'Conquistas e missões', color: DIALOG_COLORS.gold, width, onTap: () => {
        this.close();
        this.options.onAchievements?.();
      } }, left, this.height - 116, 68);
    }
    this.button({ label: 'currency-ok', caption: 'Entendi', color: DIALOG_COLORS.green, width, onTap: () => this.close() },
      left + (buttons - 1) * (width + 30), this.height - 116, 68);
    this.closeButton('currency-close');
  }

  protected override confirmKey(): void { this.close(); }
}
