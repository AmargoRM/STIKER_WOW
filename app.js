(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const S = 512;
  const MAX_DUR = 10;
  const cv = $('#cv');
  const g = cv.getContext('2d');

  const state = {
    mediaType: 'emoji', img: null, video: null, emoji: '😂',
    zoom: 1, offX: 0, offY: 0, fit: 'cover', videoStart: 0,
    topText: '', bottomText: '', textColor: '#ffffff', textSize: 58,
    shape: 'square', border: false, bg: '#ffffff', anim: 'none',
    soundKind: 'none', soundId: null, soundName: '',
    fileBuffer: null, fileName: '', micBuffer: null, videoBuffer: null,
    soundStart: 0, duration: 3, volume: 1,
  };

  /* ---------- Audio ---------- */
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
  async function currentBuffer() {
    switch (state.soundKind) {
      case 'lib': return state.soundId ? SoundLib.get(state.soundId) : null;
      case 'file': return state.fileBuffer;
      case 'mic': return state.micBuffer;
      case 'video': return state.videoBuffer;
      default: return null;
    }
  }

  let playing = null;
  let idleStart = performance.now();
  function nowT() {
    if (playing && actx) return Math.max(0, actx.currentTime - playing.startAt);
    return ((performance.now() - idleStart) / 1000) % Math.max(state.duration, 0.5);
  }

  async function play() {
    stopPlay();
    ensureAudio();
    const buf = await currentBuffer();
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
      const wanted = state.soundKind === 'video' ? state.videoStart : state.soundStart;
      const off = Math.min(wanted, Math.max(0, buf.duration - 0.05));
      src.start(startAt, off);
      src.stop(startAt + dur);
    }
    if (state.mediaType === 'video' && state.video) {
      const v = state.video;
      v.currentTime = state.videoStart;
      try { await v.play(); } catch (e) { /* sin reproducción automática */ }
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
    $('#btnPlay').textContent = playing ? '⏹ Parar' : '▶ Escuchar';
  }

  const td = new Uint8Array(1024);
  let level = 0;
  function readLevel() {
    if (!analyser || !playing) { level *= 0.9; return level; }
    analyser.getByteTimeDomainData(td);
    let s = 0;
    for (let i = 0; i < td.length; i++) { const x = (td[i] - 128) / 128; s += x * x; }
    const rms = Math.min(1, Math.sqrt(s / td.length) * 3.2);
    level = Math.max(rms, level * 0.85);
    return level;
  }

  /* ---------- Dibujo ---------- */
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
    const base = 1;
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
    c.scale(base * s, base * s);
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
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
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
    requestAnimationFrame(loop);
  }

  /* ---------- Arrastrar ---------- */
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

  /* ---------- Paso 1: imagen / video / emoji ---------- */
  function resetPos() { state.offX = 0; state.offY = 0; state.zoom = 1; $('#zoom').value = 1; }
  function showEmojiBox(on) { $('#emojiBox').classList.toggle('hidden', !on); }
  function clearVideo() {
    if (state.video) { state.video.pause(); URL.revokeObjectURL(state.video.src); state.video.remove(); }
    state.video = null;
    state.videoBuffer = null;
    $('#videoStartField').classList.add('hidden');
    $('#videoSoundMsg').textContent = 'Primero subí un video en el paso 1.';
    if (state.soundKind === 'video') setSoundKind('none');
  }

  $('#inImage').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    const img = new Image();
    img.onload = () => { clearVideo(); state.img = img; state.mediaType = 'image'; resetPos(); showEmojiBox(false); };
    img.onerror = () => alert('No pude abrir esa imagen. Probá con JPG o PNG.');
    img.src = URL.createObjectURL(f);
  });

  $('#inVideo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    clearVideo();
    ensureAudio();
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.loop = true;
    v.preload = 'auto';
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
    document.body.appendChild(v);
    v.src = URL.createObjectURL(f);
    v.addEventListener('loadeddata', () => {
      state.video = v;
      state.mediaType = 'video';
      state.videoStart = 0;
      resetPos();
      showEmojiBox(false);
      const vs = $('#videoStart');
      vs.max = Math.max(0, (v.duration || 1) - 0.5).toFixed(1);
      vs.value = 0;
      $('#videoStartVal').textContent = '0';
      $('#videoStartField').classList.remove('hidden');
      v.currentTime = 0;
    }, { once: true });
    v.addEventListener('error', () => alert('No pude abrir ese video. Probá con un MP4.'), { once: true });

    $('#videoSoundMsg').textContent = 'Leyendo el sonido del video…';
    try {
      const buf = await decode(await f.arrayBuffer());
      state.videoBuffer = buf;
      $('#videoSoundMsg').textContent = '✅ Se usará el sonido original del video, sincronizado con la imagen.';
      if (state.soundKind === 'none') setSoundKind('video');
    } catch (err) {
      $('#videoSoundMsg').textContent = 'Este video no tiene sonido (o no lo pude leer). Elegí uno de la biblioteca.';
    }
  });

  $('#btnEmoji').addEventListener('click', () => {
    stopPlay();
    clearVideo();
    state.mediaType = 'emoji';
    resetPos();
    showEmojiBox(true);
  });
  $('#emojiInput').addEventListener('input', (e) => { state.emoji = e.target.value; });
  const quick = ['😂', '🤣', '😭', '💀', '🤡', '🔥', '😎', '🙄', '😱', '🥵', '👀', '🫠', '🐸', '🐶', '💩', '❤️'];
  quick.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.addEventListener('click', () => { state.emoji = em; $('#emojiInput').value = em; });
    $('#emojiQuick').appendChild(b);
  });

  $('#zoom').addEventListener('input', (e) => { state.zoom = +e.target.value; });
  $('#videoStart').addEventListener('input', (e) => {
    state.videoStart = +e.target.value;
    $('#videoStartVal').textContent = state.videoStart.toFixed(1);
    if (state.video && !playing) state.video.currentTime = state.videoStart;
  });

  function segment(id, key) {
    $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
      $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v;
    }));
  }
  segment('fitSeg', 'fit');
  segment('shapeSeg', 'shape');

  /* ---------- Paso 2 y 3 ---------- */
  $('#topText').addEventListener('input', (e) => { state.topText = e.target.value; });
  $('#bottomText').addEventListener('input', (e) => { state.bottomText = e.target.value; });
  $('#textColor').addEventListener('input', (e) => { state.textColor = e.target.value; });
  $('#textSize').addEventListener('input', (e) => { state.textSize = +e.target.value; });
  $('#bg').addEventListener('input', (e) => { state.bg = e.target.value; });
  $('#border').addEventListener('change', (e) => { state.border = e.target.checked; });
  $('#anim').addEventListener('change', (e) => { state.anim = e.target.value; });

  /* ---------- Paso 4: sonido ---------- */
  function showTab(tab) {
    $$('#soundTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
  }
  $$('#soundTabs button').forEach((b) => b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    showTab(tab);
    if (tab === 'none') setSoundKind('none');
    if (tab === 'video' && state.videoBuffer) setSoundKind('video');
    if (tab === 'file' && state.fileBuffer) setSoundKind('file');
    if (tab === 'mic' && state.micBuffer) setSoundKind('mic');
  }));

  async function setSoundKind(kind) {
    state.soundKind = kind;
    $$('.sound-btn').forEach((b) => b.classList.toggle('on', kind === 'lib' && b.dataset.id === state.soundId));
    const buf = await currentBuffer();
    const labels = {
      none: 'Sin sonido',
      lib: '🎵 ' + state.soundName,
      file: '📁 ' + state.fileName,
      mic: '🎙️ Tu grabación',
      video: '🎞️ Sonido del video',
    };
    $('#soundLabel').textContent = labels[kind] || 'Sin sonido';
    const ss = $('#soundStart');
    const showStart = buf && (kind === 'file' || kind === 'mic');
    $('#soundStartField').classList.toggle('hidden', !showStart);
    if (buf) {
      ss.max = Math.max(0, buf.duration - 0.3).toFixed(2);
      if (state.soundStart > +ss.max) state.soundStart = 0;
      ss.value = state.soundStart;
      $('#soundStartVal').textContent = state.soundStart.toFixed(1) + ' s';
      let avail = kind === 'video' ? buf.duration - state.videoStart : buf.duration - state.soundStart;
      if (kind === 'video' && state.video && state.video.duration) avail = state.video.duration - state.videoStart;
      setDuration(Math.min(MAX_DUR, Math.max(0.5, avail)));
    }
  }
  function setDuration(d) {
    state.duration = Math.round(d * 10) / 10;
    $('#duration').value = state.duration;
    $('#durationVal').textContent = state.duration.toFixed(1) + ' s';
  }

  SoundLib.list.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sound-btn';
    b.dataset.id = s.id;
    b.innerHTML = `<span class="e">${s.emoji}</span><span></span>`;
    b.lastChild.textContent = s.name;
    b.addEventListener('click', async () => {
      ensureAudio();
      state.soundId = s.id;
      state.soundName = s.name;
      state.soundStart = 0;
      await setSoundKind('lib');
      play();
    });
    $('#soundGrid').appendChild(b);
  });

  $('#inAudio').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPlay();
    $('#fileName').textContent = 'Leyendo ' + f.name + '…';
    try {
      state.fileBuffer = await decode(await f.arrayBuffer());
      state.fileName = f.name;
      state.soundStart = 0;
      $('#fileName').textContent = '✅ ' + f.name + ' (' + state.fileBuffer.duration.toFixed(1) + ' s). Usá “Empezar el sonido en” para elegir la parte que querés.';
      await setSoundKind('file');
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
    micRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(micTimer);
      micRec = null;
      $('#btnMic').textContent = '⏺️ Grabar de nuevo (máx. 10 s)';
      try {
        const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
        state.micBuffer = await decode(await blob.arrayBuffer());
        state.soundStart = 0;
        $('#micStatus').textContent = '✅ Grabación lista (' + state.micBuffer.duration.toFixed(1) + ' s).';
        await setSoundKind('mic');
        play();
      } catch (err) {
        $('#micStatus').textContent = '❌ No pude procesar la grabación.';
      }
    };
    micRec.start();
    $('#btnMic').textContent = '⏹️ Parar grabación';
    $('#micStatus').textContent = '🔴 Grabando… hablá ahora.';
    const micTimer = setTimeout(() => micRec && micRec.stop(), MAX_DUR * 1000);
  });

  $('#soundStart').addEventListener('input', (e) => {
    state.soundStart = +e.target.value;
    $('#soundStartVal').textContent = state.soundStart.toFixed(1) + ' s';
  });
  $('#soundStart').addEventListener('change', () => play());
  $('#duration').addEventListener('input', (e) => setDuration(+e.target.value));
  $('#volume').addEventListener('input', (e) => {
    state.volume = +e.target.value;
    $('#volumeVal').textContent = Math.round(state.volume * 100) + ' %';
  });

  $('#btnPlay').addEventListener('click', () => { if (playing) stopPlay(); else play(); });

  /* ---------- Paso 5: crear ---------- */
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
    ['#btnMakeVideo', '#btnMakeSticker', '#btnPlay'].forEach((s) => { $(s).disabled = on; });
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

    const type = ((rec.mimeType || mime || 'video/webm').split(';')[0]) || 'video/webm';
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
    state.anim = 'still';
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
      warn = 'Tu navegador no crea WebP, así que se guardó como PNG. Las apps de stickers lo convierten sin problema.';
    }
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    showResult(blob, `sticker-wow.${ext}`, 'image', warn);
  });

  let lastUrl = null;
  function showResult(blob, name, kind, warn) {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    const url = (lastUrl = URL.createObjectURL(blob));
    const file = new File([blob], name, { type: blob.type });
    const box = document.createElement('div');
    box.className = 'result-box';
    const media = document.createElement(kind === 'video' ? 'video' : 'img');
    media.src = url;
    if (kind === 'video') { media.controls = true; media.playsInline = true; media.loop = true; }
    box.appendChild(media);
    const row = document.createElement('div');
    row.className = 'row-btns';
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    if (canShare) {
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'btn wa';
      sb.textContent = '📲 Enviar (WhatsApp)';
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

  /* ---------- Inicio ---------- */
  showTab('lib');
  if (document.fonts && document.fonts.load) document.fonts.load('40px Anton').catch(() => {});
  requestAnimationFrame(loop);
})();
