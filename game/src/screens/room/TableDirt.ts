import { Container, Graphics, Polygon, Sprite, Texture } from 'pixi.js';

/** Plates a customer left on a table: crumbs, a smear and the cutlery. */
function dirtyPlateTexture(): Texture {
  const element = document.createElement('canvas');
  element.width = 96;
  element.height = 64;
  const g = element.getContext('2d');
  if (!g) throw new Error('Canvas 2D indisponível.');
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke?: string): void => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 2;
      g.stroke();
    }
  };
  ellipse(48, 38, 42, 21, 'rgba(0,0,0,0.18)');
  ellipse(48, 34, 42, 21, '#f7f4ee', '#9c8f7e');
  ellipse(48, 34, 28, 13, '#ebe5da');
  // Sauce smear and crumbs.
  g.fillStyle = 'rgba(150,72,32,0.75)';
  g.beginPath();
  g.ellipse(42, 33, 13, 5, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(190,120,50,0.9)';
  for (const [x, y] of [[58, 30], [62, 37], [36, 40], [52, 41], [30, 30]]) {
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  // Fork and knife left across the plate.
  g.strokeStyle = '#8e939b';
  g.lineCap = 'round';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(22, 20);
  g.lineTo(60, 44);
  g.moveTo(40, 16);
  g.lineTo(74, 38);
  g.stroke();
  return Texture.from(element);
}

let plateTexture: Texture | undefined;
let plateUsers = 0;

const PLATE_SPOTS: readonly [number, number][] = [[-20, 2], [22, -8], [4, 16]];
/** Flies show up once a table has waited this long for cleaning. */
const FLIES_AFTER_MS = 20_000;
const VANISH_MS = 650;

/**
 * Dirty plates on one table. The whole table top is the hit area, so the owner
 * can tap the table to clear it; the view fades out with a sparkle when cleared.
 */
export class TableDirt {
  readonly view = new Container();
  private readonly plates: Sprite[] = [];
  private readonly flies = new Graphics();
  private readonly sparkle = new Graphics();
  private vanishMs = -1;

  constructor() {
    this.view.label = 'table-dirt';
    plateTexture ??= dirtyPlateTexture();
    plateUsers++;
    for (const [x, y] of PLATE_SPOTS) {
      const plate = new Sprite(plateTexture);
      plate.anchor.set(0.5, 0.6);
      plate.position.set(x, y);
      plate.scale.set(0.72);
      plate.visible = false;
      this.plates.push(plate);
      this.view.addChild(plate);
    }
    this.view.addChild(this.flies, this.sparkle);
    // Table top and legs, relative to the plates (about 70 px above the floor tile).
    this.view.hitArea = new Polygon([-84, 0, 0, -44, 84, 0, 84, 72, 0, 112, -84, 72]);
  }

  get vanishing(): boolean {
    return this.vanishMs >= 0;
  }

  setPlates(count: number): void {
    this.plates.forEach((plate, index) => { plate.visible = index < Math.min(count, this.plates.length); });
  }

  /** Starts the cleared animation; update() returns true when it ends. */
  vanish(): void {
    if (this.vanishMs < 0) this.vanishMs = 0;
    this.view.eventMode = 'none';
  }

  update(deltaMs: number, dirtyForMs: number, serverNowMs: number): boolean {
    this.flies.clear();
    if (this.vanishMs >= 0) {
      this.vanishMs += deltaMs;
      const t = Math.min(1, this.vanishMs / VANISH_MS);
      for (const plate of this.plates) plate.alpha = 1 - t;
      this.sparkle.clear();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + t;
        const r = 18 + 46 * t;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * 0.55 - 10 - 20 * t;
        const s = 7 * (1 - t) + 2;
        this.sparkle.moveTo(x, y - s).lineTo(x + s * 0.3, y - s * 0.3).lineTo(x + s, y).lineTo(x + s * 0.3, y + s * 0.3)
          .lineTo(x, y + s).lineTo(x - s * 0.3, y + s * 0.3).lineTo(x - s, y).lineTo(x - s * 0.3, y - s * 0.3).closePath()
          .fill({ color: 0xfff4b8, alpha: 1 - t * 0.8 });
      }
      return t >= 1;
    }
    if (dirtyForMs >= FLIES_AFTER_MS) {
      for (let i = 0; i < 2; i++) {
        const angle = serverNowMs / (260 + i * 90) + i * Math.PI;
        const x = Math.cos(angle) * 26;
        const y = -34 + Math.sin(angle * 1.7) * 9;
        this.flies.circle(x, y, 3).fill(0x1f1f1f)
          .ellipse(x - 3, y - 3, 3, 1.6).fill({ color: 0xffffff, alpha: 0.7 })
          .ellipse(x + 3, y - 3, 3, 1.6).fill({ color: 0xffffff, alpha: 0.7 });
      }
    }
    return false;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    plateUsers--;
    if (plateUsers === 0 && plateTexture) {
      plateTexture.destroy(true);
      plateTexture = undefined;
    }
  }
}
