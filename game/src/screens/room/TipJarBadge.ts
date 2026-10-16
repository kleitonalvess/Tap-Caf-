import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

/**
 * The tip jar over the cash register (or the first counter): a glass jar that
 * fills with coins up to the <tips> limit; a full jar glows. The owner taps it
 * to collect.
 */
export class TipJarBadge {
  readonly view = new Container();
  private readonly glass = new Graphics();
  private readonly label: Text;
  private pulseMs = 0;
  private full = false;

  constructor(onTap: () => void) {
    this.view.label = 'tip-jar';
    this.view.eventMode = 'static';
    this.view.cursor = 'pointer';
    this.view.hitArea = new Rectangle(-40, -96, 80, 104);
    this.label = new Text({ text: '', style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 20, fontWeight: '800', fill: 0xffffff, stroke: { color: 0x5a3915, width: 5 }, padding: 4 }) });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, -78);
    this.view.addChild(this.glass, this.label);
    for (const name of ['pointerdown', 'pointerup', 'pointerupoutside'] as const) this.view.on(name, (event) => event.stopPropagation());
    this.view.on('pointertap', (event) => { event.stopPropagation(); onTap(); });
  }

  /** Coins in the jar against its limit; an empty jar is hidden. */
  set(coins: number, cap: number): void {
    this.view.visible = coins > 0;
    this.full = cap > 0 && coins >= cap;
    const fill = cap > 0 ? Math.min(1, coins / cap) : 0;
    const g = this.glass.clear();
    // Glass body, coins inside from the bottom, lid and a "gorjetas" band.
    g.roundRect(-24, -66, 48, 60, 12).fill({ color: 0xdff3fb, alpha: 0.75 }).stroke({ color: 0x5b7f8c, width: 3 });
    if (fill > 0) {
      const h = Math.max(6, 52 * fill);
      g.roundRect(-20, -10 - h, 40, h, 8).fill(0xf2c230);
      for (let i = 0; i < Math.floor(h / 9); i++) g.ellipse(-8 + (i % 3) * 8, -14 - i * 9, 7, 3).fill(0xc8930f);
    }
    g.roundRect(-27, -74, 54, 12, 5).fill(0x8a5a32).stroke({ color: 0x5a3915, width: 2 });
    g.roundRect(-22, -42, 44, 14, 4).fill({ color: 0xffffff, alpha: 0.85 });
    this.label.text = `+${coins.toLocaleString('pt-BR')}`;
  }

  update(deltaMs: number): void {
    if (!this.view.visible) return;
    this.pulseMs = (this.pulseMs + deltaMs) % 1200;
    const pulse = this.full ? 1 + 0.06 * Math.sin((this.pulseMs / 1200) * Math.PI * 2) : 1;
    this.view.scale.set(pulse);
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
