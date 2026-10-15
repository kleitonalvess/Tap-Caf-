import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import {
  expansionOffer, sizeLabel,
  type ExpansionClient, type ExpansionOffer, type ExpansionPay, type ExpansionResult, type ExpansionWallet,
} from '../../game/expansion';
import type { ExpansionRules } from '../../game/game-rules';

export interface ExpansionModalOptions {
  rules: ExpansionRules;
  client: ExpansionClient;
  /** Current side of the café and the owner's wallet, read when the window renders. */
  tiles: () => number;
  wallet: () => ExpansionWallet;
  onExpanded: (result: ExpansionResult) => void;
  icons?: { coin?: Texture; cash?: Texture; xp?: Texture };
  audio?: SoundPlayer;
}

const PANEL_WIDTH = 1240;
const PANEL_HEIGHT = 820;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;
const PURPLE = 0x7b4fc9;
const COIN_COLOR = 0xd2891b;
const CASH_COLOR = 0x2e9e5b;
const CARD = { w: 330, h: 330, y: 200 };

const amount = (value: number): string => value.toLocaleString('pt-BR');

/** Expansão do Café: the next size, paid with coins (level required) or Grana (any level). */
export class ExpansionModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly content = new Container();
  private readonly texts: Text[] = [];
  private busy = false;
  private message = '';
  private messageError = false;
  private resolution = 1;
  private disposed = false;

  constructor(private readonly options: ExpansionModalOptions) {
    this.view.label = 'expansion-modal';
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.65 });
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    backdrop.on('pointertap', (event) => { event.stopPropagation(); if (!this.busy) this.close(); });

    this.panel.label = 'expansion-modal-panel';
    this.panel.position.set((STAGE_WIDTH - PANEL_WIDTH) / 2, (STAGE_HEIGHT - PANEL_HEIGHT) / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, PANEL_HEIGHT - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xfffaf0);
    frame.eventMode = 'none';
    this.panel.addChild(frame, this.content, this.closeButton());
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.view.visible; }

  open(): void {
    if (this.disposed || this.isOpen) return;
    this.view.visible = true;
    this.message = '';
    this.messageError = false;
    this.options.audio?.play('bookPage');
    this.render();
  }

  close(): void {
    this.view.visible = false;
  }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = this.resolution;
  }

  private async buy(pay: ExpansionPay, tiles: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message = 'Ampliando o café…';
    this.messageError = false;
    this.render();
    try {
      const result = await this.options.client.expand(tiles, pay);
      if (this.disposed) return;
      this.busy = false;
      this.close();
      this.options.onExpanded(result);
    } catch (error) {
      this.busy = false;
      this.message = error instanceof Error ? error.message : 'Não foi possível expandir o café.';
      this.messageError = true;
      this.options.audio?.play('buzzer', 0.6);
      if (!this.disposed) this.render();
    }
  }

  private text(value: string, x: number, y: number, size: number, color = DARK_BROWN, weight: '400' | '600' | '700' = '700'): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill: color,
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.texts.push(text);
    return text;
  }

  private icon(texture: Texture | undefined, fallback: number, x: number, y: number, size: number): Container {
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(size / Math.max(texture.width, texture.height));
      sprite.position.set(x, y);
      sprite.eventMode = 'none';
      return sprite;
    }
    const disc = new Graphics().circle(x, y, size / 2).fill(fallback).stroke({ color: 0x3d2a14, width: 3 });
    disc.eventMode = 'none';
    return disc;
  }

  private button(caption: string, x: number, y: number, width: number, color: number, enabled: boolean, label: string, onTap: () => void): Container {
    const button = new Container();
    button.label = label;
    button.position.set(x, y);
    button.addChild(new Graphics().roundRect(0, 0, width, 62, 18).fill(enabled ? color : 0xb9b2a8).stroke({ color: 0x3d2a14, width: 3 }));
    const text = this.text(caption, width / 2, 31, 26, 0xffffff);
    if (text.width > width - 20) text.scale.set((width - 20) / text.width);
    button.addChild(text);
    if (enabled) {
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.on('pointerover', () => { button.scale.set(1.04); });
      button.on('pointerout', () => { button.scale.set(1); });
      button.on('pointertap', (event) => { event.stopPropagation(); this.options.audio?.play('click'); onTap(); });
    }
    return button;
  }

  /** Floor plan: the current café (wood) inside the next size (purple, dashed edge). */
  private plan(offer: ExpansionOffer): Container {
    const plan = new Container();
    plan.label = 'expansion-plan';
    const cx = 250;
    const top = 210;
    const outer = offer.step?.tiles ?? offer.tiles;
    const unit = 220 / offer.maxTiles;
    const diamond = (g: Graphics, tiles: number) => {
      const half = tiles * unit;
      return g.moveTo(cx, top).lineTo(cx + half, top + half / 2).lineTo(cx, top + half).lineTo(cx - half, top + half / 2).closePath();
    };
    const art = new Graphics();
    diamond(art, offer.maxTiles).fill({ color: 0xece4d8 }).stroke({ color: 0xd8cdb9, width: 2 });
    if (offer.step) diamond(art, outer).fill(0xe6dafa).stroke({ color: PURPLE, width: 4 });
    diamond(art, offer.tiles).fill(0xc9a46b).stroke({ color: 0x8a5a2b, width: 4 });
    // Back walls stay put: the café grows towards the front.
    art.moveTo(cx, top).lineTo(cx - offer.maxTiles * unit, top + offer.maxTiles * unit / 2).moveTo(cx, top)
      .lineTo(cx + offer.maxTiles * unit, top + offer.maxTiles * unit / 2).stroke({ color: 0x8d6e63, width: 6, cap: 'round' });
    art.eventMode = 'none';
    plan.addChild(art);
    plan.addChild(this.text(`Atual: ${sizeLabel(offer.tiles)}`, cx, top + offer.tiles * unit / 2, 26, 0xffffff));
    if (offer.step) plan.addChild(this.text(`Próximo: ${sizeLabel(offer.step.tiles)}`, cx, top + outer * unit + 26, 28, PURPLE));
    return plan;
  }

  private payCard(x: number, pay: ExpansionPay, offer: ExpansionOffer): Container {
    const step = offer.step!;
    const card = new Container();
    card.label = `expansion-card-${pay}`;
    card.position.set(x, CARD.y);
    const coinsPay = pay === 'coins';
    const color = coinsPay ? COIN_COLOR : CASH_COLOR;
    const option = coinsPay ? offer.coins : offer.cash;
    card.addChild(new Graphics().roundRect(0, 0, CARD.w, CARD.h, 22).fill(0xffffff).stroke({ color, width: 4 }));
    card.addChild(this.text(coinsPay ? 'Com moedas' : 'Com Grana (atalho)', CARD.w / 2, 38, 28, color));
    // Icon and price share one centred row; the price never runs under the icon.
    const price = this.text(`${amount(coinsPay ? step.coins : step.cash)} ${coinsPay ? 'moedas' : 'Grana'}`, 0, 108, 34);
    price.anchor.set(0, 0.5);
    if (price.width > CARD.w - 130) price.scale.set((CARD.w - 130) / price.width);
    const rowStart = (CARD.w - (62 + 14 + price.width)) / 2;
    price.x = rowStart + 62 + 14;
    card.addChild(this.icon(coinsPay ? this.options.icons?.coin : this.options.icons?.cash, coinsPay ? 0xf5c518 : 0x52c27d, rowStart + 31, 108, 62), price);
    const wallet = this.options.wallet();
    let requirement: string;
    let requirementColor = 0x2e7d32;
    if (coinsPay) {
      requirement = wallet.level >= step.level ? `Nível ${step.level} alcançado ✓` : `Requer nível ${step.level} (você: ${wallet.level})`;
      if (wallet.level < step.level) requirementColor = 0xc0392b;
    } else {
      requirement = 'Sem exigência de nível';
    }
    card.addChild(this.text(requirement, CARD.w / 2, 176, 22, requirementColor, '600'));
    if (option.reason === 'funds') {
      const missing = coinsPay ? step.coins - wallet.gold : step.cash - wallet.cash;
      card.addChild(this.text(`Faltam ${amount(missing)} ${coinsPay ? 'moedas' : 'Grana'}`, CARD.w / 2, 210, 22, 0xc0392b, '600'));
    }
    card.addChild(this.button(coinsPay ? 'Expandir com moedas' : 'Expandir com Grana', 24, CARD.h - 86, CARD.w - 48, color,
      option.enabled && !this.busy, `expansion-buy-${pay}`, () => void this.buy(pay, step.tiles)));
    return card;
  }

  /** Every step in order: done, the next one and the rest with their level. */
  private steps(offer: ExpansionOffer): Container {
    const row = new Container();
    row.label = 'expansion-steps';
    const sizes = [this.options.rules.startTiles, ...this.options.rules.steps.map((step) => step.tiles)];
    const width = 140;
    const gap = 16;
    const start = (PANEL_WIDTH - (sizes.length * width + (sizes.length - 1) * gap)) / 2;
    sizes.forEach((tiles, index) => {
      const step = this.options.rules.steps.find((entry) => entry.tiles === tiles);
      const done = tiles <= offer.tiles;
      const next = tiles === offer.step?.tiles;
      const chip = new Container();
      chip.label = `expansion-step-${tiles}`;
      chip.position.set(start + index * (width + gap), 0);
      chip.addChild(new Graphics().roundRect(0, 0, width, 70, 16)
        .fill(done ? 0xd8efd8 : next ? 0xefe6ff : 0xf1ece4)
        .stroke({ color: done ? 0x3f9a4a : next ? PURPLE : 0xc8bba6, width: next ? 4 : 2 }));
      chip.addChild(this.text(sizeLabel(tiles), width / 2, 24, 24, done ? 0x2e7d32 : next ? PURPLE : 0x8c7f6c));
      chip.addChild(this.text(done ? 'concluída' : `nível ${step?.level ?? 1}`, width / 2, 52, 18, 0x8a6a48, '600'));
      row.addChild(chip);
    });
    return row;
  }

  private render(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
    const offer = expansionOffer(this.options.rules, this.options.tiles(), this.options.wallet());
    this.content.addChild(this.text('Expansão do Café', PANEL_WIDTH / 2, 76, 56));
    this.content.addChild(this.text(offer.step
      ? `Seu café tem ${sizeLabel(offer.tiles)}. A próxima expansão leva a ${sizeLabel(offer.step.tiles)}.`
      : `Seu café já está no tamanho máximo: ${sizeLabel(offer.tiles)}.`, PANEL_WIDTH / 2, 132, 26, 0x8a5a2b, '600'));
    const plan = this.plan(offer);
    plan.position.set(offer.step ? 20 : PANEL_WIDTH / 2 - 250, 0);
    this.content.addChild(plan);
    if (offer.step) {
      this.content.addChild(this.payCard(500, 'coins', offer), this.payCard(500 + CARD.w + 30, 'cash', offer));
      const reward = new Container();
      reward.label = 'expansion-reward';
      reward.position.set(500 + CARD.w + 15, CARD.y + CARD.h + 46);
      const label = this.text(`Recompensa: +${amount(offer.rewardCoins)} moedas · +${amount(offer.step.xp)} XP`, 0, 0, 26, 0x8a5a00);
      const width = label.width + 60;
      reward.addChild(new Graphics().roundRect(-width / 2, -26, width, 52, 26).fill(0xfff1b8).stroke({ color: 0xe0a33a, width: 3 }), label);
      this.content.addChild(reward);
    }
    const steps = this.steps(offer);
    steps.position.set(0, 640);
    this.content.addChild(steps);
    const footer = this.message || (offer.step ? 'Piso e paredes novos seguem o visual atual do café. Nada sai do lugar.' : 'Obrigado por crescer conosco!');
    this.content.addChild(this.text(footer, PANEL_WIDTH / 2, PANEL_HEIGHT - 52, 24, this.messageError ? 0xc0392b : 0x8a5a2b, '600'));
  }

  private closeButton(): Container {
    const button = new Container();
    button.label = 'expansion-modal-close';
    button.position.set(PANEL_WIDTH - 66, 66);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(-38, -38, 76, 76);
    const icon = new Graphics()
      .roundRect(-34, -34, 68, 68, 20).fill(0x015495)
      .roundRect(-28, -28, 56, 56, 14).fill(0x0084ed)
      .roundRect(-24, -24, 48, 48, 10).fill(0x01a9fd)
      .moveTo(-10, -10).lineTo(10, 10).moveTo(10, -10).lineTo(-10, 10)
      .stroke({ color: 0xffffff, width: 8, cap: 'round' });
    icon.eventMode = 'none';
    button.addChild(icon);
    button.on('pointerover', () => { button.scale.set(1.1); });
    button.on('pointerout', () => { button.scale.set(1); });
    button.on('pointertap', (event) => { event.stopPropagation(); if (!this.busy) this.close(); });
    return button;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen && !this.busy) {
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
