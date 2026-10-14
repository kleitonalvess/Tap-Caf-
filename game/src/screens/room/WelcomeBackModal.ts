import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { awayLines, formatAway, type AwaySummary } from '../../game/away';

const PANEL_WIDTH = 1080;
const PANEL_HEIGHT = 760;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;
const TONES = { good: 0x2e7d32, info: 0x8a5a2b, warn: 0xc0562b } as const;
const POP_MS = 380;

/**
 * "Bem-vindo de volta!": what the café did while the owner was away. The
 * coins and XP were credited when the room woke; Coletar only acknowledges
 * the summary and plays the reward.
 */
export class WelcomeBackModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly content = new Container();
  private readonly texts: Text[] = [];
  private summary?: AwaySummary;
  private resolution = 1;
  private elapsedMs = 0;
  private disposed = false;

  constructor(private readonly options: { onCollect: (summary: AwaySummary) => void; audio?: SoundPlayer }) {
    this.view.label = 'welcome-back-modal';
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.6 });
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    this.panel.label = 'welcome-back-panel';
    this.panel.pivot.set(PANEL_WIDTH / 2, PANEL_HEIGHT / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, PANEL_HEIGHT - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xfff8ea);
    frame.eventMode = 'none';
    this.panel.addChild(frame, this.content);
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.view.visible; }

  show(summary: AwaySummary): void {
    if (this.disposed) return;
    this.summary = summary;
    this.render(summary);
    this.elapsedMs = 0;
    this.view.visible = true;
    this.options.audio?.play('doorBell');
    this.update(0);
  }

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

  private text(value: string, y: number, size: number, color: number, weight: '600' | '700' = '700'): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill: color,
      wordWrap: true, wordWrapWidth: PANEL_WIDTH - 140, align: 'center',
      ...(size >= 60 ? { stroke: { color: 0xffffff, width: 8 } } : {}),
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.anchor.set(0.5, 0);
    text.position.set(PANEL_WIDTH / 2, y);
    this.texts.push(text);
    return text;
  }

  private render(summary: AwaySummary): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
    this.content.addChild(this.text('Bem-vindo de volta!', 52, 78, 0xd2541b));
    const capped = summary.simulatedMs < summary.to - summary.from - 1000;
    this.content.addChild(this.text(
      `Enquanto você esteve fora (${formatAway(summary.to - summary.from)})${capped ? `, contamos as primeiras ${formatAway(summary.simulatedMs)}` : ''}:`,
      160, 28, DARK_BROWN, '600'));
    let y = 224;
    for (const line of awayLines(summary).slice(0, 8)) {
      const text = this.text(line.text, y, line.tone === 'good' ? 32 : 26, TONES[line.tone], line.tone === 'good' ? '700' : '600');
      this.content.addChild(text);
      y += text.height + 14;
    }
    const button = new Container();
    button.label = 'welcome-back-collect';
    const width = 340;
    button.position.set((PANEL_WIDTH - width) / 2, PANEL_HEIGHT - 120);
    button.addChild(new Graphics().roundRect(0, 0, width, 72, 22).fill(0x3f9a4a).stroke({ color: 0x3d2a14, width: 3 }));
    const caption = this.text(summary.coins > 0 || summary.xp > 0 ? 'Coletar' : 'Continuar', 14, 34, 0xffffff);
    caption.position.x = width / 2;
    button.addChild(caption);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerover', () => { button.scale.set(1.04); });
    button.on('pointerout', () => { button.scale.set(1); });
    button.on('pointertap', (event) => { event.stopPropagation(); this.collect(); });
    this.content.addChild(button);
  }

  private collect(): void {
    const summary = this.summary;
    this.view.visible = false;
    if (summary) this.options.onCollect(summary);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if ((event.key === 'Escape' || event.key === 'Enter') && this.isOpen) {
      event.stopPropagation();
      this.collect();
    }
  };

  destroy(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown, true);
    this.view.destroy({ children: true });
  }
}
