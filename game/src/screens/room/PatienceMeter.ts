import { Container, Graphics } from 'pixi.js';

import { POPUP_DRAW_PRIORITY } from '../../world/iso';

/** Above the head, below the exit emotion (225 px) so both can be read. */
const HEIGHT_ABOVE_FEET = 200;
const RADIUS = 20;

/** Remaining share of a customer's wait, clamped to 0..1. */
export function patienceLeft(patience: { startedAt: number; duration: number }, serverNowMs: number): number {
  if (!(patience.duration > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - (serverNowMs - patience.startedAt) / patience.duration));
}

export function patienceColor(left: number): number {
  return left > 0.5 ? 0x43a047 : left > 0.2 ? 0xf5a623 : 0xd8432f;
}

/** A thought bubble with a draining pie: how long a seated customer still waits for food. */
export class PatienceMeter {
  readonly view = new Container();
  private readonly pie = new Graphics();

  constructor() {
    this.view.label = 'patience-meter';
    this.view.eventMode = 'none';
    const bubble = new Graphics()
      .circle(0, 0, RADIUS + 9).fill(0xffffff).stroke({ color: 0x5a3915, width: 3 })
      .circle(-14, RADIUS + 14, 6).fill(0xffffff).stroke({ color: 0x5a3915, width: 2 })
      .circle(-20, RADIUS + 26, 3.5).fill(0xffffff).stroke({ color: 0x5a3915, width: 2 });
    // Fork and plate: the customer is waiting for food.
    const hint = new Graphics().ellipse(0, 4, 13, 6).stroke({ color: 0x5a3915, width: 2 });
    this.view.addChild(bubble, this.pie, hint);
  }

  update(left: number, actorView: Container, serverNowMs: number): void {
    const color = patienceColor(left);
    this.pie.clear().circle(0, 0, RADIUS).fill(0xf1ebe0);
    if (left > 0) {
      const start = -Math.PI / 2;
      this.pie.moveTo(0, 0).arc(0, 0, RADIUS, start, start + left * Math.PI * 2).closePath().fill(color);
    }
    this.view.position.set(actorView.x + 34, actorView.y - HEIGHT_ABOVE_FEET);
    this.view.zIndex = POPUP_DRAW_PRIORITY + actorView.zIndex;
    // The last moments blink to draw the player's eye.
    this.view.alpha = left < 0.15 ? 0.55 + 0.45 * Math.abs(Math.sin(serverNowMs / 160)) : 1;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
