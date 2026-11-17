/* METEOR DODGE – vanilla JS / Canvas / Web Audio. No dependencies, no network requests. */
(() => {
  'use strict';

  // Logical playfield: always 720 tall. Width is 480 on phones and stretches up to 1280 on wide PC screens.
  const BASE_W = 480, BASE_H = 720, MAX_W = 2560, MAX_H = 1200;
  let W = BASE_W, H = BASE_H;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('game'), ctx = canvas.getContext('2d');

  /* ---------------- Wait for the pixel font so the first screen never shows the wrong font ---------------- */
  { const show = () => document.documentElement.classList.add('fonts-ready');
    let done = false; const once = () => { if (!done) { done = true; show(); } };
    try {
      if (document.fonts && document.fonts.load) {
        Promise.all([document.fonts.load('12px "Press Start 2P"'), document.fonts.ready]).then(once, once);
        setTimeout(once, 1800);                       // never keep the screen hidden for long
      } else once();
    } catch (e) { once(); }
  }

  /* ---------------- Safe storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('meteorDodge.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('meteorDodge.' + k, String(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------------- Settings / constants ---------------- */
  const DIFF = {
    easy:   { speed: 0.75, interval: 1.4,  grace: 4.5, boss: 0.7, bossFirst: 70, bossEvery: 50, label: 'Easy' },
    normal: { speed: 1.0,  interval: 1.0,  grace: 3.5, boss: 1.0, bossFirst: 55, bossEvery: 40, label: 'Normal' },
    hard:   { speed: 1.3,  interval: 0.72, grace: 2.5, boss: 1.3, bossFirst: 45, bossEvery: 32, label: 'Hard' }
  };
  const SIZES = [{ r: 13, speed: 1.15 }, { r: 22, speed: 1.0 }, { r: 34, speed: 0.8 }];
  const LEVEL_SECS = 15;
  const SHIELD_SECS = 6;
  const INVULN_SECS = 1.6;

  // Three ships to choose from on the menu
  const SHIPS = {
    star: { name: 'STAR', speed: 1.0,  cd: 0.2,  r: 15, desc: 'BALANCED ALL-ROUNDER' },
    dart: { name: 'DART', speed: 1.3,  cd: 0.24, r: 12, desc: 'FAST AND SMALL TARGET' },
    tank: { name: 'TANK', speed: 0.82, cd: 0.15, r: 17, desc: 'SLOW BUT SHOOTS FAST' },
    void: { name: 'VOID', speed: 1.12, cd: 0.19, r: 13, desc: 'TWIN SHOT', twin: true }
  };
  // Dart, Tank and Void are earned
  const UNLOCK_HINT = { dart: 'UNLOCK: SCORE 1500 IN ONE RUN', tank: 'UNLOCK: BEAT A BOSS', void: 'UNLOCK: SCORE 5000 IN ONE RUN' };
  const unlocked = new Set(store.get('unlocked', 'star').split(',').filter((k) => SHIPS[k]));
  unlocked.add('star');
  { const b0 = parseInt(store.get('best', '0'), 10) || 0; if (b0 >= 1500) unlocked.add('dart'); if (b0 >= 5000) unlocked.add('void'); }
  let shipId = store.get('ship', 'star'); if (!SHIPS[shipId] || !unlocked.has(shipId)) shipId = 'star';
  let musicOn = store.get('music', '1') === '1';
  const COMBO_SECS = 2.2;
  let difficulty = store.get('difficulty', 'normal'); if (!DIFF[difficulty]) difficulty = 'normal';
  let soundOn = store.get('sound', '1') === '1';
  let padOn = store.get('pad2', '0') === '1';
  let best = parseInt(store.get('best', '0'), 10) || 0;

  /* ---------------- Game state ---------------- */
  let state = 'menu';                           // menu | playing | paused | dying | over
  let t = 0;                                    // seconds survived this run
  let score = 0, shownScore = 0, scoreFrac = 0, stars = 0, lives = 3, level = 0;
  let shield = 0, invuln = 0, dyingT = 0, flash = 0, shakeT = 0, shakeMag = 0, beatBest = false, prevBest = 0;
  let spawnT = 1, starT = 4, shieldT = 18;
  const ship = { x: W / 2, y: H - 110, vx: 0, r: 15 };
  const keys = { left: false, right: false, fire: false };
  let padDir = 0, pointerX = null, padFire = false;
  const meteors = [], items = [];
  const BULLET_SPEED = 780;
  const B = [];                                  // fixed bullet pool
  for (let i = 0; i < 56; i++) B.push({ a: false, x: 0, y: 0 });
  // "Squad" power-up: extra wingman planes (up to 2) that fly beside you and shoot too, for a limited time
  const SQUAD_SECS = 10, WING_X = [46, -46], WING_Y = 14, WING_SCALE = 0.75;
  let squad = 0, squadT = 0, wingSpawnT = 14;
  // "Rapid" power-up: much faster shooting for a while. "Bomb": instantly blows up every meteor on screen.
  const RAPID_SECS = 8, RAPID_COOLDOWN = 0.085;
  let rapid = 0, rapidSpawnT = 22, bombSpawnT = 30;
  let combo = 0, comboT = 0, bestCombo = 0;          // chain kills quickly to raise the score multiplier
  let boss = null, bossT = 55, bossKills = 0;
  const enemies = [];                                // little UFOs that fly across and shoot back
  const EB = [];                                     // enemy bullet pool
  for (let i = 0; i < 30; i++) EB.push({ a: false, x: 0, y: 0, vx: 0, vy: 0 });
  let ebCursor = 0, enemyT = 24;
  let gpDir = 0, gpFire = false; const gpPrev = { a: false, st: false };
  const holes = []; let holeT = 22;                  // black hole hazard
  const POPS = [];                                   // floating "+30" texts (fixed pool)
  for (let i = 0; i < 24; i++) POPS.push({ a: false, x: 0, y: 0, l: 0, txt: '', c: '#fff' });
  let popCursor = 0;
  let fireT = 0, bulletCursor = 0, fireQueued = false;   // fireQueued: a quick tap still fires one shot

  /* ---------------- DOM refs ---------------- */
  const hudScore = $('hudScore'), hudBest = $('hudBest'), livesEl = $('lives'), powerEl = $('power'), powerBar = $('powerBar');
  const power2El = $('power2'), power2Label = $('power2Label'), power2Bar = $('power2Bar');
  const power3El = $('power3'), power3Bar = $('power3Bar'), comboEl = $('combo');
  const toastEl = $('toast');
  const screens = { menu: $('menu'), pause: $('pause'), over: $('over') };
  let shownHudScore = -1, lastToast = 0;

  /* ---------------- Audio (Web Audio, generated) ---------------- */
  let ac = null;
  function audio() {
    if (!soundOn) return null;
    try {
      if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ac = new C(); }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { return null; }
    return ac;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol) {
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = vol;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  }
  const sfx = {
    start() { [330, 440, 660].forEach((f, i) => tone(f, 0.12, 'square', 0.07, 0, i * 0.08)); },
    hit()   { noise(0.35, 0.35); tone(160, 0.3, 'sawtooth', 0.12, 40); },
    star()  { tone(880, 0.08, 'triangle', 0.12); tone(1320, 0.14, 'triangle', 0.12, 0, 0.07); },
    power() { tone(300, 0.35, 'sine', 0.14, 1200); tone(600, 0.35, 'triangle', 0.06, 1800, 0.05); },
    over()  { [440, 330, 247, 165].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.09, f * 0.8, i * 0.2)); noise(0.6, 0.25); },
    shoot() { tone(980, 0.07, 'square', 0.035, 320); },
    boom()  { noise(0.22, 0.22); tone(220, 0.18, 'sawtooth', 0.07, 60); },
    best()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'square', 0.07, 0, i * 0.1)); },
    warn()  { [0, 1, 2].forEach((i) => { tone(420, 0.22, 'square', 0.07, 300, i * 0.32); tone(300, 0.1, 'sawtooth', 0.05, 0, i * 0.32); }); },
    hole()  { noise(0.6, 0.2); tone(90, 0.7, 'sawtooth', 0.09, 35); },
    win()   { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.08, 0, i * 0.09)); noise(0.5, 0.3); }
  };

  // Tiny chiptune loop made with oscillators (Am - F - C - G). Faster during a boss fight.
  const BASS = [110, 87.31, 130.81, 98], ARP = [[440, 523.25, 659.25], [349.23, 440, 523.25], [523.25, 659.25, 784], [392, 493.88, 587.33]];
  const music = {
    on: false, timer: 0, step: 0, next: 0,
    note(f, dur, type, vol, at, slide) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, at); if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at + dur + 0.02);
    },
    hat(at) {
      const n = Math.floor(ac.sampleRate * 0.04), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = 0.03;
      s.buffer = buf; s.connect(f); f.connect(g); g.connect(ac.destination); s.start(at);
    },
    play(step, at) {
      const bar = Math.floor(step / 16) % 4, k = step % 16, fast = !!boss;
      if (k % 2 === 0) this.note(BASS[bar] * (fast && k % 4 === 2 ? 2 : 1), 0.16, fast ? 'sawtooth' : 'triangle', fast ? 0.035 : 0.06, at);
      const ar = ARP[bar], pat = [0, 1, 2, 1, 0, 1, 2, 2][k % 8];
      this.note(ar[pat] * (fast ? 2 : 1), 0.1, 'square', k % 4 === 0 ? 0.028 : 0.016, at);
      if (k % 8 === 0) this.note(130, 0.14, 'sine', 0.12, at, 40);
      if (k % 2 === 1) this.hat(at);
    },
    tick() {
      if (!this.on) return;
      if (!ac || !soundOn || !musicOn) { this.stop(); return; }
      const dur = boss ? 0.105 : 0.14;
      while (this.next < ac.currentTime + 0.3) { this.play(this.step, Math.max(this.next, ac.currentTime)); this.next += dur; this.step++; }
    },
    start() {
      if (this.on || !soundOn || !musicOn) return;
      const a = audio(); if (!a) return;
      this.on = true; this.step = 0; this.next = a.currentTime + 0.12; this.timer = setInterval(() => this.tick(), 80);
    },
    stop() { this.on = false; if (this.timer) clearInterval(this.timer); this.timer = 0; }
  };

  /* ---------------- Particles (fixed pool, no per-frame allocation) ---------------- */
  const P = [];
  for (let i = 0; i < 360; i++) P.push({ a: false, x: 0, y: 0, vx: 0, vy: 0, l: 0, m: 1, s: 2, c: '#fff' });
  let pCursor = 0;
  function emit(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const p = P[pCursor]; pCursor = (pCursor + 1) % P.length;
      const ang = Math.random() * 6.2832, sp = speed * (0.25 + Math.random() * 0.75);
      p.a = true; p.x = x; p.y = y; p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
      p.m = p.l = life * (0.5 + Math.random() * 0.5); p.s = size * (0.5 + Math.random()); p.c = color;
    }
  }

  /* ---------------- Background: nebula + parallax starfield ---------------- */
  // Level themes: every 2 levels (about 30 seconds) the sky and the meteor mix change. Each one has a clearly different colour.
  const THEMES = [
    { name: 'DEEP SPACE',     bg: '#05060f', star: '#cfefff', pal: [1, 1, 1],
      glow: ['rgba(120,40,200,.32)', 'rgba(255,61,168,.16)', 'rgba(34,211,255,.16)', 'rgba(34,211,255,.1)', 'rgba(120,40,200,.18)'] },
    { name: 'TOXIC NEBULA',   bg: '#031a0c', star: '#d8ffe0', pal: [5, 3, 2],
      glow: ['rgba(74,222,128,.50)', 'rgba(190,255,90,.30)', 'rgba(20,140,70,.45)', 'rgba(190,255,90,.28)', 'rgba(74,222,128,.34)'] },
    { name: 'ICE FIELD',      bg: '#0c2f4f', star: '#ffffff', pal: [2, 7, 1],
      glow: ['rgba(160,235,255,.52)', 'rgba(255,255,255,.30)', 'rgba(90,170,255,.50)', 'rgba(210,245,255,.34)', 'rgba(120,210,255,.40)'] },
    { name: 'LAVA ZONE',      bg: '#1a0605', star: '#ffd9b0', pal: [2, 1, 7],
      glow: ['rgba(255,90,40,.45)', 'rgba(255,61,90,.36)', 'rgba(255,154,77,.34)', 'rgba(150,20,10,.50)', 'rgba(255,200,60,.22)'] }
  ];
  const THEME_LEVELS = 2;
  let themeIdx = 0, nextTheme = 0, themeFade = 1;
  const nebula = document.createElement('canvas'), nebulaNext = document.createElement('canvas');
  function paintNebula(cv, th) {
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), k = W / BASE_W, ky = H / BASE_H, gl = th.glow;
    g.fillStyle = th.bg; g.fillRect(0, 0, W, H);
    [[100 * k, 140 * ky, 280, gl[0]], [400 * k, 360 * ky, 300, gl[1]], [160 * k, 600 * ky, 320, gl[2]], [420 * k, 40 * ky, 200, gl[3]], [W * 0.62, 220 * ky, 260, gl[4]]]
      .forEach(([x, y, r, col]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
  }
  function buildNebula() { paintNebula(nebula, THEMES[themeIdx]); if (themeFade < 1) paintNebula(nebulaNext, THEMES[nextTheme]); }
  buildNebula();
  function startTheme(ti) { nextTheme = ti; paintNebula(nebulaNext, THEMES[ti]); themeFade = 0; }
  function resetTheme() { if (themeIdx !== 0 || themeFade < 1) { themeIdx = 0; nextTheme = 0; themeFade = 1; paintNebula(nebula, THEMES[0]); } }
  function pickPal() {
    const w = THEMES[themeIdx].pal, tot = w[0] + w[1] + w[2]; let r = Math.random() * tot;
    for (let i = 0; i < 3; i++) { r -= w[i]; if (r < 0) return i; }
    return 2;
  }
  const starsBG = [];
  for (let i = 0; i < 560; i++) {                // enough for the widest field; only starCount are used
    const layer = i % 3;
    starsBG.push({ x: Math.random() * MAX_W, y: Math.random() * H, s: 0.7 + layer * 0.7, v: 14 + layer * 28, ph: Math.random() * 6.28 });
  }
  let starCount = 110;

  /* ---------------- Meteor sprites (pre-rendered once) ---------------- */
  const PALETTES = [
    { hi: '#b5a79d', mid: '#8d7f78', lo: '#5a4f4a', out: '#1e1715', cr: '#3b322e' },   // rock
    { hi: '#d6f2ff', mid: '#9fd8ff', lo: '#4f86b8', out: '#14304f', cr: '#3a6ea0' },   // ice
    { hi: '#e0643a', mid: '#b0452b', lo: '#6a2318', out: '#2a0d08', cr: '#ffb04d' }    // magma
  ];
  // Draws a rock on a tiny grid (one square per "art pixel"), so it looks like real pixel art
  function makeRock(pal, r, PX, decorate) {
    const n = Math.ceil(r * 2 / PX), c = (n - 1) / 2, R = n / 2;
    const bump = []; for (let i = 0; i < 12; i++) bump.push(0.8 + Math.random() * 0.2);
    const inside = (x, y) => {
      if (x < 0 || y < 0 || x >= n || y >= n) return false;
      const dx = x - c, dy = y - c, ang = (Math.atan2(dy, dx) + 3.1416) / 6.2832 * 12, i0 = Math.floor(ang) % 12, f = ang - Math.floor(ang);
      const lim = R * (bump[i0] * (1 - f) + bump[(i0 + 1) % 12] * f);
      return Math.sqrt(dx * dx + dy * dy) <= lim;
    };
    const cv = document.createElement('canvas'); cv.width = cv.height = n * PX; const g = cv.getContext('2d');
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x * PX, y * PX, PX, PX); };
    const crater = new Set(); const nc = 2 + Math.floor(n / 6);
    for (let k = 0; k < nc; k++) { const cx = Math.floor(c - R * 0.5 + Math.random() * R), cy = Math.floor(c - R * 0.5 + Math.random() * R), w = n > 12 ? 2 : 1; for (let u = 0; u < w; u++) for (let v = 0; v < w; v++) crater.add((cx + u) + ',' + (cy + v)); }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { px(x, y, pal.out); continue; }
      const sh = ((x - c) + (y - c)) / (R * 2);
      px(x, y, crater.has(x + ',' + y) ? pal.cr : sh < -0.22 ? pal.hi : sh < 0.18 ? pal.mid : pal.lo);
    }
    if (decorate) decorate(px, n);
    return cv;
  }
  const METEOR_PX = [3, 4, 4];                     // size of one "art pixel" for small / medium / large meteors
  const sprites = PALETTES.map((pal) => SIZES.map((sz, si) => makeRock(pal, sz.r, METEOR_PX[si])));
  const BOSS_R = 58;
  const whiteOf = (spr) => { const c = document.createElement('canvas'); c.width = spr.width; c.height = spr.height; const g = c.getContext('2d'); g.drawImage(spr, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); return c; };
  const Y = '#ffd36b', K = '#2a0d08', RD = '#ff3d5a', WH = '#ffffff';
  const BOSS_DECOR = [
    (px, n) => {   // 0 MAGMA: angry face
      const m = Math.floor(n / 2);
      [-6, -5, -4].forEach((o) => px(m + o, m - 5, K)); [3, 4, 5].forEach((o) => px(m + o, m - 5, K));
      [-5, -4].forEach((o) => { px(m + o, m - 3, Y); px(m + o, m - 2, Y); }); [3, 4].forEach((o) => { px(m + o, m - 3, Y); px(m + o, m - 2, Y); });
      px(m - 4, m - 2, RD); px(m + 3, m - 2, RD);
      for (let o = -4; o <= 3; o++) { px(m + o, m + 2, o % 2 ? K : WH); px(m + o, m + 3, K); }
    },
    (px, n) => {   // 1 ICE: one big eye, shoots fans of bullets
      const m = Math.floor(n / 2);
      for (let x = -3; x <= 2; x++) for (let y = -5; y <= -1; y++) px(m + x, m + y, WH);
      for (let x = -1; x <= 0; x++) for (let y = -4; y <= -2; y++) px(m + x, m + y, RD);
      px(m - 1, m - 3, K); px(m, m - 3, K);
      for (let o = -5; o <= 4; o++) px(m + o, m + 3 + (o % 2 ? 0 : 1), K);
    },
    (px, n) => {   // 2 SKULL: fires laser beams
      const m = Math.floor(n / 2);
      [[-6, -4], [2, -4]].forEach(([x, y]) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) px(m + x + i, m + y + j, K); px(m + x + 1, m + y + 1, RD); px(m + x + 2, m + y + 1, RD); });
      px(m - 1, m, K); px(m, m, K); px(m - 1, m + 1, K); px(m, m + 1, K);
      for (let o = -5; o <= 4; o++) { px(m + o, m + 3, o % 2 ? K : WH); px(m + o, m + 4, o % 2 ? WH : K); }
    }
  ];
  const bossSprites = [0, 1, 2].map((i) => makeRock(PALETTES[[2, 1, 0][i]], BOSS_R, 6, BOSS_DECOR[i]));
  const bossFlashSprites = bossSprites.map(whiteOf);
  // little UFO enemy (left half of each row, mirrored)
  const UFO_ART = ['....oo', '...owW', '..owWW', 'ooorrr', 'orrrrr', 'oyrryr', '.oddrd', '..oooo'];
  const UFO_COL = { o: '#3a0f2a', w: '#9fe8ff', W: '#e6fbff', r: '#ff5a7a', d: '#b01e48', y: '#ffd36b' };
  const ufoSprite = (() => {
    const PX = 4, cv = document.createElement('canvas'); cv.width = 12 * PX; cv.height = UFO_ART.length * PX; const g = cv.getContext('2d');
    UFO_ART.forEach((row, y) => { const full = row + row.split('').reverse().join(''); for (let x = 0; x < 12; x++) { const ch = full[x]; if (ch !== '.') { g.fillStyle = UFO_COL[ch]; g.fillRect(x * PX, y * PX, PX, PX); } } });
    return cv;
  })();
  const ufoFlash = whiteOf(ufoSprite);

  /* ---------------- Helpers ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    const stamp = ++lastToast;
    setTimeout(() => { if (stamp === lastToast) toastEl.classList.remove('show'); }, ms || 1400);
  }
  function shake(mag, dur) { shakeMag = mag; shakeT = dur; }
  function unlock(id) {
    if (unlocked.has(id)) return;
    unlocked.add(id); store.set('unlocked', [...unlocked].join(','));
    toast('NEW SHIP: ' + SHIPS[id].name + '!', 2600); sfx.best(); buzz([30, 30, 60]);
  }
  function buzz(pattern) { if (!soundOn) return; try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ } }
  function fmt(n) { return String(Math.floor(n)); }

  /* ---------------- UI state ---------------- */
  function setState(s) {
    state = s; if (s === 'playing') music.start(); else music.stop();
    if (s !== 'menu') screens.menu.classList.remove('show-how');
    stage.classList.remove('state-menu', 'state-playing', 'state-paused', 'state-dying', 'state-over');
    stage.classList.add('state-' + (s === 'dying' ? 'playing' : s));
    screens.menu.classList.toggle('active', s === 'menu');
    screens.pause.classList.toggle('active', s === 'paused');
    screens.over.classList.toggle('active', s === 'over');
  }
  function refreshMenu() {
    $('menuBest').textContent = fmt(best); hudBest.textContent = fmt(best);
    document.querySelectorAll('.diff-btn:not(.ship-btn)').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === difficulty)));
    const sb = $('btnSound'); sb.textContent = 'SOUND: ' + (soundOn ? 'ON' : 'OFF'); sb.setAttribute('aria-pressed', String(soundOn));
    const mb = $('btnMusic'); mb.textContent = 'MUSIC: ' + (musicOn ? 'ON' : 'OFF'); mb.setAttribute('aria-pressed', String(musicOn));
    document.querySelectorAll('.ship-btn').forEach((b) => { const id = b.dataset.ship; b.setAttribute('aria-checked', String(id === shipId)); b.classList.toggle('locked', !unlocked.has(id)); });
    $('shipDesc').textContent = unlocked.has(shipId) ? SHIPS[shipId].desc : UNLOCK_HINT[shipId]; drawPreview();
    const pb = $('btnPadToggle'); pb.textContent = 'TOUCH PAD: ' + (padOn ? 'ON' : 'OFF'); pb.setAttribute('aria-pressed', String(padOn));
    stage.classList.toggle('pad-on', padOn);
  }
  function drawPreview() {
    const c = $('shipPreview'); if (!c) return; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
    g.drawImage(shipSprites[shipId], 0, 0);
  }
  function renderLives() { [...livesEl.children].forEach((el, i) => el.classList.toggle('lost', i >= lives)); }
  function renderHud() {
    const s = Math.floor(shownScore);
    if (s !== shownHudScore) { shownHudScore = s; hudScore.textContent = s; }
    if (shield > 0) { powerEl.classList.remove('hidden'); powerBar.style.transform = 'scaleX(' + (shield / SHIELD_SECS).toFixed(3) + ')'; }
    else powerEl.classList.add('hidden');
    if (squad > 0) {
      power2El.classList.remove('hidden'); power2Label.textContent = squad === 1 ? 'DOUBLE SHIP' : 'TRIPLE SHIP';
      power2Bar.style.transform = 'scaleX(' + clamp(squadT / SQUAD_SECS, 0, 1).toFixed(3) + ')';
    } else power2El.classList.add('hidden');
    if (combo >= 2 && state === 'playing') { comboEl.classList.remove('hidden'); const txt = combo + ' HITS  x' + comboMult(); if (comboEl.textContent !== txt) comboEl.textContent = txt; comboEl.style.opacity = comboT < 0.6 ? '0.5' : '1'; }
    else comboEl.classList.add('hidden');
    if (rapid > 0) { power3El.classList.remove('hidden'); power3Bar.style.transform = 'scaleX(' + clamp(rapid / RAPID_SECS, 0, 1).toFixed(3) + ')'; }
    else power3El.classList.add('hidden');
  }
  function popScore() { try { hudScore.animate([{ transform: 'scale(1.35)', color: '#ffd36b' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); } catch (e) { /* old browsers */ } }

  /* ---------------- Game flow ---------------- */
  function startGame() {
    t = 0; score = 0; shownScore = 0; scoreFrac = 0; stars = 0; lives = 3; level = 0; shield = 0; invuln = 0; flash = 0; shakeT = 0; dyingT = 0;
    beatBest = false; prevBest = best; spawnT = 1.2; starT = 5; shieldT = 20; shownHudScore = -1;
    ship.x = W / 2; ship.vx = 0; pointerX = null; padDir = 0;
    meteors.length = 0; items.length = 0; P.forEach((p) => { p.a = false; }); B.forEach((b) => { b.a = false; });
    fireT = 0.15; keys.fire = false; padFire = false; fireQueued = false; squad = 0; squadT = 0; wingSpawnT = 14; rapid = 0; rapidSpawnT = 22; bombSpawnT = 30;
    enemies.length = 0; EB.forEach((e) => { e.a = false; }); enemyT = 24; combo = 0; comboT = 0; bestCombo = 0; boss = null; bossT = DIFF[difficulty].bossFirst; bossKills = 0; POPS.forEach((p) => { p.a = false; });
    if (!unlocked.has(shipId)) shipId = 'star';
    ship.r = SHIPS[shipId].r; resetTheme(); holes.length = 0; holeT = 22;
    $('newBest').classList.add('hidden');
    renderLives(); renderHud(); hudBest.textContent = fmt(best);
    setState('playing'); sfx.start();
  }
  function pauseGame() { if (state === 'playing') { setState('paused'); keys.left = keys.right = keys.fire = false; padDir = 0; padFire = false; pointerX = null; } }
  function resumeGame() { if (state === 'paused') { setState('playing'); last = performance.now(); } }
  function toMenu() { setState('menu'); refreshMenu(); }
  function endGame() {
    const isBest = score > prevBest;
    if (score > best) { best = Math.floor(score); store.set('best', best); }
    $('ovScore').textContent = fmt(score); $('ovBest').textContent = fmt(best); $('ovStars').textContent = stars; $('ovBosses').textContent = bossKills; $('ovCombo').textContent = bestCombo;
    $('newBest').classList.toggle('hidden', !isBest);
    if (isBest) setTimeout(() => { if (state === 'over') sfx.best(); }, 500);
    setState('over'); refreshMenu();
  }

  function hurt() {
    lives--; combo = 0; comboT = 0; renderLives(); sfx.hit(); buzz(lives <= 0 ? [80, 40, 160] : 70); shake(14, 0.4); flash = 0.55;
    emit(ship.x, ship.y, 26, '#ff3da8', 260, 0.7, 3);
    if (lives <= 0) {
      state = 'dying'; dyingT = 1.1; music.stop(); sfx.over(); shake(26, 0.9);
      emit(ship.x, ship.y, 90, '#ffd36b', 380, 1.2, 3.5); emit(ship.x, ship.y, 60, '#22d3ff', 300, 1.0, 3);
    } else invuln = INVULN_SECS;
  }

  /* ---------------- Spawning ---------------- */
  function spawnMeteor() {
    const d = DIFF[difficulty], si = Math.random() < 0.42 ? 0 : Math.random() < 0.6 ? 1 : 2, sz = SIZES[si];
    const ramp = 1 + Math.min(t / 70, 1.4);
    const m = { x: rand(sz.r, W - sz.r), y: -sz.r - 12, vy: rand(150, 270) * d.speed * ramp * sz.speed, vx: t > 20 ? rand(-45, 45) : 0,
      r: sz.r, spr: sprites[pickPal()][si], rot: Math.floor(Math.random() * 4) * 1.5708, vr: 0, si, hp: si + 1, hit: 0 };
    m.rt = rand(0.4, 1.1); meteors.push(m);
  }
  function spawnMeteorAt(x, y, si, vx, vy, pal, fire) {
    meteors.push({ fire: !!fire, x, y, vy, vx, r: SIZES[si].r, spr: sprites[pal === undefined ? pickPal() : pal][si], rot: Math.floor(Math.random() * 4) * 1.5708, vr: 0, si, hp: si + 1, hit: 0, rt: rand(0.4, 1.1) });
  }
  function spawnEnemy() {
    const d = DIFF[difficulty], dir = Math.random() < 0.5 ? 1 : -1;
    enemies.push({ x: dir > 0 ? -28 : W + 28, y: rand(90, 210), by: 0, vx: dir * rand(95, 135) * d.speed, ph: Math.random() * 6, hp: 2, hit: 0, fireT: rand(0.6, 1.1) });
    enemies[enemies.length - 1].by = enemies[enemies.length - 1].y;
  }
  function killEnemy(e, i, viaBomb) {
    enemies.splice(i, 1);
    if (viaBomb) { score += 40; pop(e.x, e.y, '+40', '#ffffff'); } else addKill({ si: 3, x: e.x, y: e.y, r: 22 });
    emit(e.x, e.y, 22, '#ff5a7a', 240, 0.7, 3); emit(e.x, e.y, 10, '#ffd36b', 180, 0.5, 2.5); emit(e.x, e.y, 8, '#ffffff', 140, 0.4, 2);
    sfx.boom(); shake(5, 0.15);
    if (!viaBomb && Math.random() < 0.4) spawnItemAt(['shield', 'wing', 'rapid', 'star', 'star'][Math.floor(Math.random() * 5)], e.x, e.y);
  }
  function stepEnemies(dt, active) {
    const d = DIFF[difficulty];
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; e.ph += dt; e.x += e.vx * dt; e.y = e.by + Math.sin(e.ph * 2.2) * 18; if (e.hit > 0) e.hit -= dt;
      if ((e.vx > 0 && e.x > W + 40) || (e.vx < 0 && e.x < -40)) { enemies.splice(i, 1); continue; }
      e.fireT -= dt;
      if (active && e.fireT <= 0 && e.x > 20 && e.x < W - 20) {
        e.fireT = rand(1.3, 1.9);
        const aim = Math.atan2(ship.y - e.y, ship.x - e.x) + rand(-0.12, 0.12);
        ebFire(e.x, e.y + 10, aim, 250 * d.speed);
      }
      if (active && state === 'playing') {                      // touching a UFO hurts too
        const dx = e.x - ship.x, dy = e.y - ship.y, rr = 22 + ship.r;
        if (dx * dx + dy * dy < rr * rr) {
          if (shield > 0) { killEnemy(e, i, false); continue; }
          if (invuln <= 0) { emit(e.x, e.y, 16, '#ff5a7a', 220, 0.5, 3); enemies.splice(i, 1); hurt(); if (state === 'dying') return; }
        }
      }
    }
    for (let i = 0; i < EB.length; i++) {
      const e = EB[i]; if (!e.a) continue;
      if (!active) { e.a = false; continue; }
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.y > H + 20 || e.y < -20 || e.x < -20 || e.x > W + 20) { e.a = false; continue; }
      const dx = e.x - ship.x, dy = e.y - ship.y, rr = ship.r + 5;
      if (dx * dx + dy * dy < rr * rr) {
        e.a = false;
        if (shield > 0) { emit(e.x, e.y, 10, '#22d3ff', 200, 0.4, 2.2); sfx.hit(); }
        else if (invuln <= 0) { emit(e.x, e.y, 14, '#ff7ab0', 220, 0.5, 2.5); hurt(); if (state === 'dying') return; }
      }
    }
  }
  function spawnHole() {
    holes.push({ x: rand(110, Math.max(120, W - 110)), y: -110, vy: 62, core: 26, pull: 215, ph: 0, cd: 0 });
    toast('BLACK HOLE! KEEP AWAY', 1700); sfx.hole(); buzz([50, 30, 50]);
  }
  function stepHoles(dt, active) {
    for (let i = holes.length - 1; i >= 0; i--) {
      const h = holes[i]; h.y += h.vy * dt; h.ph += dt; if (h.cd > 0) h.cd -= dt;
      if (h.y > H + 130) { holes.splice(i, 1); continue; }
      for (let j = meteors.length - 1; j >= 0; j--) {          // bend and swallow meteors
        const m = meteors[j], dx = h.x - m.x, dy = h.y - m.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < h.pull) { const f = 1 - d / h.pull; m.vx += dx / d * 260 * f * dt; m.y += dy / d * 70 * f * dt; }
        if (d < h.core + m.r * 0.3) { emit(m.x, m.y, 8, '#a855f7', 140, 0.4, 2.2); meteors.splice(j, 1); }
      }
      for (let j = items.length - 1; j >= 0; j--) {            // power-ups and stars get swallowed too: grab them first
        const it = items[j], dx = h.x - it.x, dy = h.y - it.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < h.pull) { const f = 1 - d / h.pull; it.x += dx / d * 120 * f * dt; it.y += dy / d * 50 * f * dt; }
        if (d < h.core) { emit(it.x, it.y, 8, '#c084fc', 140, 0.4, 2.2); items.splice(j, 1); }
      }
      if (active && state === 'playing') {
        const dx = h.x - ship.x, dy = h.y - ship.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < h.pull) { const f = 1 - d / h.pull; ship.x = clamp(ship.x + (dx / d) * 230 * f * dt, 24, W - 24); }
        if (d < h.core + ship.r * 0.6) {
          if (shield > 0) { if (h.cd <= 0) { shield = Math.max(0, shield - 2.5); h.cd = 0.6; emit(ship.x, ship.y, 14, '#22d3ff', 200, 0.4, 2.5); shake(6, 0.2); sfx.hit(); } }
          else if (invuln <= 0) { hurt(); if (state === 'dying') return; }
        }
      }
    }
  }
  function drawHole(h) {
    ctx.save();
    ctx.globalAlpha = 0.14; ctx.fillStyle = '#a855f7';
    for (let i = 0; i < 30; i++) { const a = i * 0.2094 + h.ph * 0.2; ctx.fillRect(Math.round(h.x + Math.cos(a) * h.pull) - 2, Math.round(h.y + Math.sin(a) * h.pull) - 2, 4, 4); }   // faint pull range
    for (let i = 0; i < 26; i++) {                                                                                                       // swirling ring
      const a = h.ph * 1.6 + i * 0.2417, r = h.core + 10 + (i % 4) * 8;
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(h.ph * 3 + i); ctx.fillStyle = i % 2 ? '#a855f7' : '#22d3ff';
      ctx.fillRect(Math.round(h.x + Math.cos(a) * r) - 3, Math.round(h.y + Math.sin(a) * r) - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    const disc = (r, col) => { ctx.fillStyle = col; for (let yy = -r; yy < r; yy += 4) { const w = Math.floor(Math.sqrt(r * r - yy * yy) / 4) * 4; ctx.fillRect(Math.round(h.x - w), Math.round(h.y + yy), Math.round(w * 2), 5); } };
    disc(h.core + 6, '#7c3aed'); disc(h.core, '#000000');
    ctx.restore();
  }
  function spawnItem(kind) { items.push({ kind, x: rand(30, W - 30), y: -20, vy: 110, r: 13, ph: Math.random() * 6 }); }
  function spawnItemAt(kind, x, y) { items.push({ kind, x: clamp(x, 30, W - 30), y, vy: 110, r: 13, ph: Math.random() * 6 }); }
  function pop(x, y, txt, c) { const p = POPS[popCursor]; popCursor = (popCursor + 1) % POPS.length; p.a = true; p.x = x; p.y = y; p.l = 0.8; p.txt = txt; p.c = c || '#fff'; }

  /* ---------------- Combo + boss ---------------- */
  const comboMult = () => Math.min(5, 1 + Math.floor(combo / 4));
  function addKill(m) {
    combo++; comboT = COMBO_SECS; if (combo > bestCombo) bestCombo = combo;
    const mult = comboMult(), pts = (m.si + 1) * 10 * mult; score += pts;
    pop(m.x, m.y - m.r * 0.4, '+' + pts, mult > 1 ? '#ffd36b' : '#ffffff');
    if (combo % 4 === 0 && mult > 1) toast('COMBO x' + mult + '!', 700);
  }
  const BOSS_NAMES = ['MAGMA KING', 'ICE EYE', 'LASER SKULL'];
  function spawnBoss() {
    const d = DIFF[difficulty], hp = Math.round((52 + level * 3) * d.boss * (1 + 0.12 * Math.min(bossKills, 5))), type = bossKills % 3;
    boss = { x: W / 2, y: -BOSS_R - 20, ty: 150, ph: 0, hp, max: hp, hit: 0, fireT: 1.6, r: BOSS_R, type, beam: null, beamT: 2.4, volley: 0, phase: 0, muzzle: 0, rainT: 5, dir: Math.random() < 0.5 ? 1 : -1 };
    toast('WARNING! ' + BOSS_NAMES[type] + (bossKills > 0 ? ' #' + (bossKills + 1) : ''), 1900); sfx.warn(); shake(6, 0.4); buzz([60, 40, 60]);
  }
  function ebFire(x, y, ang, sp) {
    const e = EB[ebCursor]; ebCursor = (ebCursor + 1) % EB.length;
    e.a = true; e.x = x; e.y = y; e.vx = Math.cos(ang) * sp; e.vy = Math.sin(ang) * sp;
  }
  function bossRain() {
    // a wall of small meteors with one gap to slip through
    const n = Math.max(5, Math.floor(W / 78)), gap = 1 + Math.floor(Math.random() * (n - 2)), d = DIFF[difficulty];
    for (let i = 0; i < n; i++) { if (i === gap || i === gap + 1) continue; spawnMeteorAt((i + 0.5) * (W / n), -24, 0, 0, 190 * d.speed, 2, true); }
    toast('METEOR RAIN!', 1100);
  }
  function stepBoss(dt) {
    if (!boss) return;
    const d = DIFF[difficulty], frac = boss.hp / boss.max;
    boss.ph += dt; if (boss.hit > 0) boss.hit -= dt; if (boss.muzzle > 0) boss.muzzle -= dt;
    if (boss.y < boss.ty) boss.y = Math.min(boss.ty, boss.y + 110 * dt);   // fly in from the top
    // the boss gets angrier at 2/3 and 1/3 health
    const phase = frac < 0.34 ? 2 : frac < 0.67 ? 1 : 0;
    if (phase > boss.phase) {
      boss.phase = phase; toast(phase === 1 ? 'BOSS IS ANGRY!' : 'FINAL RAGE!', 1500); shake(10, 0.4); sfx.warn(); buzz([40, 30, 40]);
      emit(boss.x, boss.y, 40, '#ff3d5a', 300, 0.8, 3);
    }
    // steady side-to-side patrol (speed no longer grows with screen width)
    const lo = boss.r + 15, hi = Math.max(lo, W - boss.r - 15), sp0 = (78 + (1 - frac) * 38) * (0.75 + d.speed * 0.25) * (1 + (W / BASE_W - 1) * 0.25);
    boss.x += boss.dir * sp0 * dt;
    if (boss.x > hi) { boss.x = hi; boss.dir = -1; } else if (boss.x < lo) { boss.x = lo; boss.dir = 1; }
    if (boss.y < boss.ty - 2) return;
    // attack speed: faster each phase, slower on Easy, faster on Hard
    const rate = (1 + phase * 0.25) * (1 + 0.06 * Math.min(bossKills, 5)) / (difficulty === 'easy' ? 1.25 : difficulty === 'hard' ? 0.85 : 1);
    boss.fireT -= dt * rate;
    const mouthY = boss.y + boss.r * 0.7, msp = rand(230, 300) * d.speed;
    const throwMeteors = (n) => {
      for (let k = 0; k < n; k++) {
        const o = k - (n - 1) / 2;
        spawnMeteorAt(clamp(boss.x + o * 46 + rand(-12, 12), 20, W - 20), mouthY, Math.random() < 0.65 ? 0 : 1, clamp((ship.x - boss.x) * 0.25, -90, 90) + o * 40, msp * (0.9 + Math.random() * 0.1), [2, 1, 0][boss.type], boss.type === 0);
      }
      boss.muzzle = 0.22;
    };
    if (boss.type === 0) {                                          // MAGMA KING: throws meteors, then rains them
      if (boss.fireT <= 0) { boss.fireT = 0.95; boss.volley++; throwMeteors(Math.min(bossKills >= 3 ? 4 : 3, 1 + phase)); }
      if (phase >= 1) { boss.rainT -= dt * rate; if (boss.rainT <= 0) { boss.rainT = 8; bossRain(); } }
    } else if (boss.type === 1) {                                   // ICE EYE: fans of bullets + a meteor every volley
      if (boss.fireT <= 0) {
        boss.fireT = 1.5; boss.volley++;
        const aim = Math.atan2(ship.y - boss.y, ship.x - boss.x), n = 3 + phase * 2;
        for (let k = 0; k < n; k++) ebFire(boss.x, mouthY, aim + (k - (n - 1) / 2) * 0.26, 235 * d.speed);
        throwMeteors(1);
      }
    } else {                                                        // LASER SKULL: aimed beams (two in the last phase) + meteors
      if (boss.fireT <= 0) { boss.fireT = 1.7; throwMeteors(phase >= 2 ? 2 : 1); }
      if (!boss.beam) {
        boss.beamT -= dt * rate;
        if (boss.beamT <= 0) {
          const xs = [clamp(ship.x, 30, W - 30)];
          if (phase >= 2) xs.push(clamp(ship.x + (Math.random() < 0.5 ? -1 : 1) * 120, 30, W - 30));
          boss.beam = { xs, t: 0.95, on: false };
        }
      } else {
        const bm = boss.beam; bm.t -= dt;
        if (!bm.on && bm.t <= 0) { bm.on = true; bm.t = 0.45; shake(5, 0.3); sfx.boom(); buzz(40); }
        else if (bm.on) {
          const inBeam = bm.xs.some((bx) => Math.abs(ship.x - bx) < 22 + ship.r * 0.4);
          if (inBeam && state === 'playing') {
            if (shield > 0) { if (Math.random() < 0.3) emit(ship.x, ship.y - 20, 4, '#22d3ff', 160, 0.3, 2); }
            else if (invuln <= 0) hurt();
          }
          if (bm.t <= 0) { boss.beam = null; boss.beamT = 2.3; }
        }
      }
    }
  }
  function defeatBoss() {
    const bx = boss.x, by = boss.y; bossKills++; boss = null; bossT = DIFF[difficulty].bossEvery; unlock('tank');
    score += 500; pop(bx, by, '+500', '#ffd36b'); popScore();
    emit(bx, by, 110, '#ff9a4d', 420, 1.2, 4); emit(bx, by, 70, '#ffd36b', 320, 1.0, 3.5); emit(bx, by, 50, '#ffffff', 260, 0.8, 3);
    shake(22, 0.7); sfx.win(); buzz([40, 30, 40, 30, 140]); EB.forEach((e) => { e.a = false; });
    for (let k = -1; k <= 1; k++) spawnItemAt('star', bx + k * 60, by);
    if (lives < 3) { lives++; renderLives(); toast('BOSS DOWN! EXTRA LIFE', 1900); } else toast('BOSS DESTROYED!', 1700);
    for (let i = meteors.length - 1; i >= 0; i--) { const m = meteors[i]; emit(m.x, m.y, 8, '#ff9a4d', 200, 0.5, 2.5); }
    meteors.length = 0;
  }

  /* ---------------- Update ---------------- */
  function update(dt) {
    // background always scrolls
    for (let i = 0; i < starCount; i++) { const s = starsBG[i]; s.y += s.v * dt * (state === 'playing' ? 1 + level * 0.08 : 1); if (s.y > H) { s.y = -2; s.x = Math.random() * W; } s.ph += dt * 2; }
    for (let i = 0; i < POPS.length; i++) { const p = POPS[i]; if (!p.a) continue; p.l -= dt; p.y -= 44 * dt; if (p.l <= 0) p.a = false; }
    for (let i = 0; i < P.length; i++) { const p = P[i]; if (!p.a) continue; p.l -= dt; if (p.l <= 0) { p.a = false; continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; }
    if (shakeT > 0) shakeT -= dt;
    if (flash > 0) flash -= dt;
    if (themeFade < 1) {
      themeFade += dt / 2.5;
      if (themeFade >= 1) { themeFade = 1; themeIdx = nextTheme; const g = nebula.getContext('2d'); g.globalAlpha = 1; g.drawImage(nebulaNext, 0, 0); }
    }

    if (state === 'dying') {
      stepWorld(dt, false); dyingT -= dt; if (dyingT <= 0) endGame(); return;
    }
    if (state !== 'playing') return;

    t += dt;
    const d = DIFF[difficulty];
    // level-up feedback
    const lv = Math.floor(t / LEVEL_SECS);
    if (lv > level) {
      level = lv;
      const ti = Math.floor(level / THEME_LEVELS) % THEMES.length;
      if (ti !== nextTheme) { startTheme(ti); toast('LEVEL ' + (level + 1) + ': ' + THEMES[ti].name, 2000); }
      else toast('SPEED UP!  LEVEL ' + (level + 1), 1300);
    }

    // score: survival points
    if (score >= 1500) unlock('dart');
    if (score >= 5000) unlock('void');
    scoreFrac += dt * 10 * (1 + level * 0.15);
    if (scoreFrac >= 1) { const add = Math.floor(scoreFrac); score += add; scoreFrac -= add; }
    checkBest();

    // ship movement
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + padDir + gpDir;
    if (dir !== 0) {
      pointerX = null; ship.vx += (clamp(dir, -1, 1) * 430 * SHIPS[shipId].speed * (1 + (W / BASE_W - 1) * 0.45) - ship.vx) * Math.min(1, dt * 12); ship.x += ship.vx * dt;
    } else if (pointerX !== null) {
      const nx = ship.x + (pointerX - ship.x) * Math.min(1, dt * 16); ship.vx = (nx - ship.x) / Math.max(dt, 1e-3); ship.x = nx;
    } else { ship.vx += (0 - ship.vx) * Math.min(1, dt * 10); ship.x += ship.vx * dt; }
    ship.x = clamp(ship.x, 24, W - 24); // never leave the playfield

    if (invuln > 0) invuln -= dt;
    if (shield > 0) { shield -= dt; if (shield <= 0) shield = 0; }

    // engine particles
    if (Math.random() < 0.7) emit(ship.x + rand(-4, 4), ship.y + 26, 1, Math.random() < 0.5 ? '#ff3da8' : '#ffd36b', 60, 0.35, 2);

    // shooting: Space (hold), Fire pad, or while dragging a finger / mouse
    fireT -= dt;
    if (fireT <= 0 && (fireQueued || keys.fire || padFire || gpFire || pointerX !== null)) { shoot(); fireT = rapid > 0 ? RAPID_COOLDOWN : SHIPS[shipId].cd; }
    fireQueued = false;

    // spawning with start-up grace and progressive difficulty
    spawnT -= dt;
    if (spawnT <= 0) {
      const ramp = Math.max(0.36, 1 - t / 110), grace = t < d.grace ? 1.8 : 1;
      // wider field => proportionally more meteors, so a big screen isn't easier than a phone
      spawnMeteor(); spawnT = 0.72 * d.interval * ramp * grace * rand(0.75, 1.25) / Math.pow(W / BASE_W, 0.8) * (boss ? 1.35 : 1);
      if (level >= 3 && !boss && Math.random() < 0.2) spawnMeteor();
    }
    starT -= dt; if (starT <= 0) { spawnItem('star'); starT = rand(3.5, 6.5); }
    shieldT -= dt; if (shieldT <= 0) { if (shield <= 0) spawnItem('shield'); shieldT = rand(18, 28); }
    wingSpawnT -= dt; if (wingSpawnT <= 0) { spawnItem('wing'); wingSpawnT = rand(16, 26); }
    if (squad > 0) { squadT -= dt; if (squadT <= 0) loseSquad(); }
    rapidSpawnT -= dt; if (rapidSpawnT <= 0) { spawnItem('rapid'); rapidSpawnT = rand(20, 32); }
    bombSpawnT -= dt; if (bombSpawnT <= 0) { spawnItem('bomb'); bombSpawnT = rand(28, 42); }
    if (rapid > 0) rapid = Math.max(0, rapid - dt);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    if (!boss) { bossT -= dt; if (bossT <= 0) spawnBoss(); } else stepBoss(dt);
    if (state === 'dying') return;
    holeT -= dt; if (holeT <= 0) { if (!boss && level >= 1 && holes.length === 0) spawnHole(); holeT = rand(18, 30); }
    // enemy UFOs: from about 20 seconds in, never during a boss, at most two at a time
    enemyT -= dt; if (enemyT <= 0) { if (!boss && t > 20 && enemies.length < 2) spawnEnemy(); enemyT = rand(9, 15) * Math.max(0.6, 1 - level * 0.05) * (difficulty === 'hard' ? 0.8 : difficulty === 'easy' ? 1.3 : 1); }

    stepWorld(dt, true);
    renderHud();
  }

  function checkBest() {
    if (!beatBest && prevBest > 0 && score > prevBest) { beatBest = true; toast('NEW HIGH SCORE!', 1600); sfx.best(); hudBest.textContent = fmt(score); }
    if (beatBest) hudBest.textContent = fmt(score);
  }

  function fireBullet(x, y) {
    const b = B[bulletCursor]; bulletCursor = (bulletCursor + 1) % B.length;
    b.a = true; b.x = x; b.y = y; emit(x, y, 3, '#9ff3ff', 70, 0.2, 1.8);
  }
  function shoot() {
    if (SHIPS[shipId].twin) { fireBullet(ship.x - 9, ship.y - 26); fireBullet(ship.x + 9, ship.y - 26); } else fireBullet(ship.x, ship.y - 28);
    for (let k = 0; k < squad; k++) fireBullet(ship.x + WING_X[k], ship.y + WING_Y - 28 * WING_SCALE);
    sfx.shoot();
  }
  function bomb() {
    let n = 0;
    for (let j = meteors.length - 1; j >= 0; j--) {
      const m = meteors[j]; score += (m.si + 1) * 10; n++;
      emit(m.x, m.y, 14 + m.si * 8, '#ff9a4d', 240, 0.7, 3); emit(m.x, m.y, 6, '#ffffff', 160, 0.4, 2);
    }
    for (let i = enemies.length - 1; i >= 0; i--) killEnemy(enemies[i], i, true);
    EB.forEach((e) => { e.a = false; }); buzz(80);
    meteors.length = 0; flash = 0.5; shake(10, 0.35); sfx.boom(); sfx.power(); popScore();
    toast(n ? 'BOOM! ' + n + ' DESTROYED' : 'BOOM!', 1300);
  }
  function loseSquad() {
    for (let k = 0; k < squad; k++) emit(ship.x + WING_X[k], ship.y + WING_Y, 24, '#a855f7', 220, 0.6, 2.8);
    squad = 0; squadT = 0; sfx.hit();
  }
  function stepBullets(dt, active) {
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (!b.a) continue;
      b.y -= BULLET_SPEED * dt;
      if (b.y < -20 || !active) { b.a = false; continue; }
      if (boss && boss.y > -boss.r * 0.3) {
        const bx = boss.x - b.x, by = boss.y - b.y, br = boss.r * 0.92;
        if (bx * bx + by * by < br * br) {
          b.a = false; boss.hp--; boss.hit = 0.08; emit(b.x, b.y, 5, '#ffd36b', 150, 0.3, 2); score += 2; shake(2, 0.06);
          if (boss.hp <= 0) defeatBoss();
          continue;
        }
      }
      let hitEnemy = false;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j], ex = e.x - b.x, ey = e.y - b.y;
        if (ex * ex + ey * ey < 26 * 26) {
          b.a = false; hitEnemy = true; e.hp--; e.hit = 0.08; emit(b.x, b.y, 5, '#ffd36b', 150, 0.3, 2);
          if (e.hp <= 0) killEnemy(e, j, false);
          break;
        }
      }
      if (hitEnemy) continue;
      for (let j = 0; j < meteors.length; j++) {
        const m = meteors[j], dx = m.x - b.x, dy = m.y - b.y, rr = m.r * 0.9 + 4;
        if (dx * dx + dy * dy < rr * rr) {
          b.a = false; m.hp--; m.hit = 0.09; emit(b.x, b.y, 6, '#ffd36b', 160, 0.3, 2);
          if (m.hp <= 0) {
            addKill(m); sfx.boom(); shake(3 + m.si * 2, 0.12);
            emit(m.x, m.y, 14 + m.si * 10, '#ff9a4d', 220 + m.si * 40, 0.7, 3); emit(m.x, m.y, 8 + m.si * 6, '#ffffff', 160, 0.4, 2);
            meteors.splice(j, 1);
          }
          break;
        }
      }
    }
  }

  function stepWorld(dt, active) {
    shownScore += (score - shownScore) * Math.min(1, dt * 10); if (score - shownScore < 0.5) shownScore = score;
    stepBullets(dt, active);
    stepEnemies(dt, active); if (state === 'dying' && active) return;
    stepHoles(dt, active); if (state === 'dying' && active) return;
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]; m.y += m.vy * dt; m.x += m.vx * dt; m.rt -= dt;
      if (m.fire && Math.random() < 0.4) emit(m.x + rand(-m.r * 0.3, m.r * 0.3), m.y - m.r * 0.6, 1, Math.random() < 0.5 ? '#ffb04d' : '#ff5a2a', 55, 0.35, 2.4); if (m.rt <= 0) { m.rot += 1.5708 * (Math.random() < 0.5 ? 1 : -1); m.rt = rand(0.45, 1.1); } if (m.hit > 0) m.hit -= dt;
      if (m.y > H + m.r + 20 || m.x < -60 || m.x > W + 60) { meteors.splice(i, 1); continue; }
      if (active) {
        const dx = m.x - ship.x, dy = m.y - ship.y, rr = m.r * 0.82 + ship.r;
        if (dx * dx + dy * dy < rr * rr) {
          if (shield > 0) { emit(m.x, m.y, 18, '#22d3ff', 220, 0.5, 2.5); shake(5, 0.15); sfx.hit(); score += 5; meteors.splice(i, 1); continue; }
          if (invuln <= 0) { emit(m.x, m.y, 20, '#ff9a4d', 240, 0.6, 3); meteors.splice(i, 1); hurt(); if (state === 'dying') return; }
        }
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]; it.y += it.vy * dt; it.ph += dt * 4;
      if (it.y > H + 30) { items.splice(i, 1); continue; }
      if (active) {
        const dx = it.x - ship.x, dy = it.y - ship.y, rr = it.r + ship.r + 6;
        if (dx * dx + dy * dy < rr * rr) {
          items.splice(i, 1);
          if (it.kind === 'star') { stars++; score += 50; sfx.star(); emit(it.x, it.y, 16, '#ffd36b', 200, 0.6, 2.5); popScore(); }
          else if (it.kind === 'wing') {
            squad = Math.min(2, squad + 1); squadT = SQUAD_SECS; score += 25; sfx.power(); popScore();
            for (let k = 0; k < squad; k++) emit(ship.x + WING_X[k], ship.y + WING_Y, 22, '#a855f7', 240, 0.6, 2.8);
            toast(squad === 1 ? 'DOUBLE SHIP!' : 'TRIPLE SHIP!', 1300);
          }
          else if (it.kind === 'rapid') { rapid = RAPID_SECS; score += 25; sfx.power(); popScore(); emit(ship.x, ship.y, 24, '#ff9a4d', 240, 0.6, 2.8); toast('RAPID FIRE!', 1300); }
          else if (it.kind === 'bomb') { bomb(); }
          else { shield = SHIELD_SECS; sfx.power(); emit(ship.x, ship.y, 30, '#22d3ff', 260, 0.7, 2.5); toast('SHIELD ON!', 1000); }
        }
      }
    }
  }

  /* ---------------- Rendering ---------------- */
  // Pixel-art ships: left half of each row, mirrored to make the full plane (16 x 16 art pixels)
  const SHIP_ART = {
    star: ['.......o', '......ow', '......ow', '.....owc', '.....owv', '....owvv', '....owcv', '...owccc',
           'o..owccc', 'oo.owccd', 'owoowccd', 'owcccccd', 'opcccccd', 'oppoocdd', '.oo..odd', '.....ood'],
    dart: ['.......o', '.......o', '......ow', '......ow', '.....owv', '.....owv', '.....owc', '....owcc',
           '....owcc', '...owccc', '...owccc', '..owcccd', '.opwcccd', 'opp.occd', 'o....odd', '.....ood'],
    void: ['.......o', '......ow', '.....owc', '.o...owc', 'owo.owcv', 'owwoowcv', 'owcwowcc', 'owccwwcc',
           'opcccwcc', 'opccccdd', 'oppccddd', '.oppcddd', '..oopcdd', '....oodd', '.....ood', '......oo'],
    tank: ['.......o', '......ow', '.....owc', '....owcv', '...owccv', '.o.owccc', 'owowcccc', 'owwwcccd',
           'owcccccd', 'owcccccd', 'opcccddd', 'opoccddd', 'ooo.oodd', '....oodd', '.....ood', '......oo']
  };
  const SHIP_PX = 3;
  const SHIP_COLORS = {
    star: { o: '#0b3a66', w: '#ffffff', c: '#22d3ff', d: '#1688b8', p: '#ff3da8', v: '#c084fc', i: '#1688b8' },
    dart: { o: '#0b3b22', w: '#f0fff4', c: '#4ade80', d: '#16a34a', p: '#ffd36b', v: '#22d3ff', i: '#16a34a' },
    tank: { o: '#4a2208', w: '#fff3e0', c: '#ffb04d', d: '#d9731a', p: '#ff3da8', v: '#22d3ff', i: '#d9731a' },
    void: { o: '#2a0b4a', w: '#f5e8ff', c: '#a855f7', d: '#6b21a8', p: '#ff3da8', v: '#22d3ff', i: '#6b21a8' },
    wing: { o: '#3b1768', w: '#f3e8ff', c: '#c084fc', d: '#8b4fd0', p: '#ff3da8', v: '#ffd36b', i: '#8b4fd0' }
  };
  const shipSprites = {}, wingSprites = {};
  function paintShip(art, col) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16 * SHIP_PX; const g = cv.getContext('2d');
    art.forEach((row, y) => {
      const full = row + row.split('').reverse().join('');
      for (let x = 0; x < 16; x++) { const ch = full[x]; if (ch !== '.') { g.fillStyle = col[ch]; g.fillRect(x * SHIP_PX, y * SHIP_PX, SHIP_PX, SHIP_PX); } }
    });
    return cv;
  }
  Object.keys(SHIP_ART).forEach((k) => { shipSprites[k] = paintShip(SHIP_ART[k], SHIP_COLORS[k]); wingSprites[k] = paintShip(SHIP_ART[k], SHIP_COLORS.wing); });
  function drawHull(wing) {
    // blocky flame under the engine (flickers), then the pixel plane, all centred on (0,0)
    const rows = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rows; i++) {
      ctx.fillStyle = i === 0 ? '#ffd36b' : i < 3 ? '#ff9a4d' : '#ff3da8';
      ctx.fillRect(-SHIP_PX * 1.5, 24 + i * SHIP_PX, SHIP_PX * 3, SHIP_PX);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage((wing ? wingSprites : shipSprites)[shipId], -24, -26);
  }
  function drawShip() {
    const blink = invuln > 0 && Math.floor(t * 14) % 2 === 0;
    // wingmen (blink during the last 2 seconds before they vanish)
    if (squad > 0 && !(squadT < 2 && Math.floor(t * 10) % 2 === 0)) {
      for (let k = 0; k < squad; k++) {
        ctx.save(); ctx.translate(ship.x + WING_X[k], ship.y + WING_Y); ctx.scale(WING_SCALE, WING_SCALE); drawHull(true); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(ship.x, ship.y);
    if (!blink) drawHull(false);
    ctx.restore();
    if (shield > 0 && !(shield < 1.5 && Math.floor(t * 8) % 2 === 0)) {
      ctx.save(); ctx.translate(ship.x, ship.y);
      const pr = 38 + Math.sin(t * 8) * 1.5, sg = ctx.createRadialGradient(0, 0, pr * 0.5, 0, 0, pr);
      sg.addColorStop(0, 'rgba(34,211,255,0)'); sg.addColorStop(1, 'rgba(34,211,255,.35)');
      ctx.fillStyle = sg; ctx.strokeStyle = 'rgba(160,240,255,.9)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(0, 0, pr, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  function starPath(r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -1.5708 + i * 0.6283, rr = i % 2 ? r * 0.45 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath();
  }
  function drawItem(it) {
    ctx.save(); ctx.translate(it.x, it.y);
    if (it.kind === 'star') {
      ctx.rotate(Math.sin(it.ph) * 0.35); const s = 1 + Math.sin(it.ph * 1.5) * 0.1; ctx.scale(s, s);
      ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffe28a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      starPath(it.r + 4); ctx.fill(); ctx.stroke();
    } else if (it.kind === 'wing') {
      ctx.rotate(it.ph * 0.5 % 6.2832);
      ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 16; ctx.strokeStyle = '#d8b4fe'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(168,85,247,.45)';
      ctx.beginPath(); ctx.rect(-it.r, -it.r, it.r * 2, it.r * 2); ctx.fill(); ctx.stroke();
      ctx.rotate(-(it.ph * 0.5 % 6.2832)); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = '16px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', 1, 1);
    } else if (it.kind === 'rapid' || it.kind === 'bomb') {
      const c = it.kind === 'rapid' ? '#ff9a4d' : '#ff3d5a', fc = it.kind === 'rapid' ? 'rgba(255,154,77,.4)' : 'rgba(255,61,90,.4)';
      const s = 1 + Math.sin(it.ph * 1.5) * 0.08; ctx.scale(s, s);
      ctx.shadowColor = c; ctx.shadowBlur = 16; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.fillStyle = fc;
      ctx.beginPath(); ctx.moveTo(0, -it.r - 3); ctx.lineTo(it.r + 3, 0); ctx.lineTo(0, it.r + 3); ctx.lineTo(-it.r - 3, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = '12px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.kind === 'rapid' ? 'R' : 'B', 1, 1);
    } else {
      ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 16; ctx.strokeStyle = '#22d3ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, it.r + Math.sin(it.ph) * 1.5, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = 'rgba(34,211,255,.35)'; ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = '12px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', 0, 1);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shakeT > 0) ctx.translate(rand(-1, 1) * shakeMag * Math.min(1, shakeT * 4), rand(-1, 1) * shakeMag * Math.min(1, shakeT * 4));
    ctx.drawImage(nebula, -20, -20, W + 40, H + 40);
    if (themeFade < 1) { ctx.globalAlpha = themeFade; ctx.drawImage(nebulaNext, -20, -20, W + 40, H + 40); ctx.globalAlpha = 1; }
    const starTint = THEMES[themeFade < 0.5 ? themeIdx : nextTheme].star;
    for (let i = 0; i < starCount; i++) {
      const s = starsBG[i]; ctx.globalAlpha = 0.45 + 0.4 * Math.sin(s.ph); ctx.fillStyle = s.s > 1.8 ? starTint : '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < holes.length; i++) drawHole(holes[i]);
    for (let i = 0; i < items.length; i++) drawItem(items[i]);
    for (let i = 0; i < meteors.length; i++) {
      const m = meteors[i]; ctx.save(); ctx.imageSmoothingEnabled = false; if (m.fire) { ctx.shadowColor = '#ff7a2a'; ctx.shadowBlur = 14; } ctx.translate(m.x, m.y); ctx.rotate(m.rot); ctx.drawImage(m.spr, -m.spr.width / 2, -m.spr.height / 2); ctx.restore();
      if (m.hit > 0) { ctx.globalAlpha = Math.min(0.7, m.hit * 8); ctx.fillStyle = '#fff'; const hs = m.spr.width * 0.7; ctx.fillRect(m.x - hs / 2, m.y - hs / 2, hs, hs); ctx.globalAlpha = 1; }
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], ex = Math.round(e.x - ufoSprite.width / 2), ey = Math.round(e.y - ufoSprite.height / 2);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(ufoSprite, ex, ey);
      if (e.hit > 0) { ctx.globalAlpha = 0.6; ctx.drawImage(ufoFlash, ex, ey); } ctx.restore();
    }
    if (boss) {
      const bw = bossSprites[boss.type].width, bob = Math.sin(boss.ph * 3) * 4;
      if (boss.beam) {   // laser: thin warning line first, then the beam
        const bm = boss.beam, top = boss.y + boss.r * 0.5;
        bm.xs.forEach((bx) => {
          if (!bm.on) { if (Math.floor(bm.t * 12) % 2 === 0) { ctx.fillStyle = 'rgba(255,61,90,.8)'; for (let yy = top; yy < H; yy += 24) ctx.fillRect(bx - 2, yy, 4, 12); } }
          else { ctx.shadowColor = '#ff3da8'; ctx.shadowBlur = 18; ctx.fillStyle = '#ff3da8'; ctx.fillRect(bx - 17, top, 34, H - top); ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - 7, top, 14, H - top); ctx.shadowBlur = 0; }
        });
      }
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(bossSprites[boss.type], boss.x - bw / 2, boss.y - bw / 2 + bob); ctx.restore();
      if (boss.muzzle > 0) { const my = Math.round(boss.y + boss.r * 0.7 + bob); ctx.fillStyle = '#ffd36b'; ctx.fillRect(Math.round(boss.x) - 14, my, 28, 8); ctx.fillStyle = '#ff9a4d'; ctx.fillRect(Math.round(boss.x) - 8, my + 8, 16, 8); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(boss.x) - 4, my, 8, 4); }
      if (boss.hit > 0) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.5; ctx.drawImage(bossFlashSprites[boss.type], boss.x - bw / 2, boss.y - bw / 2 + bob); ctx.restore(); }
    }
    ctx.shadowColor = '#ff3da8'; ctx.shadowBlur = 8;
    for (let i = 0; i < EB.length; i++) { const e = EB[i]; if (e.a) { ctx.fillStyle = '#ff7ab0'; ctx.fillRect(Math.round(e.x) - 5, Math.round(e.y) - 5, 10, 10); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(e.x) - 2, Math.round(e.y) - 2, 4, 4); } }
    ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 10; ctx.fillStyle = '#c9fbff';
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.a) { ctx.fillRect(b.x - 2, b.y - 9, 4, 18); } }
    ctx.shadowBlur = 0;
    if (state === 'playing' || state === 'paused') drawShip();
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p.a) continue; ctx.globalAlpha = Math.max(0, p.l / p.m); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x - p.s), Math.round(p.y - p.s), Math.ceil(p.s * 2), Math.ceil(p.s * 2));
    }
    ctx.globalAlpha = 1;
    ctx.font = '10px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < POPS.length; i++) { const p = POPS[i]; if (!p.a) continue; ctx.globalAlpha = Math.min(1, p.l * 2.5); ctx.fillStyle = '#000'; ctx.fillText(p.txt, p.x + 1, p.y + 1); ctx.fillStyle = p.c; ctx.fillText(p.txt, p.x, p.y); }
    ctx.globalAlpha = 1;
    if (boss && (state === 'playing' || state === 'paused')) {   // small health bar that follows the boss
      const bw = 132, bx = Math.round(boss.x - bw / 2), by = Math.round(boss.y + boss.r + 22);
      ctx.fillStyle = '#000'; ctx.fillRect(bx - 4, by - 4, bw + 8, 16); ctx.fillStyle = '#ff3da8'; ctx.fillRect(bx - 4, by - 4, bw + 8, 2); ctx.fillRect(bx - 4, by + 10, bw + 8, 2);
      ctx.fillStyle = '#3a0f2a'; ctx.fillRect(bx, by, bw, 8); ctx.fillStyle = '#ff3d5a'; ctx.fillRect(bx, by, Math.round(bw * Math.max(0, boss.hp) / boss.max), 8);
    }
    if (flash > 0) { ctx.fillStyle = 'rgba(255,40,100,' + (flash * 0.5).toFixed(3) + ')'; ctx.fillRect(-30, -30, W + 60, H + 60); }
    ctx.restore();
  }

  /* ---------------- Main loop (single rAF) ---------------- */
  let rafId = 0, last = 0;
  function pollPad() {
    let gp = null;
    try { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) { gp = l[i]; break; } } catch (e) { /* ignore */ }
    if (!gp) { gpDir = 0; gpFire = false; return; }
    const bt = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), ax = gp.axes[0] || 0;
    gpDir = bt(14) ? -1 : bt(15) ? 1 : Math.abs(ax) > 0.25 ? ax : 0;
    gpFire = bt(0) || bt(2) || bt(5) || bt(7);
    const a = bt(0), st = bt(9);
    if (a && !gpPrev.a && (state === 'menu' || state === 'over')) startGame();
    if (st && !gpPrev.st) { if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); else if (state === 'menu' || state === 'over') startGame(); }
    gpPrev.a = a; gpPrev.st = st;
  }
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    pollPad();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    update(dt); render();
  }
  function startLoop() { if (rafId) return; last = performance.now(); rafId = requestAnimationFrame(frame); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  /* ---------------- Resize ---------------- */
  function resize() {
    // The playfield is always 720 tall and as wide as the window needs, so the game fills the whole screen
    // (phone or PC, portrait or landscape) with no black bars.
    // Measure the full-screen #app box (not window.innerHeight): inside an installed iPhone app, innerHeight can be wrong
    // for a moment after launch, which made the game look cropped or zoomed out.
    // iPhone home-screen app: the page box can end ~47px above the bottom of the screen. Make the page box exactly
    // as tall as the physical screen (portrait or landscape), then measure it like normal.
    if (window.navigator.standalone === true && window.screen) {
      const portrait = window.innerHeight >= window.innerWidth, sa = window.screen.width, sb = window.screen.height;
      const rootEl = document.documentElement; rootEl.classList.add('ios-standalone');
      rootEl.style.setProperty('--screen-h', (portrait ? Math.max(sa, sb) : Math.min(sa, sb)) + 'px');
    }
    const box = $('app').getBoundingClientRect();
    let vw = Math.max(1, Math.round(box.width || window.innerWidth)), vh = Math.max(1, Math.round(box.height || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Wide screens get a wider field (720 tall). Tall, narrow screens (phones) get a 480-wide field that is taller,
    // so objects keep a comfortable size instead of being blown up.
    const aspect = vw / vh;
    let nw, nh;
    if (aspect < BASE_W / BASE_H) { nw = BASE_W; nh = clamp(Math.round(BASE_W / aspect), BASE_H, MAX_H); }
    else { nh = BASE_H; nw = clamp(Math.round(BASE_H * aspect), BASE_W, MAX_W); }
    if (nw !== W || nh !== H) {
      const oldW = W, oldH = H; W = nw; H = nh; buildNebula();
      for (let i = 0; i < starsBG.length; i++) { if (starsBG[i].x > W) starsBG[i].x = Math.random() * W; starsBG[i].y = starsBG[i].y / oldH * H; }
      ship.x = clamp(ship.x * (W / oldW), 24, W - 24); ship.y = H - 110; pointerX = null;
      if (boss) boss.x = clamp(boss.x, boss.r, W - boss.r);
    }
    starCount = Math.min(starsBG.length, Math.round(110 * (W / BASE_W) * (H / BASE_H)));
    const scale = Math.min(vw / W, vh / H);
    let sw = Math.round(W * scale), sh = Math.round(H * scale);
    if (Math.abs(sw - vw) <= 2) sw = Math.round(vw);     // remove rounding gaps at the edges
    if (Math.abs(sh - vh) <= 2) sh = Math.round(vh);
    stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
    stage.style.setProperty('--u', scale + 'px');
    stage.classList.toggle('wide-layout', W >= 800);
    const pw = Math.round(sw * dpr), ph = Math.round(sh * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }

  /* ---------------- Input (listeners tracked for clean-up) ---------------- */
  const cleanups = [];
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); }

  on(window, 'keydown', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (state === 'playing') { keys.fire = true; fireQueued = true; }
      else if (!e.repeat && (state === 'menu' || state === 'over')) startGame();
      return;
    }
    if (k === 'f' || k === 'F') { toggleFullscreen(); return; }
    if (k === 'Escape') { e.preventDefault(); if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') e.preventDefault();
  });
  on(window, 'keyup', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); keys.fire = false; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });
  on(window, 'blur', () => { keys.left = keys.right = false; pauseGame(); });
  on(document, 'visibilitychange', () => { if (document.hidden) pauseGame(); });

  // touch / mouse drag on the play area
  function toLogical(e) { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; }
  on(stage, 'pointerdown', (e) => {
    if (state !== 'playing' || e.target.closest('button')) return;
    pointerX = toLogical(e); try { stage.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
  });
  on(stage, 'pointermove', (e) => { if (state === 'playing' && pointerX !== null) pointerX = toLogical(e); });
  const endPtr = () => { pointerX = null; };
  on(stage, 'pointerup', endPtr); on(stage, 'pointercancel', endPtr);
  on(stage, 'touchmove', (e) => e.preventDefault(), { passive: false });   // no page scrolling
  on(document, 'contextmenu', (e) => e.preventDefault());

  // on-screen pads
  [['padL', -1], ['padR', 1]].forEach(([id, v]) => {
    const b = $(id);
    on(b, 'pointerdown', (e) => { e.preventDefault(); padDir = v; pointerX = null; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    const up = () => { if (padDir === v) padDir = 0; b.classList.remove('down'); };
    on(b, 'pointerup', up); on(b, 'pointercancel', up); on(b, 'lostpointercapture', up);
  });

  { // Fire pad
    const f = $('padF');
    on(f, 'pointerdown', (e) => { e.preventDefault(); padFire = true; f.classList.add('down'); try { f.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    const up = () => { padFire = false; f.classList.remove('down'); };
    on(f, 'pointerup', up); on(f, 'pointercancel', up); on(f, 'lostpointercapture', up);
  }

  // buttons
  function click(id, fn) { on($(id), 'click', (e) => { audio(); fn(e); e.currentTarget.blur(); }); }
  click('btnPlay', startGame); click('btnAgain', startGame); click('btnRestart', startGame);
  click('btnPause', pauseGame); click('btnResume', resumeGame);
  click('btnPauseMenu', toMenu); click('btnOverMenu', toMenu);
  click('btnSound', () => { soundOn = !soundOn; store.set('sound', soundOn ? '1' : '0'); refreshMenu(); if (soundOn) sfx.star(); });
  click('btnHow', () => screens.menu.classList.add('show-how')); click('btnHowBack', () => screens.menu.classList.remove('show-how'));
  click('btnMusic', () => { musicOn = !musicOn; store.set('music', musicOn ? '1' : '0'); refreshMenu(); if (!musicOn) music.stop(); });
  document.querySelectorAll('.ship-btn').forEach((b) => on(b, 'click', () => {
    const id = b.dataset.ship;
    if (!unlocked.has(id)) { $('shipDesc').textContent = UNLOCK_HINT[id]; return; }   // still locked: just show how to unlock it
    shipId = id; store.set('ship', shipId); refreshMenu();
  }));
  click('btnPadToggle', () => { padOn = !padOn; store.set('pad2', padOn ? '1' : '0'); refreshMenu(); });
  click('btnShare', () => share(false)); click('btnShare2', () => share(true));
  document.querySelectorAll('.diff-btn:not(.ship-btn)').forEach((b) => on(b, 'click', () => { difficulty = b.dataset.diff; store.set('difficulty', difficulty); refreshMenu(); }));

  /* ---------------- Hidden info panel (tap the title 5 times) ---------------- */
  { let taps = 0, tapT = 0;
    on(document.querySelector('#menu .title'), 'click', () => {
      const now = Date.now(); taps = now - tapT < 1500 ? taps + 1 : 1; tapT = now;
      if (taps < 5) return; taps = 0;
      let box = $('infoPanel');
      if (!box) { box = document.createElement('pre'); box.id = 'infoPanel'; box.style.cssText = 'position:fixed;left:8px;right:8px;top:60px;z-index:99;margin:0;padding:10px;background:rgba(0,0,0,.88);color:#9ff3ff;font:11px/1.5 monospace;white-space:pre-wrap;border:2px solid #22d3ff'; document.body.appendChild(box); on(box, 'click', () => { box.style.display = 'none'; }); }
      const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden'; document.body.appendChild(probe);
      const cs = getComputedStyle(probe), ar = $('app').getBoundingClientRect(), vv = window.visualViewport;
      box.textContent = ['inner ' + innerWidth + 'x' + innerHeight, 'app ' + Math.round(ar.width) + 'x' + Math.round(ar.height), 'screen ' + screen.width + 'x' + screen.height,
        'visual ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : 'n/a'), 'standalone ' + String(navigator.standalone), 'insets top ' + cs.paddingTop + ' bottom ' + cs.paddingBottom,
        'field ' + W + 'x' + H + ' stage ' + stage.style.width + ' x ' + stage.style.height, 'dpr ' + window.devicePixelRatio, '(tap this box to close)'].join('\n');
      box.style.display = 'block'; probe.remove();
    });
  }

  /* ---------------- Fullscreen ---------------- */
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { /* not allowed */ }
  }
  if (!document.fullscreenEnabled) $('btnFull').classList.add('hidden');
  click('btnFull', toggleFullscreen);

  /* ---------------- Share ---------------- */
  async function share(withScore) {
    const url = location.href.split('#')[0];
    const text = withScore ? 'I scored ' + fmt(score) + ' in METEOR DODGE! Can you beat me?' : 'Dodge meteors, collect stars and survive in METEOR DODGE!';
    try { if (navigator.share) { await navigator.share({ title: 'METEOR DODGE', text, url }); return; } }
    catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('LINK COPIED!', 1500); return; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta);
      toast(ok ? 'LINK COPIED!' : url, 2500);
    } catch (e) { toast(url, 3000); }
  }

  /* ---------------- Init / teardown ---------------- */
  function destroy() { stopLoop(); cleanups.splice(0).forEach((f) => f()); try { if (ac) ac.close(); } catch (e) { /* ignore */ } }
  on(window, 'resize', resize); on(document, 'fullscreenchange', resize);
  // phones sometimes report the final size late (app launch, rotation, browser bars): measure again a few times
  const resizeSoon = () => { [0, 120, 400, 1000].forEach((ms) => setTimeout(resize, ms)); };
  on(window, 'pageshow', resizeSoon); on(window, 'load', resizeSoon); on(window, 'orientationchange', resizeSoon);
  on(document, 'visibilitychange', () => { if (!document.hidden) resizeSoon(); });
  const resizeTimer = setInterval(() => { if (!document.hidden) resize(); }, 1500);   // cheap safety net: catches sizes that arrive late
  cleanups.push(() => clearInterval(resizeTimer));
  if (window.ResizeObserver) { try { const ro = new ResizeObserver(() => resize()); ro.observe($('app')); cleanups.push(() => ro.disconnect()); } catch (e) { /* ignore */ } }
  if (window.visualViewport) on(window.visualViewport, 'resize', resize); on(window, 'orientationchange', resize);
  on(window, 'pagehide', destroy);

  resize(); refreshMenu(); setState('menu'); startLoop();

  // works offline / installable as an app (only on http/https, never from a file)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ }); });
  }

  // small hook used by the automated tests (read-only helpers; no effect on normal play)
  window.MeteorDodge = {
    get: () => ({ W, state, score, lives, stars, shield, squad, squadT, rapid, theme: themeIdx, themeFade, holes: holes.length, unlocked: [...unlocked].join(','), combo, bestCombo, shipId, boss: boss ? { hp: boss.hp, max: boss.max, x: boss.x, y: boss.y, phase: boss.phase } : null, bossKills, enemies: enemies.length, ebullets: EB.filter((e) => e.a).length, invuln, level, t, best, shipX: ship.x, meteors: meteors.length, items: items.length, rafId, difficulty }),
    step: update, startGame, pauseGame, resumeGame, ship, meteors, items, keys, bullets: B,
    spawnMeteor, spawnItem, spawnBoss, spawnEnemy, spawnHole, setTheme: (i) => { themeIdx = nextTheme = i; themeFade = 1; paintNebula(nebula, THEMES[i]); }, holeList: holes, unlock, enemyList: enemies, eb: EB, destroy, music, setShip: (id) => { shipId = id; ship.r = SHIPS[id].r; }
  };
})();
