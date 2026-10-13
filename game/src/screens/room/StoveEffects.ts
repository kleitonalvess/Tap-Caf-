import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import type { StoveStatus } from '../../game/cooking';
import { POPUP_DRAW_PRIORITY } from '../../world/iso';

/** What a stove shows above its dish; `staleness` is 0 fresh … 1 spoiled. */
export interface StoveEffectState {
  status: StoveStatus | 'empty';
  staleness: number;
  seasoned: boolean;
}

interface Puff { view: Graphics; age: number; life: number; drift: number }
interface Spark { view: Graphics; age: number; vx: number; vy: number }

const BUBBLE_HEIGHT = 150;

/**
 * Procedural stove feedback until dedicated art exists: smoke over a spoiled
 * dish, a "ready" bubble that turns urgent near spoiling, a seasoning star and
 * a one-shot sparkle burst.
 */
export class StoveEffects {
  readonly view = new Container();
  private readonly smoke = new Container();
  private readonly sparks = new Container();
  private readonly bubble = new Container();
  private readonly bubbleFace = new Graphics();
  private readonly seasonStar = new Graphics();
  private readonly puffs: Puff[] = [];
  private readonly sparkList: Spark[] = [];
  private emitMs = 0;
  private clockMs = 0;

  constructor() {
    this.view.label = 'stove-effects';
    this.view.eventMode = 'none';
    const mark = new Text({
      text: '!',
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 44, fontWeight: '700', fill: 0xffffff, padding: 4 }),
    });
    mark.anchor.set(0.5);
    mark.position.set(0, -2);
    this.bubble.addChild(this.bubbleFace, mark);
    this.bubble.visible = false;
    this.seasonStar.star(0, 0, 5, 16, 7).fill(0xffd54a).stroke({ color: 0xa86b00, width: 3 });
    this.seasonStar.visible = false;
    this.view.addChild(this.smoke, this.seasonStar, this.bubble, this.sparks);
  }

  /** x/y: burner position in world space; depth: the stove's draw order. */
  update(deltaMs: number, state: StoveEffectState, x: number, y: number, depth: number, visible: boolean): void {
    const dt = Math.max(0, deltaMs);
    this.clockMs += dt;
    this.view.position.set(x, y);
    this.view.zIndex = POPUP_DRAW_PRIORITY + depth;
    this.view.visible = visible;

    // Spoiled: dark smoke puffs rising from the pan.
    if (state.status === 'spoiled') {
      this.emitMs -= dt;
      while (this.emitMs <= 0) {
        this.emitMs += 140;
        const puff = new Graphics().circle(0, 0, 12 + Math.random() * 8).fill({ color: 0x4a4a4a, alpha: 1 });
        puff.position.set((Math.random() - 0.5) * 30, -20);
        this.smoke.addChild(puff);
        this.puffs.push({ view: puff, age: 0, life: 1600 + Math.random() * 600, drift: (Math.random() - 0.5) * 0.03 });
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.age += dt;
      const t = puff.age / puff.life;
      puff.view.y -= dt * 0.06;
      puff.view.x += dt * puff.drift;
      puff.view.scale.set(1 + t * 1.6);
      puff.view.alpha = 0.55 * (1 - t);
      if (t >= 1) { puff.view.destroy(); this.puffs.splice(i, 1); }
    }

    // Ready: a bobbing bubble; it turns orange, then red, as spoiling nears.
    this.bubble.visible = state.status === 'ready';
    if (this.bubble.visible) {
      const urgent = state.staleness > 0.75;
      const color = urgent ? 0xd8432f : state.staleness > 0.5 ? 0xf08c1a : 0x3fae4a;
      this.bubbleFace.clear()
        .circle(0, 0, 28).fill(color).stroke({ color: 0xffffff, width: 5 })
        .poly([-8, 24, 8, 24, 0, 40]).fill(color);
      const speed = urgent ? 180 : 420;
      this.bubble.position.set(0, -BUBBLE_HEIGHT + Math.sin(this.clockMs / speed) * 6);
      this.bubble.scale.set(urgent ? 1 + 0.08 * Math.sin(this.clockMs / 90) : 1);
    }

    this.seasonStar.visible = state.seasoned && (state.status === 'preparing' || state.status === 'cooking' || state.status === 'ready');
    if (this.seasonStar.visible) {
      this.seasonStar.position.set(44, -58);
      this.seasonStar.rotation = Math.sin(this.clockMs / 500) * 0.25;
      this.seasonStar.scale.set(0.9 + 0.1 * Math.sin(this.clockMs / 260));
    }

    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const spark = this.sparkList[i];
      spark.age += dt;
      spark.view.x += spark.vx * dt;
      spark.view.y += spark.vy * dt;
      spark.vy += 0.0006 * dt;
      spark.view.alpha = Math.max(0, 1 - spark.age / 700);
      if (spark.age >= 700) { spark.view.destroy(); this.sparkList.splice(i, 1); }
    }
  }

  /** Seasoning feedback: golden sparks bursting from the pan. */
  burst(): void {
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const view = new Graphics().star(0, 0, 4, 7, 3).fill(i % 2 ? 0xffe082 : 0xffffff);
      view.position.set(0, -40);
      this.sparks.addChild(view);
      this.sparkList.push({ view, age: 0, vx: Math.cos(angle) * 0.18, vy: Math.sin(angle) * 0.18 - 0.12 });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
