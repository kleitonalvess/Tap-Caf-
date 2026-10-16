import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { POPUP_DRAW_PRIORITY } from '../../world/iso';

/** Above the patience balloon (200 px over the feet, to the right of the head). */
const HEIGHT_ABOVE_FEET = 262;

/**
 * A special visitor's tag: a gold star (a notepad for the critic) and the name,
 * bobbing over the head so the owner spots who to serve first.
 */
export class VisitorBadge {
  readonly view = new Container();
  private elapsedMs = 0;

  constructor(name: string, title: string, critic: boolean) {
    this.view.label = 'visitor-badge';
    this.view.eventMode = 'none';
    const label = new Text({ text: name, style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 22, fontWeight: '800', fill: 0xffffff, stroke: { color: 0x5a3915, width: 5 }, padding: 4 }) });
    label.anchor.set(0.5, 1);
    const caption = new Text({ text: title, style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 15, fontWeight: '700', fill: 0xfff3c4, stroke: { color: 0x5a3915, width: 4 }, padding: 3 }) });
    caption.anchor.set(0.5, 1);
    caption.position.set(0, 18);
    const icon = new Graphics();
    icon.position.set(0, -38);
    if (critic) {
      // Notepad and pencil: the critic is taking notes.
      icon.roundRect(-14, -16, 28, 32, 4).fill(0xfffaf0).stroke({ color: 0x5a3915, width: 3 });
      for (const y of [-6, 2, 10]) icon.moveTo(-8, y).lineTo(8, y).stroke({ color: 0x8a6a4a, width: 2 });
      icon.poly([10, -20, 18, -12, 2, 8, -4, 10, -2, 4]).fill(0xf2c230).stroke({ color: 0x5a3915, width: 2 });
    } else {
      const star: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 18 : 8, a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      icon.poly(star).fill(0xf6c344).stroke({ color: 0x9a6a10, width: 3 });
    }
    this.view.addChild(icon, label, caption);
  }

  update(actorView: Container, deltaMs: number): void {
    this.elapsedMs = (this.elapsedMs + deltaMs) % 1600;
    const bob = Math.sin((this.elapsedMs / 1600) * Math.PI * 2) * 4;
    this.view.position.set(actorView.x, actorView.y - HEIGHT_ABOVE_FEET + bob);
    this.view.zIndex = POPUP_DRAW_PRIORITY + actorView.zIndex;
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
