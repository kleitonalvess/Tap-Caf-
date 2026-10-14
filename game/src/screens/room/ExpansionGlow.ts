import { Container, Graphics } from 'pixi.js';

import { tileDiamond } from './iso-art';

const DURATION_MS = 2600;
const SPARKLES = 26;

interface Sparkle { g: Graphics; x: number; y: number; delay: number }

/** Tiles a café gained when it grew from oldTiles to newTiles (square rooms, walls on tx=0 and ty=0). */
export function newFloorTiles(oldTilesX: number, oldTilesY: number, tilesX: number, tilesY: number): { tx: number; ty: number }[] {
  const tiles: { tx: number; ty: number }[] = [];
  for (let ty = 1; ty < tilesY; ty++) {
    for (let tx = 1; tx < tilesX; tx++) if (tx >= oldTilesX || ty >= oldTilesY) tiles.push({ tx, ty });
  }
  return tiles;
}

/** Celebration over the new floor: the tiles light up in purple and sparkle, then fade. */
export class ExpansionGlow {
  readonly view = new Container();
  private readonly glow = new Graphics();
  private readonly sparkles: Sparkle[] = [];
  private elapsedMs = 0;

  constructor(tiles: readonly { tx: number; ty: number }[], zIndex: number) {
    this.view.label = 'expansion-glow';
    this.view.eventMode = 'none';
    this.view.zIndex = zIndex;
    for (const { tx, ty } of tiles) {
      const corners = tileDiamond(tx, ty);
      this.glow.poly(corners.flatMap(({ x, y }) => [x, y])).fill({ color: 0xb48cff, alpha: 0.55 }).stroke({ color: 0xffffff, width: 3, alpha: 0.8 });
    }
    this.view.addChild(this.glow);
    for (let i = 0; i < SPARKLES && tiles.length; i++) {
      const tile = tiles[Math.floor((i * 7919) % tiles.length)]!;
      const [top, right, bottom, left] = tileDiamond(tile.tx, tile.ty);
      const g = new Graphics()
        .star(0, 0, 4, 16, 5).fill(0xfff6c2).stroke({ color: 0xffd23f, width: 2 });
      g.alpha = 0;
      const x = (top!.x + bottom!.x + left!.x + right!.x) / 4;
      const y = (top!.y + bottom!.y) / 2;
      this.sparkles.push({ g, x, y, delay: (i / SPARKLES) * 1200 });
      this.view.addChild(g);
    }
  }

  get done(): boolean { return this.elapsedMs >= DURATION_MS; }

  update(deltaMs: number): void {
    this.elapsedMs += Math.max(0, deltaMs);
    const t = Math.min(1, this.elapsedMs / DURATION_MS);
    this.glow.alpha = (1 - t) * (0.75 + 0.25 * Math.sin(this.elapsedMs / 110));
    for (const sparkle of this.sparkles) {
      const local = (this.elapsedMs - sparkle.delay) / 900;
      sparkle.g.alpha = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
      sparkle.g.scale.set(0.5 + local);
      sparkle.g.rotation = local * 2;
      sparkle.g.position.set(sparkle.x, sparkle.y - 50 * Math.max(0, local));
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
