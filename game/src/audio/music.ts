import { bass, brush, cymbal, kick, mulberry32, rhodes, rim, shaker, vibes, type SynthKit } from './synth';

/** Beats are quarter notes from the start of the bar; every event sits on the eighth-note grid. */
export interface NoteEvent {
  readonly beat: number;
  readonly midi: number;
  readonly beats: number;
  readonly velocity: number;
}

/** Piano rhythm over two bars (beats 0–8). */
export interface CompHit {
  readonly beat: number;
  readonly beats: number;
  readonly velocity: number;
  /** Plays the next bar's chord early, the bossa anticipation. */
  readonly anticipate?: boolean;
}

export interface SongBar {
  /** One chord, or two when the harmony changes on beat 3. */
  readonly chords: readonly (readonly number[])[];
  readonly bass: readonly NoteEvent[];
  readonly melody?: readonly NoteEvent[];
}

export type DrumKind = 'kick' | 'rim' | 'shaker' | 'ride' | 'hat' | 'brush';

export interface SongDefinition {
  readonly id: string;
  readonly name: string;
  readonly bpm: number;
  /** Output gain that matches the default recording (about −20.5 LUFS at full volume). */
  readonly level: number;
  /** Delay of off-beat eighths as a fraction of an eighth; 1/3 is triplet swing. */
  readonly swing: number;
  readonly comp: readonly CompHit[];
  /** Beats within two bars (0–8). */
  readonly drums: Readonly<Partial<Record<DrumKind, readonly number[]>>>;
  readonly bars: readonly SongBar[];
}

export const STEPS_PER_BAR = 8;
/** Rush hour raises the tempo by up to 7%. */
export const MAX_RUSH_TEMPO = 0.07;

const n = (beat: number, midi: number, beats: number, velocity = 0.8): NoteEvent => ({ beat, midi, beats, velocity });

/** Bossa bass: root on 1, fifth below on the "and" of 2; the same for the second half. */
function bossaBass(root: number, fifth: number, root2 = fifth, fifth2 = root): NoteEvent[] {
  return [n(0, root, 1.4, 0.9), n(1.5, fifth, 0.45, 0.6), n(2, root2, 1.4, 0.85), n(3.5, fifth2, 0.45, 0.55)];
}

const walk = (a: number, b: number, c: number, d: number): NoteEvent[] =>
  [n(0, a, 0.9, 0.55), n(1, b, 0.9, 0.45), n(2, c, 0.9, 0.5), n(3, d, 0.9, 0.45)];

// Rootless voicings around middle C (MIDI 60).
const FMA9 = [57, 60, 64, 67];
const GM9 = [58, 62, 65, 69];
const C13 = [58, 62, 64, 69];
const AM9 = [60, 64, 67, 71];
const D7B9 = [60, 63, 66, 69];
const BBMA9 = [57, 60, 62, 65];
const EM7B5 = [55, 58, 62, 64];
const A7B13 = [55, 61, 65, 71];
const EB9 = [55, 61, 65, 70];
const C9SUS = [58, 62, 65, 67];

const DM9 = [53, 57, 60, 64];
const G13 = [53, 59, 64, 69];
const CMA9 = [55, 59, 62, 64];
const EM9 = [55, 59, 62, 66];
const A13 = [55, 61, 66, 71];

/** Original bossa in F: an eight-bar A theme and a sparser B section. */
export const BOSSA_DO_BALCAO: SongDefinition = {
  id: 'bossa',
  name: 'Bossa do Balcão',
  bpm: 126,
  level: 0.45,
  swing: 0,
  comp: [
    { beat: 0, beats: 0.6, velocity: 0.75 }, { beat: 1.5, beats: 0.45, velocity: 0.6 },
    { beat: 3, beats: 0.6, velocity: 0.65 }, { beat: 4.5, beats: 0.45, velocity: 0.55 },
    { beat: 6, beats: 0.6, velocity: 0.65 }, { beat: 7.5, beats: 0.45, velocity: 0.6, anticipate: true },
  ],
  drums: {
    kick: [0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5],
    rim: [0, 1.5, 3, 5, 6.5],
    shaker: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5],
  },
  bars: [
    { chords: [FMA9], bass: bossaBass(41, 36), melody: [n(0, 72, 1.5), n(1.5, 69, 0.5), n(2, 67, 1), n(3, 69, 1)] },
    { chords: [GM9, C13], bass: bossaBass(43, 38, 48, 43), melody: [n(0.5, 70, 0.5), n(1, 69, 0.5), n(1.5, 67, 1.5), n(3, 64, 1)] },
    { chords: [AM9, D7B9], bass: bossaBass(45, 40, 50, 45), melody: [n(0, 72, 1), n(1, 71, 0.5), n(1.5, 72, 1.5), n(3, 75, 1)] },
    { chords: [GM9, C13], bass: bossaBass(43, 38, 48, 43), melody: [n(0, 74, 1.5), n(1.5, 72, 0.5), n(2, 70, 1), n(3, 69, 1)] },
    { chords: [FMA9], bass: bossaBass(41, 36), melody: [n(0, 69, 2.5), n(3, 72, 0.5), n(3.5, 74, 0.5)] },
    { chords: [BBMA9], bass: bossaBass(46, 41), melody: [n(0, 76, 1.5), n(1.5, 74, 0.5), n(2, 72, 1), n(3, 69, 1)] },
    { chords: [EM7B5, A7B13], bass: bossaBass(40, 34, 45, 40), melody: [n(0, 70, 1), n(1, 67, 1), n(2, 73, 1), n(3, 72, 0.5), n(3.5, 70, 0.5)] },
    { chords: [GM9, C13], bass: bossaBass(43, 38, 48, 43), melody: [n(0, 69, 1), n(1, 70, 0.5), n(1.5, 72, 1.5), n(3, 64, 1)] },
    { chords: [BBMA9], bass: bossaBass(46, 41), melody: [n(0, 69, 3, 0.7)] },
    { chords: [EB9], bass: bossaBass(39, 34), melody: [n(0, 70, 1, 0.7), n(1, 72, 2, 0.7)] },
    { chords: [AM9], bass: bossaBass(45, 40), melody: [n(0, 76, 1.5, 0.7), n(1.5, 74, 0.5, 0.7), n(2, 72, 2, 0.7)] },
    { chords: [D7B9], bass: bossaBass(50, 45), melody: [n(0, 75, 1, 0.7), n(1, 72, 1, 0.7), n(2, 69, 2, 0.7)] },
    { chords: [GM9], bass: bossaBass(43, 38), melody: [n(0, 70, 3, 0.7)] },
    { chords: [C9SUS, C13], bass: bossaBass(48, 43, 48, 43), melody: [n(0, 72, 1, 0.7), n(1, 70, 1, 0.7), n(2, 69, 1, 0.7), n(3, 67, 1, 0.7)] },
    { chords: [FMA9, D7B9], bass: bossaBass(41, 36, 50, 45), melody: [n(0, 69, 2, 0.7), n(2, 66, 2, 0.7)] },
    { chords: [GM9, C13], bass: bossaBass(43, 38, 48, 43), melody: [n(0, 67, 1, 0.7), n(1, 69, 1, 0.7), n(2, 70, 1, 0.7), n(3, 64, 1, 0.7)] },
  ],
};

/** Original slow swing in C: walking bass, ride and brushes, vibes on the first half. */
export const FIM_DE_EXPEDIENTE: SongDefinition = {
  id: 'lounge',
  name: 'Fim de Expediente',
  bpm: 88,
  level: 0.7,
  swing: 1 / 3,
  comp: [
    { beat: 0, beats: 0.7, velocity: 0.6 }, { beat: 1.5, beats: 0.4, velocity: 0.5 },
    { beat: 2.5, beats: 0.5, velocity: 0.45 }, { beat: 4.5, beats: 0.6, velocity: 0.5 },
    { beat: 6, beats: 0.7, velocity: 0.55 }, { beat: 7.5, beats: 0.4, velocity: 0.45, anticipate: true },
  ],
  drums: {
    ride: [0, 1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 7.5],
    hat: [1, 3, 5, 7],
    brush: [0, 2, 4, 6],
    kick: [0, 2, 4, 6],
  },
  bars: [
    { chords: [DM9], bass: walk(38, 40, 41, 42), melody: [n(0.5, 72, 0.5), n(1, 69, 0.5), n(1.5, 65, 1.5), n(3, 64, 1)] },
    { chords: [G13], bass: walk(43, 47, 50, 49), melody: [n(0, 65, 1.5), n(1.5, 64, 0.5), n(2, 62, 2)] },
    { chords: [CMA9], bass: walk(48, 47, 45, 44), melody: [n(0.5, 67, 0.5), n(1, 71, 0.5), n(1.5, 74, 2.5)] },
    { chords: [A7B13], bass: walk(45, 49, 52, 51), melody: [n(0, 77, 1), n(1, 73, 1), n(2, 70, 2)] },
    { chords: [DM9], bass: walk(50, 48, 45, 44) },
    { chords: [G13], bass: walk(43, 47, 50, 51) },
    { chords: [EM9, A13], bass: walk(52, 47, 45, 49) },
    { chords: [DM9, G13], bass: walk(50, 45, 43, 37) },
  ],
};

/** Disco octave bass: root and its octave on every eighth (half a bar per chord when two). */
function octaves(root: number, root2 = root): NoteEvent[] {
  return [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat) => {
    const base = beat < 2 ? root : root2;
    return n(beat, beat % 1 === 0 ? base : base + 12, 0.4, beat % 1 === 0 ? 0.9 : 0.6);
  });
}

/**
 * Original disco-funk in A minor for the party at the disco: four-on-the-floor
 * kick, open hats on the off-beats, off-beat chord stabs and an octave bass.
 * Played only while a party is on (AudioEngine.setOverride); level provisional.
 */
export const FESTA_DO_BAIRRO: SongDefinition = {
  id: 'party',
  name: 'Festa do Bairro',
  bpm: 122,
  level: 0.42,
  swing: 0,
  comp: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((beat) => ({ beat, beats: 0.3, velocity: beat % 2 === 1.5 ? 0.6 : 0.5 })),
  drums: {
    kick: [0, 1, 2, 3, 4, 5, 6, 7],
    rim: [1, 3, 5, 7],
    hat: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
    shaker: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5],
  },
  bars: [
    { chords: [AM9], bass: octaves(45), melody: [n(0, 76, 0.5), n(0.5, 79, 0.5), n(1, 81, 1), n(2.5, 79, 0.5), n(3, 76, 1)] },
    { chords: [DM9], bass: octaves(38), melody: [n(0.5, 74, 0.5), n(1, 77, 1), n(2, 76, 0.5), n(2.5, 74, 1.5)] },
    { chords: [GM9, C13], bass: octaves(43, 36), melody: [n(0, 74, 0.5), n(0.5, 79, 1), n(2, 76, 0.5), n(2.5, 72, 1)] },
    { chords: [FMA9, EM7B5], bass: octaves(41, 40), melody: [n(0, 72, 1), n(1, 69, 0.5), n(2, 71, 1.5)] },
    { chords: [AM9], bass: octaves(45) },
    { chords: [DM9], bass: octaves(38), melody: [n(2, 81, 0.5), n(2.5, 79, 0.5), n(3, 77, 1)] },
    { chords: [GM9, C13], bass: octaves(43, 36) },
    { chords: [FMA9, A7B13], bass: octaves(41, 45), melody: [n(2, 76, 2, 0.7)] },
  ],
};

export const PROCEDURAL_SONGS: readonly SongDefinition[] = [BOSSA_DO_BALCAO, FIM_DE_EXPEDIENTE];

const onGrid = (beat: number) => Number.isInteger(beat * 2);

/** Returns a problem description, or an empty string for a playable song. */
export function validateSong(song: SongDefinition): string {
  if (!song.id || !song.name || !(song.bpm >= 50 && song.bpm <= 220) || !(song.swing >= 0 && song.swing <= 0.5)) return 'tempo inválido';
  if (!(song.level > 0 && song.level <= 1)) return 'nível inválido';
  if (song.bars.length === 0) return 'sem compassos';
  const note = (event: NoteEvent) => onGrid(event.beat) && event.beat >= 0 && event.beat < 4 && event.beats > 0 &&
    event.midi >= 24 && event.midi <= 108 && event.velocity > 0 && event.velocity <= 1;
  for (const [index, bar] of song.bars.entries()) {
    if (bar.chords.length < 1 || bar.chords.length > 2 || bar.chords.some((chord) => chord.length < 2 || chord.some((midi) => midi < 36 || midi > 96))) {
      return `acorde inválido no compasso ${index + 1}`;
    }
    if (!bar.bass.every(note) || !(bar.melody ?? []).every(note)) return `nota inválida no compasso ${index + 1}`;
  }
  const twoBar = (beat: number) => onGrid(beat) && beat >= 0 && beat < 8;
  if (!song.comp.every((hit) => twoBar(hit.beat) && hit.beats > 0 && hit.velocity > 0 && hit.velocity <= 1)) return 'acompanhamento inválido';
  if (!Object.values(song.drums).every((beats) => beats.every(twoBar))) return 'bateria inválida';
  return '';
}

export function chordAt(bar: SongBar, beat: number): readonly number[] {
  return bar.chords[bar.chords.length > 1 && beat >= 2 ? 1 : 0];
}

export interface StepEvents {
  comp: Array<{ chord: readonly number[]; beats: number; velocity: number }>;
  bass: NoteEvent[];
  melody: NoteEvent[];
  drums: DrumKind[];
}

/** Everything that starts on a global eighth-note step; pure, so tests can inspect a song. */
export function eventsAtStep(song: SongDefinition, step: number): StepEvents {
  const barIndex = Math.floor(step / STEPS_PER_BAR) % song.bars.length;
  const bar = song.bars[barIndex];
  const slot = step % STEPS_PER_BAR;
  const pairSlot = step % (STEPS_PER_BAR * 2);
  const at = (beat: number) => Math.round(beat * 2);
  return {
    comp: song.comp.filter((hit) => at(hit.beat) === pairSlot).map((hit) => {
      const next = song.bars[(barIndex + 1) % song.bars.length];
      return { chord: hit.anticipate ? next.chords[0] : chordAt(bar, slot / 2), beats: hit.beats, velocity: hit.velocity };
    }),
    bass: bar.bass.filter((event) => at(event.beat) === slot),
    melody: (bar.melody ?? []).filter((event) => at(event.beat) === slot),
    drums: (Object.keys(song.drums) as DrumKind[]).filter((kind) => song.drums[kind]!.some((beat) => at(beat) === pairSlot)),
  };
}

/** Swing delays only the off-beat eighths. */
export function swingOffset(song: SongDefinition, step: number, eighthSeconds: number): number {
  return step % 2 === 1 ? song.swing * eighthSeconds : 0;
}

/**
 * Lookahead scheduler for one procedural song. Notes are scheduled slightly
 * ahead on the audio clock; timers only decide when to schedule more.
 */
export class SongPlayer {
  readonly output: GainNode;
  private readonly piano: GainNode;
  private readonly drums: GainNode;
  private readonly lead: StereoPannerNode;
  private readonly lfos: OscillatorNode[] = [];
  private step = 0;
  private nextTime = 0;
  private tempoScale = 1;
  private intensity = 0;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private readonly kit: SynthKit, readonly song: SongDefinition, destination: AudioNode) {
    const ctx = kit.ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    // Sub-bass below the bass line only muddies small speakers.
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 45;
    this.output.connect(rumble).connect(destination);
    // Suitcase-style tremolo panning on the electric piano.
    this.piano = ctx.createGain();
    this.piano.gain.value = 0.85;
    const pan = ctx.createStereoPanner();
    const panLfo = ctx.createOscillator();
    panLfo.frequency.value = 0.33;
    const panDepth = ctx.createGain();
    panDepth.gain.value = 0.35;
    panLfo.connect(panDepth).connect(pan.pan);
    this.piano.connect(pan).connect(this.output);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.8;
    this.drums.connect(this.output);
    this.lead = ctx.createStereoPanner();
    this.lead.pan.value = 0.2;
    this.lead.connect(this.output);
    this.lfos.push(panLfo);
  }

  /** Starts on the audio clock at `at`; `live` installs the scheduling timer. */
  start(at: number, fadeSeconds = 1.2, live = true): void {
    this.step = 0;
    this.nextTime = at;
    this.output.gain.setValueAtTime(0, at);
    this.output.gain.linearRampToValueAtTime(this.song.level, at + fadeSeconds);
    for (const lfo of this.lfos) lfo.start(at);
    if (live) {
      this.timer = setInterval(() => this.tick(), 50);
      this.tick();
    }
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  /** Eighth-note steps scheduled so far. */
  get scheduledSteps(): number { return this.step; }

  /** Schedules every step that starts before `horizon` (seconds on the audio clock). */
  scheduleUntil(horizon: number): void {
    while (!this.stopped && this.nextTime < horizon) {
      const eighth = 60 / (this.song.bpm * this.tempoScale) / 2;
      this.playStep(this.step, this.nextTime + swingOffset(this.song, this.step, eighth), eighth);
      this.nextTime += eighth;
      this.step++;
      // Glide toward the target tempo instead of jumping at once.
      this.tempoScale += (1 + MAX_RUSH_TEMPO * this.intensity - this.tempoScale) * 0.04;
    }
  }

  stop(at: number, fadeSeconds = 0.8): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.output.gain.cancelScheduledValues(at);
    this.output.gain.setValueAtTime(this.output.gain.value, at);
    this.output.gain.linearRampToValueAtTime(0, at + fadeSeconds);
    for (const lfo of this.lfos) lfo.stop(at + fadeSeconds + 0.1);
    setTimeout(() => this.output.disconnect(), (fadeSeconds + 0.3) * 1000);
  }

  private tick(): void {
    const now = this.kit.ctx.currentTime;
    // After a throttled timer or a suspended context, skip ahead instead of bursting notes.
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05;
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.scheduleUntil(now + (hidden ? 1.6 : 0.3));
  }

  private playStep(step: number, t: number, eighth: number): void {
    const beat = eighth * 2;
    const events = eventsAtStep(this.song, step);
    const random = mulberry32(step * 7919 + 17);
    const lift = 1 + 0.12 * this.intensity;
    const human = () => (0.92 + random() * 0.16) * lift;
    for (const hit of events.comp) {
      for (const midi of hit.chord) rhodes(this.kit, this.piano, t + random() * 0.012, midi, hit.beats * beat, Math.min(1, hit.velocity * human()));
    }
    for (const note of events.bass) bass(this.kit, this.output, t, note.midi, note.beats * beat * 0.95, Math.min(1, note.velocity * human()));
    for (const note of events.melody) vibes(this.kit, this.lead, t, note.midi, note.beats * beat, Math.min(1, note.velocity * human()));
    const offbeat = step % 2 === 1;
    for (const drum of events.drums) {
      switch (drum) {
        case 'kick': kick(this.kit, this.drums, t, this.song.swing > 0 ? 0.2 : 0.55 * human()); break;
        case 'rim': rim(this.kit, this.drums, t, 0.7 * human()); break;
        case 'shaker': shaker(this.kit, this.drums, t, (offbeat ? 0.9 : 0.55) * human()); break;
        case 'ride': cymbal(this.kit, this.drums, t, (offbeat ? 0.55 : 0.85) * human(), 0.55); break;
        case 'hat': cymbal(this.kit, this.drums, t, 0.6 * human(), 0.05); break;
        case 'brush': brush(this.kit, this.drums, t, 0.8 * human(), beat * 0.9); break;
      }
    }
    // Rush hour: sixteenth shakers in the bossa, off-beat hats in the swing.
    if (this.intensity > 0.45) {
      if (this.song.drums.shaker) shaker(this.kit, this.drums, t + eighth / 2, 0.45 * this.intensity);
      if (this.song.drums.hat && offbeat) cymbal(this.kit, this.drums, t, 0.35 * this.intensity, 0.04);
    }
  }
}
