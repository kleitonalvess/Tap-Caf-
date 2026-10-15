/** Game sounds the engine knows how to play, from an original sample or by synthesis. */
export const SOUND_EVENTS = ['doorBell', 'cookStart', 'coin', 'levelUp', 'broom', 'buzzer', 'bookPage', 'click', 'season'] as const;
export type SoundEvent = typeof SOUND_EVENTS[number];

/** What screens need from the audio engine; null-object friendly for isolated tests. */
export interface SoundPlayer {
  play(event: SoundEvent, volume?: number): void;
}

/** One clip inside the sprite file, in seconds of decoded audio. */
export interface SpriteClip {
  start: number;
  duration: number;
  volume?: number;
}

/**
 * Written by tools/sfx-slicer from ripped/compiled_sfx.mp3. `file` is resolved
 * next to the manifest; several clips for one event are picked at random.
 */
export interface SpriteManifest {
  version: 1;
  file: string;
  sprites: Partial<Record<SoundEvent, SpriteClip[]>>;
}

const FILE_PATTERN = /^[A-Za-z0-9_.-]+\.(mp3|ogg|opus|wav|m4a)$/;

export function isSoundEvent(value: string): value is SoundEvent {
  return (SOUND_EVENTS as readonly string[]).includes(value);
}

/** Accepts only the documented shape; invalid clips are dropped, unknown events ignored. */
export function parseSpriteManifest(raw: unknown): SpriteManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (source.version !== 1 || typeof source.file !== 'string' || !FILE_PATTERN.test(source.file) ||
    typeof source.sprites !== 'object' || source.sprites === null) return null;
  const sprites: SpriteManifest['sprites'] = {};
  for (const [event, clips] of Object.entries(source.sprites as Record<string, unknown>)) {
    if (!isSoundEvent(event) || !Array.isArray(clips)) continue;
    const valid = clips.flatMap((clip): SpriteClip[] => {
      if (typeof clip !== 'object' || clip === null) return [];
      const { start, duration, volume } = clip as Record<string, unknown>;
      if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return [];
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 60) return [];
      if (volume !== undefined && (typeof volume !== 'number' || !(volume > 0 && volume <= 2))) return [];
      return [volume === undefined ? { start, duration } : { start, duration, volume }];
    });
    if (valid.length) sprites[event] = valid;
  }
  return { version: 1, file: source.file, sprites };
}
