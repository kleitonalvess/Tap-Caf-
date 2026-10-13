import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

const BUTTON_WIDTH = 400;
const BUTTON_HEIGHT = 72;
const BUTTON_GAP = 4;
const INK = 0x603a1e;

type ButtonState = 'rest' | 'hover' | 'pressed';
export type StoveActionKind = 'clock' | 'season' | 'cancel' | 'clean';

export interface StoveAction {
  kind: StoveActionKind;
  caption: string;
  onTap: () => void;
}

function drawIcon(icon: Graphics, kind: StoveActionKind): void {
  const cy = BUTTON_HEIGHT / 2;
  const stroke = { color: INK, width: 4, cap: 'round' as const, join: 'round' as const };
  switch (kind) {
    case 'clock':
      icon.circle(38, cy, 17).stroke({ color: INK, width: 4 });
      icon.moveTo(38, cy - 11).lineTo(38, cy).lineTo(47, cy + 5).stroke({ ...stroke, width: 3.5 });
      break;
    case 'cancel':
      icon.moveTo(26, 24).lineTo(50, 48).moveTo(50, 24).lineTo(26, 48).stroke({ ...stroke, width: 4.5 });
      break;
    case 'season':
      // Salt shaker with falling grains.
      icon.roundRect(28, cy - 6, 18, 22, 5).fill(INK);
      icon.roundRect(30, cy - 13, 14, 8, 3).fill(0xb7863b);
      for (const [x, y] of [[50, cy - 14], [55, cy - 6], [50, cy + 2], [58, cy + 9]]) icon.circle(x, y, 2.4).fill(INK);
      break;
    case 'clean':
      // Broom: handle and bristles.
      icon.moveTo(48, cy - 20).lineTo(34, cy + 4).stroke(stroke);
      icon.poly([24, cy + 2, 42, cy + 10, 36, cy + 22, 18, cy + 14]).fill(INK);
      break;
  }
}

/** Contextual stove actions, styled like the colour panels; the caller picks which apply. */
export class StoveActionMenu {
  readonly view = new Container();
  readonly height: number;
  private timerLabel?: Text;
  private remainingSeconds = 0;
  private timeRevealed = false;

  constructor(actions: readonly StoveAction[]) {
    this.view.label = 'stove-action-menu';
    actions.forEach((action, index) => {
      const label = this.addButton(index * (BUTTON_HEIGHT + BUTTON_GAP), action);
      if (action.kind === 'clock') this.timerLabel = label;
    });
    this.height = actions.length * BUTTON_HEIGHT + Math.max(0, actions.length - 1) * BUTTON_GAP;
  }

  setRemaining(ms: number): void {
    this.remainingSeconds = Math.max(0, Math.ceil(ms / 1000));
    this.updateTimerLabel();
  }

  private updateTimerLabel(): void {
    if (!this.timeRevealed || !this.timerLabel) return;
    this.timerLabel.text = `Faltam ${String(Math.floor(this.remainingSeconds / 60)).padStart(2, '0')}:${String(this.remainingSeconds % 60).padStart(2, '0')}`;
  }

  private addButton(y: number, action: StoveAction): Text {
    const button = new Container();
    button.label = `stove-action-${action.kind}`;
    button.y = y;
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);

    const frame = new Graphics();
    frame.eventMode = 'none';
    const draw = (state: ButtonState) => {
      frame.clear();
      frame.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 12).fill(0x68401e);
      frame.roundRect(4, 4, BUTTON_WIDTH - 8, BUTTON_HEIGHT - 8, 10).fill(0xb7863b);
      frame.roundRect(9, 9, BUTTON_WIDTH - 18, BUTTON_HEIGHT - 18, 8)
        .fill(state === 'rest' ? 0xffffff : state === 'hover' ? 0xffefae : 0xf7d47a);
    };
    draw('rest');

    const icon = new Graphics();
    icon.eventMode = 'none';
    drawIcon(icon, action.kind);

    const label = new Text({
      text: action.caption,
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 29, fontWeight: '600', fill: INK }),
    });
    label.eventMode = 'none';
    label.anchor.set(0, 0.5);
    label.position.set(74, BUTTON_HEIGHT / 2);
    if (label.width > BUTTON_WIDTH - 90) label.scale.set((BUTTON_WIDTH - 90) / label.width);
    button.on('pointerover', () => draw('hover'));
    button.on('pointerout', () => draw('rest'));
    button.on('pointerdown', () => draw('pressed'));
    button.on('pointerup', () => draw('hover'));
    button.on('pointerupoutside', () => draw('rest'));
    button.on('pointertap', (event) => {
      event.stopPropagation();
      if (action.kind === 'clock') {
        this.timeRevealed = true;
        this.updateTimerLabel();
      }
      action.onTap();
    });
    button.addChild(frame, icon, label);
    this.view.addChild(button);
    return label;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
