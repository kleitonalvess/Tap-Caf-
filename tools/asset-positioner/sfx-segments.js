/* Detecção de trechos sonoros e manifesto de sprites de áudio do jogo. Sem DOM: roda no navegador e nos testes. */
'use strict';
(() => {
  // Mesmos eventos de game/src/audio/sound-events.ts; um teste compara as duas listas.
  const EVENTS = Object.freeze(['doorBell', 'cookStart', 'coin', 'levelUp', 'broom', 'buzzer', 'bookPage', 'click']);
  const FILE_PATTERN = /^[A-Za-z0-9_.-]+\.(mp3|ogg|opus|wav|m4a)$/;
  const round = (seconds) => Math.round(seconds * 1000) / 1000;

  /** Nível RMS em dBFS por janela, com os canais misturados. */
  function envelope(channels, sampleRate, windowMs) {
    const size = Math.max(1, Math.round(sampleRate * windowMs / 1000));
    const length = channels[0].length;
    const levels = new Float32Array(Math.ceil(length / size));
    for (let w = 0; w < levels.length; w++) {
      let sum = 0;
      let count = 0;
      const end = Math.min(length, (w + 1) * size);
      for (const data of channels) {
        for (let i = w * size; i < end; i++) { sum += data[i] * data[i]; count++; }
      }
      levels[w] = 10 * Math.log10(sum / Math.max(1, count) + 1e-12);
    }
    return { levels, windowSeconds: size / sampleRate };
  }

  /**
   * Trechos acima do limiar. Silêncios menores que minSilenceMs unem trechos
   * vizinhos (sons com pausas internas); trechos menores que minSoundMs são
   * descartados e a margem padMs preserva ataque e cauda.
   */
  function detectSegments(channels, sampleRate, options = {}) {
    const { thresholdDb = -50, minSilenceMs = 120, minSoundMs = 30, padMs = 15, windowMs = 10 } = options;
    if (!Array.isArray(channels) || channels.length === 0 || !(sampleRate > 0)) throw new Error('Áudio inválido.');
    if (![thresholdDb, minSilenceMs, minSoundMs, padMs, windowMs].every(Number.isFinite) || windowMs <= 0) {
      throw new Error('Parâmetros de detecção inválidos.');
    }
    const duration = channels[0].length / sampleRate;
    const { levels, windowSeconds } = envelope(channels, sampleRate, windowMs);
    const runs = [];
    let start = -1;
    for (let w = 0; w <= levels.length; w++) {
      const loud = w < levels.length && levels[w] >= thresholdDb;
      if (loud && start < 0) start = w;
      if (!loud && start >= 0) {
        runs.push({ start: start * windowSeconds, end: Math.min(duration, w * windowSeconds) });
        start = -1;
      }
    }
    const merged = [];
    for (const run of runs) {
      const previous = merged[merged.length - 1];
      if (previous && run.start - previous.end < minSilenceMs / 1000) previous.end = run.end;
      else merged.push({ ...run });
    }
    const pad = padMs / 1000;
    return merged
      .filter((run) => run.end - run.start >= minSoundMs / 1000)
      .map((run) => ({ start: round(Math.max(0, run.start - pad)), end: round(Math.min(duration, run.end + pad)) }));
  }

  /** Manifesto lido pelo AudioEngine: apenas trechos com evento conhecido. */
  function buildManifest(file, segments) {
    if (typeof file !== 'string' || !FILE_PATTERN.test(file)) {
      throw new Error('Use um nome de arquivo com letras, números, _ . - e extensão mp3, ogg, opus, wav ou m4a.');
    }
    const sprites = {};
    for (const segment of segments) {
      if (!EVENTS.includes(segment.event)) continue;
      const duration = round(segment.end - segment.start);
      if (!(segment.start >= 0) || !(duration > 0) || duration > 60) throw new Error('Trecho com início ou duração inválidos.');
      const clip = { start: round(segment.start), duration };
      if (segment.volume !== undefined && segment.volume !== 1) {
        if (!(segment.volume > 0 && segment.volume <= 2)) throw new Error('Volume do trecho deve ficar entre 0 e 2.');
        clip.volume = round(segment.volume);
      }
      (sprites[segment.event] ??= []).push(clip);
    }
    return { version: 1, file, sprites };
  }

  /** Converte um manifesto exportado de volta para trechos editáveis. */
  function readManifest(raw) {
    if (!raw || raw.version !== 1 || typeof raw.file !== 'string' || typeof raw.sprites !== 'object' || raw.sprites === null) {
      throw new Error('Manifesto de sprites inválido.');
    }
    const segments = [];
    for (const [event, clips] of Object.entries(raw.sprites)) {
      if (!EVENTS.includes(event) || !Array.isArray(clips)) continue;
      for (const clip of clips) {
        if (!(clip?.start >= 0) || !(clip?.duration > 0)) continue;
        segments.push({ start: clip.start, end: round(clip.start + clip.duration), event, volume: clip.volume ?? 1 });
      }
    }
    segments.sort((a, b) => a.start - b.start);
    return { file: raw.file, segments };
  }

  globalThis.SfxSegments = Object.freeze({ EVENTS, FILE_PATTERN, detectSegments, buildManifest, readManifest });
})();
