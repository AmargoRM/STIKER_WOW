/* Biblioteca de sonidos de Sticker WOW.
   Todos los sonidos se fabrican aquí mismo con código (síntesis de audio),
   así no dependen de archivos externos ni tienen problemas de derechos de autor. */
(function () {
  const SR = 44100;

  function make(dur) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ctx.destination);
    return { ctx, out };
  }

  function env(g, t, d, v, a, r) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, Math.max(t + a, t + d - r));
    g.gain.linearRampToValueAtTime(0, t + d);
  }

  function tone(ctx, out, o) {
    const { type = 'sine', f, f2, t = 0, d, v = 0.3, a = 0.01, r = 0.05, lp, vib, vibDepth = 0, vibDecay = false, detune = 0 } = o;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + d);
    osc.detune.value = detune;
    if (vib) {
      const l = ctx.createOscillator();
      l.frequency.value = vib;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(vibDepth, t);
      if (vibDecay) lg.gain.linearRampToValueAtTime(0, t + d);
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t);
      l.stop(t + d + 0.01);
    }
    const g = ctx.createGain();
    env(g, t, d, v, a, r);
    let node = osc;
    if (lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = lp;
      osc.connect(fl);
      node = fl;
    }
    node.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + d + 0.02);
  }

  function noise(ctx, out, o) {
    const { t = 0, d, v = 0.3, type = 'lowpass', freq = 1000, f2, q = 1, a = 0.004, decay = true } = o;
    const len = Math.ceil(SR * d);
    const b = ctx.createBuffer(1, len, SR);
    const ch = b.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(freq, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, t + d);
    else {
      g.gain.setValueAtTime(v, Math.max(t + a, t + d - 0.05));
      g.gain.linearRampToValueAtTime(0, t + d);
    }
    s.connect(fl);
    fl.connect(g);
    g.connect(out);
    s.start(t);
    s.stop(t + d);
  }

  const kick = (c, o, t, v = 0.9) => tone(c, o, { f: 150, f2: 40, t, d: 0.32, v, a: 0.002, r: 0.3 });
  const snare = (c, o, t, v = 0.5) => {
    noise(c, o, { t, d: 0.2, v, type: 'bandpass', freq: 1900, q: 0.7 });
    tone(c, o, { type: 'triangle', f: 210, f2: 120, t, d: 0.1, v: v * 0.6, a: 0.002, r: 0.09 });
  };
  const hat = (c, o, t, v = 0.18) => noise(c, o, { t, d: 0.05, v, type: 'highpass', freq: 7000 });

  const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const nf = (n) => 440 * Math.pow(2, (NOTE[n[0]] + (n[1] === '#' ? 1 : 0) + (parseInt(n.slice(-1), 10) - 4) * 12) / 12);

  const SOUNDS = [
    { id: 'bocina', emoji: '📯', name: 'Bocina', dur: 2.1, build(c, o) {
      [[0, 0.17], [0.21, 0.17], [0.42, 0.17], [0.66, 1.3]].forEach(([t, d]) => {
        [440, 443, 554.4, 659].forEach((f) => tone(c, o, { type: 'sawtooth', f, f2: f * 0.97, t, d, v: 0.13, a: 0.01, r: 0.06, lp: 2600 }));
      });
    } },
    { id: 'trombon', emoji: '🎺', name: 'Trombón triste', dur: 3.1, build(c, o) {
      const n = [[293.66, 0, 0.45], [277.18, 0.5, 0.45], [261.63, 1.0, 0.45], [246.94, 1.5, 1.5]];
      n.forEach(([f, t, d], i) => {
        const last = i === 3;
        tone(c, o, { type: 'sawtooth', f, t, d, v: 0.35, a: 0.05, r: last ? 0.5 : 0.1, lp: 1200, vib: last ? 5.5 : 0, vibDepth: last ? 7 : 0 });
        tone(c, o, { type: 'square', f: f / 2, t, d, v: 0.08, a: 0.05, r: 0.1, lp: 700 });
      });
    } },
    { id: 'badumtss', emoji: '🥁', name: 'Ba dum tss', dur: 1.7, build(c, o) {
      tone(c, o, { f: 230, f2: 110, t: 0, d: 0.25, v: 0.7, a: 0.002, r: 0.23 });
      tone(c, o, { f: 165, f2: 80, t: 0.2, d: 0.3, v: 0.7, a: 0.002, r: 0.28 });
      kick(c, o, 0.45);
      noise(c, o, { t: 0.45, d: 1.2, v: 0.45, type: 'highpass', freq: 6000 });
    } },
    { id: 'boing', emoji: '🦘', name: 'Boing', dur: 1.0, build(c, o) {
      tone(c, o, { type: 'triangle', f: 200, f2: 330, t: 0, d: 0.95, v: 0.5, a: 0.005, r: 0.6, vib: 13, vibDepth: 90, vibDecay: true });
    } },
    { id: 'dramatico', emoji: '😱', name: 'Dun dun duuun', dur: 3.3, build(c, o) {
      [[220, 0, 0.35], [196, 0.45, 0.35], [185, 0.9, 2.3]].forEach(([f, t, d], i) => {
        tone(c, o, { type: 'sawtooth', f, t, d, v: 0.3, a: 0.02, r: i === 2 ? 1.2 : 0.08, lp: 900, vib: i === 2 ? 6 : 0, vibDepth: 3 });
        tone(c, o, { type: 'sawtooth', f: f / 2, t, d, v: 0.25, a: 0.02, r: i === 2 ? 1.2 : 0.08, lp: 600 });
        kick(c, o, t, 0.8);
      });
    } },
    { id: 'correcto', emoji: '✅', name: 'Correcto', dur: 1.3, build(c, o) {
      tone(c, o, { f: 1046.5, t: 0, d: 0.15, v: 0.3, a: 0.003, r: 0.05 });
      tone(c, o, { f: 1568, t: 0.12, d: 1.1, v: 0.3, a: 0.003, r: 1.0 });
      tone(c, o, { type: 'triangle', f: 3136, t: 0.12, d: 0.6, v: 0.06, a: 0.003, r: 0.55 });
    } },
    { id: 'error', emoji: '❌', name: 'Error', dur: 0.95, build(c, o) {
      [[0, 0.35], [0.42, 0.5]].forEach(([t, d]) => {
        tone(c, o, { type: 'square', f: 116, t, d, v: 0.2, lp: 1600 });
        tone(c, o, { type: 'sawtooth', f: 110, t, d, v: 0.2, lp: 1600 });
      });
    } },
    { id: 'grillos', emoji: '🦗', name: 'Grillos (silencio incómodo)', dur: 3.2, build(c, o) {
      [[4400, 0], [4750, 0.23]].forEach(([f, off]) => {
        for (let t = off; t < 3; t += 0.5 + Math.random() * 0.08) {
          for (let k = 0; k < 3; k++) tone(c, o, { f, t: t + k * 0.045, d: 0.03, v: 0.12, a: 0.004, r: 0.02 });
        }
      });
    } },
    { id: 'explosion', emoji: '💥', name: 'Explosión', dur: 2.6, build(c, o) {
      noise(c, o, { t: 0, d: 2.5, v: 1, type: 'lowpass', freq: 1400, f2: 90 });
      tone(c, o, { f: 85, f2: 28, t: 0, d: 0.9, v: 0.9, a: 0.003, r: 0.85 });
    } },
    { id: 'laser', emoji: '⚡', name: 'Láser', dur: 0.9, build(c, o) {
      [0, 0.25, 0.5].forEach((t) => tone(c, o, { type: 'square', f: 1900, f2: 180, t, d: 0.2, v: 0.18, a: 0.002, r: 0.05 }));
    } },
    { id: 'tada', emoji: '🎉', name: 'Tadá', dur: 2.3, build(c, o) {
      tone(c, o, { type: 'sawtooth', f: 523.25, t: 0, d: 0.12, v: 0.2, lp: 2200 });
      tone(c, o, { type: 'sawtooth', f: 523.25, t: 0.15, d: 0.12, v: 0.2, lp: 2200 });
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(c, o, { type: 'sawtooth', f, t: 0.3, d: 1.9, v: 0.12, a: 0.02, r: 0.8, lp: 2600, vib: 5, vibDepth: 3 }));
      noise(c, o, { t: 0.3, d: 1.5, v: 0.3, type: 'highpass', freq: 6500 });
    } },
    { id: 'aplausos', emoji: '👏', name: 'Aplausos', dur: 3.0, build(c, o) {
      for (let i = 0; i < 220; i++) {
        const t = Math.pow(Math.random(), 1.3) * 2.8;
        noise(c, o, { t, d: 0.06, v: 0.12 + Math.random() * 0.25, type: 'bandpass', freq: 900 + Math.random() * 1600, q: 1.2 });
      }
    } },
    { id: 'alarma', emoji: '🚨', name: 'Alarma', dur: 2.5, build(c, o) {
      for (let i = 0; i < 10; i++) tone(c, o, { type: 'square', f: i % 2 ? 660 : 880, t: i * 0.25, d: 0.24, v: 0.14, a: 0.005, r: 0.01, lp: 3000 });
    } },
    { id: 'suspenso', emoji: '🎻', name: 'Suspenso', dur: 4.0, build(c, o) {
      const g = c.createGain();
      g.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = 9;
      const lg = c.createGain();
      lg.gain.value = 0.45;
      lfo.connect(lg);
      lg.connect(g.gain);
      lfo.start(0);
      g.connect(o);
      [110, 116.5, 220].forEach((f) => tone(c, g, { type: 'sawtooth', f, f2: f * 2, t: 0, d: 3.9, v: 0.18, a: 0.6, r: 0.4, lp: 900 }));
    } },
    { id: 'pedo', emoji: '💨', name: 'Pedo', dur: 1.2, build(c, o) {
      tone(c, o, { type: 'sawtooth', f: 95, f2: 60, t: 0, d: 1.0, v: 0.55, a: 0.02, r: 0.3, lp: 420, vib: 28, vibDepth: 22 });
      noise(c, o, { t: 0, d: 1.0, v: 0.25, type: 'lowpass', freq: 320 });
    } },
    { id: 'moneda', emoji: '🪙', name: 'Moneda', dur: 0.6, build(c, o) {
      tone(c, o, { type: 'square', f: 988, t: 0, d: 0.08, v: 0.18, a: 0.002, r: 0.01 });
      tone(c, o, { type: 'square', f: 1319, t: 0.08, d: 0.45, v: 0.18, a: 0.002, r: 0.4 });
    } },
    { id: 'fiesta', emoji: '🕹️', name: 'Canción: Fiesta 8 bits', dur: 6.9, build(c, o) {
      const st = 60 / 140 / 2;
      const mel = ['C5', 'E5', 'G5', 'E5', 'A5', 'G5', 'E5', 'C5', 'D5', 'F5', 'A5', 'F5', 'G5', '-', '-', '-',
        'E5', 'G5', 'C6', 'G5', 'A5', 'F5', 'D5', 'F5', 'G5', 'E5', 'C5', 'D5', 'C5', '-', '-', '-'];
      mel.forEach((n, i) => { if (n !== '-') tone(c, o, { type: 'square', f: nf(n), t: i * st, d: st * 0.9, v: 0.1, a: 0.005, r: 0.03 }); });
      const bass = ['C3', 'F3', 'G3', 'C3'];
      for (let i = 0; i < 32; i++) {
        const root = nf(bass[Math.floor(i / 8)]);
        tone(c, o, { type: 'triangle', f: i % 2 ? root * 2 : root, t: i * st, d: st * 0.9, v: 0.22, a: 0.005, r: 0.03 });
        if (i % 2 === 1) hat(c, o, i * st, 0.08);
        if (i % 4 === 0) kick(c, o, i * st, 0.5);
      }
    } },
    { id: 'dembow', emoji: '🔊', name: 'Canción: Ritmo dembow', dur: 5.1, build(c, o) {
      const st = 60 / 95 / 4;
      for (let i = 0; i < 32; i++) {
        const s = i % 16;
        const t = i * st;
        if (s % 4 === 0) kick(c, o, t);
        if ([3, 6, 11, 14].includes(s)) snare(c, o, t, 0.45);
        if (s % 2 === 0) hat(c, o, t, 0.1);
        if (s === 0 || s === 8) tone(c, o, { f: s === 0 ? 55 : 49, t, d: st * 6, v: 0.45, a: 0.01, r: 0.1 });
      }
    } },
  ];

  const cache = new Map();
  function get(id) {
    if (!cache.has(id)) {
      const s = SOUNDS.find((x) => x.id === id);
      const { ctx, out } = make(s.dur);
      s.build(ctx, out);
      cache.set(id, ctx.startRendering());
    }
    return cache.get(id);
  }

  window.SoundLib = { list: SOUNDS.map(({ id, emoji, name }) => ({ id, emoji, name })), get };
})();
