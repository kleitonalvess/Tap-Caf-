import type { SoundPlayer } from '../../audio/sound-events';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirm: string;
  /** Destructive actions are red; the default is green. */
  danger?: boolean;
  cancel?: string;
  onConfirm: () => void;
}

/** "Tem certeza?" before an action that cannot be undone. Esc or Voltar keeps things as they were. */
export class ConfirmDialog extends RoomDialog {
  private request?: ConfirmRequest;

  constructor(audio?: SoundPlayer) {
    super('confirm-dialog', 860, 460, audio);
  }

  ask(request: ConfirmRequest): void {
    this.request = request;
    this.clear();
    this.text(request.title, this.width / 2, 58, 52, DIALOG_COLORS.title);
    this.text(request.message, this.width / 2, 150, 30, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    this.button({ label: 'confirm-dialog-cancel', caption: request.cancel ?? 'Voltar', color: DIALOG_COLORS.grey, width: 300, onTap: () => this.close() },
      this.width / 2 - 320, this.height - 130);
    this.button({ label: 'confirm-dialog-confirm', caption: request.confirm, color: request.danger ? DIALOG_COLORS.red : DIALOG_COLORS.green, width: 300,
      onTap: () => this.confirmKey() }, this.width / 2 + 20, this.height - 130);
    this.reveal();
  }

  protected override confirmKey(): void {
    const request = this.request;
    this.request = undefined;
    this.close();
    request?.onConfirm();
  }

  protected override closed(): void { this.request = undefined; }
}
