(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const S = 512;
  const MAX_DUR = 5; // WhatsApp conserva 5 s de sonido en stickers hechos desde video
  const MAX_REC = 10;
  const cv = $('#cv');
  const g = cv.getContext('2d');

  const state = {
    mediaType: 'emoji', img: null, video: null, emoji: '😂',
    zoom: 1, offX: 0, offY: 0, fit: 'cover', videoStart: 0,
    topText: '', bottomText: '', textColor: '#ffffff', textSize: 58,
    shape: 'square', border: false, bg: '#ffffff', anim: 'none',
    soundKind: 'none', fileBuffer: null, fileName: '', micBuffer: null, videoBuffer: null,
    soundStart: 0, duration: 3, volume: 1,
  };
  const isVideo = () => state.mediaType === 'video' && !!state.video;

  /* ================= Barra de recorte (tipo editor de video) ================= */
  function Trimmer(root, { minLen = 0.5, maxLen = MAX_DUR, onChange, onCommit }) {
    root.classList.add('trimmer');
    root.innerHTML =
      '<div class="tr-track"><canvas class="tr-bg"></canvas>' +
      '<div class="tr-shade tr-l"></div><div class="tr-shade tr-r"></div>' +
      '<div class="tr-win"><div class="tr-h tr-hl"><i></i></div><div class="tr-h tr-hr"><i></i></div></div>' +
      '<div class="tr-head"></div></div>' +
      '<div class="tr-info"><span class="tr-a"></span><b class="tr-len"></b><span class="tr-b"></span></div>';
    const q = (s) => root.querySelector(s);
    const track = q('.tr-track'), bg = q('.tr-bg'), win = q('.tr-win'), shL = q('.tr-l'), shR = q('.tr-r'), head = q('.tr-head');
    const self = { total: 1, start: 0, len: 1, fixedLen: false, painter: null };
    const pct = (t) => (t / self.total) * 100 + '%';
    const fmt = (t) => {
      const m = Math.floor(t / 60);
      const s = (t - m * 60).toFixed(1).padStart(4, '0');
      return `${m}:${s}`;
    };
    function clamp() {
      const maxL = Math.min(maxLen, self.total);
      self.len = Math.min(Math.max(self.len, Math.min(minLen, maxL)), maxL);
      self.start = Math.min(Math.max(0, self.start), self.total - self.len);
    }
    function render() {
      const b = self.start + self.len;
      win.style.left = pct(self.start);
      win.style.width = pct(self.len);
      shL.style.width = pct(self.start);
      shR.style.left = pct(b);
      shR.style.width = pct(self.total - b);
      root.classList.toggle('fixed', self.fixedLen);
      q('.tr-a').textContent = fmt(self.start);
      q('.tr-b').textContent = fmt(b);
      q('.tr-len').textContent = self.len.toFixed(1) + ' s';
    }
    self.setTotal = (t) => { self.total = Math.max(0.1, t || 0.1); clamp(); render(); };
    self.set = (s, l) => { self.start = s; self.len = l; clamp(); render(); };
    self.setFixed = (f) => { self.fixedLen = f; render(); };
    self.redraw = () => {
      const w = track.clientWidth, h = track.clientHeight;
      if (!w) return;
      const d = window.devicePixelRatio || 1;
      bg.width = Math.round(w * d);
      bg.height = Math.round(h * d);
      const c = bg.getContext('2d');
      c.fillStyle = '#1d1b2f';
      c.fillRect(0, 0, bg.width, bg.height);
      if (self.painter) self.painter(c, bg.width, bg.height);
    };
    self.setHead = (t) => {
      if (t == null) { head.style.display = 'none'; return; }
      head.style.display = 'block';
      head.style.left = pct(Math.min(t, self.total));
    };
    let drag = null;
    const tAt = (x) => {
      const r = track.getBoundingClientRect();
      return ((x - r.left) / r.width) * self.total;
    };
    const emit = () => onChange && onChange(self.start, self.len);
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const t = tAt(e.clientX);
      let mode = 'move';
      if (e.target.closest('.tr-hl')) mode = 'l';
      else if (e.target.closest('.tr-hr')) mode = 'r';
      else if (!e.target.closest('.tr-win')) {
        self.start = t - self.len / 2;
        clamp(); render(); emit();
      }
      drag = { mode, t0: t, s0: self.start, l0: self.len };
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dt = tAt(e.clientX) - drag.t0;
      const maxL = Math.min(maxLen, self.total);
      if (drag.mode === 'move') self.start = drag.s0 + dt;
      else if (drag.mode === 'l') {
        const end = drag.s0 + drag.l0;
        let s = Math.min(drag.s0 + dt, end - minLen);
        s = Math.max(s, end - maxL, 0);
        self.start = s;
        self.len = end - s;
      } else {
        self.len = Math.max(minLen, Math.min(drag.l0 + dt, maxL, self.total - drag.s0));
      }
      clamp(); render(); emit();
    });
    const up = () => { if (drag) { drag = null; if (onCommit) onCommit(self.start, self.len); } };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    render();
    return self;
  }

  function wavePainter(buf) {
    const data = buf.getChannelData(0);
    return (c, w, h) => {
      const step = Math.max(1, Math.floor(data.length / w));
      const stride = Math.max(1, Math.floor(step / 200));
      let peak = 0.01;
      const cols = new Float32Array(w);
      for (let x = 0; x < w; x++) {
        let m = 0;
        const s0 = x * step;
        for (let j = 0; j < step; j += stride) { const v = Math.abs(data[s0 + j] || 0); if (v > m) m = v; }
        cols[x] = m;
        if (m > peak) peak = m;
      }
      c.fillStyle = '#b993ff';
      for (let x = 0; x < w; x++) {
        const bh = Math.max(2, (cols[x] / peak) * h * 0.85);
        c.fillRect(x, (h - bh) / 2, 1, bh);
      }
    };
  }
  function thumbPainter(frames) {
    return (c, w, h) => {
      if (!frames.length) return;
      const tw = h * 0.8;
      const n = Math.ceil(w / tw);
      for (let i = 0; i < n; i++) {
        const f = frames[Math.min(frames.length - 1, Math.floor((i / n) * frames.length))];
        const sc = Math.max(tw / f.width, h / f.height);
        const sw = tw / sc, sh = h / sc;
        c.drawImage(f, (f.width - sw) / 2, (f.height - sh) / 2, sw, sh, i * tw, 0, tw, h);
      }
    };
  }
  const once = (el, ev, ms = 3000) => new Promise((res) => {
    const t = setTimeout(res, ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  });
  async function captureThumbs(url, dur, n = 12) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await once(v, 'loadeddata');
    const out = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(dur - 0.05, ((i + 0.5) * dur) / n);
      await once(v, 'seeked', 2000);
      if (!v.videoWidth) continue;
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = Math.round((160 * v.videoHeight) / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      out.push(c);
    }
    v.removeAttribute('src');
    v.load();
    return out;
  }

  /* ================= Audio ================= */
  let actx = null, master = null, analyser = null, mediaDest = null;
  function ensureAudio() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      master.connect(analyser);
      analyser.connect(actx.destination);
      if (actx.createMediaStreamDestination) {
        mediaDest = actx.createMediaStreamDestination();
        master.connect(mediaDest);
      }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function decode(ab) {
    ensureAudio();
    return new Promise((res, rej) => {
      const p = actx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  function currentBuffer() {
    switch (state.soundKind) {
      case 'file': return state.fileBuffer;
      case 'mic': return state.micBuffer;
      case 'video': return state.videoBuffer;
      default: return null;
    }
  }
  const soundOffset = () => (state.soundKind === 'video' ? state.videoStart : state.soundStart);

  let playing = null;
  let idleStart = performance.now();
  function nowT() {
    if (playing && actx) return Math.max(0, actx.currentTime - playing.startAt);
    return ((performance.now() - idleStart) / 1000) % Math.max(state.duration, 0.5);
  }
  async function play() {
    stopPlay();
    ensureAudio();
    try { await actx.resume(); } catch (e) { /* nada */ }
    const buf = currentBuffer();
    const dur = state.duration;
    const startAt = actx.currentTime + 0.08;
    let src = null;
    if (buf) {
      src = actx.createBufferSource();
      src.buffer = buf;
      const gn = actx.createGain();
      gn.gain.value = state.volume;
      src.connect(gn);
      gn.connect(master);
      src.start(startAt, Math.min(soundOffset(), Math.max(0, buf.duration - 0.05)));
      src.stop(startAt + dur);
    }
    if (isVideo()) {
      state.video.currentTime = state.videoStart;
      try { await state.video.play(); } catch (e) { /* sin reproducción */ }
    }
    return new Promise((resolve) => {
      playing = { src, startAt, resolve, timer: setTimeout(stopPlay, (dur + 0.1) * 1000) };
      updatePlayBtn();
    });
  }
  function stopPlay() {
    if (!playing) return;
    const p = playing;
    playing = null;
    clearTimeout(p.timer);
    try { if (p.src) p.src.stop(); } catch (e) { /* ya detenido */ }
    if (state.video) {
      state.video.pause();
      state.video.currentTime = state.videoStart;
    }
    idleStart = performance.now();
    updatePlayBtn();
    p.resolve();
  }
  function updatePlayBtn() {
    $('#btnPlay').textContent = playing ? '■' : '▶';
    $('#btnPlay').classList.toggle('on', !!playing);
  }

  const td = new Uint8Array(1024);
  let level = 0;
  function readLevel() {
    if (!analyser || !playing) { level *= 0.9; return level; }
    analyser.getByteTimeDomainData(td);
    let s = 0;
    for (let i = 0; i < td.length; i++) { const x = (td[i] - 128) / 128; s += x * x; }
    level = Math.max(Math.min(1, Math.sqrt(s / td.length) * 3.2), level * 0.85);
    return level;
  }

  /* ================= Dibujo del sticker ================= */
  function roundRect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function shapePath(c, inset) {
    const w = S - 2 * inset;
    c.beginPath();
    if (state.shape === 'circle') c.arc(S / 2, S / 2, w / 2, 0, Math.PI * 2);
    else if (state.shape === 'rounded') roundRect(c, inset, inset, w, w, Math.max(4, 96 - inset));
    else c.rect(inset, inset, w, w);
  }
  function animTransform(c, t, lv) {
    let s = 1, r = 0, dx = 0, dy = 0;
    switch (state.anim) {
      case 'pulse': s = 1 + 0.07 * Math.sin(t * Math.PI * 4); break;
      case 'beat': s = 1 + lv * 0.28; break;
      case 'shake': dx = Math.sin(t * 61) * 9; dy = Math.cos(t * 47) * 7; r = Math.sin(t * 53) * 0.045; break;
      case 'bounce': dy = 22 - Math.abs(Math.sin(t * Math.PI * 2.5)) * 44; break;
      case 'wobble': r = Math.sin(t * Math.PI * 3) * 0.14; break;
      case 'zoom': s = 1 + Math.min(t / Math.max(state.duration, 0.5), 1) * 0.3; break;
      case 'spin': r = t * Math.PI * 1.5; break;
    }
    c.translate(S / 2 + dx, S / 2 + dy);
    c.rotate(r);
    c.scale(s, s);
    c.translate(-S / 2, -S / 2);
  }
  function drawMedia(c) {
    const m = state.mediaType;
    if (m === 'image' || m === 'video') {
      const el = m === 'image' ? state.img : state.video;
      if (!el) return;
      const iw = m === 'image' ? el.naturalWidth : el.videoWidth;
      const ih = m === 'image' ? el.naturalHeight : el.videoHeight;
      if (!iw || !ih) return;
      const base = state.fit === 'cover' ? Math.max(S / iw, S / ih) : Math.min(S / iw, S / ih);
      const sc = base * state.zoom;
      const w = iw * sc, h = ih * sc;
      c.drawImage(el, (S - w) / 2 + state.offX, (S - h) / 2 + state.offY, w, h);
    } else {
      const fs = 250 * state.zoom;
      c.font = `${fs}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(state.emoji || '😂', S / 2 + state.offX, S / 2 + state.offY + fs * 0.06);
    }
  }
  function wrap(c, text, maxW) {
    const lines = [];
    let line = '';
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawTexts(c) {
    const fs = state.textSize;
    const lh = fs * 1.1;
    c.font = `${fs}px Anton, Impact, "Arial Black", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';
    c.lineWidth = Math.max(5, fs / 5.5);
    c.strokeStyle = '#000';
    c.fillStyle = state.textColor;
    const put = (l, y) => { c.strokeText(l, S / 2, y); c.fillText(l, S / 2, y); };
    const top = state.topText.trim();
    const bot = state.bottomText.trim();
    if (top) wrap(c, top, S - 70).forEach((l, i) => put(l, 34 + fs + i * lh));
    if (bot) {
      const lines = wrap(c, bot, S - 70);
      lines.forEach((l, i) => put(l, S - 38 - (lines.length - 1 - i) * lh));
    }
  }
  function drawFrame(c, t, lv, transparent) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    if (!transparent) { c.fillStyle = state.bg; c.fillRect(0, 0, S, S); }
    c.save();
    animTransform(c, t, lv);
    const bw = state.border ? 14 : 0;
    if (bw) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,.28)';
      c.shadowBlur = 14;
      c.fillStyle = '#ffffff';
      shapePath(c, 8);
      c.fill();
      c.restore();
    }
    c.save();
    shapePath(c, bw ? 8 + bw : 0);
    c.clip();
    c.fillStyle = state.bg;
    c.fillRect(0, 0, S, S);
    drawMedia(c);
    c.restore();
    drawTexts(c);
    c.restore();
  }

  let recording = false;
  function loop() {
    if (!recording) drawFrame(g, nowT(), readLevel(), false);
    if (playing) {
      const t = nowT();
      videoTrim.setHead(state.videoStart + t);
      audioTrim.setHead(state.soundKind === 'video' ? null : state.soundStart + t);
    } else {
      videoTrim.setHead(null);
      audioTrim.setHead(null);
    }
    requestAnimationFrame(loop);
  }

  /* ================= Pasos ================= */
  let step = 1;
  function go(n) {
    step = Math.max(1, Math.min(5, n));
    $$('.step').forEach((s) => s.classList.toggle('hidden', +s.dataset.step !== step));
    $$('#stepper li').forEach((li) => {
      const k = +li.dataset.go;
      li.classList.toggle('on', k === step);
      li.classList.toggle('done', k < step);
    });
    $('#btnBack').disabled = step === 1;
    $('#btnNext').classList.toggle('hidden', step === 5);
    if (step === 2) requestAnimationFrame(() => videoTrim.redraw());
    if (step === 4) { refreshSoundUI(); requestAnimationFrame(() => audioTrim.redraw()); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#btnBack').addEventListener('click', () => go(step - 1));
  $('#btnNext').addEventListener('click', () => go(step + 1));
  $$('#stepper li').forEach((li) => li.addEventListener('click', () => go(+li.dataset.go)));
  window.addEventListener('resize', () => { videoTrim.redraw(); audioTrim.redraw(); });

  /* ================= Recortadores ================= */
  const videoTrim = Trimmer($('#videoTrim'), {
    onChange(s, l) {
      state.videoStart = s;
      state.duration = l;
      if (!playing && state.video) state.video.currentTime = s;
      syncAudioTrim();
    },
    onCommit: () => play(),
  });
  const audioTrim = Trimmer($('#audioTrim'), {
    onChange(s, l) {
      state.soundStart = s;
      if (!isVideo()) setDuration(l);
    },
    onCommit: () => play(),
  });
  function syncAudioTrim() {
    const buf = currentBuffer();
    if (!buf || state.soundKind === 'video') return;
    audioTrim.setTotal(buf.duration);
    audioTrim.setFixed(isVideo());
    audioTrim.set(state.soundStart, isVideo() ? Math.min(state.duration, buf.duration) : state.duration);
    state.soundStart = audioTrim.start;
  }
  function setDuration(d) {
    state.duration = Math.round(d * 10) / 10;
    $('#duration').value = state.duration;
    $('#durationVal').textContent = state.duration.toFixed(1) + ' s';
  }

  /* ================= Paso 1: base ================= */
  function resetPos() { state.offX = 0; state.offY = 0; state.zoom = 1; $('#zoom').value = 1; }
  function clearVideo() {
    if (state.video) { state.video.pause(); state.video.remove(); }
    state.video = null;
    state.videoBuffer = null;
    $('#videoTrimBox').classList.add('hidden');
    $('#videoSoundMsg').textContent = 'Primero elegí un video en el paso 1.';
    if (state.soundKind === 'video') state.soundKind = 'none';
  }

  $('#inImage').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    const img = new Image();
    img.onload = () => {
      clearVideo();
      state.img = img;
      state.mediaType = 'image';
      resetPos();
      $('#emojiBox').classList.add('hidden');
      go(2);
    };
    img.onerror = () => { $('#loadMsg').textContent = '❌ No pude abrir esa imagen. Probá con JPG o PNG.'; };
    img.src = URL.createObjectURL(f);
  });

  $('#inVideo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    clearVideo();
    ensureAudio();
    $('#loadMsg').textContent = '⏳ Abriendo el video…';
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.loop = true;
    v.preload = 'auto';
    v.className = 'src-video';
    $('.canvas-wrap').appendChild(v);
    v.src = url;
    v.addEventListener('error', () => { $('#loadMsg').textContent = '❌ No pude abrir ese video. Probá con un MP4.'; }, { once: true });
    await once(v, 'loadeddata', 15000);
    if (!v.videoWidth) return;
    state.video = v;
    state.mediaType = 'video';
    state.videoStart = 0;
    resetPos();
    $('#emojiBox').classList.add('hidden');
    $('#loadMsg').textContent = '';
    const total = isFinite(v.duration) ? v.duration : MAX_DUR;
    videoTrim.painter = null;
    videoTrim.setTotal(total);
    videoTrim.set(0, Math.min(5, total));
    state.duration = videoTrim.len;
    $('#videoTrimBox').classList.remove('hidden');
    go(2);
    captureThumbs(url, total).then((frames) => {
      videoTrim.painter = thumbPainter(frames);
      videoTrim.redraw();
    });
    $('#videoSoundMsg').textContent = '⏳ Leyendo el sonido del video…';
    try {
      state.videoBuffer = await decode(await f.arrayBuffer());
      $('#videoSoundMsg').textContent = '✅ Suena la misma parte que elegiste del video en el paso 2.';
      if (state.soundKind === 'none') state.soundKind = 'video';
    } catch (err) {
      $('#videoSoundMsg').textContent = 'Este video no tiene sonido. Subí un audio o grabá tu voz.';
    }
    refreshSoundUI();
  });

  $('#btnEmoji').addEventListener('click', () => {
    stopPlay();
    clearVideo();
    state.mediaType = 'emoji';
    resetPos();
    $('#emojiBox').classList.remove('hidden');
  });
  $('#emojiInput').addEventListener('input', (e) => { state.emoji = e.target.value; });
  ['😂', '🤣', '😭', '💀', '🤡', '🔥', '😎', '🙄', '😱', '🥵', '👀', '🫠', '🐸', '🐶', '💩', '❤️'].forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.addEventListener('click', () => { state.emoji = em; $('#emojiInput').value = em; });
    $('#emojiQuick').appendChild(b);
  });

  /* ================= Paso 2 y 3 ================= */
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: state.offX, oy: state.offY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = S / cv.getBoundingClientRect().width;
    state.offX = drag.ox + (e.clientX - drag.x) * k;
    state.offY = drag.oy + (e.clientY - drag.y) * k;
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  $('#zoom').addEventListener('input', (e) => { state.zoom = +e.target.value; });
  function segment(id, key) {
    $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
      $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v;
    }));
  }
  segment('fitSeg', 'fit');
  segment('shapeSeg', 'shape');
  $('#topText').addEventListener('input', (e) => { state.topText = e.target.value; });
  $('#bottomText').addEventListener('input', (e) => { state.bottomText = e.target.value; });
  $('#textColor').addEventListener('input', (e) => { state.textColor = e.target.value; });
  $('#textSize').addEventListener('input', (e) => { state.textSize = +e.target.value; });
  $('#bg').addEventListener('input', (e) => { state.bg = e.target.value; });
  $('#border').addEventListener('change', (e) => { state.border = e.target.checked; });
  $('#anim').addEventListener('change', (e) => { state.anim = e.target.value; });

  /* ================= Paso 4: sonido ================= */
  let tab = 'file';
  function showTab(t) {
    tab = t;
    $$('#soundTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
  }
  function refreshSoundUI() {
    showTab(state.soundKind !== 'none' ? state.soundKind : tab);
    const labels = { none: '🔇 Sin sonido', file: '📁 ' + state.fileName, mic: '🎙️ Tu grabación', video: '🎞️ Sonido original del video' };
    $('#soundLabel').textContent = labels[state.soundKind];
    const buf = currentBuffer();
    const showTrim = !!buf && state.soundKind !== 'video';
    $('#audioTrimBox').classList.toggle('hidden', !showTrim);
    $('#audioTrimHelp').textContent = isVideo()
      ? 'Arrastrá la franja para elegir qué parte del sonido acompaña al video.'
      : 'Arrastrá los bordes para elegir qué parte del sonido suena (máx. 5 s).';
    $('#durationField').classList.toggle('hidden', isVideo() || !!buf);
    if (showTrim) {
      audioTrim.painter = wavePainter(buf);
      syncAudioTrim();
      requestAnimationFrame(() => audioTrim.redraw());
    }
  }
  function useSound(kind) {
    state.soundKind = kind;
    state.soundStart = 0;
    const buf = currentBuffer();
    if (buf && kind !== 'video' && !isVideo()) setDuration(Math.min(MAX_DUR, buf.duration));
    refreshSoundUI();
  }
  $$('#soundTabs button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    stopPlay();
    const avail = { video: state.videoBuffer, file: state.fileBuffer, mic: state.micBuffer };
    if (t !== 'none' && avail[t]) useSound(t);
    else { state.soundKind = 'none'; tab = t; refreshSoundUI(); }
    showTab(t);
  }));

  $('#inAudio').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    $('#fileName').textContent = '⏳ Leyendo ' + f.name + '…';
    try {
      state.fileBuffer = await decode(await f.arrayBuffer());
      state.fileName = f.name;
      $('#fileName').textContent = '✅ ' + f.name + ' (' + state.fileBuffer.duration.toFixed(1) + ' s)';
      useSound('file');
      play();
    } catch (err) {
      $('#fileName').textContent = '❌ No pude leer ese archivo. Probá con MP3, M4A u OGG.';
    }
  });

  let micRec = null;
  $('#btnMic').addEventListener('click', async () => {
    if (micRec) { micRec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      $('#micStatus').textContent = 'Tu navegador no permite grabar. Probá con Chrome o Safari.';
      return;
    }
    stopPlay();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) {
      $('#micStatus').textContent = '❌ No diste permiso para el micrófono.';
      return;
    }
    const chunks = [];
    micRec = new MediaRecorder(stream);
    micRec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    let micTimer = null;
    micRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(micTimer);
      micRec = null;
      $('#btnMic').textContent = '⏺️ Grabar de nuevo (máx. 10 s)';
      try {
        const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
        state.micBuffer = await decode(await blob.arrayBuffer());
        $('#micStatus').textContent = '✅ Grabación lista (' + state.micBuffer.duration.toFixed(1) + ' s).';
        useSound('mic');
        play();
      } catch (err) {
        $('#micStatus').textContent = '❌ No pude procesar la grabación.';
      }
    };
    micRec.start();
    $('#btnMic').textContent = '⏹️ Parar grabación';
    $('#micStatus').textContent = '🔴 Grabando… hablá ahora.';
    micTimer = setTimeout(() => micRec && micRec.stop(), MAX_REC * 1000);
  });

  $('#duration').addEventListener('input', (e) => setDuration(+e.target.value));
  $('#volume').addEventListener('input', (e) => {
    state.volume = +e.target.value;
    $('#volumeVal').textContent = Math.round(state.volume * 100) + ' %';
  });
  $('#btnPlay').addEventListener('click', () => { if (playing) stopPlay(); else play(); });

  /* ================= Paso 5: crear ================= */
  function pickMime() {
    const list = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const m of list) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  function setBusy(on) {
    ['#btnMakeVideo', '#btnMakeSticker', '#btnPlay', '#btnBack'].forEach((s) => { $(s).disabled = on; });
    $('#progress').classList.toggle('hidden', !on);
    $('#progressBar').style.width = '0%';
  }

  $('#btnMakeVideo').addEventListener('click', async () => {
    if (!window.MediaRecorder || !cv.captureStream) {
      alert('Tu navegador no puede crear videos. Usá Chrome (Android/PC) o Safari actualizado (iPhone).');
      return;
    }
    stopPlay();
    ensureAudio();
    await actx.resume();
    setBusy(true);
    $('#result').innerHTML = '';
    const mime = pickMime();
    const vStream = cv.captureStream(30);
    const tracks = [...vStream.getVideoTracks()];
    if (mediaDest) tracks.push(...mediaDest.stream.getAudioTracks());
    let rec;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 } : {});
    } catch (err) {
      rec = new MediaRecorder(new MediaStream(tracks));
    }
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    recording = true;
    const iv = setInterval(() => {
      drawFrame(g, nowT(), readLevel(), false);
      $('#progressBar').style.width = Math.min(100, (nowT() / state.duration) * 100) + '%';
    }, 33);
    drawFrame(g, 0, 0, false);
    rec.start(250);
    await play();
    await new Promise((r) => setTimeout(r, 120));
    rec.stop();
    await stopped;
    clearInterval(iv);
    recording = false;
    vStream.getTracks().forEach((t) => t.stop());
    setBusy(false);
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0] || 'video/webm';
    const blob = new Blob(chunks, { type });
    if (!blob.size) { alert('No se pudo grabar el video. Probá de nuevo.'); return; }
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    showResult(blob, `sticker-wow.${ext}`, 'video', ext === 'webm'
      ? 'Tu navegador creó el video en formato WebM y WhatsApp a veces no lo acepta. Si falla, usá Chrome actualizado o Safari.'
      : '');
  });

  $('#btnMakeSticker').addEventListener('click', async () => {
    stopPlay();
    const off = document.createElement('canvas');
    off.width = off.height = S;
    const c = off.getContext('2d');
    const keep = state.anim;
    state.anim = 'none';
    drawFrame(c, 0, 0, true);
    state.anim = keep;
    let q = 0.92;
    let blob = null;
    do {
      blob = await new Promise((r) => off.toBlob(r, 'image/webp', q));
      q -= 0.12;
    } while (blob && blob.type === 'image/webp' && blob.size > 100 * 1024 && q > 0.2);
    let warn = '';
    if (!blob || blob.type !== 'image/webp') {
      blob = await new Promise((r) => off.toBlob(r, 'image/png'));
      warn = 'Se guardó como PNG porque tu navegador no crea WebP. WhatsApp lo acepta igual.';
    }
    showResult(blob, `sticker-wow.${blob.type === 'image/webp' ? 'webp' : 'png'}`, 'image', warn);
  });

  let lastUrl = null;
  function showResult(blob, name, kind, warn) {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    const url = (lastUrl = URL.createObjectURL(blob));
    const file = new File([blob], name, { type: blob.type });
    const box = document.createElement('div');
    box.className = 'result-box';
    const media = document.createElement(kind === 'image' ? 'img' : kind);
    media.src = url;
    if (kind !== 'image') { media.controls = true; media.playsInline = true; }
    if (kind === 'video') media.loop = true;
    box.appendChild(media);
    const row = document.createElement('div');
    row.className = 'row-btns';
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'btn primary';
      sb.textContent = '📲 Enviar / Compartir';
      sb.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
      row.appendChild(sb);
    }
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = url;
    a.download = name;
    a.textContent = '⬇️ Descargar';
    row.appendChild(a);
    box.appendChild(row);
    if (warn) {
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = warn;
      box.appendChild(p);
    }
    $('#result').innerHTML = '';
    $('#result').appendChild(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ================= Inicio ================= */
  if (document.fonts && document.fonts.load) document.fonts.load('40px Anton').catch(() => {});
  go(1);
  refreshSoundUI();
  requestAnimationFrame(loop);
})();
