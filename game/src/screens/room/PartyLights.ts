import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { tileToScreenX, tileToScreenY } from '../../world/iso';

const SPOT_COLORS = [0xff3fa4, 0x3fd8ff, 0xffe14a, 0x7dff6a, 0xff8a3f] as const;
const FADE_PER_SECOND = 1.5;

interface Spot { g: Graphics; phase: number; speedX: number; speedY: number }

/**
 * Party at the disco: coloured spots sweep across the café floor. The spots
 * are clipped to the floor diamond and blend additively over the wood, so the
 * furniture and customers keep their depth order above them.
 */
export class PartyLights {
  readonly view = new Container();
  private readonly mask = new Graphics();
  private readonly spots: Spot[] = [];
  private level = 0;
  private target = 0;
  private elapsed = 0;
  private center = { x: 0, y: 0 };
  private radius = { x: 400, y: 200 };

  constructor(zIndex: number) {
    this.view.label = 'party-lights';
    this.view.eventMode = 'none';
    this.view.zIndex = zIndex;
    this.view.visible = false;
    SPOT_COLORS.forEach((color, index) => {
      const g = new Graphics();
      // Soft edge: concentric ellipses add up towards the centre.
      for (let ring = 4; ring >= 1; ring--) g.ellipse(0, 0, 70 * ring, 35 * ring).fill({ color, alpha: 0.09 });
      g.blendMode = 'add';
      this.spots.push({ g, phase: index * 1.3, speedX: 0.45 + index * 0.11, speedY: 0.6 + index * 0.07 });
      this.view.addChild(g);
    });
    this.view.addChild(this.mask);
    this.view.mask = this.mask;
  }

  /** The floor diamond of a tilesX × tilesY café (walls on tx=0 and ty=0). */
  setRoom(tilesX: number, tilesY: number): void {
    const corners = [
      { x: tileToScreenX(1, 1), y: tileToScreenY(1, 1) },
      { x: tileToScreenX(tilesX, 1), y: tileToScreenY(tilesX, 1) },
      { x: tileToScreenX(tilesX, tilesY), y: tileToScreenY(tilesX, tilesY) },
      { x: tileToScreenX(1, tilesY), y: tileToScreenY(1, tilesY) },
    ];
    this.mask.clear().poly(corners.flatMap(({ x, y }) => [x, y])).fill(0xffffff);
    this.center = { x: (corners[1]!.x + corners[3]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2 };
    this.radius = { x: Math.abs(corners[1]!.x - corners[3]!.x) / 2.6, y: Math.abs(corners[2]!.y - corners[0]!.y) / 2.6 };
  }

  setActive(active: boolean): void { this.target = active ? 1 : 0; }

  get active(): boolean { return this.target === 1; }

  update(deltaMs: number): void {
    const seconds = Math.max(0, deltaMs) / 1000;
    this.elapsed += seconds;
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), seconds * FADE_PER_SECOND);
    this.view.visible = this.level > 0.01;
    if (!this.view.visible) return;
    this.view.alpha = this.level;
    for (const spot of this.spots) {
      const t = this.elapsed;
      spot.g.position.set(
        this.center.x + this.radius.x * Math.sin(t * spot.speedX + spot.phase),
        this.center.y + this.radius.y * Math.sin(t * spot.speedY + spot.phase * 1.7),
      );
      // A beat-like pulse at the party tempo (122 bpm ≈ 2 Hz).
      spot.g.scale.set(1 + 0.12 * Math.max(0, Math.sin(t * Math.PI * 2 * 2.03 + spot.phase)));
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/** HUD pill "Festa do Bairro · 3:42" shown while the party is on. */
export class PartyBadge {
  readonly view = new Container();
  private readonly label: Text;
  private readonly back = new Graphics();
  private elapsed = 0;

  constructor() {
    this.view.label = 'party-badge';
    this.view.eventMode = 'none';
    this.view.visible = false;
    this.label = new Text({
      text: '',
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 30, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x3b1f6b, width: 5 } }),
    });
    this.label.anchor.set(0.5);
    this.view.addChild(this.back, this.label);
  }

  show(text: string): void {
    this.view.visible = true;
    if (this.label.text !== text) {
      this.label.text = text;
      const width = this.label.width + 56;
      this.back.clear().roundRect(-width / 2, -30, width, 60, 30).fill(0x7b2fb8).stroke({ color: 0xffe14a, width: 4 });
    }
  }

  hide(): void { this.view.visible = false; }

  update(deltaMs: number): void {
    if (!this.view.visible) return;
    this.elapsed += Math.max(0, deltaMs) / 1000;
    this.view.scale.set(1 + 0.04 * Math.max(0, Math.sin(this.elapsed * Math.PI * 2 * 2.03)));
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
