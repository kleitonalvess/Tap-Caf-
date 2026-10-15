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

/** The dish on its way (self-service fetch): the pie fills in this blue. */
export const FETCH_COLOR = 0x3d9be0;

/** Share of a self-service fetch done, clamped to 0..1. */
export function fetchProgress(action: { startedAt: number; duration: number }, serverNowMs: number): number {
  if (!(action.duration > 0)) return 1;
  return Math.max(0, Math.min(1, (serverNowMs - action.startedAt) / action.duration));
}

/** Calm: nothing to eat in the café, so running out costs nothing (neutral grey-blue). */
export function patienceColor(left: number, calm = false): number {
  if (calm) return 0x8fa3b5;
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

  /** The customer went for the dish: the wait is paused and the pie fills up. */
  updateFetch(progress: number, actorView: Container): void {
    this.draw(progress, FETCH_COLOR, actorView);
    this.view.alpha = 1;
  }

  update(left: number, actorView: Container, serverNowMs: number, calm = false): void {
    this.draw(left, patienceColor(left, calm), actorView);
    // The last moments blink to draw the player's eye.
    this.view.alpha = left < 0.15 && !calm ? 0.55 + 0.45 * Math.abs(Math.sin(serverNowMs / 160)) : 1;
  }

  private draw(left: number, color: number, actorView: Container): void {
    this.pie.clear().circle(0, 0, RADIUS).fill(0xf1ebe0);
    if (left > 0) {
      const start = -Math.PI / 2;
      this.pie.moveTo(0, 0).arc(0, 0, RADIUS, start, start + left * Math.PI * 2).closePath().fill(color);
    }
    this.view.position.set(actorView.x + 34, actorView.y - HEIGHT_ABOVE_FEET);
    this.view.zIndex = POPUP_DRAW_PRIORITY + actorView.zIndex;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
