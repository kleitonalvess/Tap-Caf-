import { Container, Graphics, Rectangle, Sprite, Text, TextStyle } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import type { LevelUnlocks, RecipeRule } from '../../game/game-rules';
import type { RecipeArtLibrary } from '../../game/recipe-art';

export interface LevelUpModalOptions {
  art: RecipeArtLibrary;
  audio?: SoundPlayer;
  /** Contextual shortcuts: the recipe book and the staff window. */
  onRecipes?: () => void;
  onStaff?: () => void;
}

export interface LevelUpContent {
  level: number;
  rewardCoins: number;
  unlocks: LevelUnlocks;
  next: { recipeLevel?: number; recipes: RecipeRule[]; slotLevel?: number };
}

const PANEL_WIDTH = 1120;
const PANEL_HEIGHT = 780;
const CARD = { w: 220, h: 250, gap: 22 };
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;
const MAX_CARDS = 4;
const POP_MS = 420;

/** Level-up celebration: reward, what just opened and the next goals. */
export class LevelUpModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly content = new Container();
  private readonly rays = new Graphics();
  private readonly texts: Text[] = [];
  private resolution = 1;
  private elapsedMs = 0;
  private disposed = false;

  constructor(private readonly options: LevelUpModalOptions) {
    this.view.label = 'level-up-modal';
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.6 });
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });

    this.panel.label = 'level-up-panel';
    this.panel.pivot.set(PANEL_WIDTH / 2, PANEL_HEIGHT / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, PANEL_HEIGHT - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xfff8ea);
    frame.eventMode = 'none';
    this.rays.position.set(PANEL_WIDTH / 2, 130);
    this.rays.eventMode = 'none';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.rays.moveTo(0, 0).lineTo(Math.cos(a - 0.09) * 230, Math.sin(a - 0.09) * 230)
        .lineTo(Math.cos(a + 0.09) * 230, Math.sin(a + 0.09) * 230).closePath()
        .fill({ color: i % 2 ? 0xffd96a : 0xffeeb0, alpha: 0.55 });
    }
    const mask = new Graphics().roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xffffff);
    this.rays.mask = mask;
    this.panel.addChild(frame, mask, this.rays, this.content);
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.view.visible; }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = this.resolution;
  }

  show(content: LevelUpContent): void {
    if (this.disposed) return;
    this.render(content);
    this.elapsedMs = 0;
    this.view.visible = true;
    this.update(0);
  }

  close(): void {
    this.view.visible = false;
  }

  update(deltaMs: number): void {
    if (!this.view.visible) return;
    this.elapsedMs += Math.max(0, deltaMs);
    const t = Math.min(1, this.elapsedMs / POP_MS);
    // Back-out pop: slight overshoot, then settle.
    const s = 1.70158;
    const eased = 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    this.panel.scale.set(0.6 + 0.4 * eased);
    this.rays.rotation = this.elapsedMs / 4000;
  }

  private text(value: string, x: number, y: number, size: number, color = DARK_BROWN, weight: '400' | '600' | '700' = '700'): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill: color,
      ...(size >= 60 ? { stroke: { color: 0xffffff, width: 8 } } : {}),
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.texts.push(text);
    return text;
  }

  private button(caption: string, x: number, width: number, color: number, label: string, onTap: () => void): Container {
    const button = new Container();
    button.label = label;
    button.position.set(x, PANEL_HEIGHT - 112);
    button.addChild(new Graphics().roundRect(0, 0, width, 64, 18).fill(color).stroke({ color: 0x3d2a14, width: 3 }));
    const text = this.text(caption, width / 2, 32, 30, 0xffffff);
    if (text.width > width - 20) text.scale.set((width - 20) / text.width);
    button.addChild(text);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerover', () => { button.scale.set(1.05); });
    button.on('pointerout', () => { button.scale.set(1); });
    button.on('pointertap', (event) => { event.stopPropagation(); this.options.audio?.play('click'); onTap(); });
    return button;
  }

  private recipeCard(recipe: RecipeRule): Container {
    const card = new Container();
    card.label = `level-up-recipe-${recipe.id}`;
    card.addChild(new Graphics().roundRect(0, 0, CARD.w, CARD.h, 20).fill(0xffffff).stroke({ color: 0xe0a33a, width: 4 }));
    const dish = new Sprite(this.options.art.get(recipe.id).stage2);
    dish.anchor.set(0.5);
    dish.width = 130;
    dish.height = 130;
    dish.position.set(CARD.w / 2, 92);
    const name = this.text(recipe.name, CARD.w / 2, 178, 28);
    if (name.width > CARD.w - 20) name.scale.set((CARD.w - 20) / name.width);
    card.addChild(dish, name, this.text('Nova receita', CARD.w / 2, 216, 22, 0xd2541b, '600'));
    return card;
  }

  private slotCard(slots: number): Container {
    const card = new Container();
    card.label = 'level-up-staff-slot';
    card.addChild(new Graphics().roundRect(0, 0, CARD.w, CARD.h, 20).fill(0xffffff).stroke({ color: 0x2f80c8, width: 4 }));
    const tray = new Graphics()
      .ellipse(CARD.w / 2, 112, 62, 16).fill(0xd9d6e6).stroke({ color: 0x5a5a6a, width: 3 })
      .moveTo(CARD.w / 2 - 44, 108).quadraticCurveTo(CARD.w / 2, 30, CARD.w / 2 + 44, 108).closePath()
      .fill(0xf1f1f1).stroke({ color: 0x5a5a6a, width: 3 })
      .circle(CARD.w / 2, 58, 7).fill(0x5a5a6a);
    card.addChild(tray, this.text('Nova vaga de', CARD.w / 2, 166, 26), this.text('funcionário', CARD.w / 2, 196, 26),
      this.text(`Agora: ${slots} ${slots === 1 ? 'vaga' : 'vagas'}`, CARD.w / 2, 228, 20, 0x2f80c8, '600'));
    return card;
  }

  private render(content: LevelUpContent): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
    this.content.addChild(this.text(`Nível ${content.level}!`, PANEL_WIDTH / 2, 118, 96, 0xd2541b));
    this.content.addChild(this.text('Seu café subiu de nível', PANEL_WIDTH / 2, 200, 32, DARK_BROWN, '600'));
    if (content.rewardCoins > 0) {
      const chip = new Container();
      chip.position.set(PANEL_WIDTH / 2, 252);
      const label = this.text(`+${content.rewardCoins} moedas`, 18, 0, 32, 0x8a5a00);
      const width = label.width + 90;
      chip.addChild(new Graphics().roundRect(-width / 2, -28, width, 56, 28).fill(0xfff1b8).stroke({ color: 0xe0a33a, width: 3 }),
        new Graphics().circle(-width / 2 + 34, 0, 17).fill(0xf5c518).stroke({ color: 0xa8740c, width: 3 }), label);
      this.content.addChild(chip);
    }

    const cards: Container[] = content.unlocks.recipes.map((recipe) => this.recipeCard(recipe));
    if (content.unlocks.slotsAfter > content.unlocks.slotsBefore) cards.push(this.slotCard(content.unlocks.slotsAfter));
    if (cards.length > 0) {
      this.content.addChild(this.text('Desbloqueado agora', PANEL_WIDTH / 2, 318, 30, DARK_BROWN));
      const shown = cards.slice(0, MAX_CARDS);
      const start = (PANEL_WIDTH - (shown.length * CARD.w + (shown.length - 1) * CARD.gap)) / 2;
      shown.forEach((card, index) => { card.position.set(start + index * (CARD.w + CARD.gap), 346); this.content.addChild(card); });
      for (const card of cards.slice(MAX_CARDS)) card.destroy({ children: true });
      if (cards.length > MAX_CARDS) this.content.addChild(this.text(`e mais ${cards.length - MAX_CARDS}`, PANEL_WIDTH / 2, 614, 24, 0x8a5a2b, '600'));
    } else {
      this.content.addChild(this.text('Nada novo neste nível, mas continue!', PANEL_WIDTH / 2, 380, 30, 0x8a5a2b, '600'));
    }

    const goals: string[] = [];
    if (content.next.recipeLevel !== undefined && content.next.recipes.length) {
      goals.push(`${content.next.recipes.map((recipe) => recipe.name).join(', ')} no nível ${content.next.recipeLevel}`);
    }
    if (content.next.slotLevel !== undefined) goals.push(`nova vaga no nível ${content.next.slotLevel}`);
    if (goals.length) this.content.addChild(this.text(`Próximo: ${goals.join(' · ')}`, PANEL_WIDTH / 2, cards.length ? 636 : 460, 24, 0x8a5a2b, '600'));

    const buttons: Array<[string, number, string, () => void]> = [];
    if (content.unlocks.recipes.length && this.options.onRecipes) {
      buttons.push(['Ver receitas', 0xd2891b, 'level-up-recipes', () => { this.close(); this.options.onRecipes?.(); }]);
    }
    if (content.unlocks.slotsAfter > content.unlocks.slotsBefore && this.options.onStaff) {
      buttons.push(['Contratar', 0x2f80c8, 'level-up-staff', () => { this.close(); this.options.onStaff?.(); }]);
    }
    buttons.push(['Continuar', 0x3f9a4a, 'level-up-continue', () => this.close()]);
    const width = 260;
    const start = (PANEL_WIDTH - (buttons.length * width + (buttons.length - 1) * 24)) / 2;
    buttons.forEach(([caption, color, label, onTap], index) => this.content.addChild(this.button(caption, start + index * (width + 24), width, color, label, onTap)));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if ((event.key === 'Escape' || event.key === 'Enter') && this.isOpen) {
      event.stopPropagation();
      this.close();
    }
  };

  destroy(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown, true);
    this.view.destroy({ children: true });
  }
}
