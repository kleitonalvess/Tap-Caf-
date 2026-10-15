import type { SoundPlayer } from '../../audio/sound-events';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

const NAME_MAX = 24;
/** The name field's centre, below the panel's centre (stage px), between its label and the message. */
const INPUT_OFFSET_Y = 220;

export interface PopularityView {
  name: string;
  popularity: number;
  maximum: number;
  /** Visitors read the café; only its owner renames it. */
  owner: boolean;
}

/**
 * Popularidade: what the score means and, for the owner, the café's name.
 * Pixi has no text field, so the name is a DOM input laid over the panel at
 * the stage's scale while the window is open.
 */
export class PopularityModal extends RoomDialog {
  private state?: PopularityView;
  private input?: HTMLInputElement;
  private message = '';
  private messageError = false;
  private saving = false;
  private stageScale = 1;

  constructor(private readonly options: {
    lines: () => string[];
    onRename: (name: string) => Promise<string>;
    audio?: SoundPlayer;
  }) {
    super('popularity-modal', 1160, 780, options.audio);
  }

  show(state: PopularityView): void {
    this.state = state;
    this.message = '';
    this.render();
    this.reveal();
    if (state.owner) this.openInput(state.name);
  }

  private render(): void {
    const state = this.state;
    if (!state) return;
    this.clear();
    this.text('Popularidade', this.width / 2, 40, 64, DIALOG_COLORS.title);
    this.text(state.owner ? state.name : `Café visitado: ${state.name}`, this.width / 2, 128, 34, DIALOG_COLORS.ink);
    this.text(`★ ${state.popularity.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${state.maximum}`,
      this.width / 2, 176, 40, DIALOG_COLORS.gold);
    let y = 244;
    for (const line of this.options.lines()) {
      const text = this.text(`• ${line}`, 80, y, 23, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: this.width - 160, weight: '600' });
      y += text.height + 10;
    }
    if (state.owner) {
      this.text('Nome do café', this.width / 2, this.height - 238, 26, DIALOG_COLORS.ink);
      if (this.message) this.text(this.message, this.width / 2, this.height - 128, 22, this.messageError ? DIALOG_COLORS.red : DIALOG_COLORS.green, { weight: '600' });
      this.button({
        label: 'popularity-rename', caption: this.saving ? 'Salvando…' : 'Salvar nome',
        color: DIALOG_COLORS.green, width: 300, enabled: !this.saving, onTap: () => this.confirmKey(),
      }, (this.width - 300) / 2, this.height - 100, 64);
    } else {
      this.text('Só o dono pode mudar o nome do café.', this.width / 2, this.height - 120, 24, DIALOG_COLORS.grey, { weight: '600' });
    }
    this.closeButton('popularity-close');
  }

  protected override confirmKey(): void {
    const value = this.input?.value ?? '';
    if (!this.state?.owner || this.saving) return;
    this.saving = true;
    this.message = '';
    this.render();
    this.options.onRename(value).then((name) => {
      this.saving = false;
      if (this.state) this.state = { ...this.state, name };
      if (this.input) this.input.value = name;
      this.message = 'Nome salvo!';
      this.messageError = false;
      this.render();
    }, (error: unknown) => {
      this.saving = false;
      this.message = error instanceof Error ? error.message : 'Não foi possível renomear o café.';
      this.messageError = true;
      this.render();
      this.options.audio?.play('buzzer');
    });
  }

  override setStageScale(scale: number): void {
    super.setStageScale(scale);
    this.stageScale = scale;
    this.placeInput();
  }

  private openInput(name: string): void {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.value = name;
    input.setAttribute('aria-label', 'Nome do café');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.testid = 'popularity-name-input';
    Object.assign(input.style, {
      position: 'fixed', left: '50%', zIndex: '20', transform: 'translate(-50%, -50%)', textAlign: 'center',
      border: '3px solid #c69a60', borderRadius: '12px', background: '#ffffff', color: '#603a1e',
      fontFamily: 'inherit', fontWeight: '700', outline: 'none', boxSizing: 'border-box',
    } satisfies Partial<CSSStyleDeclaration>);
    // Enter and Esc reach the window's keyboard handler; other keys stay in the field.
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') event.stopPropagation();
    });
    document.body.append(input);
    this.input = input;
    this.placeInput();
    input.focus();
    input.select();
  }

  /** The stage is centred in the window with the same scale on both axes. */
  private placeInput(): void {
    if (!this.input) return;
    const scale = this.stageScale;
    Object.assign(this.input.style, {
      top: `calc(50% + ${INPUT_OFFSET_Y * scale}px)`,
      width: `${560 * scale}px`, height: `${60 * scale}px`, fontSize: `${30 * scale}px`,
    });
  }

  protected override closed(): void {
    this.input?.remove();
    this.input = undefined;
  }

  override destroy(): void {
    this.input?.remove();
    this.input = undefined;
    super.destroy();
  }
}
