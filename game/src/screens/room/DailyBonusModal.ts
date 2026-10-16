import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { dailyCards, rewardText, untilText, type DailyClaim, type DailyState } from '../../game/rewards';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const CARD_WIDTH = 168;
const CARD_HEIGHT = 220;
const CARD_GAP = 18;

/**
 * Bônus diário: six cards, one per day of the streak. Coletar asks the server
 * (which credits once per São Paulo date); the window then shows the next
 * day. Missing a day starts the streak over.
 */
export class DailyBonusModal extends RoomDialog {
  private state?: DailyState;
  private claiming = false;
  private message = '';

  constructor(private readonly options: {
    onClaim: () => Promise<DailyClaim>;
    onClaimed: (claim: DailyClaim) => void;
    /** The server's clock: the countdown is to the server's midnight. */
    now?: () => number;
    audio?: SoundPlayer;
  }) {
    super('daily-bonus-modal', 1220, 660, options.audio);
  }

  show(state: DailyState): void {
    this.state = state;
    this.message = '';
    this.render();
    this.reveal();
    this.options.audio?.play('doorBell');
  }

  private render(): void {
    const state = this.state;
    if (!state) return;
    this.clear();
    this.text('Bônus diário', this.width / 2, 48, 72, DIALOG_COLORS.title);
    this.text('Volte todos os dias: o prêmio cresce até o 6º dia. Um dia sem jogar recomeça a sequência.',
      this.width / 2, 150, 26, DIALOG_COLORS.ink, { weight: '600' });
    const cards = dailyCards(state);
    const total = cards.length * CARD_WIDTH + (cards.length - 1) * CARD_GAP;
    cards.forEach(({ reward, status }, index) => {
      const card = new Container();
      card.label = `daily-card-${reward.day}`;
      card.position.set((this.width - total) / 2 + index * (CARD_WIDTH + CARD_GAP), 222);
      const fill = status === 'today' ? 0xfff0b3 : status === 'claimed' ? 0xe8f4e3 : 0xffffff;
      const border = status === 'today' ? DIALOG_COLORS.gold : status === 'claimed' ? DIALOG_COLORS.cash : DIALOG_COLORS.frame;
      card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 20).fill(fill).stroke({ color: border, width: status === 'today' ? 6 : 3 }));
      this.content.addChild(card);
      const x = card.x + CARD_WIDTH / 2;
      this.text(`Dia ${reward.day}`, x, card.y + 16, 30, DIALOG_COLORS.ink);
      const coin = new Graphics();
      coin.position.set(x, card.y + 96);
      if (reward.cash > 0) {
        coin.roundRect(-34, -22, 68, 44, 8).fill(0x58b84f).stroke({ color: 0x276c1f, width: 4 });
        coin.circle(0, 0, 12).stroke({ color: 0xe8f4e3, width: 4 });
      } else {
        coin.circle(0, 0, 30).fill(0xf6c344).stroke({ color: 0xb7791f, width: 5 });
        coin.circle(0, 0, 17).stroke({ color: 0xfff3c4, width: 3 });
      }
      coin.eventMode = 'none';
      this.content.addChild(coin);
      // Coins and Grana on their own lines; spices and crates share the last one (day 6 has all four).
      const parts = rewardText(reward).split(' e ');
      const lines = parts.length > 2 ? [...parts.slice(0, 2), parts.slice(2).join(', ')] : parts;
      this.text(lines.join('\n'), x, card.y + 128, lines.length > 2 ? 16 : 22, reward.cash > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.gold, { wrap: CARD_WIDTH - 12 });
      const caption = { claimed: '✓ Coletado', today: 'Hoje!', tomorrow: 'Amanhã', later: '' }[status];
      if (caption) this.text(caption, x, card.y + CARD_HEIGHT - 32, 22, status === 'claimed' ? DIALOG_COLORS.cash : DIALOG_COLORS.title);
    });
    if (this.message) this.text(this.message, this.width / 2, 460, 26, DIALOG_COLORS.red, { weight: '600' });
    const waiting = !state.claimable;
    this.button({
      label: 'daily-bonus-claim',
      caption: this.claiming ? 'Coletando…' : waiting ? `Próximo bônus ${untilText(state.nextAt - (this.options.now?.() ?? Date.now()))}` : 'Coletar',
      color: DIALOG_COLORS.green, width: waiting ? 520 : 340, enabled: !waiting && !this.claiming,
      onTap: () => this.confirmKey(),
    }, (this.width - (waiting ? 520 : 340)) / 2, this.height - 136);
    this.closeButton('daily-bonus-close');
  }

  protected override confirmKey(): void {
    if (!this.state?.claimable || this.claiming) {
      if (!this.claiming) this.close();
      return;
    }
    this.claiming = true;
    this.message = '';
    this.render();
    this.options.onClaim().then((claim) => {
      this.claiming = false;
      this.state = claim.daily;
      this.render();
      this.options.audio?.play('coin');
      this.options.onClaimed(claim);
    }, (error: unknown) => {
      this.claiming = false;
      this.message = error instanceof Error ? error.message : 'Não foi possível coletar o bônus.';
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}
