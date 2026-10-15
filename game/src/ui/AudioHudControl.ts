import { Container, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';

import { sanitizeAudioPreferences, type AudioPreferences } from '../audio/preferences';
import type { SoundPlayer } from '../audio/sound-events';
import { FONT_FAMILY } from '../core/font-tokens';

export interface AudioTrackOption {
  id: string;
  name: string;
  /** Shown under the name, e.g. recording or synthesized. */
  detail?: string;
}

export interface AudioHudControlOptions {
  tracks: readonly AudioTrackOption[];
  getPreferences(): AudioPreferences;
  onChange(preferences: AudioPreferences): void;
  audio?: SoundPlayer;
}

type Channel = 'musicPercent' | 'effectsPercent';

interface Slider {
  channel: Channel;
  holder: Container;
  track: Graphics;
  thumb: Graphics;
  output: Text;
}

const BUTTON_RADIUS = 30;
const PANEL_WIDTH = 540;
const PANEL_HEIGHT = 330;
const TRACK_WIDTH = 250;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;

/** Same blue round style as the fullscreen and close buttons. */
function roundButton(label: string, x: number, y: number): Container {
  const button = new Container();
  button.label = label;
  button.position.set(x, y);
  button.eventMode = 'static';
  button.cursor = 'pointer';
  button.hitArea = new Rectangle(-BUTTON_RADIUS - 4, -BUTTON_RADIUS - 4, BUTTON_RADIUS * 2 + 8, BUTTON_RADIUS * 2 + 8);
  const face = new Graphics()
    .circle(0, 0, BUTTON_RADIUS).fill(0x015495)
    .circle(0, 0, BUTTON_RADIUS - 4).fill(0x0084ed)
    .circle(0, -2, BUTTON_RADIUS - 8).fill(0x01a9fd);
  face.eventMode = 'none';
  button.addChild(face);
  let hovered = false;
  let pressed = false;
  const sync = () => button.scale.set(pressed ? 0.9 : hovered ? 1.08 : 1);
  button.on('pointerover', () => { hovered = true; sync(); });
  button.on('pointerout', () => { hovered = false; pressed = false; sync(); });
  button.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; sync(); });
  for (const name of ['pointerup', 'pointerupoutside'] as const) button.on(name, () => { pressed = false; sync(); });
  return button;
}

const iconStroke = { color: 0xffffff, width: 3.5, cap: 'round' as const, join: 'round' as const };

function drawSpeaker(icon: Graphics, muted: boolean): void {
  icon.clear()
    .moveTo(-14, -6).lineTo(-7, -6).lineTo(2, -14).lineTo(2, 14).lineTo(-7, 6).lineTo(-14, 6).closePath()
    .fill(0xffffff).stroke(iconStroke);
  if (muted) {
    icon.moveTo(8, -7).lineTo(19, 7).moveTo(19, -7).lineTo(8, 7).stroke(iconStroke);
  } else {
    icon.moveTo(8, -7).bezierCurveTo(12, -3, 12, 3, 8, 7)
      .moveTo(13, -12).bezierCurveTo(20, -5, 20, 5, 13, 12).stroke(iconStroke);
  }
}

function drawNote(icon: Graphics): void {
  icon.clear()
    .moveTo(-6, 9).lineTo(-6, -11).lineTo(11, -15).lineTo(11, 5)
    .moveTo(-6, -5).lineTo(11, -9).stroke(iconStroke)
    .ellipse(-10, 10, 5.5, 4.5).fill(0xffffff)
    .ellipse(7, 6, 5.5, 4.5).fill(0xffffff);
}

/**
 * Top-left sound control: mute toggle, track picker and separate volumes.
 * Preferences stay owned by the caller (saved per player); this only edits them.
 */
export class AudioHudControl {
  readonly view = new Container();
  private readonly muteIcon = new Graphics();
  private readonly backdrop = new Graphics();
  private readonly panel = new Container();
  private readonly trackName: Text;
  private readonly trackDetail: Text;
  private readonly sliders: Slider[] = [];
  private readonly texts: Text[] = [];
  private preferences: AudioPreferences;
  private drag: { slider: Slider; pointerId: number } | null = null;
  private disposed = false;

  constructor(private readonly options: AudioHudControlOptions) {
    this.preferences = sanitizeAudioPreferences(options.getPreferences());
    this.view.label = 'audio-hud-control';

    this.backdrop.rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 0.001 });
    this.backdrop.label = 'audio-hud-backdrop';
    this.backdrop.eventMode = 'static';
    this.backdrop.visible = false;
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) this.backdrop.on(name, (event) => event.stopPropagation());
    this.backdrop.on('pointertap', (event) => { event.stopPropagation(); this.setOpen(false); });

    const mute = roundButton('audio-hud-mute', 56, 56);
    this.muteIcon.eventMode = 'none';
    mute.addChild(this.muteIcon);
    mute.on('pointertap', (event) => { event.stopPropagation(); this.toggleMute(); });

    const music = roundButton('audio-hud-music', 56 + BUTTON_RADIUS * 2 + 14, 56);
    const note = new Graphics();
    note.eventMode = 'none';
    drawNote(note);
    music.addChild(note);
    music.on('pointertap', (event) => {
      event.stopPropagation();
      this.options.audio?.play('click');
      this.setOpen(!this.panel.visible);
    });

    this.panel.label = 'audio-hud-panel';
    this.panel.position.set(24, 100);
    this.panel.visible = false;
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 28).fill(DARK_BROWN)
      .roundRect(8, 8, PANEL_WIDTH - 16, PANEL_HEIGHT - 16, 22).fill(LIGHT_BROWN)
      .roundRect(15, 15, PANEL_WIDTH - 30, PANEL_HEIGHT - 30, 16).fill(0xffffff);
    frame.eventMode = 'none';
    this.panel.addChild(frame);

    this.addText('Faixa', 36, 62, 28).anchor.set(0, 0.5);
    this.trackName = this.addText('', 330, 52, 28);
    this.trackName.anchor.set(0.5);
    this.trackDetail = this.addText('', 330, 84, 20, '400');
    this.trackDetail.anchor.set(0.5);
    this.panel.addChild(this.arrowButton('audio-hud-track-previous', 170, 62, -1), this.arrowButton('audio-hud-track-next', 490, 62, 1));

    this.buildSlider('musicPercent', 'Música', 158);
    this.buildSlider('effectsPercent', 'Efeitos', 236);
    const hint = this.addText('Tecla M liga e desliga o som', PANEL_WIDTH / 2, 296, 20, '400');
    hint.anchor.set(0.5);
    hint.alpha = 0.75;

    this.view.addChild(this.backdrop, mute, music, this.panel);
    this.refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('blur', this.cancelDrag);
    }
  }

  get isOpen(): boolean { return this.panel.visible; }

  setOpen(open: boolean): void {
    if (this.disposed) return;
    this.panel.visible = open;
    this.backdrop.visible = open;
    this.drag = null;
    if (open) this.refresh();
  }

  toggleMute(): void {
    this.commit({ ...this.preferences, muted: !this.preferences.muted });
    if (!this.preferences.muted) this.options.audio?.play('click');
  }

  /** Picks up changes made elsewhere, such as the Settings modal. */
  update(): void {
    if (this.drag) return;
    const latest = sanitizeAudioPreferences(this.options.getPreferences());
    const current = this.preferences;
    if (latest.muted !== current.muted || latest.track !== current.track ||
      latest.musicPercent !== current.musicPercent || latest.effectsPercent !== current.effectsPercent) {
      this.preferences = latest;
      this.refresh();
    }
  }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = resolution;
  }

  destroy(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('blur', this.cancelDrag);
    }
    this.view.destroy({ children: true });
  }

  private commit(next: AudioPreferences): void {
    this.preferences = sanitizeAudioPreferences(next);
    this.refresh();
    this.options.onChange({ ...this.preferences });
  }

  private refresh(): void {
    drawSpeaker(this.muteIcon, this.preferences.muted);
    const tracks = this.options.tracks;
    const track = tracks.find((candidate) => candidate.id === this.preferences.track) ?? tracks[0];
    this.trackName.text = track?.name ?? '';
    this.trackName.scale.set(1);
    if (this.trackName.width > 260) this.trackName.scale.set(260 / this.trackName.width);
    this.trackDetail.text = track?.detail ?? '';
    for (const slider of this.sliders) {
      const value = this.preferences[slider.channel];
      slider.track.clear().roundRect(0, -9, TRACK_WIDTH, 18, 9).fill(0x704721)
        .roundRect(3, -6, TRACK_WIDTH - 6, 12, 6).fill(0xf5eee3);
      const width = (TRACK_WIDTH - 6) * value / 100;
      if (width > 0) slider.track.roundRect(3, -6, width, 12, Math.min(6, width / 2)).fill(LIGHT_BROWN);
      slider.track.alpha = this.preferences.muted ? 0.45 : 1;
      slider.thumb.x = TRACK_WIDTH * value / 100;
      slider.output.text = `${value}%`;
    }
  }

  private cycleTrack(direction: 1 | -1): void {
    const tracks = this.options.tracks;
    if (tracks.length < 2) return;
    const index = Math.max(0, tracks.findIndex((candidate) => candidate.id === this.preferences.track));
    const next = tracks[(index + direction + tracks.length) % tracks.length];
    this.options.audio?.play('click');
    this.commit({ ...this.preferences, track: next.id });
  }

  private arrowButton(label: string, x: number, y: number, direction: 1 | -1): Container {
    const button = new Container();
    button.label = label;
    button.position.set(x, y);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(-26, -26, 52, 52);
    const shape = new Graphics().roundRect(-22, -22, 44, 44, 12).fill(DARK_BROWN)
      .moveTo(6 * -direction, -10).lineTo(8 * direction, 0).lineTo(6 * -direction, 10).closePath().fill(0xffffff);
    shape.eventMode = 'none';
    button.addChild(shape);
    button.on('pointerover', () => button.scale.set(1.08));
    button.on('pointerout', () => button.scale.set(1));
    button.on('pointertap', (event) => { event.stopPropagation(); this.cycleTrack(direction); });
    return button;
  }

  private addText(text: string, x: number, y: number, fontSize: number, fontWeight: '400' | '600' = '600'): Text {
    const value = new Text({ text, style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize, fontWeight, fill: DARK_BROWN }) });
    value.eventMode = 'none';
    value.position.set(x, y);
    this.texts.push(value);
    this.panel.addChild(value);
    return value;
  }

  private buildSlider(channel: Channel, label: string, y: number): void {
    this.addText(label, 36, y, 28).anchor.set(0, 0.5);
    const holder = new Container();
    holder.label = `audio-hud-${channel}`;
    holder.position.set(170, y);
    holder.hitArea = new Rectangle(-22, -30, TRACK_WIDTH + 44, 60);
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    const track = new Graphics();
    const thumb = new Graphics().circle(0, 0, 19).fill(DARK_BROWN).circle(0, 0, 14).fill(LIGHT_BROWN).circle(0, 0, 10).fill(0xffffff);
    track.eventMode = 'none';
    thumb.eventMode = 'none';
    holder.addChild(track, thumb);
    const output = this.addText('', PANEL_WIDTH - 36, y, 26, '400');
    output.anchor.set(1, 0.5);
    const slider: Slider = { channel, holder, track, thumb, output };
    this.sliders.push(slider);
    holder.on('pointerdown', (event) => {
      event.stopPropagation();
      if (this.drag) return;
      this.drag = { slider, pointerId: event.pointerId };
      this.updateFromPointer(slider, event);
    });
    holder.on('globalpointermove', (event) => {
      if (this.drag?.slider === slider && this.drag.pointerId === event.pointerId) this.updateFromPointer(slider, event);
    });
    for (const name of ['pointerup', 'pointerupoutside'] as const) {
      holder.on(name, (event) => {
        event.stopPropagation();
        if (this.drag?.slider !== slider || this.drag.pointerId !== event.pointerId) return;
        this.updateFromPointer(slider, event);
        this.drag = null;
        // Audible feedback at the chosen effects level.
        if (channel === 'effectsPercent') this.options.audio?.play('coin');
      });
    }
    this.panel.addChild(holder);
  }

  private updateFromPointer(slider: Slider, event: FederatedPointerEvent): void {
    const local = slider.holder.toLocal(event.global);
    const value = Math.round(Math.max(0, Math.min(100, local.x / TRACK_WIDTH * 100)));
    if (value === this.preferences[slider.channel] && !this.preferences.muted) return;
    // Choosing a volume is a request to hear it; the other channel keeps its value.
    this.commit({ ...this.preferences, [slider.channel]: value, muted: false });
  }

  private readonly cancelDrag = (): void => { this.drag = null; };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (event.key === 'm' || event.key === 'M') {
      this.toggleMute();
    } else if (event.key === 'Escape' && this.isOpen) {
      this.setOpen(false);
    }
  };
}
