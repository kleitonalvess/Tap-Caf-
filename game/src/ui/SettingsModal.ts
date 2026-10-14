import { Container, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';

import { DEFAULT_AUDIO_PREFERENCES, sanitizeAudioPreferences, type AudioPreferences } from '../audio/preferences';
import { FONT_FAMILY } from '../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../core/stage';

export interface SettingsModalOptions {
  playerName?: string;
  getPreferences?: () => AudioPreferences;
  onChange?: (preferences: AudioPreferences) => void;
  getBitterMode?: () => boolean;
  onBitterModeChange?: (enabled: boolean) => void;
  /** Music tracks the Faixa button cycles through (same list as the HUD). */
  tracks?: readonly { id: string; name: string }[];
  isFullscreen?: () => boolean;
  onToggleFullscreen?: () => void | Promise<void>;
  /** Absent in the offline mode: the browser's café has no account to leave. */
  onLogout?: () => void | Promise<void>;
}

interface SettingsButton {
  id: string;
  holder: Container;
  background: Graphics;
  focus: Graphics;
  caption: Text;
  run: () => void;
}

type VolumeChannel = 'musicPercent' | 'effectsPercent';

interface VolumeSlider {
  channel: VolumeChannel;
  holder: Container;
  track: Graphics;
  thumb: Graphics;
  focus: Graphics;
  output: Text;
}

const PANEL_WIDTH = 920;
const PANEL_HEIGHT = 920;
const BUTTON_ROW_Y = 790;
const BUTTON_HEIGHT = 74;
const TRACK_WIDTH = 520;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;

/** All visuals and pointer controls belong to the game's stage, not the DOM. */
export class SettingsModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly closeButton = new Container();
  private readonly closeFocus = new Graphics();
  private readonly sliders: VolumeSlider[] = [];
  private readonly texts: Text[] = [];
  private readonly bitterControl = new Container();
  private readonly bitterCheckbox = new Graphics();
  private readonly bitterFocus = new Graphics();
  private readonly buttons: SettingsButton[] = [];
  private loggingOut = false;
  private bitterMode = false;
  private preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private drag: { slider: VolumeSlider; pointerId: number } | null = null;
  private focusedControl = 0;
  private keyboardFocus = false;
  private closeHovered = false;
  private closePressed = false;
  private disposed = false;

  constructor(private readonly options: SettingsModalOptions = {}) {
    this.view.label = 'settings-modal';
    this.view.visible = false;

    // Like the recipe book, cover the full viewport, including stage overhang.
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000)
      .fill({ color: 0x000000, alpha: 0.65 });
    backdrop.label = 'settings-modal-backdrop';
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) {
      backdrop.on(name, (event) => event.stopPropagation());
    }
    backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });

    this.panel.label = 'settings-modal-panel';
    this.panel.position.set((STAGE_WIDTH - PANEL_WIDTH) / 2, (STAGE_HEIGHT - PANEL_HEIGHT) / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) {
      this.panel.on(name, (event) => event.stopPropagation());
    }
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, PANEL_HEIGHT - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, PANEL_HEIGHT - 44, 18).fill(0xffffff);
    frame.eventMode = 'none';
    this.panel.addChild(frame);

    const title = this.addText('Configurações', PANEL_WIDTH / 2, 85, 64, 'settings-modal-title');
    title.anchor.set(0.5);
    const square = new Graphics().roundRect(76, 166, 96, 96, 12)
      .fill(0xffffff).stroke({ color: 0x704721, width: 6 });
    square.eventMode = 'none';
    this.panel.addChild(square);
    const playerName = this.addText(options.playerName ?? '', 204, 214, 46, 'settings-modal-player-name');
    playerName.anchor.set(0, 0.5);
    // Long authenticated names stay inside the panel without changing its size.
    if (playerName.text && playerName.width > 636) playerName.scale.set(636 / playerName.width);

    this.buildCloseButton();
    this.buildSlider('musicPercent', 'Música', 382);
    this.buildSlider('effectsPercent', 'Efeitos sonoros', 522);
    this.buildBitterControl();
    this.buildButtons();
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('blur', this.cancelDrag);
    }
  }

  get isOpen(): boolean { return this.view.visible; }

  open(): void {
    if (this.disposed || this.isOpen) return;
    this.preferences = sanitizeAudioPreferences(this.options.getPreferences?.() ?? this.preferences);
    this.refreshSliders();
    this.bitterMode = this.options.getBitterMode?.() ?? this.bitterMode;
    this.refreshBitterCheckbox();
    this.refreshButtons();
    this.focusedControl = 0;
    this.keyboardFocus = false;
    this.closeHovered = false;
    this.closePressed = false;
    this.syncCloseFeedback();
    this.syncFocus();
    this.view.visible = true;
  }

  close(): void {
    this.view.visible = false;
    this.drag = null;
    this.closeHovered = false;
    this.closePressed = false;
    this.syncCloseFeedback();
  }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = resolution;
  }

  private addText(text: string, x: number, y: number, fontSize: number, label: string, fontWeight: '400' | '600' = '600'): Text {
    const value = new Text({ text, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize, fontWeight, fill: DARK_BROWN,
    }) });
    value.label = label;
    value.eventMode = 'none';
    value.position.set(x, y);
    this.texts.push(value);
    this.panel.addChild(value);
    return value;
  }

  private buildCloseButton(): void {
    const button = this.closeButton;
    button.label = 'settings-modal-close';
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
    this.closeFocus.roundRect(-42, -42, 84, 84, 24).stroke({ color: 0x01a9fd, width: 4 });
    this.closeFocus.eventMode = 'none';
    button.addChild(this.closeFocus, icon);
    button.on('pointerover', () => { this.closeHovered = true; this.syncCloseFeedback(); });
    button.on('pointerout', () => {
      this.closeHovered = false;
      this.closePressed = false;
      this.syncCloseFeedback();
    });
    button.on('pointerdown', (event) => {
      event.stopPropagation();
      this.closePressed = true;
      this.syncCloseFeedback();
    });
    for (const name of ['pointerup', 'pointerupoutside'] as const) {
      button.on(name, () => { this.closePressed = false; this.syncCloseFeedback(); });
    }
    button.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.panel.addChild(button);
  }

  private syncCloseFeedback(): void {
    this.closeButton.scale.set(this.closePressed ? 0.9 : this.closeHovered ? 1.1 : 1);
  }

  private buildBitterControl(): void {
    this.bitterControl.label = 'settings-bitter-checkbox';
    this.bitterControl.position.set(200, 628);
    this.bitterControl.eventMode = 'static';
    this.bitterControl.cursor = 'pointer';
    this.bitterControl.hitArea = new Rectangle(-14, -36, 670, 72);
    this.bitterFocus.roundRect(-14, -36, 670, 72, 14).stroke({ color: 0x01a9fd, width: 4 });
    this.bitterFocus.eventMode = 'none'; this.bitterCheckbox.eventMode = 'none';
    this.bitterControl.addChild(this.bitterFocus, this.bitterCheckbox);
    this.bitterControl.on('pointertap', (event) => {
      event.stopPropagation();
      if (!this.isOpen) return;
      this.focusedControl = this.sliders.length + 1; this.keyboardFocus = false;
      this.toggleBitterMode(); this.syncFocus();
    });
    this.panel.addChild(this.bitterControl);
    const label = this.addText('modo bitter', 264, 628, 34, 'settings-bitter-label');
    label.anchor.set(0, .5);
    const disclaimer = this.addText('modo bitter permite mais zoom, mas pode causar aberrações visuais',
      200, 676, 26, 'settings-bitter-disclaimer', '400');
    disclaimer.style.wordWrap = true; disclaimer.style.wordWrapWidth = 650; disclaimer.style.lineHeight = 34;
    this.refreshBitterCheckbox();
  }

  private toggleBitterMode(): void {
    this.bitterMode = !this.bitterMode;
    this.refreshBitterCheckbox();
    this.options.onBitterModeChange?.(this.bitterMode);
  }

  private refreshBitterCheckbox(): void {
    this.bitterCheckbox.clear().roundRect(0, -22, 44, 44, 8)
      .fill(0xffffff).stroke({ color: DARK_BROWN, width: 4 });
    if (this.bitterMode) this.bitterCheckbox.moveTo(10, -1).lineTo(19, 9).lineTo(35, -12)
      .stroke({ color: DARK_BROWN, width: 6, cap: 'round', join: 'round' });
  }

  private buildSlider(channel: VolumeChannel, label: string, y: number): void {
    const icon = new Graphics();
    const stroke = { color: DARK_BROWN, width: 3.5, cap: 'round' as const, join: 'round' as const };
    if (channel === 'musicPercent') {
      icon.moveTo(17, 32).lineTo(17, 12).lineTo(40, 7).lineTo(40, 27)
        .moveTo(17, 18).lineTo(40, 13).stroke(stroke)
        .ellipse(11, 34, 6, 5).fill(DARK_BROWN)
        .ellipse(34, 29, 6, 5).fill(DARK_BROWN);
    } else {
      icon.moveTo(7, 19).lineTo(15, 19).lineTo(25, 10).lineTo(25, 38)
        .lineTo(15, 29).lineTo(7, 29).closePath().stroke(stroke)
        .moveTo(32, 17).bezierCurveTo(37, 21, 37, 27, 32, 31)
        .moveTo(38, 11).bezierCurveTo(47, 18, 47, 30, 38, 37).stroke(stroke);
    }
    icon.label = `settings-${channel}-icon`;
    icon.scale.set(1.8);
    icon.position.set(72, y - 43);
    icon.eventMode = 'none';
    this.panel.addChild(icon);
    this.addText(label, 200, y - 60, 34, `settings-${channel}-label`);

    const holder = new Container();
    holder.label = `settings-${channel}-slider`;
    holder.position.set(200, y);
    holder.hitArea = new Rectangle(-26, -42, TRACK_WIDTH + 52, 84);
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    const focus = new Graphics().roundRect(-26, -42, TRACK_WIDTH + 52, 84, 16)
      .stroke({ color: 0x01a9fd, width: 4 });
    const track = new Graphics();
    const thumb = new Graphics().circle(0, 0, 24).fill(DARK_BROWN)
      .circle(0, 0, 18).fill(LIGHT_BROWN).circle(0, 0, 14).fill(0xffffff);
    for (const graphic of [focus, track, thumb]) graphic.eventMode = 'none';
    holder.addChild(focus, track, thumb);
    const output = this.addText('', PANEL_WIDTH - 72, y, 36, `settings-${channel}-value`, '400');
    output.anchor.set(1, 0.5);
    const slider: VolumeSlider = { channel, holder, track, thumb, focus, output };
    this.sliders.push(slider);
    holder.on('pointerdown', (event) => {
      event.stopPropagation();
      if (this.drag) return;
      this.drag = { slider, pointerId: event.pointerId };
      this.focusedControl = this.sliders.indexOf(slider) + 1;
      this.keyboardFocus = false;
      this.syncFocus();
      this.updateFromPointer(slider, event);
    });
    holder.on('globalpointermove', (event) => {
      if (this.drag?.slider === slider && this.drag.pointerId === event.pointerId) this.updateFromPointer(slider, event);
    });
    for (const name of ['pointerup', 'pointerupoutside'] as const) {
      holder.on(name, (event) => {
        event.stopPropagation();
        if (this.drag?.slider === slider && this.drag.pointerId === event.pointerId) {
          this.updateFromPointer(slider, event);
          this.drag = null;
        }
      });
    }
    this.panel.addChild(holder);
  }

  private updateFromPointer(slider: VolumeSlider, event: FederatedPointerEvent): void {
    if (!this.isOpen) return;
    const local = slider.holder.toLocal(event.global);
    this.setVolume(slider.channel, local.x / TRACK_WIDTH * 100);
  }

  private setVolume(channel: VolumeChannel, value: number): void {
    const current = this.preferences;
    // Mute is a separate HUD toggle that keeps both volumes; choosing a volume
    // here is a request to hear it, so it unmutes without touching the other one.
    const next = sanitizeAudioPreferences({ ...current, [channel]: value, muted: false });
    if (next.musicPercent === current.musicPercent && next.effectsPercent === current.effectsPercent && next.muted === current.muted) return;
    this.preferences = next;
    this.refreshSliders();
    this.refreshButtons();
    this.options.onChange?.({ ...this.preferences });
  }

  private refreshSliders(): void {
    for (const slider of this.sliders) {
      const value = this.preferences[slider.channel];
      slider.track.alpha = this.preferences.muted ? 0.45 : 1;
      slider.track.clear().roundRect(0, -10, TRACK_WIDTH, 20, 10).fill(0x704721)
        .roundRect(3, -7, TRACK_WIDTH - 6, 14, 7).fill(0xf5eee3);
      const width = (TRACK_WIDTH - 6) * value / 100;
      if (width > 0) slider.track.roundRect(3, -7, width, 14, Math.min(7, width / 2)).fill(LIGHT_BROWN);
      slider.thumb.x = TRACK_WIDTH * value / 100;
      slider.output.text = `${value}%`;
    }
  }

  /** Som (mute), Faixa, Tela cheia and Sair, in one row under the bitter mode. */
  private buildButtons(): void {
    const specs: Array<{ id: string; run: () => void }> = [
      { id: 'mute', run: () => this.applyAudio({ ...this.preferences, muted: !this.preferences.muted }) },
    ];
    if (this.options.tracks?.length) specs.push({ id: 'track', run: () => this.nextTrack() });
    if (this.options.onToggleFullscreen) specs.push({ id: 'fullscreen', run: () => {
      void Promise.resolve(this.options.onToggleFullscreen?.()).finally(() => this.refreshButtons());
    } });
    if (this.options.onLogout) specs.push({ id: 'logout', run: () => {
      if (this.loggingOut) return;
      this.loggingOut = true;
      this.refreshButtons();
      void Promise.resolve(this.options.onLogout?.()).catch((error: unknown) => console.warn('[sessão] não foi possível sair', error))
        .finally(() => { this.loggingOut = false; this.refreshButtons(); });
    } });
    const gap = 20;
    const width = (PANEL_WIDTH - 120 - gap * (specs.length - 1)) / specs.length;
    specs.forEach((spec, index) => {
      const holder = new Container();
      holder.label = `settings-${spec.id}-button`;
      holder.position.set(60 + index * (width + gap), BUTTON_ROW_Y);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.hitArea = new Rectangle(0, 0, width, BUTTON_HEIGHT);
      const background = new Graphics();
      const focus = new Graphics().roundRect(-6, -6, width + 12, BUTTON_HEIGHT + 12, 22).stroke({ color: 0x01a9fd, width: 4 });
      const caption = new Text({ text: '', style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 26, fontWeight: '600', fill: 0xffffff, align: 'center',
        wordWrap: true, wordWrapWidth: width - 16,
      }) });
      caption.anchor.set(0.5);
      caption.position.set(width / 2, BUTTON_HEIGHT / 2);
      for (const graphic of [background, focus, caption]) graphic.eventMode = 'none';
      this.texts.push(caption);
      holder.addChild(focus, background, caption);
      const button: SettingsButton = { id: spec.id, holder, background, focus, caption, run: spec.run };
      holder.on('pointerover', () => { holder.scale.set(1.03); });
      holder.on('pointerout', () => { holder.scale.set(1); });
      holder.on('pointertap', (event) => {
        event.stopPropagation();
        if (!this.isOpen) return;
        this.focusedControl = this.sliders.length + 2 + this.buttons.indexOf(button);
        this.keyboardFocus = false;
        this.syncFocus();
        button.run();
      });
      this.buttons.push(button);
      this.panel.addChild(holder);
    });
    this.refreshButtons();
  }

  private refreshButtons(): void {
    for (const button of this.buttons) {
      const width = (button.holder.hitArea as Rectangle).width;
      let caption = '';
      let color = 0x3f9a4a;
      if (button.id === 'mute') {
        caption = this.preferences.muted ? 'Som: mudo' : 'Som: ligado';
        color = this.preferences.muted ? 0x9b8b78 : 0x3f9a4a;
      } else if (button.id === 'track') {
        const track = this.options.tracks?.find((item) => item.id === this.preferences.track) ?? this.options.tracks?.[0];
        caption = `Faixa: ${track?.name ?? '—'}`;
        color = 0x8a5a2b;
      } else if (button.id === 'fullscreen') {
        caption = this.options.isFullscreen?.() ? 'Sair da tela cheia' : 'Tela cheia';
        color = 0x0084ed;
      } else if (button.id === 'logout') {
        caption = this.loggingOut ? 'Saindo…' : 'Sair do jogo';
        color = 0xc0392b;
      }
      button.caption.text = caption;
      button.caption.scale.set(1);
      if (button.caption.width > width - 16) button.caption.scale.set((width - 16) / button.caption.width);
      button.background.clear().roundRect(0, 0, width, BUTTON_HEIGHT, 20).fill(color).stroke({ color: 0x3d2a14, width: 3 });
    }
  }

  private nextTrack(): void {
    const tracks = this.options.tracks ?? [];
    if (!tracks.length) return;
    const index = tracks.findIndex((track) => track.id === this.preferences.track);
    this.applyAudio({ ...this.preferences, track: tracks[(index + 1) % tracks.length]!.id });
  }

  private applyAudio(preferences: AudioPreferences): void {
    this.preferences = sanitizeAudioPreferences(preferences);
    this.refreshSliders();
    this.refreshButtons();
    this.options.onChange?.({ ...this.preferences });
    // The engine may replace a track it cannot play; show what it chose.
    const actual = this.options.getPreferences?.();
    if (actual) {
      this.preferences = sanitizeAudioPreferences(actual);
      this.refreshButtons();
    }
  }

  private syncFocus(): void {
    this.closeFocus.visible = this.keyboardFocus && this.focusedControl === 0;
    this.sliders.forEach((slider, index) => { slider.focus.visible = this.keyboardFocus && this.focusedControl === index + 1; });
    this.bitterFocus.visible = this.keyboardFocus && this.focusedControl === this.sliders.length + 1;
    this.buttons.forEach((button, index) => { button.focus.visible = this.keyboardFocus && this.focusedControl === this.sliders.length + 2 + index; });
  }

  private readonly cancelDrag = (): void => { this.drag = null; };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.keyboardFocus = true;
      const count = this.sliders.length + 2 + this.buttons.length;
      this.focusedControl = (this.focusedControl + (event.shiftKey ? count - 1 : 1)) % count;
      this.syncFocus();
    } else if (this.focusedControl === 0 && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.close();
    } else if (this.focusedControl === this.sliders.length + 1) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) this.toggleBitterMode();
      }
    } else if (this.focusedControl >= this.sliders.length + 2) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) this.buttons[this.focusedControl - this.sliders.length - 2]?.run();
      }
    } else {
      const slider = this.sliders[this.focusedControl - 1];
      if (!slider) return;
      // Muted keeps the volumes: the arrows move from the stored one (and unmute).
      const current = this.preferences[slider.channel];
      const step = event.shiftKey ? 5 : 1;
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? 100
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
        : event.key === 'PageDown' ? current - 10 : event.key === 'PageUp' ? current + 10 : null;
      if (value === null) return;
      event.preventDefault();
      this.keyboardFocus = true;
      this.syncFocus();
      this.setVolume(slider.channel, value);
    }
  };

  destroy(): void {
    this.close();
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('blur', this.cancelDrag);
    }
    this.view.destroy({ children: true });
  }
}
