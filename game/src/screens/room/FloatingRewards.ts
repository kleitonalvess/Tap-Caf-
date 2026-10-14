import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import { FONT_FAMILY, FONT_WEIGHT } from '../../core/font-tokens';
import { STAGE_WIDTH } from '../../core/stage';
import { POPUP_DRAW_PRIORITY } from '../../world/iso';

export interface RewardIcons {
  coin?: Texture;
  xp?: Texture;
}

/** Starts above the exit emotion (225 px above the feet) so both stay readable. */
const START_HEIGHT = 270;
const RISE = 110;
const DURATION_MS = 1600;
const FADE_START = 0.6;
const ICON_SIZE = 52;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

interface Floating {
  view: Container;
  baseY: number;
  elapsedMs: number;
}

function rewardRow(text: string, fill: number, stroke: number, icon?: Texture): Container {
  const row = new Container();
  const label = new Text({
    text,
    style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 44,
      fontWeight: String(FONT_WEIGHT) as TextStyle['fontWeight'],
      fill, stroke: { color: stroke, width: 8, join: 'round' }, padding: 6,
    }),
  });
  label.anchor.set(0, 0.5);
  if (icon) {
    const sprite = new Sprite(icon);
    sprite.anchor.set(0.5);
    sprite.scale.set(ICON_SIZE / Math.max(icon.width, icon.height));
    row.addChild(sprite);
    label.x = ICON_SIZE / 2 + 4;
  }
  row.addChild(label);
  row.pivot.x = row.width / 2 - (icon ? ICON_SIZE / 2 : 0);
  return row;
}

/**
 * Coins and XP rising from where a customer paid. The values come from the
 * server's payment event; this only animates them and never touches the HUD.
 */
export class FloatingRewards {
  private readonly active: Floating[] = [];

  constructor(private readonly world: Container, private readonly icons: RewardIcons = {}) {}

  /**
   * tip (waiter or party) and fresh (farm ingredients) are parts of coins; each
   * rises on its own line under the dish price.
   */
  spawn(x: number, y: number, depth: number, coins: number, xp: number, tip = 0, fresh = 0): void {
    const view = new Container();
    view.label = 'floating-reward';
    view.eventMode = 'none';
    let rowY = 0;
    const tipped = Math.max(0, Math.min(tip, coins));
    const freshed = Math.max(0, Math.min(fresh, coins - tipped));
    if (coins - tipped - freshed > 0) {
      const row = rewardRow(`+${coins - tipped - freshed}`, 0xffd23f, 0x824310, this.icons.coin);
      row.y = rowY;
      view.addChild(row);
      rowY += 56;
    }
    if (tipped > 0) {
      const row = rewardRow(`+${tipped} gorjeta`, 0xb8f28c, 0x1f5a17, this.icons.coin);
      row.label = 'floating-tip';
      row.y = rowY;
      view.addChild(row);
      rowY += 56;
    }
    if (freshed > 0) {
      const row = rewardRow(`+${freshed} fresco`, 0x9be36b, 0x23511a, this.icons.coin);
      row.label = 'floating-fresh';
      row.y = rowY;
      view.addChild(row);
      rowY += 56;
    }
    if (xp > 0) {
      const row = rewardRow(`+${xp} XP`, 0xffffff, 0x092c65, this.icons.xp);
      row.y = rowY;
      view.addChild(row);
    }
    if (view.children.length === 0) { view.destroy(); return; }
    view.position.set(x, y - START_HEIGHT);
    view.zIndex = POPUP_DRAW_PRIORITY + depth + 1;
    this.world.addChild(view);
    this.active.push({ view, baseY: view.y, elapsedMs: 0 });
  }

  update(deltaMs: number, visible: boolean): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.elapsedMs += Math.max(0, deltaMs);
      const t = Math.min(1, entry.elapsedMs / DURATION_MS);
      entry.view.y = entry.baseY - RISE * easeOutCubic(t);
      entry.view.alpha = t < FADE_START ? 1 : 1 - (t - FADE_START) / (1 - FADE_START);
      entry.view.renderable = visible;
      if (t >= 1) {
        entry.view.destroy({ children: true });
        this.active.splice(i, 1);
      }
    }
  }

  destroy(): void {
    for (const entry of this.active) entry.view.destroy({ children: true });
    this.active.length = 0;
  }
}

const TOAST_WIDTH = 560;
const TOAST_HEIGHT = 150;
const TOAST_IN_MS = 320;
const TOAST_HOLD_MS = 2800;
const TOAST_OUT_MS = 300;

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** HUD banner for the owner's level-up; a later sprint replaces it with the unlock modal. */
export class LevelUpToast {
  readonly view = new Container();
  private readonly title: Text;
  private readonly detail: Text;
  private elapsedMs = -1;

  constructor(top = 150) {
    this.view.label = 'level-up-toast';
    this.view.eventMode = 'none';
    this.view.visible = false;
    this.view.position.set(STAGE_WIDTH / 2, top + TOAST_HEIGHT / 2);
    this.view.pivot.set(TOAST_WIDTH / 2, TOAST_HEIGHT / 2);
    const frame = new Graphics()
      .roundRect(0, 0, TOAST_WIDTH, TOAST_HEIGHT, 30).fill(0x603a1e)
      .roundRect(8, 8, TOAST_WIDTH - 16, TOAST_HEIGHT - 16, 24).fill(0xc69a60)
      .roundRect(15, 15, TOAST_WIDTH - 30, TOAST_HEIGHT - 30, 18).fill(0xfff6df);
    const style = (size: number, fill: number) => new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size,
      fontWeight: String(FONT_WEIGHT) as TextStyle['fontWeight'], fill, padding: 6,
    });
    this.title = new Text({ text: 'Subiu de nível!', style: style(46, 0x603a1e) });
    this.title.anchor.set(0.5);
    this.title.position.set(TOAST_WIDTH / 2, 55);
    this.detail = new Text({ text: '', style: style(30, 0x824310) });
    this.detail.anchor.set(0.5);
    this.detail.position.set(TOAST_WIDTH / 2, 104);
    this.view.addChild(frame, this.title, this.detail);
  }

  show(level: number, rewardCoins: number): void {
    this.showMessage('Subiu de nível!', rewardCoins > 0 ? `Nível ${level} · +${rewardCoins} moedas` : `Nível ${level}`);
  }

  /** The same banner for other celebrations (café expansion). */
  showMessage(title: string, detail: string): void {
    this.title.text = title;
    this.detail.text = detail;
    // width includes the scale left by the previous message: measure at 1.
    for (const text of [this.title, this.detail]) {
      text.scale.set(1);
      if (text.width > TOAST_WIDTH - 40) text.scale.set((TOAST_WIDTH - 40) / text.width);
    }
    this.elapsedMs = 0;
    this.view.visible = true;
    this.update(0);
  }

  update(deltaMs: number): void {
    if (this.elapsedMs < 0) return;
    this.elapsedMs += Math.max(0, deltaMs);
    const t = this.elapsedMs;
    if (t < TOAST_IN_MS) {
      this.view.scale.set(0.6 + 0.4 * easeOutBack(t / TOAST_IN_MS));
      this.view.alpha = t / TOAST_IN_MS;
    } else if (t < TOAST_IN_MS + TOAST_HOLD_MS) {
      this.view.scale.set(1);
      this.view.alpha = 1;
    } else if (t < TOAST_IN_MS + TOAST_HOLD_MS + TOAST_OUT_MS) {
      this.view.alpha = 1 - (t - TOAST_IN_MS - TOAST_HOLD_MS) / TOAST_OUT_MS;
    } else {
      this.view.visible = false;
      this.elapsedMs = -1;
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
