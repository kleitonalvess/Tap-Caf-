import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { farmStatus, formatClock, partyStatus, type StreetState } from '../../game/street';

export type StreetBuildingId = 'farm' | 'disco';

export interface StreetModalRules {
  farmBonusPercent: number;
  farmCooldownSeconds: number;
  farmMaxCharges: number;
  partyMinutes: number;
  partyArrivalFactor: number;
  partyTipMultiplier: number;
}

export interface StreetModalOptions {
  rules: StreetModalRules;
  street: () => StreetState | undefined;
  serverNow: () => number;
  /** Runs the action; the modal closes on success and shows the error otherwise. */
  harvest: () => Promise<void>;
  startParty: () => Promise<void>;
  audio?: SoundPlayer;
}

const PANEL_WIDTH = 1040;
const PANEL_HEIGHT = 620;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;
const COLORS: Readonly<Record<StreetBuildingId, number>> = { farm: 0x3f9a4a, disco: 0x9b3fd1 };

/** The Farm and the Disco: what each building does, its timer and the action button (owner only). */
export class StreetModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly content = new Container();
  private readonly texts: Text[] = [];
  private building: StreetBuildingId = 'farm';
  private busy = false;
  private message = '';
  private lastSecond = -1;
  private resolution = 1;
  private disposed = false;

  constructor(private readonly options: StreetModalOptions) {
    this.view.label = 'street-modal';
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.55 });
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    backdrop.on('pointertap', (event) => { event.stopPropagation(); if (!this.busy) this.close(); });
    this.panel.label = 'street-modal-panel';
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
  get current(): StreetBuildingId { return this.building; }

  open(building: StreetBuildingId): void {
    if (this.disposed) return;
    this.building = building;
    this.message = '';
    this.busy = false;
    this.view.visible = true;
    this.options.audio?.play('bookPage');
    this.render();
  }

  close(): void { this.view.visible = false; }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = this.resolution;
  }

  /** Redraws once per second so the countdown and the button stay current. */
  update(): void {
    if (!this.view.visible || this.busy) return;
    const second = Math.floor(this.options.serverNow() / 1000);
    if (second !== this.lastSecond) this.render();
  }

  private text(value: string, x: number, y: number, size: number, color = DARK_BROWN, weight: '400' | '600' | '700' = '700', wrap = 0): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill: color,
      ...(wrap ? { wordWrap: true, wordWrapWidth: wrap, align: 'center' as const } : {}),
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.anchor.set(0.5, 0);
    text.position.set(x, y);
    this.texts.push(text);
    return text;
  }

  /** Farm: a crate of vegetables; Disco: the mirror ball. */
  private icon(building: StreetBuildingId): Graphics {
    const g = new Graphics();
    if (building === 'farm') {
      g.roundRect(-58, -6, 116, 52, 8).fill(0xb07f2a).stroke({ color: 0x5a3d1e, width: 4 });
      g.moveTo(-58, 14).lineTo(58, 14).stroke({ color: 0x5a3d1e, width: 3 });
      g.circle(-30, -14, 20).fill(0xe2412f).stroke({ color: 0x8a1f14, width: 3 });
      g.ellipse(4, -18, 14, 24).fill(0xf08a24).stroke({ color: 0x9a4f0f, width: 3 });
      g.circle(34, -12, 18).fill(0x6dbb3c).stroke({ color: 0x2f6b1c, width: 3 });
      g.moveTo(4, -42).lineTo(-6, -58).moveTo(4, -42).lineTo(14, -58).stroke({ color: 0x2f8a2a, width: 5, cap: 'round' });
    } else {
      g.moveTo(0, -70).lineTo(0, -46).stroke({ color: 0x9a96ad, width: 5 });
      g.circle(0, 0, 46).fill(0xd8dbe8).stroke({ color: 0x4b4766, width: 4 });
      for (let row = -36; row <= 36; row += 18) g.moveTo(-Math.sqrt(46 * 46 - row * row), row).lineTo(Math.sqrt(46 * 46 - row * row), row);
      for (let col = -36; col <= 36; col += 18) g.moveTo(col, -Math.sqrt(46 * 46 - col * col)).lineTo(col, Math.sqrt(46 * 46 - col * col));
      g.stroke({ color: 0x8c8aa3, width: 2 });
      g.circle(-16, -16, 8).fill({ color: 0xffffff, alpha: 0.9 });
    }
    g.eventMode = 'none';
    return g;
  }

  private button(caption: string, enabled: boolean, onTap: () => void): Container {
    const width = 460;
    const button = new Container();
    button.label = `street-action-${this.building}`;
    button.position.set((PANEL_WIDTH - width) / 2, PANEL_HEIGHT - 150);
    button.addChild(new Graphics().roundRect(0, 0, width, 72, 20).fill(enabled ? COLORS[this.building] : 0xb9b2a8).stroke({ color: 0x3d2a14, width: 3 }));
    const label = this.text(caption, width / 2, 16, 32, 0xffffff);
    if (label.width > width - 24) label.scale.set((width - 24) / label.width);
    button.addChild(label);
    if (enabled) {
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.on('pointerover', () => { button.scale.set(1.04); });
      button.on('pointerout', () => { button.scale.set(1); });
      button.on('pointertap', (event) => { event.stopPropagation(); this.options.audio?.play('click'); onTap(); });
    }
    return button;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    this.render();
    try {
      await action();
      if (this.disposed) return;
      this.busy = false;
      this.close();
    } catch (error) {
      this.busy = false;
      this.message = error instanceof Error ? error.message : 'Não foi possível usar o prédio agora.';
      this.options.audio?.play('buzzer', 0.6);
      if (!this.disposed) this.render();
    }
  }

  private render(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
    const now = this.options.serverNow();
    this.lastSecond = Math.floor(now / 1000);
    const rules = this.options.rules;
    const street = this.options.street();
    const icon = this.icon(this.building);
    icon.position.set(PANEL_WIDTH / 2, 132);
    this.content.addChild(icon);
    if (this.building === 'farm') {
      const status = farmStatus(street, now, rules.farmMaxCharges);
      this.content.addChild(this.text('Fazenda de Ingredientes', PANEL_WIDTH / 2, 208, 48));
      this.content.addChild(this.text(
        `Colha ingredientes frescos a cada ${Math.round(rules.farmCooldownSeconds / 60)} min. A próxima receita que você cozinhar rende +${rules.farmBonusPercent}% de moedas e XP em cada porção.`,
        PANEL_WIDTH / 2, 272, 26, 0x8a5a2b, '600', PANEL_WIDTH - 140));
      const line = status.full
        ? `Ingredientes frescos guardados: ${status.charges}. Cozinhe para usá-los!`
        : status.canHarvest ? 'A colheita está pronta!' : `Próxima colheita em ${formatClock(status.readyInMs)}`;
      this.content.addChild(this.text(line, PANEL_WIDTH / 2, 372, 30, status.canHarvest ? 0x2e7d32 : 0xd2541b));
      const caption = this.busy ? 'Colhendo…' : status.full ? 'Cozinhe para usar' : status.canHarvest ? 'Colher ingredientes' : `Aguarde ${formatClock(status.readyInMs)}`;
      this.content.addChild(this.button(caption, status.canHarvest && !this.busy, () => void this.run(this.options.harvest)));
    } else {
      const status = partyStatus(street, now);
      this.content.addChild(this.text('Discoteca · Festa do Bairro', PANEL_WIDTH / 2, 208, 48));
      this.content.addChild(this.text(
        `Por ${rules.partyMinutes} min os clientes chegam ${String(rules.partyArrivalFactor).replace('.', ',')}× mais rápido, quem se serve sozinho dá gorjeta e a gorjeta do garçom vale ${rules.partyTipMultiplier}×.`,
        PANEL_WIDTH / 2, 272, 26, 0x8a5a2b, '600', PANEL_WIDTH - 140));
      const line = status.active ? `A festa termina em ${formatClock(status.endsInMs)}` : status.canStart ? 'Tudo pronto para a festa!' : `Próxima festa em ${formatClock(status.readyInMs)}`;
      this.content.addChild(this.text(line, PANEL_WIDTH / 2, 372, 30, status.canStart || status.active ? 0x2e7d32 : 0xd2541b));
      const caption = this.busy ? 'Chamando a vizinhança…' : status.active ? 'A festa está rolando!' : status.canStart ? 'Começar a festa' : `Aguarde ${formatClock(status.readyInMs)}`;
      this.content.addChild(this.button(caption, status.canStart && !this.busy, () => void this.run(this.options.startParty)));
    }
    if (this.message) this.content.addChild(this.text(this.message, PANEL_WIDTH / 2, PANEL_HEIGHT - 66, 22, 0xc0392b, '600', PANEL_WIDTH - 120));
  }

  private closeButton(): Container {
    const button = new Container();
    button.label = 'street-modal-close';
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
