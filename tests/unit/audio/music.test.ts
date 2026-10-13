import { describe, expect, it } from 'vitest';

import {
  BOSSA_DO_BALCAO, FIM_DE_EXPEDIENTE, PROCEDURAL_SONGS, STEPS_PER_BAR, SongPlayer,
  chordAt, eventsAtStep, swingOffset, validateSong,
} from '../../../game/src/audio/music';
import { createSynthKit } from '../../../game/src/audio/synth';

/**
 * Minimal BaseAudioContext stand-in: every node accepts any call, so the
 * scheduler and synth code run in Node. Audible output is checked separately
 * with OfflineAudioContext in Chromium.
 */
function fakeContext(currentTime = 0): BaseAudioContext {
  const node: object = new Proxy(function stub() {}, {
    get: (_target, key) => (key === 'value' ? 0 : key === 'then' ? undefined : node),
    set: () => true,
    apply: () => node,
  });
  return {
    currentTime,
    sampleRate: 8000,
    createBuffer: (channels: number, length: number) => ({
      duration: length / 8000, numberOfChannels: channels, length,
      getChannelData: () => new Float32Array(length),
    }),
    createGain: () => node, createOscillator: () => node, createBiquadFilter: () => node,
    createBufferSource: () => node, createStereoPanner: () => node, createConvolver: () => node,
  } as unknown as BaseAudioContext;
}

describe('procedural songs', () => {
  it('are valid and distinct', () => {
    for (const song of PROCEDURAL_SONGS) expect(validateSong(song), song.id).toBe('');
    expect(new Set(PROCEDURAL_SONGS.map((song) => song.id)).size).toBe(PROCEDURAL_SONGS.length);
  });

  it('rejects notes off the eighth-note grid', () => {
    const broken = { ...BOSSA_DO_BALCAO, bars: [{ ...BOSSA_DO_BALCAO.bars[0], bass: [{ beat: 0.25, midi: 41, beats: 1, velocity: 0.8 }] }] };
    expect(validateSong(broken)).not.toBe('');
  });

  it('plays bass on every downbeat and loops after the last bar', () => {
    for (const song of PROCEDURAL_SONGS) {
      song.bars.forEach((_, bar) => expect(eventsAtStep(song, bar * STEPS_PER_BAR).bass.length, `${song.id} bar ${bar + 1}`).toBeGreaterThan(0));
      const loop = song.bars.length * STEPS_PER_BAR;
      expect(eventsAtStep(song, loop)).toEqual(eventsAtStep(song, 0));
    }
  });

  it('changes harmony on beat 3 of two-chord bars', () => {
    const bar = BOSSA_DO_BALCAO.bars[1];
    expect(chordAt(bar, 1.5)).toBe(bar.chords[0]);
    expect(chordAt(bar, 2)).toBe(bar.chords[1]);
  });

  it('anticipates the next bar chord on the last off-beat', () => {
    const lastStepOfPair = STEPS_PER_BAR * 2 - 1;
    const [hit] = eventsAtStep(BOSSA_DO_BALCAO, lastStepOfPair).comp;
    expect(hit.chord).toBe(BOSSA_DO_BALCAO.bars[2].chords[0]);
  });

  it('swings only off-beat eighths', () => {
    expect(swingOffset(FIM_DE_EXPEDIENTE, 0, 0.3)).toBe(0);
    expect(swingOffset(FIM_DE_EXPEDIENTE, 1, 0.3)).toBeCloseTo(0.1);
    expect(swingOffset(BOSSA_DO_BALCAO, 1, 0.3)).toBe(0);
  });
});

describe('SongPlayer', () => {
  const stepsIn = (seconds: number, intensity: number) => {
    const ctx = fakeContext();
    const player = new SongPlayer(createSynthKit(ctx, ctx as unknown as AudioNode), BOSSA_DO_BALCAO, ctx as unknown as AudioNode);
    player.setIntensity(intensity);
    player.start(0, 1, false);
    player.scheduleUntil(seconds);
    return player.scheduledSteps;
  };

  it('schedules at the written tempo', () => {
    // 126 BPM: an eighth every 0.238 s; steps start at 0, so count floor + 1.
    // (A horizon off the grid avoids float ties such as 42 × 0.238… ≈ 10.)
    expect(stepsIn(10.1, 0)).toBe(Math.floor(10.1 / (60 / 126 / 2)) + 1);
  });

  it('speeds up gradually during the rush', () => {
    const calm = stepsIn(30, 0);
    const rush = stepsIn(30, 1);
    expect(rush).toBeGreaterThan(calm);
    expect(rush).toBeLessThanOrEqual(Math.ceil(calm * 1.07) + 1);
  });

  it('ignores invalid intensity values', () => {
    expect(stepsIn(10, Number.NaN)).toBe(stepsIn(10, 0));
  });
});
