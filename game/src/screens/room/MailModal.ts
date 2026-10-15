import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { rewardText, type Letter, type LetterClaim, type MailSnapshot } from '../../game/rewards';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const ROW_HEIGHT = 190;
const VISIBLE_ROWS = 2;

/** Correio: letters with what they carry; Coletar credits each one once. */
export class MailModal extends RoomDialog {
  private mail: MailSnapshot = { letters: [], unread: 0 };
  private page = 0;
  private claiming?: string;
  private message = '';

  constructor(private readonly options: { onClaim: (letter: Letter) => Promise<LetterClaim>; onClaimed: (claim: LetterClaim) => void; audio?: SoundPlayer }) {
    super('mail-modal', 1100, 640, options.audio);
  }

  show(mail: MailSnapshot): void {
    this.mail = mail;
    this.page = 0;
    this.message = '';
    this.render();
    this.reveal();
  }

  private render(): void {
    this.clear();
    this.text('Correio', this.width / 2, 44, 72, DIALOG_COLORS.title);
    const pages = Math.max(1, Math.ceil(this.mail.letters.length / VISIBLE_ROWS));
    this.page = Math.min(this.page, pages - 1);
    if (!this.mail.letters.length) this.text('Nenhuma carta por enquanto.', this.width / 2, 260, 30, DIALOG_COLORS.ink, { weight: '600' });
    this.mail.letters.slice(this.page * VISIBLE_ROWS, (this.page + 1) * VISIBLE_ROWS).forEach((letter, index) => this.row(letter, 150 + index * (ROW_HEIGHT + 16)));
    if (this.message) this.text(this.message, this.width / 2, this.height - 92, 24, DIALOG_COLORS.red, { weight: '600' });
    if (pages > 1) {
      this.text(`${this.page + 1}/${pages}`, this.width / 2, this.height - 64, 26, DIALOG_COLORS.ink);
      if (this.page > 0) this.button({ label: 'mail-previous', caption: '‹', color: DIALOG_COLORS.frame, width: 70, onTap: () => { this.page--; this.render(); } }, this.width / 2 - 150, this.height - 82, 56);
      if (this.page < pages - 1) this.button({ label: 'mail-next', caption: '›', color: DIALOG_COLORS.frame, width: 70, onTap: () => { this.page++; this.render(); } }, this.width / 2 + 80, this.height - 82, 56);
    }
    this.closeButton('mail-close');
  }

  private row(letter: Letter, y: number): void {
    const card = new Container();
    card.label = `mail-letter-${letter.key}`;
    card.position.set(60, y);
    card.addChild(new Graphics().roundRect(0, 0, this.width - 120, ROW_HEIGHT, 20)
      .fill(letter.claimed ? 0xf3ede2 : 0xffffff).stroke({ color: letter.claimed ? DIALOG_COLORS.grey : DIALOG_COLORS.frame, width: 3 }));
    // Envelope, open once collected.
    const envelope = new Graphics();
    envelope.position.set(80, ROW_HEIGHT / 2);
    envelope.rect(-46, -30, 92, 60).fill(letter.claimed ? 0xe9e1d2 : 0xfff3d6).stroke({ color: DIALOG_COLORS.ink, width: 4 });
    if (letter.claimed) envelope.moveTo(-46, -30).lineTo(0, -62).lineTo(46, -30).stroke({ color: DIALOG_COLORS.ink, width: 4 });
    else envelope.moveTo(-46, -30).lineTo(0, 6).lineTo(46, -30).stroke({ color: DIALOG_COLORS.ink, width: 4 }).circle(0, 6, 9).fill(DIALOG_COLORS.red);
    card.addChild(envelope);
    this.content.addChild(card);
    const left = card.x + 160;
    this.text(letter.title, left, y + 18, 32, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: 560 });
    this.text(letter.body, left, y + 62, 21, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: 560, weight: '600' });
    const reward = rewardText(letter);
    const right = card.x + this.width - 120 - 150;
    this.text(letter.coins > 0 || letter.cash > 0 ? reward : '', right, y + 30, 24, letter.cash > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.gold, { wrap: 240 });
    const busy = this.claiming === letter.id;
    this.button({
      label: `mail-claim-${letter.key}`,
      caption: letter.claimed ? 'Aberta' : busy ? 'Abrindo…' : 'Coletar',
      color: DIALOG_COLORS.green, width: 220, enabled: !letter.claimed && !this.claiming,
      onTap: () => this.claim(letter),
    }, right - 110, y + ROW_HEIGHT - 90, 64);
  }

  private claim(letter: Letter): void {
    if (this.claiming || letter.claimed) return;
    this.claiming = letter.id;
    this.message = '';
    this.render();
    this.options.onClaim(letter).then((claim) => {
      this.claiming = undefined;
      this.mail = {
        letters: this.mail.letters.map((item) => item.id === claim.letter.id ? claim.letter : item),
        unread: Math.max(0, this.mail.unread - 1),
      };
      this.render();
      this.options.audio?.play('coin');
      this.options.onClaimed(claim);
    }, (error: unknown) => {
      this.claiming = undefined;
      this.message = error instanceof Error ? error.message : 'Não foi possível abrir a carta.';
      this.render();
      this.options.audio?.play('buzzer');
    });
  }

  get unread(): number { return this.mail.unread; }
}
