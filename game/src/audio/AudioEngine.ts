import { SongPlayer, type SongDefinition } from './music';
import { DEFAULT_AUDIO_PREFERENCES, sanitizeAudioPreferences, type AudioPreferences } from './preferences';
import { parseSpriteManifest, type SoundEvent, type SpriteClip } from './sound-events';
import { broom, buzzer, click, coin, createSynthKit, doorBell, levelUp, pageFlip, season, sizzle, type SynthKit } from './synth';

/** A music option: an original recording (`url`) or a procedural song. */
export interface MusicTrack {
  id: string;
  name: string;
  url?: string;
  song?: SongDefinition;
  /** Linear gain that levels recordings mastered at different loudness. */
  gain?: number;
}

export interface AudioEngineOptions {
  tracks: readonly MusicTrack[];
  /** Individual original files per event; one is picked at random. */
  samples?: Partial<Record<SoundEvent, readonly string[]>>;
  /** Optional sprite manifest written by tools/sfx-slicer. */
  spritesUrl?: string;
}

type Recipe = (kit: SynthKit, dest: AudioNode, t: number) => number;

/** Synthesis covers every event that has no original sample. */
const RECIPES: Readonly<Record<SoundEvent, Recipe>> = {
  doorBell, cookStart: sizzle, coin, levelUp, broom, buzzer, bookPage: pageFlip, click, season,
};

/** The same event within this window plays once (several customers paying together). */
const REPEAT_GUARD_SECONDS = 0.06;

interface PlayingTrack {
  id: string;
  stop(at: number): void;
  setIntensity?(value: number): void;
}

/**
 * Web Audio mixer for the game: master → (music, effects). Original samples
 * are preferred by fidelity; procedural synthesis fills the gaps and provides
 * alternative tracks. The context is created on the first user gesture, as
 * browsers require, and music requested earlier starts at that moment.
 */
export class AudioEngine {
  readonly tracks: readonly MusicTrack[];
  private ctx: AudioContext | null = null;
  private master?: GainNode;
  private music?: GainNode;
  private effects?: GainNode;
  private musicKit?: SynthKit;
  private effectsKit?: SynthKit;
  private preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly ready = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<SoundEvent, number>();
  private readonly samples: Partial<Record<SoundEvent, readonly string[]>>;
  private sprites: { url: string; clips: Partial<Record<SoundEvent, SpriteClip[]>> } | null = null;
  private current: PlayingTrack | null = null;
  /** A track that temporarily replaces the player's choice (the party music). */
  private override: MusicTrack | null = null;
  private trackToken = 0;
  private musicRequested = false;
  private intensity = 0;
  private destroyed = false;

  constructor(options: AudioEngineOptions) {
    if (options.tracks.length === 0) throw new Error('AudioEngine precisa de ao menos uma faixa.');
    this.tracks = options.tracks;
    this.samples = options.samples ?? {};
    // Small original effects are downloaded now and decoded once audio is allowed.
    for (const urls of Object.values(this.samples)) for (const url of urls ?? []) void this.fetchBytes(url);
    if (options.spritesUrl) void this.loadSprites(options.spritesUrl);
    if (typeof window !== 'undefined') {
      for (const name of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(name, this.unlock, true);
    }
  }

  get running(): boolean { return this.ctx?.state === 'running'; }

  setPreferences(preferences: AudioPreferences): void {
    this.preferences = sanitizeAudioPreferences(preferences);
    if (!this.tracks.some((track) => track.id === this.preferences.track)) this.preferences.track = this.tracks[0].id;
    this.applyLevels();
    void this.applyTrack();
  }

  /** Track id actually in use after validating the stored preference. */
  get trackId(): string { return this.preferences.track; }

  startMusic(): void {
    this.musicRequested = true;
    void this.applyTrack();
  }

  /**
   * Plays a track instead of the player's choice until called with null (the
   * party at the disco); the preference itself is never changed.
   */
  setOverride(track: MusicTrack | null): void {
    if ((this.override?.id ?? null) === (track?.id ?? null)) return;
    this.override = track;
    void this.applyTrack();
  }

  /** 0 is a calm café, 1 a full rush; procedural tracks speed up and add percussion. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.current?.setIntensity?.(this.intensity);
  }

  play(event: SoundEvent, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.preferences.muted || this.preferences.effectsPercent === 0 || !this.effects || !this.effectsKit) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(event) ?? -1) < REPEAT_GUARD_SECONDS) return;
    this.lastPlayed.set(event, now);
    const t = now + 0.005;

    const clips = this.sprites?.clips[event];
    const spriteBuffer = this.sprites && this.ready.get(this.sprites.url);
    if (clips?.length && spriteBuffer) {
      const clip = clips[Math.floor(Math.random() * clips.length)];
      this.playBuffer(spriteBuffer, t, volume * (clip.volume ?? 1), clip.start, clip.duration);
      return;
    }
    const urls = this.samples[event];
    if (urls?.length) {
      const url = urls[Math.floor(Math.random() * urls.length)];
      const buffer = this.ready.get(url);
      if (buffer) {
        this.playBuffer(buffer, t, volume);
        return;
      }
      void this.decode(url);
    }
    const level = ctx.createGain();
    level.gain.value = volume;
    level.connect(this.effects);
    const seconds = RECIPES[event](this.effectsKit, level, t);
    setTimeout(() => level.disconnect(), (seconds + 1.5) * 1000);
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== 'undefined') {
      for (const name of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(name, this.unlock, true);
    }
    this.current?.stop(this.ctx?.currentTime ?? 0);
    this.current = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private readonly unlock = (): void => {
    if (this.destroyed) return;
    if (!this.ctx) this.createContext();
    // A context created inside the gesture may already be running; statechange
    // covers that, a later resume and interruptions such as iOS calls.
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  };

  private createContext(): void {
    const Context = typeof window !== 'undefined' ? window.AudioContext : undefined;
    if (!Context) return;
    const ctx = new Context({ latencyHint: 'interactive' });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.music = ctx.createGain();
    this.effects = ctx.createGain();
    this.music.connect(this.master);
    this.effects.connect(this.master);
    this.master.connect(limiter).connect(ctx.destination);
    this.musicKit = createSynthKit(ctx, this.music, 0.2);
    this.effectsKit = createSynthKit(ctx, this.effects, 0.18);
    this.ctx = ctx;
    this.applyLevels(true);
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running') this.onRunning(); });
    if (ctx.state === 'running') this.onRunning();
  }

  private onRunning(): void {
    if (this.destroyed || !this.running) return;
    for (const urls of Object.values(this.samples)) for (const url of urls ?? []) void this.decode(url);
    if (this.sprites) void this.decode(this.sprites.url);
    void this.applyTrack();
  }

  private applyLevels(immediate = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.music || !this.effects) return;
    const at = ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) { param.value = value; return; }
      param.cancelScheduledValues(at);
      param.setTargetAtTime(value, at, 0.04);
    };
    set(this.master.gain, this.preferences.muted ? 0 : 1);
    set(this.music.gain, this.preferences.musicPercent / 100);
    set(this.effects.gain, this.preferences.effectsPercent / 100);
  }

  private async applyTrack(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.musicRequested || !this.music || !this.musicKit) return;
    const track = this.override ?? this.tracks.find((candidate) => candidate.id === this.preferences.track) ?? this.tracks[0];
    if (this.current?.id === track.id) return;
    const token = ++this.trackToken;
    const at = ctx.currentTime + 0.05;
    this.current?.stop(at);
    this.current = { id: track.id, stop: () => {} };
    if (track.song) {
      this.current = this.startSong(track.id, track.song, at);
      return;
    }
    const buffer = track.url ? await this.decode(track.url) : null;
    if (token !== this.trackToken || this.destroyed || !this.music) return;
    if (!buffer) {
      // An undecodable recording (codec support varies) falls back to synthesis.
      const fallback = this.tracks.find((candidate) => candidate.song);
      console.warn('[audio] faixa indisponível; usando a trilha procedural', track.id);
      this.current = fallback?.song ? this.startSong(track.id, fallback.song, ctx.currentTime + 0.05) : null;
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const fade = ctx.createGain();
    const start = ctx.currentTime + 0.05;
    fade.gain.setValueAtTime(0, start);
    fade.gain.linearRampToValueAtTime(track.gain ?? 1, start + 1);
    source.connect(fade).connect(this.music);
    source.start(start);
    this.current = {
      id: track.id,
      stop: (stopAt) => {
        fade.gain.cancelScheduledValues(stopAt);
        fade.gain.setValueAtTime(fade.gain.value, stopAt);
        fade.gain.linearRampToValueAtTime(0, stopAt + 0.8);
        source.stop(stopAt + 0.9);
      },
    };
  }

  private startSong(id: string, song: SongDefinition, at: number): PlayingTrack {
    const player = new SongPlayer(this.musicKit!, song, this.music!);
    player.setIntensity(this.intensity);
    player.start(at);
    return { id, stop: (stopAt) => player.stop(stopAt), setIntensity: (value) => player.setIntensity(value) };
  }

  private playBuffer(buffer: AudioBuffer, t: number, volume: number, offset = 0, duration?: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const level = ctx.createGain();
    level.gain.value = volume;
    source.connect(level).connect(this.effects!);
    if (duration === undefined) {
      source.start(t, offset);
      return;
    }
    // A short fade at the cut avoids a click when the clip ends mid-waveform.
    const end = t + duration;
    level.gain.setValueAtTime(volume, Math.max(t, end - 0.015));
    level.gain.linearRampToValueAtTime(0, end);
    source.start(t, offset, duration);
  }

  private fetchBytes(url: string): Promise<ArrayBuffer | null> {
    let request = this.bytes.get(url);
    if (!request) {
      request = fetch(url, { cache: 'force-cache' })
        .then((response) => response.ok ? response.arrayBuffer() : null)
        .catch(() => null);
      this.bytes.set(url, request);
    }
    return request;
  }

  private decode(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = this.fetchBytes(url).then(async (bytes) => {
        if (!bytes) return null;
        // decodeAudioData detaches its input; keep the downloaded copy reusable.
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        this.ready.set(url, buffer);
        return buffer;
      }).catch((error: unknown) => {
        console.warn('[audio] não foi possível decodificar', url, error);
        return null;
      });
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private async loadSprites(manifestUrl: string): Promise<void> {
    try {
      const response = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!response.ok) return;
      const manifest = parseSpriteManifest(await response.json());
      if (!manifest || Object.keys(manifest.sprites).length === 0) return;
      const url = new URL(manifest.file, new URL(manifestUrl, document.baseURI)).href;
      this.sprites = { url, clips: manifest.sprites };
      void this.fetchBytes(url);
      if (this.running) void this.decode(url);
    } catch {
      // No sprite manifest: individual samples and synthesis remain available.
    }
  }
}
