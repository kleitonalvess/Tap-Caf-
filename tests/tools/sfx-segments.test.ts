import { beforeAll, describe, expect, it } from 'vitest';

import { SOUND_EVENTS, parseSpriteManifest } from '../../game/src/audio/sound-events';

interface Segment { start: number; end: number; event?: string; volume?: number }
interface SfxSegmentsApi {
  EVENTS: readonly string[];
  detectSegments(channels: Float32Array[], sampleRate: number, options?: Record<string, number>): Segment[];
  buildManifest(file: string, segments: Segment[]): unknown;
  readManifest(raw: unknown): { file: string; segments: Segment[] };
}

let api: SfxSegmentsApi;

beforeAll(async () => {
  // The Studio loads this as a classic script that publishes a global.
  await import('../../tools/asset-positioner/sfx-segments.js');
  api = (globalThis as unknown as { SfxSegments: SfxSegmentsApi }).SfxSegments;
});

const RATE = 8000;

/** Silence with tone bursts at the given [start, end] seconds. */
function signal(seconds: number, bursts: Array<[number, number]>): Float32Array {
  const data = new Float32Array(seconds * RATE);
  for (const [start, end] of bursts) {
    for (let i = Math.floor(start * RATE); i < end * RATE; i++) data[i] = 0.5 * Math.sin(i / 3);
  }
  return data;
}

describe('sfx slicer segments', () => {
  it('uses the same events as the game', () => {
    expect([...api.EVENTS]).toEqual([...SOUND_EVENTS]);
  });

  it('finds separate sounds with padding', () => {
    const segments = api.detectSegments([signal(3, [[0.5, 0.8], [1.5, 2]])], RATE, { padMs: 20 });
    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBeCloseTo(0.48, 2);
    expect(segments[0].end).toBeCloseTo(0.82, 2);
    expect(segments[1].start).toBeCloseTo(1.48, 2);
  });

  it('joins sounds split by a short pause and drops clicks', () => {
    const data = signal(3, [[0.5, 0.8], [0.85, 1.1], [2, 2.01]]);
    const segments = api.detectSegments([data], RATE, { minSilenceMs: 120, minSoundMs: 30, padMs: 0 });
    expect(segments).toHaveLength(1);
    expect(segments[0].end).toBeCloseTo(1.1, 2);
  });

  it('round-trips a manifest the game accepts', () => {
    const manifest = api.buildManifest('compiled_sfx.mp3', [
      { start: 0.5, end: 0.9, event: 'coin', volume: 1 },
      { start: 1, end: 1.2, event: '', volume: 1 },
      { start: 2, end: 2.5, event: 'coin', volume: 0.8 },
    ]);
    expect(parseSpriteManifest(manifest)).toEqual(manifest);
    const restored = api.readManifest(manifest);
    expect(restored.segments.map((segment) => segment.start)).toEqual([0.5, 2]);
    expect(restored.segments[1].volume).toBe(0.8);
  });

  it('refuses file names the game would reject', () => {
    expect(() => api.buildManifest('my sounds.mp3', [])).toThrow();
  });
});
