/**
 * Procedural voices and effects. Every function schedules nodes on a
 * BaseAudioContext at an absolute time, so an OfflineAudioContext renders
 * exactly what the game plays live.
 */
export interface SynthKit {
  readonly ctx: BaseAudioContext;
  /** Two seconds of white noise shared by every noise-based voice. */
  readonly noise: AudioBuffer;
  /** Input of this kit's room reverb; its wet output is already connected. */
  readonly reverb: AudioNode;
}

const SILENT = 0.0001;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Small deterministic PRNG, so a procedural effect sounds the same every time. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSynthKit(ctx: BaseAudioContext, output: AudioNode, reverbLevel = 0.22): SynthKit {
  const random = mulberry32(1337);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;

  // A short, dark room: exponentially decaying stereo noise.
  const seconds = 1.8;
  const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      data[i] = (random() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 4200;
  const wet = ctx.createGain();
  wet.gain.value = reverbLevel;
  convolver.connect(damp).connect(wet).connect(output);
  return { ctx, noise, reverb: convolver };
}

function gainNode(kit: SynthKit, value = 0): GainNode {
  const node = kit.ctx.createGain();
  node.gain.value = value;
  return node;
}

function oscillator(kit: SynthKit, type: OscillatorType, frequency: number): OscillatorNode {
  const node = kit.ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}

/** Looping noise; callers pass different start offsets so hits are not identical. */
function noiseSource(kit: SynthKit): AudioBufferSourceNode {
  const source = kit.ctx.createBufferSource();
  source.buffer = kit.noise;
  source.loop = true;
  return source;
}

function filter(kit: SynthKit, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const node = kit.ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/** Percussive envelope: linear attack, exponential decay to silence. */
function strike(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(SILENT, t);
  param.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  param.exponentialRampToValueAtTime(SILENT, t + attack + decay);
}

function send(kit: SynthKit, from: AudioNode, amount: number): void {
  if (amount <= 0) return;
  const level = gainNode(kit, amount);
  from.connect(level).connect(kit.reverb);
}

// ---------------------------------------------------------------------------
// Instruments used by the sequencer.

/** Two-operator FM electric piano with a short metallic tine at the attack. */
export function rhodes(kit: SynthKit, dest: AudioNode, t: number, midi: number, duration: number, velocity: number, reverb = 0.35): void {
  const f = midiToHz(midi);
  const carrier = oscillator(kit, 'sine', f);
  const body = oscillator(kit, 'sine', f);
  const tine = oscillator(kit, 'sine', f * 14);
  const bodyDepth = gainNode(kit);
  const tineDepth = gainNode(kit);
  bodyDepth.gain.setValueAtTime(f * (1.1 + 1.6 * velocity), t);
  bodyDepth.gain.setTargetAtTime(f * 0.18, t, 0.28);
  tineDepth.gain.setValueAtTime(f * 0.9 * velocity, t);
  tineDepth.gain.setTargetAtTime(0, t, 0.018);
  body.connect(bodyDepth).connect(carrier.frequency);
  tine.connect(tineDepth).connect(carrier.frequency);

  const amp = gainNode(kit);
  const peak = 0.25 * velocity;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.005);
  amp.gain.setTargetAtTime(peak * 0.3, t + 0.005, 0.45);
  amp.gain.setTargetAtTime(0, t + duration, 0.09);
  carrier.connect(amp).connect(dest);
  send(kit, amp, reverb);
  const end = t + duration + 0.7;
  for (const node of [carrier, body, tine]) { node.start(t); node.stop(end); }
}

/** Round upright-style bass: triangle plus sine, darkened as the pluck decays. */
export function bass(kit: SynthKit, dest: AudioNode, t: number, midi: number, duration: number, velocity: number): void {
  const f = midiToHz(midi);
  const tone = oscillator(kit, 'triangle', f);
  const sub = oscillator(kit, 'sine', f);
  const lowpass = filter(kit, 'lowpass', 1500, 1.1);
  lowpass.frequency.setValueAtTime(1600, t);
  lowpass.frequency.setTargetAtTime(420, t, 0.09);
  const mix = gainNode(kit, 1);
  const subLevel = gainNode(kit, 0.4);
  tone.connect(mix);
  sub.connect(subLevel).connect(mix);
  const amp = gainNode(kit);
  const peak = 0.22 * velocity;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.01);
  amp.gain.setTargetAtTime(peak * 0.55, t + 0.01, 0.22);
  amp.gain.setTargetAtTime(0, t + duration, 0.05);
  mix.connect(lowpass).connect(amp).connect(dest);
  const end = t + duration + 0.35;
  for (const node of [tone, sub]) { node.start(t); node.stop(end); }
}

/** Vibraphone: fundamental plus the bar's 4th partial, with motor tremolo. */
export function vibes(kit: SynthKit, dest: AudioNode, t: number, midi: number, duration: number, velocity: number): void {
  const f = midiToHz(midi);
  const fundamental = oscillator(kit, 'sine', f);
  const partial = oscillator(kit, 'sine', f * 4);
  const partialLevel = gainNode(kit);
  strike(partialLevel.gain, t, 0.35, 0.002, 0.35);
  const amp = gainNode(kit);
  const peak = 0.13 * velocity;
  const ring = Math.max(0.6, duration + 0.5);
  amp.gain.setValueAtTime(SILENT, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.003);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + ring + 0.9);
  const tremolo = gainNode(kit, 1);
  const motor = oscillator(kit, 'sine', 5.6);
  const motorDepth = gainNode(kit, 0.28);
  motor.connect(motorDepth).connect(tremolo.gain);
  fundamental.connect(amp);
  partial.connect(partialLevel).connect(amp);
  amp.connect(tremolo).connect(dest);
  send(kit, tremolo, 0.5);
  const end = t + ring + 1;
  for (const node of [fundamental, partial, motor]) { node.start(t); node.stop(end); }
}

export function kick(kit: SynthKit, dest: AudioNode, t: number, velocity: number): void {
  const body = oscillator(kit, 'sine', 110);
  body.frequency.setValueAtTime(115, t);
  body.frequency.exponentialRampToValueAtTime(46, t + 0.13);
  const amp = gainNode(kit);
  strike(amp.gain, t, 0.35 * velocity, 0.004, 0.3);
  body.connect(amp).connect(dest);
  body.start(t);
  body.stop(t + 0.4);
}

/** Cross-stick: a woody click from band-passed noise and a short pitched knock. */
export function rim(kit: SynthKit, dest: AudioNode, t: number, velocity: number): void {
  const click = noiseSource(kit);
  const band = filter(kit, 'bandpass', 1900, 5);
  const clickLevel = gainNode(kit);
  strike(clickLevel.gain, t, 0.5 * velocity, 0.001, 0.035);
  click.connect(band).connect(clickLevel).connect(dest);
  const knock = oscillator(kit, 'triangle', 1650);
  knock.frequency.exponentialRampToValueAtTime(1450, t + 0.03);
  const knockLevel = gainNode(kit);
  strike(knockLevel.gain, t, 0.16 * velocity, 0.001, 0.03);
  knock.connect(knockLevel).connect(dest);
  send(kit, clickLevel, 0.25);
  click.start(t, (t * 7.3) % 1.5);
  click.stop(t + 0.08);
  knock.start(t);
  knock.stop(t + 0.06);
}

export function shaker(kit: SynthKit, dest: AudioNode, t: number, velocity: number): void {
  const source = noiseSource(kit);
  const high = filter(kit, 'highpass', 5200, 0.8);
  const amp = gainNode(kit);
  amp.gain.setValueAtTime(SILENT, t);
  amp.gain.linearRampToValueAtTime(0.11 * velocity, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + 0.07);
  source.connect(high).connect(amp).connect(dest);
  source.start(t, (t * 3.1) % 1.5);
  source.stop(t + 0.1);
}

/** Metallic cymbal from inharmonic square partials; short decay doubles as a hi-hat. */
export function cymbal(kit: SynthKit, dest: AudioNode, t: number, velocity: number, decay: number): void {
  const high = filter(kit, 'highpass', 7000, 0.7);
  const band = filter(kit, 'bandpass', 9500, 0.8);
  const amp = gainNode(kit);
  strike(amp.gain, t, 0.05 * velocity, 0.002, decay);
  band.connect(high).connect(amp).connect(dest);
  const end = t + decay + 0.05;
  for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const partial = oscillator(kit, 'square', 155 * ratio);
    partial.connect(band);
    partial.start(t);
    partial.stop(end);
  }
}

export function brush(kit: SynthKit, dest: AudioNode, t: number, velocity: number, duration: number): void {
  const source = noiseSource(kit);
  const band = filter(kit, 'bandpass', 2600, 0.6);
  const amp = gainNode(kit);
  amp.gain.setValueAtTime(SILENT, t);
  amp.gain.linearRampToValueAtTime(0.07 * velocity, t + duration * 0.35);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + duration);
  source.connect(band).connect(amp).connect(dest);
  source.start(t, (t * 5.7) % 1.5);
  source.stop(t + duration + 0.05);
}

// ---------------------------------------------------------------------------
// Sound effects. Each returns its length in seconds.

/** Shop-door bell: a few inharmonic partials struck twice by the clapper. */
export function doorBell(kit: SynthKit, dest: AudioNode, t: number): number {
  const base = 1318.5;
  const partials: Array<[ratio: number, level: number, decay: number]> = [[1, 1, 1.3], [2.42, 0.5, 0.8], [3.91, 0.32, 0.5], [5.6, 0.18, 0.3]];
  [[0, 1, 1], [0.12, 0.7, 1.006], [0.27, 0.45, 0.997]].forEach(([offset, level, detune]) => {
    for (const [ratio, partialLevel, decay] of partials) {
      const tone = oscillator(kit, 'sine', base * ratio * detune);
      const amp = gainNode(kit);
      strike(amp.gain, t + offset, 0.11 * level * partialLevel, 0.002, decay);
      tone.connect(amp).connect(dest);
      send(kit, amp, 0.5);
      tone.start(t + offset);
      tone.stop(t + offset + decay + 0.05);
    }
  });
  return 1.7;
}

/** Ingredients hitting a hot pan: crackling grains over a hiss, with a few bubbles. */
export function sizzle(kit: SynthKit, dest: AudioNode, t: number, seed = 7): number {
  const random = mulberry32(seed);
  const duration = 1.4;
  const bed = noiseSource(kit);
  const bedBand = filter(kit, 'bandpass', 5200, 0.6);
  const bedAmp = gainNode(kit);
  bedAmp.gain.setValueAtTime(SILENT, t);
  bedAmp.gain.linearRampToValueAtTime(0.22, t + 0.05);
  bedAmp.gain.exponentialRampToValueAtTime(SILENT, t + duration);
  bed.connect(bedBand).connect(bedAmp).connect(dest);
  bed.start(t, 0.2);
  bed.stop(t + duration + 0.05);
  for (let i = 0; i < 70; i++) {
    const at = t + Math.pow(random(), 1.6) * duration;
    const grain = noiseSource(kit);
    const band = filter(kit, 'bandpass', 2500 + random() * 6000, 2);
    const amp = gainNode(kit);
    strike(amp.gain, at, (0.12 + random() * 0.3) * (1 - (at - t) / duration), 0.001, 0.006 + random() * 0.02);
    grain.connect(band).connect(amp).connect(dest);
    grain.start(at, random() * 1.5);
    grain.stop(at + 0.05);
  }
  for (let i = 0; i < 6; i++) {
    const at = t + 0.1 + random() * (duration - 0.3);
    const bubble = oscillator(kit, 'sine', 280);
    bubble.frequency.setValueAtTime(260 + random() * 120, at);
    bubble.frequency.exponentialRampToValueAtTime(700 + random() * 400, at + 0.045);
    const amp = gainNode(kit);
    strike(amp.gain, at, 0.12, 0.004, 0.05);
    bubble.connect(amp).connect(dest);
    bubble.start(at);
    bubble.stop(at + 0.08);
  }
  return duration;
}

/** "Plim": a rising two-note chime with a bright overtone. */
export function coin(kit: SynthKit, dest: AudioNode, t: number): number {
  const notes: Array<[offset: number, midi: number, decay: number]> = [[0, 83, 0.12], [0.075, 88, 0.55]];
  for (const [offset, midi, decay] of notes) {
    const f = midiToHz(midi);
    for (const [type, ratio, level] of [['triangle', 1, 0.2], ['sine', 2, 0.07], ['sine', 3, 0.03]] as const) {
      const tone = oscillator(kit, type, f * ratio);
      const amp = gainNode(kit);
      strike(amp.gain, t + offset, level, 0.002, decay);
      tone.connect(amp).connect(dest);
      if (ratio === 1) send(kit, amp, 0.3);
      tone.start(t + offset);
      tone.stop(t + offset + decay + 0.05);
    }
  }
  return 0.7;
}

/** Short brass arpeggio resolving on a held chord, with a sparkle on top. */
export function levelUp(kit: SynthKit, dest: AudioNode, t: number): number {
  const brass = (at: number, midi: number, duration: number, level: number) => {
    const f = midiToHz(midi);
    const saw = oscillator(kit, 'sawtooth', f);
    const vibrato = oscillator(kit, 'sine', 5.5);
    const vibratoDepth = gainNode(kit);
    vibratoDepth.gain.setValueAtTime(0, at);
    vibratoDepth.gain.linearRampToValueAtTime(f * 0.006, at + duration);
    vibrato.connect(vibratoDepth).connect(saw.frequency);
    const lowpass = filter(kit, 'lowpass', 800, 1.5);
    lowpass.frequency.setValueAtTime(700, at);
    lowpass.frequency.linearRampToValueAtTime(3200, at + 0.05);
    lowpass.frequency.setTargetAtTime(1500, at + 0.05, 0.2);
    const amp = gainNode(kit);
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.03);
    amp.gain.setTargetAtTime(level * 0.7, at + 0.03, 0.2);
    amp.gain.setTargetAtTime(0, at + duration, 0.08);
    saw.connect(lowpass).connect(amp).connect(dest);
    send(kit, amp, 0.35);
    const end = at + duration + 0.5;
    for (const node of [saw, vibrato]) { node.start(at); node.stop(end); }
  };
  const step = 0.11;
  [72, 76, 79].forEach((midi, index) => brass(t + index * step, midi, step * 0.9, 0.07));
  for (const midi of [72, 76, 79, 84]) brass(t + 3 * step, midi, 0.85, midi === 84 ? 0.08 : 0.045);
  [96, 100, 103, 108].forEach((midi, index) => {
    const at = t + 3 * step + 0.05 + index * 0.06;
    const tone = oscillator(kit, 'sine', midiToHz(midi));
    const amp = gainNode(kit);
    strike(amp.gain, at, 0.035, 0.002, 0.4);
    tone.connect(amp).connect(dest);
    send(kit, amp, 0.6);
    tone.start(at);
    tone.stop(at + 0.45);
  });
  return 1.8;
}

/** Three broom strokes: band-passed noise sweeping up and down. */
export function broom(kit: SynthKit, dest: AudioNode, t: number): number {
  [0, 0.27, 0.54].forEach((offset, index) => {
    const at = t + offset;
    const source = noiseSource(kit);
    const band = filter(kit, 'bandpass', 900, 1.3);
    const [from, to] = index % 2 === 0 ? [750, 2800] : [2600, 900];
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(to, at + 0.22);
    const amp = gainNode(kit);
    amp.gain.setValueAtTime(SILENT, at);
    amp.gain.linearRampToValueAtTime(0.55, at + 0.06);
    amp.gain.exponentialRampToValueAtTime(SILENT, at + 0.24);
    source.connect(band).connect(amp).connect(dest);
    source.start(at, 0.3 + offset);
    source.stop(at + 0.28);
  });
  return 0.85;
}

/** Brief "uh-oh": two descending muted notes, kept short because it can repeat. */
export function buzzer(kit: SynthKit, dest: AudioNode, t: number): number {
  const notes: Array<[offset: number, midi: number, duration: number]> = [[0, 64, 0.16], [0.19, 60, 0.3]];
  for (const [offset, midi, duration] of notes) {
    const at = t + offset;
    const tone = oscillator(kit, 'sawtooth', midiToHz(midi));
    const square = oscillator(kit, 'square', midiToHz(midi - 12));
    const lowpass = filter(kit, 'lowpass', 600, 4);
    lowpass.frequency.setValueAtTime(450, at);
    lowpass.frequency.linearRampToValueAtTime(1300, at + 0.06);
    lowpass.frequency.exponentialRampToValueAtTime(380, at + duration);
    const amp = gainNode(kit);
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(0.09, at + 0.015);
    amp.gain.setTargetAtTime(0, at + duration - 0.04, 0.03);
    const squareLevel = gainNode(kit, 0.5);
    tone.connect(lowpass);
    square.connect(squareLevel).connect(lowpass);
    lowpass.connect(amp).connect(dest);
    for (const node of [tone, square]) { node.start(at); node.stop(at + duration + 0.15); }
  }
  return 0.6;
}

/** Soft interface tick. */
export function click(kit: SynthKit, dest: AudioNode, t: number): number {
  const tone = oscillator(kit, 'sine', 1900);
  tone.frequency.exponentialRampToValueAtTime(1200, t + 0.02);
  const amp = gainNode(kit);
  strike(amp.gain, t, 0.26, 0.001, 0.03);
  tone.connect(amp).connect(dest);
  tone.start(t);
  tone.stop(t + 0.05);
  return 0.05;
}

/** Paper flick, used only when the original book samples are unavailable. */
export function pageFlip(kit: SynthKit, dest: AudioNode, t: number): number {
  const source = noiseSource(kit);
  const high = filter(kit, 'highpass', 1800, 0.7);
  high.frequency.setValueAtTime(1500, t);
  high.frequency.exponentialRampToValueAtTime(4200, t + 0.16);
  const amp = gainNode(kit);
  amp.gain.setValueAtTime(SILENT, t);
  amp.gain.linearRampToValueAtTime(0.32, t + 0.03);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + 0.2);
  source.connect(high).connect(amp).connect(dest);
  source.start(t, 0.9);
  source.stop(t + 0.22);
  return 0.22;
}

/** Seasoning: two shaker flicks followed by a short rising sparkle. */
export function season(kit: SynthKit, dest: AudioNode, t: number): number {
  for (const offset of [0, 0.11]) {
    const source = noiseSource(kit);
    const high = filter(kit, 'bandpass', 6500, 1.2);
    const amp = gainNode(kit);
    strike(amp.gain, t + offset, 0.28, 0.006, 0.07);
    source.connect(high).connect(amp).connect(dest);
    source.start(t + offset, 0.4 + offset);
    source.stop(t + offset + 0.1);
  }
  [84, 88, 91, 96].forEach((midi, index) => {
    const at = t + 0.24 + index * 0.05;
    const tone = oscillator(kit, 'sine', midiToHz(midi));
    const amp = gainNode(kit);
    strike(amp.gain, at, 0.08, 0.002, 0.3);
    tone.connect(amp).connect(dest);
    send(kit, amp, 0.5);
    tone.start(at);
    tone.stop(at + 0.35);
  });
  return 0.7;
}
