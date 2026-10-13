import { describe, expect, it } from 'vitest';

import { DEFAULT_AUDIO_PREFERENCES, loadAudioPreferences, sanitizeAudioPreferences } from '../../../game/src/audio/preferences';
import { SOUND_EVENTS, parseSpriteManifest } from '../../../game/src/audio/sound-events';

describe('audio preferences', () => {
  it('keeps volumes while muted and adds the default track to older saves', () => {
    const legacy = { musicPercent: 70, effectsPercent: 20, muted: true };
    expect(sanitizeAudioPreferences(legacy)).toEqual({ ...legacy, track: DEFAULT_AUDIO_PREFERENCES.track });
  });

  it('rejects malformed track ids', () => {
    expect(sanitizeAudioPreferences({ track: '../../x' }).track).toBe(DEFAULT_AUDIO_PREFERENCES.track);
    expect(sanitizeAudioPreferences({ track: 'bossa' }).track).toBe('bossa');
  });

  it('falls back to defaults when storage fails', () => {
    const storage = { getItem: () => { throw new Error('blocked'); } };
    expect(loadAudioPreferences(storage, 'player')).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });
});

describe('sprite manifest', () => {
  it('keeps valid clips of known events', () => {
    const manifest = parseSpriteManifest({
      version: 1, file: 'compiled_sfx.mp3',
      sprites: { coin: [{ start: 1.5, duration: 0.4 }, { start: -1, duration: 1 }], unknown: [{ start: 0, duration: 1 }] },
    });
    expect(manifest).toEqual({ version: 1, file: 'compiled_sfx.mp3', sprites: { coin: [{ start: 1.5, duration: 0.4 }] } });
  });

  it('rejects paths and unsupported versions', () => {
    expect(parseSpriteManifest({ version: 1, file: '../secret.mp3', sprites: {} })).toBeNull();
    expect(parseSpriteManifest({ version: 2, file: 'a.mp3', sprites: {} })).toBeNull();
    expect(parseSpriteManifest('nope')).toBeNull();
  });

  it('lists every event the game plays', () => {
    expect(SOUND_EVENTS).toEqual(['doorBell', 'cookStart', 'coin', 'levelUp', 'broom', 'buzzer', 'bookPage', 'click', 'season']);
  });
});
