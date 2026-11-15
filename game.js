/* METEOR DODGE – vanilla JS / Canvas / Web Audio. No dependencies, no network requests. */
(() => {
  'use strict';

  const W = 480, H = 720;                       // logical game size (2:3 portrait)
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
  const keys = { left: false, right: false };
  let padDir = 0, pointerX = null;
  const meteors = [], items = [];

  /* ---------------- DOM refs ---------------- */
  const hudScore = $('hudScore'), hudBest = $('hudBest'), livesEl = $('lives'), powerEl = $('power'), powerBar = $('powerBar');
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
  const nebula = document.createElement('canvas'); nebula.width = W; nebula.height = H;
  (function buildNebula() {
    const g = nebula.getContext('2d');
    g.fillStyle = '#05060f'; g.fillRect(0, 0, W, H);
    [[100, 140, 280, 'rgba(120,40,200,.32)'], [400, 360, 300, 'rgba(255,61,168,.16)'], [160, 600, 320, 'rgba(34,211,255,.16)'], [420, 40, 200, 'rgba(34,211,255,.1)']]
      .forEach(([x, y, r, c]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
  })();
  const starsBG = [];
  for (let i = 0; i < 110; i++) {
    const layer = i % 3;
    starsBG.push({ x: Math.random() * W, y: Math.random() * H, s: 0.7 + layer * 0.7, v: 14 + layer * 28, ph: Math.random() * 6.28 });
  }

  /* ---------------- Meteor sprites (pre-rendered once) ---------------- */
  const PALETTES = [
    { a: '#8d7f78', b: '#4a403c', rim: 'rgba(255,200,150,.35)', crater: 'rgba(30,22,20,.55)' },   // rock
    { a: '#9fd8ff', b: '#3a6ea0', rim: 'rgba(200,245,255,.6)',  crater: 'rgba(20,50,90,.45)' },    // ice
    { a: '#b0452b', b: '#3a1410', rim: 'rgba(255,140,60,.75)',  crater: 'rgba(255,120,40,.5)' }    // magma
  ];
  const sprites = PALETTES.map((pal) => SIZES.map((sz) => {
    const r = sz.r, S = Math.ceil(r * 2 + 12), c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.translate(S / 2, S / 2);
    const n = 11 + Math.floor(r / 6), pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * 6.2832, k = 0.78 + Math.random() * 0.26; pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]); }
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
    const gr = g.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r * 1.1); gr.addColorStop(0, pal.a); gr.addColorStop(1, pal.b);
    g.shadowColor = pal.rim; g.shadowBlur = 6; g.fillStyle = gr; g.fill();
    g.shadowBlur = 0; g.lineWidth = 1.5; g.strokeStyle = pal.rim; g.stroke();
    g.save(); g.clip();
    for (let i = 0; i < 3 + r / 8; i++) {
      const cx = (Math.random() - 0.5) * r * 1.1, cy = (Math.random() - 0.5) * r * 1.1, cr = r * (0.1 + Math.random() * 0.18);
      g.fillStyle = pal.crater; g.beginPath(); g.arc(cx, cy, cr, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(cx - 0.8, cy - 0.8, cr, 3.6, 5.7); g.stroke();
    }
    g.restore();
    return c;
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
  }
  function popScore() { try { hudScore.animate([{ transform: 'scale(1.35)', color: '#ffd36b' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); } catch (e) { /* old browsers */ } }

  /* ---------------- Game flow ---------------- */
  function startGame() {
    t = 0; score = 0; shownScore = 0; scoreFrac = 0; stars = 0; lives = 3; level = 0; shield = 0; invuln = 0; flash = 0; shakeT = 0; dyingT = 0;
    beatBest = false; prevBest = best; spawnT = 1.2; starT = 5; shieldT = 20; shownHudScore = -1;
    ship.x = W / 2; ship.vx = 0; pointerX = null; padDir = 0;
    meteors.length = 0; items.length = 0; P.forEach((p) => { p.a = false; });
    $('newBest').classList.add('hidden');
    renderLives(); renderHud(); hudBest.textContent = fmt(best);
    setState('playing'); sfx.start();
  }
  function pauseGame() { if (state === 'playing') { setState('paused'); keys.left = keys.right = false; padDir = 0; } }
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
      r: sz.r, spr: sprites[Math.floor(Math.random() * 3)][si], rot: rand(0, 6.28), vr: rand(-2, 2) };
    meteors.push(m);
  }
  function spawnItem(kind) { items.push({ kind, x: rand(30, W - 30), y: -20, vy: 110, r: 13, ph: Math.random() * 6 }); }

  /* ---------------- Update ---------------- */
  function update(dt) {
    // background always scrolls
    for (let i = 0; i < starsBG.length; i++) { const s = starsBG[i]; s.y += s.v * dt * (state === 'playing' ? 1 + level * 0.08 : 1); if (s.y > H) { s.y = -2; s.x = Math.random() * W; } s.ph += dt * 2; }
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
      pointerX = null; ship.vx += (clamp(dir, -1, 1) * 430 - ship.vx) * Math.min(1, dt * 12); ship.x += ship.vx * dt;
    } else if (pointerX !== null) {
      const nx = ship.x + (pointerX - ship.x) * Math.min(1, dt * 16); ship.vx = (nx - ship.x) / Math.max(dt, 1e-3); ship.x = nx;
    } else { ship.vx += (0 - ship.vx) * Math.min(1, dt * 10); ship.x += ship.vx * dt; }
    ship.x = clamp(ship.x, 24, W - 24); // never leave the playfield

    if (invuln > 0) invuln -= dt;
    if (shield > 0) { shield -= dt; if (shield <= 0) shield = 0; }

    // engine particles
    if (Math.random() < 0.7) emit(ship.x + rand(-4, 4), ship.y + 26, 1, Math.random() < 0.5 ? '#ff3da8' : '#ffd36b', 60, 0.35, 2);

    // spawning with start-up grace and progressive difficulty
    spawnT -= dt;
    if (spawnT <= 0) {
      const ramp = Math.max(0.36, 1 - t / 110), grace = t < d.grace ? 1.8 : 1;
      spawnMeteor(); spawnT = 0.72 * d.interval * ramp * grace * rand(0.75, 1.25);
      if (level >= 3 && Math.random() < 0.2) spawnMeteor();
    }
    starT -= dt; if (starT <= 0) { spawnItem('star'); starT = rand(3.5, 6.5); }
    shieldT -= dt; if (shieldT <= 0) { if (shield <= 0) spawnItem('shield'); shieldT = rand(18, 28); }

    stepWorld(dt, true);
    renderHud();
  }

  function checkBest() {
    if (!beatBest && prevBest > 0 && score > prevBest) { beatBest = true; toast('NEW HIGH SCORE!', 1600); sfx.best(); hudBest.textContent = fmt(score); }
    if (beatBest) hudBest.textContent = fmt(score);
  }

  function stepWorld(dt, active) {
    shownScore += (score - shownScore) * Math.min(1, dt * 10); if (score - shownScore < 0.5) shownScore = score;
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]; m.y += m.vy * dt; m.x += m.vx * dt; m.rot += m.vr * dt;
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
          else { shield = SHIELD_SECS; sfx.power(); emit(ship.x, ship.y, 30, '#22d3ff', 260, 0.7, 2.5); toast('SHIELD ON!', 1000); }
        }
      }
    }
  }

  /* ---------------- Rendering ---------------- */
  function drawShip() {
    const blink = invuln > 0 && Math.floor(t * 14) % 2 === 0;
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(clamp(ship.vx / 430, -1, 1) * 0.18);
    if (!blink) {
      // flame
      const fl = 14 + Math.random() * 12, fg = ctx.createLinearGradient(0, 22, 0, 22 + fl);
      fg.addColorStop(0, '#ffd36b'); fg.addColorStop(0.5, '#ff3da8'); fg.addColorStop(1, 'rgba(255,61,168,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(-6, 22); ctx.lineTo(0, 22 + fl); ctx.lineTo(6, 22); ctx.closePath(); ctx.fill();
      // hull
      const hg = ctx.createLinearGradient(0, -26, 0, 24); hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#22d3ff');
      ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 18; ctx.fillStyle = hg; ctx.strokeStyle = '#22d3ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(8, -8); ctx.lineTo(24, 14); ctx.lineTo(22, 22); ctx.lineTo(10, 16); ctx.lineTo(6, 24);
      ctx.lineTo(-6, 24); ctx.lineTo(-10, 16); ctx.lineTo(-22, 22); ctx.lineTo(-24, 14); ctx.lineTo(-8, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#ff3da8'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-22, 22); ctx.lineTo(-10, 16); ctx.moveTo(22, 22); ctx.lineTo(10, 16); ctx.stroke();
      const cg = ctx.createLinearGradient(0, -12, 0, 6); cg.addColorStop(0, '#c084fc'); cg.addColorStop(1, '#ff3da8');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(0, -4, 4, 9, 0, 0, 6.2832); ctx.fill();
    }
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
    } else {
      ctx.shadowColor = '#22d3ff'; ctx.shadowBlur = 16; ctx.strokeStyle = '#22d3ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, it.r + Math.sin(it.ph) * 1.5, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = 'rgba(34,211,255,.35)'; ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', 0, 1);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shakeT > 0) ctx.translate(rand(-1, 1) * shakeMag * Math.min(1, shakeT * 4), rand(-1, 1) * shakeMag * Math.min(1, shakeT * 4));
    ctx.drawImage(nebula, -20, -20, W + 40, H + 40);
    for (let i = 0; i < starsBG.length; i++) {
      const s = starsBG[i]; ctx.globalAlpha = 0.45 + 0.4 * Math.sin(s.ph); ctx.fillStyle = s.s > 1.8 ? '#cfefff' : '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < items.length; i++) drawItem(items[i]);
    for (let i = 0; i < meteors.length; i++) {
      const m = meteors[i]; ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot); ctx.drawImage(m.spr, -m.spr.width / 2, -m.spr.height / 2); ctx.restore();
    }
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
    const w = stage.clientWidth || W, dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.style.setProperty('--u', (w / W) + 'px');
    const pw = Math.round(w * dpr), ph = Math.round(w * (H / W) * dpr);
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
      if (!e.repeat && (state === 'menu' || state === 'over')) startGame();
      return;
    }
    if (k === 'Escape') { e.preventDefault(); if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') e.preventDefault();
  });
  on(window, 'keyup', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') e.preventDefault();
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
    get: () => ({ state, score, lives, stars, shield, invuln, level, t, best, shipX: ship.x, meteors: meteors.length, items: items.length, rafId, difficulty }),
    step: update, startGame, pauseGame, resumeGame, ship, meteors, items, keys,
    spawnMeteor, spawnItem, destroy
  };
})();
