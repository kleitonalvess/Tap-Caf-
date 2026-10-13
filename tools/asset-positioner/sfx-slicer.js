/* Interface do Recortador de SFX: ouvir, ajustar e rotular trechos de um arquivo de áudio. */
'use strict';
(() => {
  const { EVENTS, FILE_PATTERN, detectSegments, buildManifest, readManifest } = globalThis.SfxSegments;
  const LABELS = {
    doorBell: 'Sininho da porta', cookStart: 'Ingredientes no fogão', coin: 'Moeda', levelUp: 'Subiu de nível',
    broom: 'Vassoura', buzzer: 'Cliente insatisfeito', bookPage: 'Livro de receitas', click: 'Clique de interface',
  };
  const STORAGE_PREFIX = 'coffe-sfx-slicer.v1:';
  const $ = (id) => document.getElementById(id);
  const state = { fileName: '', buffer: null, channels: [], segments: [], selected: -1, ctx: null, playing: null };

  const setStatus = (message, error = false) => {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  };
  const fmt = (seconds) => seconds.toFixed(3);
  const duration = () => state.buffer?.duration ?? Math.max(0, ...state.segments.map((s) => s.end));
  const storageKey = () => `${STORAGE_PREFIX}${state.fileName}:${duration().toFixed(2)}`;

  function save() {
    if (!state.buffer) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(state.segments)); } catch { /* Armazenamento indisponível: a sessão continua. */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
      if (!Array.isArray(saved)) return false;
      state.segments = saved.filter((s) => s && s.start >= 0 && s.end > s.start)
        .map((s) => ({ start: s.start, end: s.end, event: EVENTS.includes(s.event) ? s.event : '', volume: s.volume > 0 && s.volume <= 2 ? s.volume : 1 }));
      return state.segments.length > 0;
    } catch { return false; }
  }

  function context() {
    state.ctx ??= new AudioContext();
    if (state.ctx.state !== 'running') void state.ctx.resume();
    return state.ctx;
  }

  async function openAudio(file) {
    try {
      setStatus(`Decodificando ${file.name}…`);
      const buffer = await context().decodeAudioData(await file.arrayBuffer());
      stop();
      state.buffer = buffer;
      state.fileName = file.name;
      state.channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      state.selected = -1;
      $('audioInfo').textContent = `${file.name} · ${buffer.duration.toFixed(2)} s · ${buffer.sampleRate} Hz · ${buffer.numberOfChannels} canal(is)`;
      if (!FILE_PATTERN.test(file.name)) setStatus('Renomeie o arquivo (letras, números, _ . -) antes de exportar o manifesto.', true);
      if (restore()) {
        render();
        setStatus(`${state.segments.length} trechos e rótulos restaurados da última sessão com este arquivo.`);
      } else {
        detect();
      }
    } catch (error) {
      setStatus(`Não foi possível abrir o áudio: ${error.message ?? error}`, true);
    }
  }

  function detect() {
    if (!state.buffer) return;
    try {
      const options = {
        thresholdDb: Number($('threshold').value), minSilenceMs: Number($('minSilence').value),
        minSoundMs: Number($('minSound').value), padMs: Number($('pad').value),
      };
      state.segments = detectSegments(state.channels, state.buffer.sampleRate, options).map((s) => ({ ...s, event: '', volume: 1 }));
      state.selected = state.segments.length ? 0 : -1;
      render();
      setStatus(`${state.segments.length} trechos detectados. Ouça cada um e escolha o evento do jogo.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  // ------------------------------------------------------------ desenho

  function fit(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    return { g: canvas.getContext('2d'), width, height, ratio };
  }

  function drawWave(canvas, from, to) {
    const { g, width, height } = fit(canvas);
    g.fillStyle = '#1b1d20';
    g.fillRect(0, 0, width, height);
    const span = Math.max(1e-6, to - from);
    const x = (t) => (t - from) / span * width;
    state.segments.forEach((segment, index) => {
      if (segment.end < from || segment.start > to) return;
      g.fillStyle = index === state.selected ? 'rgba(231,170,93,0.35)' : segment.event ? 'rgba(120,190,140,0.22)' : 'rgba(150,160,175,0.16)';
      g.fillRect(x(segment.start), 0, Math.max(1, x(segment.end) - x(segment.start)), height);
    });
    if (state.buffer) {
      const rate = state.buffer.sampleRate;
      const data = state.channels[0];
      g.strokeStyle = '#c9d1da';
      g.beginPath();
      for (let px = 0; px < width; px++) {
        const a = Math.floor((from + px / width * span) * rate);
        const b = Math.max(a + 1, Math.floor((from + (px + 1) / width * span) * rate));
        let lo = 0;
        let hi = 0;
        for (let i = Math.max(0, a); i < Math.min(data.length, b); i++) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
        g.moveTo(px + 0.5, (1 - hi) * height / 2);
        g.lineTo(px + 0.5, (1 - lo) * height / 2 + 1);
      }
      g.stroke();
    }
    const playing = state.playing;
    if (playing && state.ctx) {
      const t = playing.offset + (state.ctx.currentTime - playing.startedAt);
      if (t >= from && t <= to) {
        g.fillStyle = '#e7aa5d';
        g.fillRect(x(t), 0, 2, height);
      }
    }
  }

  function draw() {
    const total = duration();
    drawWave($('overview'), 0, total || 1);
    const segment = state.segments[state.selected];
    if (segment) {
      const margin = Math.max(0.05, (segment.end - segment.start) * 0.25);
      drawWave($('detail'), Math.max(0, segment.start - margin), Math.min(total || segment.end + margin, segment.end + margin));
    } else {
      drawWave($('detail'), 0, 1);
    }
  }

  // ------------------------------------------------------------ lista e controles

  function renderTable() {
    const body = $('segments');
    body.replaceChildren();
    state.segments.forEach((segment, index) => {
      const row = document.createElement('tr');
      row.classList.toggle('selected', index === state.selected);
      row.classList.toggle('labelled', Boolean(segment.event));
      const cell = (text) => { const td = document.createElement('td'); td.textContent = text; return td; };
      const play = document.createElement('button');
      play.textContent = '▶';
      play.title = 'Tocar trecho';
      play.addEventListener('click', (event) => { event.stopPropagation(); select(index); playSelected(); });
      const playCell = document.createElement('td');
      playCell.append(play);
      const choose = document.createElement('select');
      choose.add(new Option('— não usado —', ''));
      for (const name of EVENTS) choose.add(new Option(`${LABELS[name]} (${name})`, name));
      choose.value = segment.event;
      choose.addEventListener('click', (event) => event.stopPropagation());
      choose.addEventListener('change', () => { segment.event = choose.value; row.classList.toggle('labelled', Boolean(segment.event)); save(); draw(); });
      const chooseCell = document.createElement('td');
      chooseCell.append(choose);
      const volume = document.createElement('input');
      volume.type = 'number';
      volume.min = '0.1';
      volume.max = '2';
      volume.step = '0.1';
      volume.value = String(segment.volume);
      volume.addEventListener('click', (event) => event.stopPropagation());
      volume.addEventListener('change', () => {
        const value = Number(volume.value);
        if (value > 0 && value <= 2) { segment.volume = value; save(); } else { volume.value = String(segment.volume); }
      });
      const volumeCell = document.createElement('td');
      volumeCell.append(volume);
      row.append(cell(String(index + 1)), cell(fmt(segment.start)), cell(fmt(segment.end - segment.start)), playCell, chooseCell, volumeCell);
      row.addEventListener('click', () => select(index));
      body.append(row);
    });
  }

  function updateControls() {
    const segment = state.segments[state.selected];
    const has = Boolean(segment);
    for (const id of ['segStart', 'segEnd', 'playSegment', 'removeSegment']) $(id).disabled = !has;
    $('mergeNext').disabled = !has || state.selected >= state.segments.length - 1;
    document.querySelectorAll('[data-nudge]').forEach((button) => { button.disabled = !has; });
    $('segStart').value = has ? fmt(segment.start) : '';
    $('segEnd').value = has ? fmt(segment.end) : '';
    $('detect').disabled = !state.buffer;
    $('exportManifest').disabled = state.segments.length === 0;
  }

  function render() {
    renderTable();
    updateControls();
    draw();
    save();
  }

  function select(index) {
    if (index < 0 || index >= state.segments.length) return;
    state.selected = index;
    $('segments').querySelectorAll('tr').forEach((row, i) => row.classList.toggle('selected', i === index));
    $('segments').children[index]?.scrollIntoView({ block: 'nearest' });
    updateControls();
    draw();
  }

  function setBounds(start, end) {
    const segment = state.segments[state.selected];
    if (!segment) return;
    const total = duration();
    const nextStart = Math.max(0, Math.min(start, total));
    const nextEnd = Math.max(0, Math.min(end, total));
    if (!(nextEnd - nextStart >= 0.005)) { setStatus('O fim deve ficar depois do início.', true); updateControls(); return; }
    segment.start = Math.round(nextStart * 1000) / 1000;
    segment.end = Math.round(nextEnd * 1000) / 1000;
    state.segments.sort((a, b) => a.start - b.start);
    state.selected = state.segments.indexOf(segment);
    render();
  }

  // ------------------------------------------------------------ reprodução

  function stop() {
    state.playing?.source.stop();
    state.playing = null;
  }

  function playSelected() {
    const segment = state.segments[state.selected];
    if (!segment || !state.buffer) { setStatus('Abra o arquivo de áudio para ouvir os trechos.', true); return; }
    const ctx = context();
    stop();
    const source = ctx.createBufferSource();
    source.buffer = state.buffer;
    const gain = ctx.createGain();
    gain.gain.value = segment.volume;
    source.connect(gain).connect(ctx.destination);
    const playing = { source, offset: segment.start, startedAt: ctx.currentTime };
    source.onended = () => { if (state.playing === playing) { state.playing = null; draw(); } };
    source.start(0, segment.start, segment.end - segment.start);
    state.playing = playing;
    const frame = () => { if (state.playing === playing) { draw(); requestAnimationFrame(frame); } };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ manifesto

  function exportManifest() {
    try {
      const manifest = buildManifest(state.fileName, state.segments);
      const count = Object.values(manifest.sprites).reduce((total, clips) => total + clips.length, 0);
      if (count === 0) { setStatus('Escolha o evento de ao menos um trecho antes de exportar.', true); return; }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }));
      link.download = 'sfx-sprites.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus(`Exportado: ${count} trecho(s) em ${Object.keys(manifest.sprites).length} evento(s). Copie também ${state.fileName}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function importManifest(file) {
    try {
      const { file: audio, segments } = readManifest(JSON.parse(await file.text()));
      if (state.fileName && audio !== state.fileName) setStatus(`O manifesto se refere a ${audio}, mas o áudio aberto é ${state.fileName}.`, true);
      else setStatus(`${segments.length} trecho(s) importado(s).`);
      state.fileName ||= audio;
      state.segments = segments;
      state.selected = segments.length ? 0 : -1;
      render();
    } catch (error) {
      setStatus(error.message ?? 'Manifesto inválido.', true);
    }
  }

  // ------------------------------------------------------------ eventos

  $('openAudio').addEventListener('click', () => $('audioFile').click());
  $('audioFile').addEventListener('change', () => { const file = $('audioFile').files?.[0]; if (file) void openAudio(file); $('audioFile').value = ''; });
  $('detect').addEventListener('click', detect);
  $('exportManifest').addEventListener('click', exportManifest);
  $('importManifest').addEventListener('click', () => $('manifestFile').click());
  $('manifestFile').addEventListener('change', () => { const file = $('manifestFile').files?.[0]; if (file) void importManifest(file); $('manifestFile').value = ''; });
  $('playSegment').addEventListener('click', playSelected);
  $('segStart').addEventListener('change', () => setBounds(Number($('segStart').value), state.segments[state.selected].end));
  $('segEnd').addEventListener('change', () => setBounds(state.segments[state.selected].start, Number($('segEnd').value)));
  document.querySelectorAll('[data-nudge]').forEach((button) => button.addEventListener('click', () => {
    const [edge, delta] = button.dataset.nudge.split(':');
    const segment = state.segments[state.selected];
    if (edge === 'start') setBounds(segment.start + Number(delta), segment.end);
    else setBounds(segment.start, segment.end + Number(delta));
  }));
  $('mergeNext').addEventListener('click', () => {
    const index = state.selected;
    const [current, next] = [state.segments[index], state.segments[index + 1]];
    if (!current || !next) return;
    current.end = Math.max(current.end, next.end);
    current.event ||= next.event;
    state.segments.splice(index + 1, 1);
    render();
  });
  $('removeSegment').addEventListener('click', () => {
    if (state.selected < 0) return;
    state.segments.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.segments.length - 1);
    render();
  });
  $('overview').addEventListener('click', (event) => {
    const rect = $('overview').getBoundingClientRect();
    const t = (event.clientX - rect.left) / rect.width * duration();
    let best = -1;
    let distance = Infinity;
    state.segments.forEach((segment, index) => {
      const d = t < segment.start ? segment.start - t : t > segment.end ? t - segment.end : 0;
      if (d < distance) { distance = d; best = index; }
    });
    if (best >= 0) select(best);
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key === ' ') { event.preventDefault(); playSelected(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); select(state.selected + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); select(state.selected - 1); }
    else if (event.key === 'Delete' && state.selected >= 0) $('removeSegment').click();
  });
  window.addEventListener('resize', draw);
  draw();
})();
