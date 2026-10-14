import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';

export const DIALOG_COLORS = {
  ink: 0x603a1e, frame: 0xc69a60, paper: 0xfff8ea, title: 0xd2541b,
  green: 0x3f9a4a, red: 0xc0392b, grey: 0x9b8b78, gold: 0xb7791f, cash: 0x2e7d32,
} as const;
const POP_MS = 380;

export interface DialogButton {
  label: string;
  caption: string;
  color: number;
  width?: number;
  enabled?: boolean;
  onTap: () => void;
}

/**
 * A window over the room in the game's style: dimmed backdrop that swallows
 * input, brown frame, pop-in, text at the stage's resolution and Esc to
 * close. Subclasses draw their content with text() and button().
 */
export abstract class RoomDialog {
  readonly view = new Container();
  protected readonly panel = new Container();
  protected readonly content = new Container();
  private readonly texts: Text[] = [];
  private resolution = 1;
  private elapsedMs = 0;
  private disposed = false;

  protected constructor(label: string, protected readonly width: number, protected readonly height: number, protected readonly audio?: SoundPlayer) {
    this.view.label = label;
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.6 });
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    this.panel.label = `${label}-panel`;
    this.panel.pivot.set(width / 2, height / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, width, height);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, width, height, 40).fill(DIALOG_COLORS.ink)
      .roundRect(12, 12, width - 24, height - 24, 28).fill(DIALOG_COLORS.frame)
      .roundRect(22, 22, width - 44, height - 44, 18).fill(DIALOG_COLORS.paper);
    frame.eventMode = 'none';
    this.panel.addChild(frame, this.content);
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.view.visible; }

  protected reveal(): void {
    if (this.disposed) return;
    this.elapsedMs = 0;
    this.view.visible = true;
    this.update(0);
  }

  close(): void {
    if (!this.view.visible) return;
    this.view.visible = false;
    this.closed();
  }

  /** After the window closed (Esc, the X or a button). */
  protected closed(): void {}

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = this.resolution;
  }

  update(deltaMs: number): void {
    if (!this.view.visible) return;
    this.elapsedMs += Math.max(0, deltaMs);
    const t = Math.min(1, this.elapsedMs / POP_MS);
    const s = 1.70158;
    this.panel.scale.set(0.65 + 0.35 * (1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)));
  }

  protected clear(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
  }

  /** Centered on x unless anchorX says otherwise; wraps at wrap (default: the panel). */
  protected text(value: string, x: number, y: number, size: number, color: number,
    options: { weight?: '600' | '700'; wrap?: number; anchorX?: number; align?: 'left' | 'center' } = {}): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: options.weight ?? '700', fill: color,
      wordWrap: true, wordWrapWidth: options.wrap ?? this.width - 140, align: options.align ?? 'center',
      ...(size >= 56 ? { stroke: { color: 0xffffff, width: 8 } } : {}),
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.anchor.set(options.anchorX ?? 0.5, 0);
    text.position.set(x, y);
    this.texts.push(text);
    this.content.addChild(text);
    return text;
  }

  protected button(spec: DialogButton, x: number, y: number, height = 72): Container {
    const width = spec.width ?? 320;
    const enabled = spec.enabled !== false;
    const button = new Container();
    button.label = spec.label;
    button.position.set(x, y);
    button.addChild(new Graphics().roundRect(0, 0, width, height, 22)
      .fill(enabled ? spec.color : DIALOG_COLORS.grey).stroke({ color: 0x3d2a14, width: 3 }));
    const caption = this.text(spec.caption, width / 2, 0, height >= 70 ? 32 : 26, 0xffffff, { wrap: width - 20 });
    caption.position.y = (height - caption.height) / 2;
    this.content.removeChild(caption);
    button.addChild(caption);
    button.pivot.set(width / 2, height / 2);
    button.position.set(x + width / 2, y + height / 2);
    if (enabled) {
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.on('pointerover', () => { button.scale.set(1.04); });
      button.on('pointerout', () => { button.scale.set(1); });
      button.on('pointertap', (event) => {
        event.stopPropagation();
        this.audio?.play('click');
        spec.onTap();
      });
    }
    this.content.addChild(button);
    return button;
  }

  /** The round X in the top-right corner. */
  protected closeButton(label: string): Container {
    const button = new Container();
    button.label = label;
    button.position.set(this.width - 54, 54);
    button.addChild(new Graphics().circle(0, 0, 30).fill(DIALOG_COLORS.red).stroke({ color: 0xffffff, width: 4 })
      .moveTo(-11, -11).lineTo(11, 11).moveTo(11, -11).lineTo(-11, 11).stroke({ color: 0xffffff, width: 6, cap: 'round' }));
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointertap', (event) => {
      event.stopPropagation();
      this.audio?.play('click');
      this.close();
    });
    this.content.addChild(button);
    return button;
  }

  /** Enter's action, if the window has a main button. */
  protected confirmKey(): void {}

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Enter') {
      event.stopPropagation();
      this.confirmKey();
    }
  };

  destroy(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown, true);
    this.view.destroy({ children: true });
  }
}
