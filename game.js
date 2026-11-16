/* METEOR DODGE – vanilla JS / Canvas / Web Audio. No dependencies, no network requests. */
(() => {
  'use strict';

  // Logical playfield: always 720 tall. Width is 480 on phones and stretches up to 1280 on wide PC screens.
  const BASE_W = 480, MAX_W = 1280, H = 720;
  let W = BASE_W;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('game'), ctx = canvas.getContext('2d');

  /* ---------------- Safe storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('meteorDodge.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('meteorDodge.' + k, String(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------------- Settings / constants ---------------- */
  const DIFF = {
    easy:   { speed: 0.75, interval: 1.4,  grace: 4.5, label: 'Easy' },
    normal: { speed: 1.0,  interval: 1.0,  grace: 3.5, label: 'Normal' },
    hard:   { speed: 1.3,  interval: 0.72, grace: 2.5, label: 'Hard' }
  };
  const SIZES = [{ r: 13, speed: 1.15 }, { r: 22, speed: 1.0 }, { r: 34, speed: 0.8 }];
  const LEVEL_SECS = 15;
  const SHIELD_SECS = 6;
  const INVULN_SECS = 1.6;

  let difficulty = store.get('difficulty', 'normal'); if (!DIFF[difficulty]) difficulty = 'normal';
  let soundOn = store.get('sound', '1') === '1';
  let padOn = store.get('pad', '1') === '1';
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
  const FIRE_COOLDOWN = 0.2, BULLET_SPEED = 780;
  const B = [];                                  // fixed bullet pool
  for (let i = 0; i < 56; i++) B.push({ a: false, x: 0, y: 0 });
  // "Squad" power-up: extra wingman planes (up to 2) that fly beside you and shoot too, for a limited time
  const SQUAD_SECS = 10, WING_X = [46, -46], WING_Y = 14, WING_SCALE = 0.75;
  let squad = 0, squadT = 0, wingSpawnT = 14;
  // "Rapid" power-up: much faster shooting for a while. "Bomb": instantly blows up every meteor on screen.
  const RAPID_SECS = 8, RAPID_COOLDOWN = 0.085;
  let rapid = 0, rapidSpawnT = 22, bombSpawnT = 30;
  let fireT = 0, bulletCursor = 0, fireQueued = false;   // fireQueued: a quick tap still fires one shot

  /* ---------------- DOM refs ---------------- */
  const hudScore = $('hudScore'), hudBest = $('hudBest'), livesEl = $('lives'), powerEl = $('power'), powerBar = $('powerBar');
  const power2El = $('power2'), power2Label = $('power2Label'), power2Bar = $('power2Bar');
  const power3El = $('power3'), power3Bar = $('power3Bar');
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
    best()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'square', 0.07, 0, i * 0.1)); }
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
  const nebula = document.createElement('canvas');
  function buildNebula() {
    nebula.width = W; nebula.height = H;
    const g = nebula.getContext('2d'), k = W / BASE_W;
    g.fillStyle = '#05060f'; g.fillRect(0, 0, W, H);
    [[100 * k, 140, 280, 'rgba(120,40,200,.32)'], [400 * k, 360, 300, 'rgba(255,61,168,.16)'], [160 * k, 600, 320, 'rgba(34,211,255,.16)'], [420 * k, 40, 200, 'rgba(34,211,255,.1)'], [W * 0.62, 220, 260, 'rgba(120,40,200,.18)']]
      .forEach(([x, y, r, c]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
  }
  buildNebula();
  const starsBG = [];
  for (let i = 0; i < 300; i++) {                // enough for the widest field; only starCount are used
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
  const METEOR_PX = [3, 4, 4];                     // size of one "art pixel" for small / medium / large meteors
  const sprites = PALETTES.map((pal) => SIZES.map((sz, si) => {
    // draw the meteor on a tiny grid, one square per art pixel, so it looks like real pixel art
    const PX = METEOR_PX[si], n = Math.ceil(sz.r * 2 / PX), c = (n - 1) / 2, R = n / 2;
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
    return cv;
  }));

  /* ---------------- Helpers ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    const stamp = ++lastToast;
    setTimeout(() => { if (stamp === lastToast) toastEl.classList.remove('show'); }, ms || 1400);
  }
  function shake(mag, dur) { shakeMag = mag; shakeT = dur; }
  function fmt(n) { return String(Math.floor(n)); }

  /* ---------------- UI state ---------------- */
  function setState(s) {
    state = s;
    stage.classList.remove('state-menu', 'state-playing', 'state-paused', 'state-dying', 'state-over');
    stage.classList.add('state-' + (s === 'dying' ? 'playing' : s));
    screens.menu.classList.toggle('active', s === 'menu');
    screens.pause.classList.toggle('active', s === 'paused');
    screens.over.classList.toggle('active', s === 'over');
  }
  function refreshMenu() {
    $('menuBest').textContent = fmt(best); hudBest.textContent = fmt(best);
    document.querySelectorAll('.diff-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === difficulty)));
    const sb = $('btnSound'); sb.textContent = 'SOUND: ' + (soundOn ? 'ON' : 'OFF'); sb.setAttribute('aria-pressed', String(soundOn));
    const pb = $('btnPadToggle'); pb.textContent = 'TOUCH PAD: ' + (padOn ? 'ON' : 'OFF'); pb.setAttribute('aria-pressed', String(padOn));
    stage.classList.toggle('pad-on', padOn);
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
    $('ovScore').textContent = fmt(score); $('ovBest').textContent = fmt(best); $('ovStars').textContent = stars;
    $('newBest').classList.toggle('hidden', !isBest);
    if (isBest) setTimeout(() => { if (state === 'over') sfx.best(); }, 500);
    setState('over'); refreshMenu();
  }

  function hurt() {
    lives--; renderLives(); sfx.hit(); shake(14, 0.4); flash = 0.55;
    emit(ship.x, ship.y, 26, '#ff3da8', 260, 0.7, 3);
    if (lives <= 0) {
      state = 'dying'; dyingT = 1.1; sfx.over(); shake(26, 0.9);
      emit(ship.x, ship.y, 90, '#ffd36b', 380, 1.2, 3.5); emit(ship.x, ship.y, 60, '#22d3ff', 300, 1.0, 3);
    } else invuln = INVULN_SECS;
  }

  /* ---------------- Spawning ---------------- */
  function spawnMeteor() {
    const d = DIFF[difficulty], si = Math.random() < 0.42 ? 0 : Math.random() < 0.6 ? 1 : 2, sz = SIZES[si];
    const ramp = 1 + Math.min(t / 70, 1.4);
    const m = { x: rand(sz.r, W - sz.r), y: -sz.r - 12, vy: rand(150, 270) * d.speed * ramp * sz.speed, vx: t > 20 ? rand(-45, 45) : 0,
      r: sz.r, spr: sprites[Math.floor(Math.random() * 3)][si], rot: Math.floor(Math.random() * 4) * 1.5708, vr: 0, si, hp: si + 1, hit: 0 };
    meteors.push(m);
  }
  function spawnItem(kind) { items.push({ kind, x: rand(30, W - 30), y: -20, vy: 110, r: 13, ph: Math.random() * 6 }); }

  /* ---------------- Update ---------------- */
  function update(dt) {
    // background always scrolls
    for (let i = 0; i < starCount; i++) { const s = starsBG[i]; s.y += s.v * dt * (state === 'playing' ? 1 + level * 0.08 : 1); if (s.y > H) { s.y = -2; s.x = Math.random() * W; } s.ph += dt * 2; }
    for (let i = 0; i < P.length; i++) { const p = P[i]; if (!p.a) continue; p.l -= dt; if (p.l <= 0) { p.a = false; continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; }
    if (shakeT > 0) shakeT -= dt;
    if (flash > 0) flash -= dt;

    if (state === 'dying') {
      stepWorld(dt, false); dyingT -= dt; if (dyingT <= 0) endGame(); return;
    }
    if (state !== 'playing') return;

    t += dt;
    const d = DIFF[difficulty];
    // level-up feedback
    const lv = Math.floor(t / LEVEL_SECS);
    if (lv > level) { level = lv; toast('SPEED UP!  LEVEL ' + (level + 1), 1300); }

    // score: survival points
    scoreFrac += dt * 10 * (1 + level * 0.15);
    if (scoreFrac >= 1) { const add = Math.floor(scoreFrac); score += add; scoreFrac -= add; }
    checkBest();

    // ship movement
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + padDir;
    if (dir !== 0) {
      pointerX = null; ship.vx += (clamp(dir, -1, 1) * 430 * (1 + (W / BASE_W - 1) * 0.45) - ship.vx) * Math.min(1, dt * 12); ship.x += ship.vx * dt;
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
    if (fireT <= 0 && (fireQueued || keys.fire || padFire || pointerX !== null)) { shoot(); fireT = rapid > 0 ? RAPID_COOLDOWN : FIRE_COOLDOWN; }
    fireQueued = false;

    // spawning with start-up grace and progressive difficulty
    spawnT -= dt;
    if (spawnT <= 0) {
      const ramp = Math.max(0.36, 1 - t / 110), grace = t < d.grace ? 1.8 : 1;
      // wider field => proportionally more meteors, so a big screen isn't easier than a phone
      spawnMeteor(); spawnT = 0.72 * d.interval * ramp * grace * rand(0.75, 1.25) / Math.pow(W / BASE_W, 0.8);
      if (level >= 3 && Math.random() < 0.2) spawnMeteor();
    }
    starT -= dt; if (starT <= 0) { spawnItem('star'); starT = rand(3.5, 6.5); }
    shieldT -= dt; if (shieldT <= 0) { if (shield <= 0) spawnItem('shield'); shieldT = rand(18, 28); }
    wingSpawnT -= dt; if (wingSpawnT <= 0) { spawnItem('wing'); wingSpawnT = rand(16, 26); }
    if (squad > 0) { squadT -= dt; if (squadT <= 0) loseSquad(); }
    rapidSpawnT -= dt; if (rapidSpawnT <= 0) { spawnItem('rapid'); rapidSpawnT = rand(20, 32); }
    bombSpawnT -= dt; if (bombSpawnT <= 0) { spawnItem('bomb'); bombSpawnT = rand(28, 42); }
    if (rapid > 0) rapid = Math.max(0, rapid - dt);

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
    fireBullet(ship.x, ship.y - 28);
    for (let k = 0; k < squad; k++) fireBullet(ship.x + WING_X[k], ship.y + WING_Y - 28 * WING_SCALE);
    sfx.shoot();
  }
  function bomb() {
    let n = 0;
    for (let j = meteors.length - 1; j >= 0; j--) {
      const m = meteors[j]; score += (m.si + 1) * 10; n++;
      emit(m.x, m.y, 14 + m.si * 8, '#ff9a4d', 240, 0.7, 3); emit(m.x, m.y, 6, '#ffffff', 160, 0.4, 2);
    }
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
      for (let j = 0; j < meteors.length; j++) {
        const m = meteors[j], dx = m.x - b.x, dy = m.y - b.y, rr = m.r * 0.9 + 4;
        if (dx * dx + dy * dy < rr * rr) {
          b.a = false; m.hp--; m.hit = 0.09; emit(b.x, b.y, 6, '#ffd36b', 160, 0.3, 2);
          if (m.hp <= 0) {
            score += (m.si + 1) * 10; sfx.boom(); shake(3 + m.si * 2, 0.12);
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
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]; m.y += m.vy * dt; m.x += m.vx * dt; m.rot += m.vr * dt; if (m.hit > 0) m.hit -= dt;
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
  // Pixel-art ship: left half of each row, mirrored to make the full plane (16 x 16 art pixels)
  const SHIP_ART = [
    '.......o', '......ow', '......ow', '.....owc', '.....owv', '....owvv', '....owcv', '...owccc',
    'o..owccc', 'oo.owccd', 'owoowccd', 'owcccccd', 'opcccccd', 'oppoocdd', '.oo..odd', '.....ood'
  ];
  const SHIP_PX = 3;
  const SHIP_COLORS = {
    ship: { o: '#0b3a66', w: '#ffffff', c: '#22d3ff', d: '#1688b8', p: '#ff3da8', v: '#c084fc' },
    wing: { o: '#3b1768', w: '#f3e8ff', c: '#c084fc', d: '#8b4fd0', p: '#ff3da8', v: '#ffd36b' }
  };
  const shipSprites = {};
  Object.keys(SHIP_COLORS).forEach((key) => {
    const col = SHIP_COLORS[key], cv = document.createElement('canvas'); cv.width = cv.height = 16 * SHIP_PX; const g = cv.getContext('2d');
    SHIP_ART.forEach((row, y) => {
      const full = row + row.split('').reverse().join('');
      for (let x = 0; x < 16; x++) { const ch = full[x]; if (ch !== '.') { g.fillStyle = col[ch]; g.fillRect(x * SHIP_PX, y * SHIP_PX, SHIP_PX, SHIP_PX); } }
    });
    shipSprites[key] = cv;
  });
  function drawHull(wing) {
    // blocky flame under the engine (flickers), then the pixel plane, all centred on (0,0)
    const rows = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rows; i++) {
      ctx.fillStyle = i === 0 ? '#ffd36b' : i < 3 ? '#ff9a4d' : '#ff3da8';
      ctx.fillRect(-SHIP_PX * 1.5, 24 + i * SHIP_PX, SHIP_PX * 3, SHIP_PX);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(shipSprites[wing ? 'wing' : 'ship'], -24, -26);
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
    for (let i = 0; i < starCount; i++) {
      const s = starsBG[i]; ctx.globalAlpha = 0.45 + 0.4 * Math.sin(s.ph); ctx.fillStyle = s.s > 1.8 ? '#cfefff' : '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < items.length; i++) drawItem(items[i]);
    for (let i = 0; i < meteors.length; i++) {
      const m = meteors[i]; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(m.x, m.y); ctx.rotate(m.rot); ctx.drawImage(m.spr, -m.spr.width / 2, -m.spr.height / 2); ctx.restore();
      if (m.hit > 0) { ctx.globalAlpha = Math.min(0.7, m.hit * 8); ctx.fillStyle = '#fff'; const hs = m.spr.width * 0.7; ctx.fillRect(m.x - hs / 2, m.y - hs / 2, hs, hs); ctx.globalAlpha = 1; }
    }
    ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 10; ctx.fillStyle = '#c9fbff';
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.a) { ctx.fillRect(b.x - 2, b.y - 9, 4, 18); } }
    ctx.shadowBlur = 0;
    if (state === 'playing' || state === 'paused') drawShip();
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p.a) continue; ctx.globalAlpha = Math.max(0, p.l / p.m); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (flash > 0) { ctx.fillStyle = 'rgba(255,40,100,' + (flash * 0.5).toFixed(3) + ')'; ctx.fillRect(-30, -30, W + 60, H + 60); }
    ctx.restore();
  }

  /* ---------------- Main loop (single rAF) ---------------- */
  let rafId = 0, last = 0;
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    update(dt); render();
  }
  function startLoop() { if (rafId) return; last = performance.now(); rafId = requestAnimationFrame(frame); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  /* ---------------- Resize ---------------- */
  function resize() {
    const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight), dpr = Math.min(window.devicePixelRatio || 1, 2);
    // touch devices keep the portrait 2:3 field; mouse/keyboard devices fill the whole window (up to 16:9)
    let coarse = false; try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* ignore */ }
    const nw = clamp(Math.round(H * vw / vh), BASE_W, coarse ? BASE_W : MAX_W);
    if (nw !== W) {
      const old = W; W = nw; buildNebula();
      for (let i = 0; i < starsBG.length; i++) if (starsBG[i].x > W) starsBG[i].x = Math.random() * W;
      ship.x = clamp(ship.x * (W / old), 24, W - 24); pointerX = null;
    }
    starCount = Math.min(starsBG.length, Math.round(110 * W / BASE_W));
    const scale = Math.min(vw / W, vh / H), sw = Math.floor(W * scale), sh = Math.floor(H * scale);
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
  click('btnPadToggle', () => { padOn = !padOn; store.set('pad', padOn ? '1' : '0'); refreshMenu(); });
  click('btnShare', () => share(false)); click('btnShare2', () => share(true));
  document.querySelectorAll('.diff-btn').forEach((b) => on(b, 'click', () => { difficulty = b.dataset.diff; store.set('difficulty', difficulty); refreshMenu(); }));

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
  on(window, 'resize', resize); on(window, 'orientationchange', resize);
  on(window, 'pagehide', destroy);

  resize(); refreshMenu(); setState('menu'); startLoop();

  // small hook used by the automated tests (read-only helpers; no effect on normal play)
  window.MeteorDodge = {
    get: () => ({ W, state, score, lives, stars, shield, squad, squadT, rapid, invuln, level, t, best, shipX: ship.x, meteors: meteors.length, items: items.length, rafId, difficulty }),
    step: update, startGame, pauseGame, resumeGame, ship, meteors, items, keys, bullets: B,
    spawnMeteor, spawnItem, destroy
  };
})();
