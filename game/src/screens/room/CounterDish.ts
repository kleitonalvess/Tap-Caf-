import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

/** The dish on a serving counter and how many servings remain. */
export class CounterDish {
  readonly view = new Container();
  private readonly dish: Sprite;
  private readonly badge = new Container();
  private readonly count: Text;

  constructor(texture: Texture) {
    this.view.label = 'counter-dish';
    this.view.eventMode = 'none';
    this.dish = new Sprite(texture);
    this.dish.anchor.set(0.5, 0.72);
    this.dish.width = 88;
    this.dish.height = 88;
    const circle = new Graphics().circle(0, 0, 22).fill(0x5a3915).circle(0, 0, 18).fill(0xfff3d6);
    this.count = new Text({
      text: '',
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 22, fontWeight: '700', fill: 0x5a3915, padding: 4 }),
    });
    this.count.anchor.set(0.5);
    this.badge.addChild(circle, this.count);
    this.badge.position.set(40, -46);
    this.view.addChild(this.dish, this.badge);
  }

  set(texture: Texture, servings: number): void {
    if (this.dish.texture !== texture) {
      this.dish.texture = texture;
      this.dish.width = 88;
      this.dish.height = 88;
    }
    this.count.text = `×${servings}`;
    this.count.scale.set(this.count.width > 34 ? 34 / this.count.width : 1);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
