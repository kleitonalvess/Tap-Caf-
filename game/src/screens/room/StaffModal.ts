import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import {
  ROLE_LABEL, hireableProfiles, otherRole, staffSlots,
  type StaffClient, type StaffProfile, type StaffRole, type StaffSlot, type StaffSnapshot,
} from '../../game/staff';

export interface StaffModalOptions {
  client: StaffClient;
  locks: readonly { employees: number; level: number }[];
  /** The hired employee's current look, when the room has already drawn it. */
  portrait?: (staffId: string) => Texture | undefined;
  /** The owner's coins, to show whether the next slot's fee is affordable. */
  gold?: () => number;
  audio?: SoundPlayer;
}

const coins = (value: number): string => value.toLocaleString('pt-BR');

const PANEL_WIDTH = 1500;
const PANEL_HEIGHT = 910;
const TEAM_Y = 214;
const TEAM_HEIGHT = 272;
const HIRE_Y = 552;
const CARD_WIDTH = 190;
const CARD_GAP = 13;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;
const CREAM = 0xfff7e6;
const ROLE_COLOR: Readonly<Record<StaffRole, number>> = { waiter: 0x2f80c8, cleaner: 0x3f9a4a };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(-2).map((word) => word[0]!.toUpperCase()).join('');
}

/** Tray (waiter) or bucket (cleaner), drawn small next to the portrait. */
function roleIcon(role: StaffRole): Graphics {
  const g = new Graphics();
  if (role === 'waiter') {
    g.ellipse(0, 6, 17, 5).fill(0xd9d6e6).stroke({ color: 0x5a5a6a, width: 2 });
    g.moveTo(-11, 4).quadraticCurveTo(0, -16, 11, 4).closePath().fill(0xeeeeee).stroke({ color: 0x5a5a6a, width: 2 });
    g.circle(0, -9, 2.5).fill(0x5a5a6a);
  } else {
    g.moveTo(-12, -8).lineTo(12, -8).lineTo(9, 12).lineTo(-9, 12).closePath().fill(0x3fb0e0).stroke({ color: 0x1d5e7a, width: 2 });
    g.moveTo(-12, -8).quadraticCurveTo(0, -24, 12, -8).stroke({ color: 0x1d5e7a, width: 2 });
  }
  g.eventMode = 'none';
  return g;
}

/** Funcionários: open slots by level, the team (switch role, dismiss) and who can be hired. */
export class StaffModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly content = new Container();
  private readonly texts: Text[] = [];
  private snapshot?: StaffSnapshot;
  private busy = false;
  private message = '';
  private messageError = false;
  private resolution = 1;
  private disposed = false;

  constructor(private readonly options: StaffModalOptions) {
    this.view.label = 'staff-modal';
    this.view.visible = false;
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.65 });
    backdrop.label = 'staff-modal-backdrop';
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) backdrop.on(name, (event) => event.stopPropagation());
    backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });

    this.panel.label = 'staff-modal-panel';
    this.panel.position.set((STAGE_WIDTH - PANEL_WIDTH) / 2, (STAGE_HEIGHT - PANEL_HEIGHT) / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, PANEL_HEIGHT - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xffffff);
    frame.eventMode = 'none';
    this.panel.addChild(frame, this.content);
    this.panel.addChild(this.closeButton());
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.view.visible; }

  open(): void {
    if (this.disposed || this.isOpen) return;
    this.view.visible = true;
    this.options.audio?.play('bookPage');
    this.message = 'Carregando equipe…';
    this.messageError = false;
    this.render();
    void this.run(() => this.options.client.get(), '');
  }

  close(): void {
    this.view.visible = false;
  }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = this.resolution;
  }

  private async run(action: () => Promise<StaffSnapshot>, success: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.snapshot = await action();
      this.message = success;
      this.messageError = false;
      if (success) this.options.audio?.play('click');
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Não foi possível atualizar os funcionários.';
      this.messageError = true;
      this.options.audio?.play('buzzer', 0.6);
    } finally {
      this.busy = false;
      if (!this.disposed) this.render();
    }
  }

  private text(value: string, x: number, y: number, size: number, color = DARK_BROWN, weight: '400' | '600' | '700' = '600', wrap = 0): Text {
    const text = new Text({ text: value, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: weight, fill: color,
      ...(wrap ? { wordWrap: true, wordWrapWidth: wrap, align: 'center' as const } : {}),
    }) });
    text.resolution = this.resolution;
    text.eventMode = 'none';
    text.position.set(x, y);
    this.texts.push(text);
    return text;
  }

  private fit(text: Text, width: number): Text {
    if (text.width > width) text.scale.set(width / text.width);
    return text;
  }

  private button(caption: string, x: number, y: number, width: number, color: number, enabled: boolean, onTap: () => void, label: string): Container {
    const button = new Container();
    button.label = label;
    button.position.set(x, y);
    const face = new Graphics().roundRect(0, 0, width, 44, 12).fill(enabled ? color : 0xb9b2a8).stroke({ color: 0x3d2a14, width: 2 });
    const text = this.fit(this.text(caption, width / 2, 22, 20, 0xffffff, '700'), width - 12);
    text.anchor.set(0.5);
    button.addChild(face, text);
    if (enabled) {
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.on('pointerover', () => { button.scale.set(1.05); });
      button.on('pointerout', () => { button.scale.set(1); });
      button.on('pointertap', (event) => { event.stopPropagation(); onTap(); });
    }
    return button;
  }

  private portrait(name: string, role: StaffRole, texture?: Texture): Container {
    const holder = new Container();
    holder.addChild(new Graphics().circle(0, 0, 50).fill(0xf3ece0).stroke({ color: ROLE_COLOR[role], width: 5 }));
    if (texture) {
      const mask = new Graphics().circle(0, 0, 46).fill(0xffffff);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.42);
      sprite.scale.set(118 / texture.height);
      sprite.mask = mask;
      holder.addChild(mask, sprite);
    } else {
      const letters = this.text(initials(name), 0, 0, 40, ROLE_COLOR[role], '700');
      letters.anchor.set(0.5);
      holder.addChild(letters);
    }
    const badge = new Container();
    badge.position.set(38, 36);
    badge.addChild(new Graphics().circle(0, 0, 21).fill(0xffffff).stroke({ color: ROLE_COLOR[role], width: 3 }), roleIcon(role));
    holder.addChild(badge);
    return holder;
  }

  private render(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.texts.length = 0;
    const title = this.text('Funcionários', PANEL_WIDTH / 2, 82, 60);
    title.anchor.set(0.5);
    this.content.addChild(title);
    const snapshot = this.snapshot;
    if (snapshot) {
      const hired = snapshot.staff.length;
      const next = snapshot.nextSlotLevel ? ` · próxima vaga no nível ${snapshot.nextSlotLevel}` : ' · todas as vagas abertas';
      const summary = this.text(`Vagas ocupadas: ${hired} de ${snapshot.slots}${next}`, PANEL_WIDTH / 2, 140, 28, 0x8a5a2b);
      summary.anchor.set(0.5);
      this.content.addChild(summary);
      this.renderTeam(snapshot);
      this.renderHiring(snapshot);
    }
    const footer = this.message || (snapshot ? this.feeNote(snapshot) : '');
    const line = this.text(footer, PANEL_WIDTH / 2, PANEL_HEIGHT - 50, 26, this.messageError ? 0xc0392b : 0x8a5a2b);
    line.anchor.set(0.5);
    this.content.addChild(line);
  }

  /** The first slot is free; every other slot charges its fee once, and changing role is always free. */
  private feeNote(snapshot: StaffSnapshot): string {
    if (snapshot.hireCoins > 0) {
      return `Próxima contratação: ${coins(snapshot.hireCoins)} moedas, taxa única da ${snapshot.staff.length + 1}ª vaga. Trocar de função é grátis.`;
    }
    if (snapshot.staff.length < (snapshot.paidSlots ?? 0)) return 'Esta vaga já foi paga: contratar de novo é grátis.';
    return 'A 1ª vaga é grátis; as outras têm taxa única. Trocar de função é grátis.';
  }

  private rowStart(count: number): number {
    return (PANEL_WIDTH - (count * CARD_WIDTH + (count - 1) * CARD_GAP)) / 2;
  }

  private renderTeam(snapshot: StaffSnapshot): void {
    const heading = this.text('Sua equipe', 48, 168, 32, DARK_BROWN, '700');
    this.content.addChild(heading);
    const slots = staffSlots(snapshot, this.options.locks);
    const start = this.rowStart(slots.length);
    slots.forEach((slot, index) => this.content.addChild(this.slotCard(slot, start + index * (CARD_WIDTH + CARD_GAP), TEAM_Y)));
  }

  private slotCard(slot: StaffSlot, x: number, y: number): Container {
    const card = new Container();
    card.position.set(x, y);
    const height = TEAM_HEIGHT;
    if (slot.kind === 'locked') {
      card.label = 'staff-slot-locked';
      card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, height, 18).fill(0xe9e2d6).stroke({ color: 0xc8bba6, width: 3 }));
      const lock = new Graphics().roundRect(CARD_WIDTH / 2 - 22, 106, 44, 36, 6).fill(0x9c8f7e)
        .moveTo(CARD_WIDTH / 2 - 13, 106).arc(CARD_WIDTH / 2, 106, 13, Math.PI, 0).stroke({ color: 0x9c8f7e, width: 6 });
      const level = this.text(`Nível ${slot.level}`, CARD_WIDTH / 2, 172, 28, 0x8c7f6c, '700');
      level.anchor.set(0.5);
      card.addChild(lock, level);
      if (slot.fee > 0) {
        const fee = this.text(`Taxa: ${coins(slot.fee)}`, CARD_WIDTH / 2, 210, 20, 0x8c7f6c);
        fee.anchor.set(0.5);
        card.addChild(fee);
      }
      return card;
    }
    if (slot.kind === 'free') {
      card.label = 'staff-slot-free';
      const outline = new Graphics();
      for (let i = 0; i < 24; i++) {
        const t0 = i / 24;
        const perimeter = (t: number): [number, number] => {
          const total = 2 * (CARD_WIDTH + height);
          let d = t * total;
          if (d < CARD_WIDTH) return [d, 0];
          d -= CARD_WIDTH;
          if (d < height) return [CARD_WIDTH, d];
          d -= height;
          if (d < CARD_WIDTH) return [CARD_WIDTH - d, height];
          return [0, height - (d - CARD_WIDTH)];
        };
        const [ax, ay] = perimeter(t0);
        const [bx, by] = perimeter(t0 + 0.5 / 24);
        outline.moveTo(ax, ay).lineTo(bx, by);
      }
      outline.stroke({ color: LIGHT_BROWN, width: 4 });
      const label = this.text('Vaga livre', CARD_WIDTH / 2, 120, 28, 0x8a5a2b, '700');
      label.anchor.set(0.5);
      const hint = this.text(slot.fee > 0 ? `Taxa única: ${coins(slot.fee)}` : 'Contrate abaixo · grátis', CARD_WIDTH / 2, 160, 20, 0xa58058);
      hint.anchor.set(0.5);
      card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, height, 18).fill(CREAM), outline, label, hint);
      return card;
    }
    const { member } = slot;
    card.label = `staff-member-${member.profile}`;
    card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, height, 18).fill(CREAM).stroke({ color: ROLE_COLOR[member.role], width: 4 }));
    const portrait = this.portrait(member.name, member.role, this.options.portrait?.(member.id));
    portrait.position.set(CARD_WIDTH / 2, 64);
    const name = this.fit(this.text(member.name, CARD_WIDTH / 2, 130, 24, DARK_BROWN, '700'), CARD_WIDTH - 16);
    name.anchor.set(0.5);
    const role = this.text(ROLE_LABEL[member.role], CARD_WIDTH / 2, 157, 22, ROLE_COLOR[member.role], '700');
    role.anchor.set(0.5);
    const next = otherRole(member.role);
    const swap = this.button(`Virar ${ROLE_LABEL[next]}`, 10, 176, CARD_WIDTH - 20, 0xd2891b, !this.busy,
      () => void this.run(() => this.options.client.setRole(member.id, next), `${member.name} agora é ${ROLE_LABEL[next]}.`), `staff-role-${member.profile}`);
    const dismiss = this.button('Dispensar', 10, 224, CARD_WIDTH - 20, 0xb8432f, !this.busy,
      () => void this.run(() => this.options.client.dismiss(member.id), `${member.name} foi dispensado(a).`), `staff-dismiss-${member.profile}`);
    card.addChild(portrait, name, role, swap, dismiss);
    return card;
  }

  private renderHiring(snapshot: StaffSnapshot): void {
    const heading = this.text('Contratar', 48, HIRE_Y - 46, 32, DARK_BROWN, '700');
    this.content.addChild(heading);
    const fee = snapshot.staff.length < snapshot.slots ? snapshot.hireCoins : 0;
    const gold = this.options.gold?.();
    const affordable = gold === undefined || gold >= fee;
    if (snapshot.staff.length < snapshot.slots) {
      const caption = fee > 0
        ? `Taxa desta vaga: ${coins(fee)} moedas${affordable ? '' : ` · faltam ${coins(fee - (gold ?? 0))}`}`
        : 'Esta vaga não tem taxa';
      const chip = this.text(caption, PANEL_WIDTH - 48, HIRE_Y - 30, 24, affordable ? 0x2e7d32 : 0xc0392b, '700');
      chip.anchor.set(1, 0.5);
      chip.label = 'staff-hire-fee';
      this.content.addChild(chip);
    }
    const profiles = hireableProfiles(snapshot);
    if (profiles.length === 0) {
      const all = this.text('Todos os personagens já trabalham no seu café.', PANEL_WIDTH / 2, HIRE_Y + 110, 28, 0x8a5a2b);
      all.anchor.set(0.5);
      this.content.addChild(all);
      return;
    }
    const free = snapshot.staff.length < snapshot.slots;
    const start = this.rowStart(profiles.length);
    profiles.forEach((profile, index) => this.content.addChild(this.profileCard(profile, free, affordable, start + index * (CARD_WIDTH + CARD_GAP), HIRE_Y)));
  }

  private profileCard(profile: StaffProfile, free: boolean, affordable: boolean, x: number, y: number): Container {
    const card = new Container();
    card.label = `staff-profile-${profile.id}`;
    card.position.set(x, y);
    card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, 250, 18).fill(0xfbf3e4).stroke({ color: 0xd9c3a0, width: 3 }));
    const portrait = this.portrait(profile.name, profile.role, undefined);
    portrait.scale.set(0.72);
    portrait.position.set(CARD_WIDTH / 2, 46);
    const name = this.fit(this.text(profile.name, CARD_WIDTH / 2, 98, 23, DARK_BROWN, '700'), CARD_WIDTH - 16);
    name.anchor.set(0.5);
    const tagline = this.text(profile.tagline, CARD_WIDTH / 2, 116, 16, 0x8a6a48, '400', CARD_WIDTH - 20);
    tagline.anchor.set(0.5, 0);
    if (tagline.height > 62) tagline.scale.set(62 / tagline.height);
    card.addChild(portrait, name, tagline);
    if (!free) {
      const full = this.text('Sem vaga livre', CARD_WIDTH / 2, 214, 20, 0x9c8f7e, '700');
      full.anchor.set(0.5);
      card.addChild(full);
      return card;
    }
    const roles: StaffRole[] = [profile.role, otherRole(profile.role)];
    roles.forEach((role, index) => {
      card.addChild(this.button(ROLE_LABEL[role], 10 + index * ((CARD_WIDTH - 26) / 2 + 6), 190, (CARD_WIDTH - 26) / 2, ROLE_COLOR[role], !this.busy && affordable,
        () => void this.run(() => this.options.client.hire(profile.id, role), `${profile.name} contratado(a) como ${ROLE_LABEL[role]}!`),
        `staff-hire-${profile.id}-${role}`));
    });
    return card;
  }

  private closeButton(): Container {
    const button = new Container();
    button.label = 'staff-modal-close';
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
    button.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    return button;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen) {
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
