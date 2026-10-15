import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/fonts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { formatDuration, recipeAvailability, recipeProfit, recipeTab, RECIPE_TABS, type CookingContext, type RecipeAvailability, type RecipeRule } from '../../game/game-rules';
import type { RecipeArtLibrary } from '../../game/recipe-art';

export interface CookScreenTextures {
  cookScreen: Texture;
  foodCard: Texture;
  closeButton?: Texture;
  cakeStage1?: Texture;
  cakeStage2?: Texture;
  progressBack?: Texture;
  progressFront?: Texture;
  progressCallout?: Texture;
  calloutClock?: Texture;
}

export interface CookRecipeEvent {
  id: string;
  name: string;
  stage1: Texture;
  stage2: Texture;
}

/** Everything the book shows; refreshed by the room before each opening. */
export interface CookBook {
  recipes: readonly RecipeRule[];
  context: CookingContext;
  art: RecipeArtLibrary;
}

export interface CookScreenModalOptions {
  textures: CookScreenTextures;
  onClose?: () => void;
  onCookRecipe?: (recipe: CookRecipeEvent) => void;
  audio?: SoundPlayer;
}

type ModalState = 'closed' | 'opening' | 'open' | 'closing';

interface CardItem {
  container: Container;
  inner: Container;
  sprite: Sprite;
  currentScale: number;
  targetScale: number;
}

const OPEN_DURATION_MS = 260;
const CLOSE_DURATION_MS = 200;
const OVERLAY_MAX_ALPHA = 0.65;

// Layout measured on cook_screen.png (1672 × 941).
const PANEL = { x: 236, y: 236 };
const CARD = { w: 370, h: 185, padX: 22, padY: 15, gapX: 21, gapY: 21, radius: 14 };
const TABS = [260, 460, 660, 856].map((x) => new Rectangle(x, 118, 170, 52));
const DETAILS = { x: 1092, y: 216, w: 348, cx: 1266 };
const CARDS_PER_PAGE = 6;
/** Page arrows under the cards, centred on the two columns. */
const PAGER = { cx: PANEL.x + CARD.padX + CARD.w + CARD.gapX / 2, y: 878 };

const INK = 0x5a3915;
const GOOD = 0x2f7d32;
const BAD = 0xb3261e;

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

function text(value: string, size: number, fill: number, weight: '400' | '600' | '700' = '600', stroke?: number): Text {
  return new Text({
    text: value,
    style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill, padding: 4,
      ...(stroke !== undefined ? { stroke: { color: stroke, width: 4, join: 'round' as const } } : {}),
    }),
  });
}

function fitWidth(label: Text, width: number): Text {
  label.scale.set(1);
  if (label.width > width) label.scale.set(width / label.width);
  return label;
}

/** Small vector icons drawn around (0,0), about 24 px tall. */
function icon(kind: 'clock' | 'coin' | 'plate' | 'lock'): Graphics {
  const g = new Graphics();
  switch (kind) {
    case 'clock':
      g.circle(0, 0, 11).fill(0xffffff).stroke({ color: INK, width: 3 });
      g.moveTo(0, -6).lineTo(0, 0).lineTo(5, 3).stroke({ color: INK, width: 2.5, cap: 'round' });
      break;
    case 'coin':
      g.circle(0, 0, 11).fill(0xf5c518).stroke({ color: 0xa8740c, width: 3 });
      g.circle(0, 0, 5).stroke({ color: 0xa8740c, width: 2 });
      break;
    case 'plate':
      g.ellipse(0, 2, 13, 7).fill(0xffffff).stroke({ color: INK, width: 2.5 });
      g.ellipse(0, -3, 7, 5).fill(0xe2a24b);
      break;
    case 'lock':
      g.arc(0, -4, 9, Math.PI, 0).stroke({ color: 0xfff3dc, width: 8 }).arc(0, -4, 9, Math.PI, 0).stroke({ color: INK, width: 5 });
      g.roundRect(-14, -4, 28, 22, 4).fill(INK).stroke({ color: 0xfff3dc, width: 2 });
      break;
  }
  g.eventMode = 'none';
  return g;
}

/**
 * Recipe book opened from an empty stove: four tabs filter the catalogue
 * (all, quick, profitable, unlocked), six cards per page, and the right panel
 * details the selected recipe.
 */
export class CookScreenModal {
  readonly view = new Container();

  private readonly backdrop = new Graphics();
  private readonly window = new Container();
  private readonly cardsLayer = new Container();
  private readonly tabsLayer = new Container();
  private readonly details = new Container();
  private readonly closeButton = new Container();
  private cardItems: CardItem[] = [];

  private state: ModalState = 'closed';
  private animTimer = 0;
  private readonly onCloseCallback?: () => void;
  private readonly onCookRecipe?: (recipe: CookRecipeEvent) => void;
  private readonly audio?: SoundPlayer;
  private readonly cardTexture: Texture;
  private book?: CookBook;
  private tab = 0;
  private page = 0;
  private selectedId?: string;
  /** Recipe the player tapped since the book opened; a preselected card never cooks on one tap. */
  private tappedId?: string;

  constructor(options: CookScreenModalOptions) {
    this.onCloseCallback = options.onClose;
    this.onCookRecipe = options.onCookRecipe;
    this.audio = options.audio;
    this.cardTexture = options.textures.foodCard;
    this.view.label = 'cook-screen-modal';
    this.view.visible = false;

    this.backdrop.label = 'cook-modal-backdrop';
    this.backdrop.rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 1 });
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'static';
    this.backdrop.cursor = 'pointer';
    this.backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    this.backdrop.on('pointertap', () => this.close());
    this.view.addChild(this.backdrop);

    this.window.label = 'cook-modal-window';
    this.window.sortableChildren = true;
    this.window.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.window.pivot.set(836, 470.5);
    // The window swallows taps so only the backdrop closes the book.
    this.window.eventMode = 'static';
    this.window.on('pointertap', (event) => event.stopPropagation());

    const bg = new Sprite(options.textures.cookScreen);
    bg.label = 'cook-modal-bg';
    bg.zIndex = 0;
    this.window.addChild(bg);
    this.cardsLayer.zIndex = 1;
    this.cardsLayer.sortableChildren = true;
    this.tabsLayer.zIndex = 2;
    this.details.zIndex = 2;
    this.details.label = 'cook-details';
    this.window.addChild(this.cardsLayer, this.tabsLayer, this.details);

    this.setupCloseButton(options.textures.closeButton);
    this.window.addChild(this.closeButton);
    this.view.addChild(this.window);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  get isOpen(): boolean {
    return this.state !== 'closed';
  }

  /** Replaces the recipes and the player's situation; keeps the tab and page when possible. */
  setBook(book: CookBook): void {
    this.book = book;
    const pages = this.pages();
    this.page = Math.min(this.page, Math.max(0, pages.length - 1));
    if (!this.selectedId || !book.recipes.some((recipe) => recipe.id === this.selectedId)) {
      const firstUseful = pages[this.page]?.find((recipe) => recipeAvailability(recipe, book.context) !== 'locked');
      this.selectedId = (firstUseful ?? book.recipes[0])?.id;
    }
    this.render();
  }

  /** The open tab's recipes, six per page. */
  private pages(): RecipeRule[][] {
    const book = this.book;
    if (!book) return [];
    const list = recipeTab(book.recipes, RECIPE_TABS[this.tab]!.id, book.context.level);
    const pages: RecipeRule[][] = [];
    for (let i = 0; i < list.length; i += CARDS_PER_PAGE) pages.push(list.slice(i, i + CARDS_PER_PAGE));
    return pages.length ? pages : [[]];
  }

  /** After a tab or page change: select the first recipe there that can be cooked. */
  private selectOnPage(): void {
    const book = this.book!;
    const recipes = this.pages()[this.page] ?? [];
    const first = recipes.find((recipe) => recipeAvailability(recipe, book.context) !== 'locked') ?? recipes[0];
    if (first) this.selectedId = first.id;
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening') return;
    this.audio?.play('bookPage');
    this.tappedId = undefined;
    this.state = 'opening';
    this.animTimer = 0;
    this.view.visible = true;
    this.backdrop.alpha = 0;
    this.window.alpha = 0;
    this.window.scale.set(0.7);
  }

  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';
    this.animTimer = 0;
    this.onCloseCallback?.();
  }

  private render(): void {
    const book = this.book;
    if (!book) return;
    const pages = this.pages();
    this.renderTabs(RECIPE_TABS.map((tab) => tab.label));
    this.renderCards(pages[this.page] ?? [], book);
    this.renderPager(pages.length);
    this.renderDetails(book);
  }

  private renderPager(pages: number): void {
    if (pages <= 1 && (this.pages()[0]?.length ?? 0) > 0) return;
    if (pages <= 1) {
      // An empty tab says why instead of showing a blank page.
      const empty = text(this.tab === 1 ? 'Nenhuma receita rápida no cardápio.' : 'Nenhuma receita desbloqueada ainda.', 24, INK, '600');
      empty.anchor.set(0.5);
      empty.position.set(PAGER.cx, 520);
      empty.eventMode = 'none';
      this.cardsLayer.addChild(empty);
      return;
    }
    const caption = text(`${this.page + 1}/${pages}`, 24, INK, '700');
    caption.anchor.set(0.5);
    caption.position.set(PAGER.cx, PAGER.y);
    caption.eventMode = 'none';
    this.cardsLayer.addChild(caption);
    for (const [direction, glyph] of [[-1, '‹'], [1, '›']] as const) {
      const target = this.page + direction;
      const arrow = new Container();
      arrow.label = direction < 0 ? 'cook-page-previous' : 'cook-page-next';
      arrow.position.set(PAGER.cx + direction * 90, PAGER.y);
      const enabled = target >= 0 && target < pages;
      arrow.addChild(new Graphics().circle(0, 0, 24).fill({ color: enabled ? 0xfff3d6 : 0xffffff, alpha: enabled ? 1 : 0.4 }).stroke({ color: INK, width: 3 }));
      const label = text(glyph, 34, INK, '700');
      label.anchor.set(0.5, 0.56);
      arrow.addChild(label);
      if (enabled) {
        arrow.eventMode = 'static';
        arrow.cursor = 'pointer';
        arrow.hitArea = new Rectangle(-30, -30, 60, 60);
        arrow.on('pointertap', (event) => {
          event.stopPropagation();
          this.page = target;
          this.audio?.play('bookPage');
          this.selectOnPage();
          this.render();
        });
      }
      this.cardsLayer.addChild(arrow);
    }
  }

  private renderTabs(labels: readonly string[]): void {
    this.tabsLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    labels.forEach((caption, index) => {
      const area = TABS[index];
      const tab = new Container();
      tab.label = `cook-tab-${index + 1}`;
      tab.position.set(area.x, area.y);
      tab.eventMode = 'static';
      tab.cursor = 'pointer';
      tab.hitArea = new Rectangle(0, 0, area.width, area.height);
      const selected = index === this.tab;
      const face = new Graphics().roundRect(4, 4, area.width - 8, area.height - 8, 14)
        .fill({ color: selected ? 0xfff3d6 : 0xffffff, alpha: selected ? 0.95 : 0.25 });
      if (selected) face.roundRect(4, 4, area.width - 8, area.height - 8, 14).stroke({ color: INK, width: 3 });
      face.eventMode = 'none';
      const label = fitWidth(text(caption, 22, INK, selected ? '700' : '600'), area.width - 20);
      label.anchor.set(0.5);
      label.position.set(area.width / 2, area.height / 2);
      label.eventMode = 'none';
      tab.addChild(face, label);
      tab.on('pointertap', (event) => {
        event.stopPropagation();
        if (this.tab === index) return;
        this.tab = index;
        this.page = 0;
        this.audio?.play('bookPage');
        this.selectOnPage();
        this.render();
      });
      this.tabsLayer.addChild(tab);
    });
  }

  private renderCards(recipes: readonly RecipeRule[], book: CookBook): void {
    this.cardsLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.cardItems = [];
    recipes.forEach((recipe, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const availability = recipeAvailability(recipe, book.context);
      const card = new Container();
      card.label = `cook-card-${recipe.id}`;
      card.position.set(PANEL.x + CARD.padX + col * (CARD.w + CARD.gapX), PANEL.y + CARD.padY + row * (CARD.h + CARD.gapY));
      card.eventMode = 'static';
      card.cursor = 'pointer';
      card.hitArea = new Rectangle(0, 0, CARD.w, CARD.h);
      card.zIndex = 1;

      const inner = new Container();
      inner.position.set(CARD.w / 2, CARD.h / 2);
      inner.pivot.set(CARD.w / 2, CARD.h / 2);
      const sprite = new Sprite(this.cardTexture);
      sprite.width = CARD.w;
      sprite.height = CARD.h;
      const mask = new Graphics().roundRect(0, 0, CARD.w, CARD.h, CARD.radius).fill(0xffffff);
      inner.mask = mask;
      inner.addChild(mask, sprite);

      const title = fitWidth(text(recipe.name, 20, 0xfffcf5, '600', INK), CARD.w - 120);
      title.anchor.set(0.5);
      title.position.set(CARD.w / 2, 23);
      const dish = new Sprite(book.art.get(recipe.id).stage2);
      dish.anchor.set(0.5);
      dish.width = 110;
      dish.height = 110;
      dish.position.set(75, 114);
      inner.addChild(title, dish);

      // A locked card shows only its time; the lock and level take the other rows.
      const rows: Array<[Graphics, Text]> = availability === 'locked'
        ? [[icon('clock'), text(formatDuration(recipe.cookSeconds), 22, INK)]]
        : [
            [icon('clock'), text(formatDuration(recipe.cookSeconds), 22, INK)],
            [icon('coin'), availability === 'free' ? text('Grátis', 22, GOOD, '700')
              : text(String(recipe.costCoins), 22, availability === 'unaffordable' ? BAD : INK)],
            [icon('plate'), text(`${recipe.servings} porções`, 22, INK)],
          ];
      rows.forEach(([glyph, value], line) => {
        const y = 72 + line * 36;
        glyph.position.set(160, y);
        value.anchor.set(0, 0.5);
        value.position.set(180, y);
        fitWidth(value, CARD.w - 196);
        inner.addChild(glyph, value);
      });

      if (availability === 'free') {
        const ribbon = new Graphics().roundRect(CARD.w - 112, 46, 104, 30, 8).fill(GOOD);
        const ribbonText = text('GRÁTIS', 18, 0xffffff, '700');
        ribbonText.anchor.set(0.5);
        ribbonText.position.set(CARD.w - 60, 61);
        inner.addChild(ribbon, ribbonText);
      }
      if (availability === 'locked') {
        dish.tint = 0x777777;
        const shade = new Graphics().roundRect(0, 0, CARD.w, CARD.h, CARD.radius).fill({ color: 0x2b1a0c, alpha: 0.45 });
        const lock = icon('lock');
        lock.position.set(160, 126);
        const level = fitWidth(text(`Nível ${recipe.level}`, 24, 0xffffff, '700', INK), CARD.w - 196);
        level.anchor.set(0, 0.5);
        level.position.set(180, 126);
        inner.addChild(shade, lock, level);
      }
      if (recipe.id === this.selectedId) {
        inner.addChild(new Graphics().roundRect(2, 2, CARD.w - 4, CARD.h - 4, CARD.radius).stroke({ color: 0xff8f1f, width: 5 }));
      }

      card.addChild(inner);
      const item: CardItem = { container: card, inner, sprite, currentScale: 1, targetScale: 1 };
      card.on('pointerover', () => { item.targetScale = 1.04; sprite.tint = 0xfff5ea; card.zIndex = 10; });
      card.on('pointerout', () => { item.targetScale = 1; sprite.tint = 0xffffff; card.zIndex = 1; });
      card.on('pointertap', (event) => {
        event.stopPropagation();
        // A second tap on the selected recipe cooks it, like the original single click.
        if (this.tappedId === recipe.id) { this.cook(recipe); return; }
        this.selectedId = recipe.id;
        this.tappedId = recipe.id;
        this.audio?.play('click');
        this.render();
      });
      this.cardItems.push(item);
      this.cardsLayer.addChild(card);
    });
  }

  private renderDetails(book: CookBook): void {
    this.details.removeChildren().forEach((child) => child.destroy({ children: true }));
    const recipe = book.recipes.find((candidate) => candidate.id === this.selectedId);
    if (!recipe) return;
    const availability = recipeAvailability(recipe, book.context);
    const name = fitWidth(text(recipe.name, 34, INK, '700'), DETAILS.w - 40);
    name.anchor.set(0.5);
    name.position.set(DETAILS.cx, 268);
    const dish = new Sprite(book.art.get(recipe.id).stage2);
    dish.anchor.set(0.5);
    dish.width = 170;
    dish.height = 170;
    dish.position.set(DETAILS.cx, 385);
    if (availability === 'locked') dish.tint = 0x888888;
    this.details.addChild(name, dish);

    const rows: Array<[string, string]> = [
      ['Preparo', formatDuration(recipe.cookSeconds)],
      ['Custo', availability === 'free' ? 'Grátis' : `${recipe.costCoins} moedas`],
      ['Rende', `${recipe.servings} porções`],
      ['Venda', `${recipe.pricePerServing} por porção`],
      ['Experiência', `${recipe.xpPerServing} por porção`],
      ['Estraga após', formatDuration(recipe.spoilSeconds)],
      ['Lucro por lote', `${recipeProfit(recipe)} moedas`],
    ];
    rows.forEach(([label, value], index) => {
      const y = 488 + index * 37;
      const left = text(label, 22, INK, '400');
      left.anchor.set(0, 0.5);
      left.position.set(DETAILS.x + 22, y);
      const right = fitWidth(text(value, 22, INK, '600'), 190);
      right.anchor.set(1, 0.5);
      right.position.set(DETAILS.x + DETAILS.w - 22, y);
      this.details.addChild(left, right);
    });

    const statuses: Record<RecipeAvailability, [string, number]> = {
      locked: [`Bloqueada até o nível ${recipe.level}`, BAD],
      free: ['Grátis (Ajuda de Emergência)', GOOD],
      unaffordable: ['Moedas insuficientes', BAD],
      available: ['Temperar no fogo rende mais porções', INK],
    };
    const fresh = (availability === 'available' || availability === 'free') && (book.context.freshPercent ?? 0) > 0;
    const [status, color] = fresh ? [`Ingredientes frescos: +${book.context.freshPercent}% de moedas e XP`, GOOD] as [string, number] : statuses[availability];
    const quiet = availability === 'available' && !fresh;
    const statusText = fitWidth(text(status, quiet ? 18 : 21, color, quiet ? '400' : '700'), DETAILS.w - 30);
    statusText.anchor.set(0.5);
    statusText.position.set(DETAILS.cx, 752);
    this.details.addChild(statusText);

    const enabled = availability === 'available' || availability === 'free';
    const button = new Container();
    button.label = 'cook-button';
    button.position.set(DETAILS.cx, 822);
    button.pivot.set(140, 32);
    button.eventMode = enabled ? 'static' : 'none';
    button.cursor = enabled ? 'pointer' : 'default';
    const face = new Graphics()
      .roundRect(0, 0, 280, 64, 18).fill(enabled ? 0x2f7d32 : 0x9e9e9e)
      .roundRect(4, 4, 272, 52, 14).fill(enabled ? 0x4caf50 : 0xbdbdbd);
    const caption = text('Cozinhar', 30, 0xffffff, '700', enabled ? 0x1b5e20 : 0x616161);
    caption.anchor.set(0.5);
    caption.position.set(140, 30);
    button.addChild(face, caption);
    button.on('pointerover', () => button.scale.set(1.04));
    button.on('pointerout', () => button.scale.set(1));
    button.on('pointertap', (event) => { event.stopPropagation(); this.cook(recipe); });
    this.details.addChild(button);
  }

  private cook(recipe: RecipeRule): void {
    const book = this.book;
    if (!book) return;
    const availability = recipeAvailability(recipe, book.context);
    if (availability === 'locked' || availability === 'unaffordable') {
      this.audio?.play('buzzer', 0.6);
      return;
    }
    const art = book.art.get(recipe.id);
    this.close();
    this.onCookRecipe?.({ id: recipe.id, name: recipe.name, stage1: art.stage1, stage2: art.stage2 });
  }

  private setupCloseButton(closeButtonTexture?: Texture): void {
    this.closeButton.label = 'cook-close-button';
    // Metade do botão para fora da janela e metade para dentro na borda superior (y=27)
    this.closeButton.position.set(1448, 27);
    this.closeButton.zIndex = 20;
    this.closeButton.eventMode = 'static';
    this.closeButton.cursor = 'pointer';

    if (closeButtonTexture) {
      const sprite = new Sprite(closeButtonTexture);
      sprite.label = 'cook-close-sprite';
      sprite.anchor.set(0.5, 0.5);
      sprite.width = 50;
      sprite.height = 52;
      this.closeButton.addChild(sprite);
      this.closeButton.on('pointerover', () => { this.closeButton.scale.set(1.1); });
      this.closeButton.on('pointerout', () => { this.closeButton.scale.set(1.0); });
    } else {
      const bg = new Graphics();
      bg.circle(0, 0, 20).fill({ color: 0xcc3333 }).stroke({ color: 0xffffff, width: 3 });
      bg.moveTo(-7, -7).lineTo(7, 7).stroke({ color: 0xffffff, width: 3, cap: 'round' });
      bg.moveTo(7, -7).lineTo(-7, 7).stroke({ color: 0xffffff, width: 3, cap: 'round' });
      this.closeButton.addChild(bg);
      this.closeButton.on('pointerover', () => { this.closeButton.scale.set(1.12); });
      this.closeButton.on('pointerout', () => { this.closeButton.scale.set(1.0); });
    }

    this.closeButton.on('pointertap', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  };

  update(deltaMs: number): void {
    for (const item of this.cardItems) {
      if (Math.abs(item.currentScale - item.targetScale) > 0.0005) {
        const factor = 1 - Math.exp(-deltaMs / 70);
        item.currentScale += (item.targetScale - item.currentScale) * factor;
        item.inner.scale.set(item.currentScale);
      } else if (item.currentScale !== item.targetScale) {
        item.currentScale = item.targetScale;
        item.inner.scale.set(item.targetScale);
      }
    }

    if (this.state === 'closed') return;

    this.animTimer += deltaMs;

    if (this.state === 'opening') {
      const progress = Math.min(1, this.animTimer / OPEN_DURATION_MS);
      const scale = 0.7 + 0.3 * easeOutBack(progress);
      const alpha = easeOutCubic(progress);

      this.window.scale.set(scale);
      this.window.alpha = alpha;
      this.backdrop.alpha = OVERLAY_MAX_ALPHA * progress;

      if (progress >= 1) {
        this.state = 'open';
        this.window.scale.set(1);
        this.window.alpha = 1;
        this.backdrop.alpha = OVERLAY_MAX_ALPHA;
      }
    } else if (this.state === 'closing') {
      const progress = Math.min(1, this.animTimer / CLOSE_DURATION_MS);
      const scale = 1 - 0.25 * easeInCubic(progress);
      const alpha = Math.max(0, 1 - progress);

      this.window.scale.set(scale);
      this.window.alpha = alpha;
      this.backdrop.alpha = Math.max(0, OVERLAY_MAX_ALPHA * (1 - progress));

      if (progress >= 1) {
        this.state = 'closed';
        this.view.visible = false;
        this.window.scale.set(0.7);
        this.window.alpha = 0;
        this.backdrop.alpha = 0;
      }
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.view.destroy({ children: true });
  }
}
