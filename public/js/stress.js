// Stress buster zone. Each tool registers optional start/stop hooks so switching
// tools silences sounds and timers. All sounds are synthesised with WebAudio.

const logUse = (tool, amount = 1) => api('/stress-log', { method: 'POST', body: { tool, amount } }).catch(() => {});
const tools = {};

// ---------- sound helpers ----------

const noiseCache = {};
function noise(kind, seconds = 2) {
  const ctx = audio();
  const key = `${kind}-${seconds}`;
  if (noiseCache[key]) return noiseCache[key];
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
  }
  return (noiseCache[key] = buf);
}

function envelope(node, peak, attack, decay) {
  const t = audio().currentTime;
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function thump(power) {
  const ctx = audio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.16);
  envelope(g, 0.25 + power * 0.5, 0.005, 0.25);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.3);
  const slap = ctx.createBufferSource();
  slap.buffer = noise('white', 0.2);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 700 + power * 900;
  const ng = ctx.createGain();
  envelope(ng, 0.15 + power * 0.25, 0.002, 0.08);
  slap.connect(f).connect(ng).connect(ctx.destination);
  slap.start(t);
}

function pop() {
  const ctx = audio();
  const src = ctx.createBufferSource();
  src.buffer = noise('white', 0.2);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1500 + Math.random() * 1500;
  f.Q.value = 1.5;
  const g = ctx.createGain();
  envelope(g, 0.6, 0.001, 0.05);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

function bell(volume = 0.18) {
  const ctx = audio();
  [[220, 1], [440, 0.5], [606, 0.35], [1188, 0.15]].forEach(([freq, amp]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    envelope(g, volume * amp, 0.02, 4.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 5);
  });
}

function chime(freq) {
  const ctx = audio();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  envelope(g, 0.05, 0.05, 1.2);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 1.4);
}

// ---------- punching bag ----------

tools.punch = (() => {
  const stage = $('#bag-stage');
  const bag = $('#bag');
  const body = $('#bag-body');
  body.style.transformBox = 'fill-box';
  body.style.transformOrigin = 'center';
  const WORDS = ['POW!', 'BAM!', 'WHAM!', 'BOOM!', 'Take that!', '💥', 'THWACK!'];
  const MILESTONES = {
    10: 'Nice. Keep going if you need to.',
    25: 'Let it all out — this bag can take it.',
    50: 'Feeling some of it leave your shoulders?',
    100: 'Wow. Take a deep breath… how do you feel now?',
    200: 'You’ve got serious power. Maybe some water and a breather? 💧',
  };
  let angle = 0, vel = 0, power = 0, lastHit = 0, punches = 0, unsaved = 0, raf = null;

  function frame() {
    vel += -0.022 * angle;
    vel *= 0.965;
    angle = Math.max(-38, Math.min(38, angle + vel));
    power *= 0.985;
    bag.setAttribute('transform', `rotate(${angle.toFixed(2)} 100 40)`);
    $('#power').style.width = `${Math.round(power * 100)}%`;
    if (Math.abs(angle) < 0.05 && Math.abs(vel) < 0.05 && power < 0.01) { raf = null; return; }
    raf = requestAnimationFrame(frame);
  }

  function hit(clientX, clientY) {
    const now = performance.now();
    power = Math.min(1, power * 0.85 + (now - lastHit < 380 ? 0.28 : 0.12));
    lastHit = now;
    const rect = stage.getBoundingClientRect();
    const x = clientX ?? rect.left + rect.width / 2 + (Math.random() - 0.5) * 60;
    const y = clientY ?? rect.top + rect.height / 2;
    vel += (x < rect.left + rect.width / 2 ? -1 : 1) * (1.5 + power * 5);
    body.animate([{ transform: 'scale(.9, 1.03)' }, { transform: 'scale(1, 1)' }], { duration: 200, easing: 'ease-out' });

    const word = document.createElement('div');
    word.className = 'pow';
    word.textContent = WORDS[Math.floor(Math.random() * WORDS.length)];
    word.style.left = `${x - rect.left}px`;
    word.style.top = `${y - rect.top}px`;
    word.style.fontSize = `${1.4 + power * 1.6}rem`;
    stage.append(word);
    setTimeout(() => word.remove(), 700);

    if (power > 0.7) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
    if ($('#bag-sound').checked) thump(power);
    punches++; unsaved++;
    $('#punches').textContent = punches;
    if (MILESTONES[punches]) $('#bag-msg').textContent = MILESTONES[punches];
    raf ||= requestAnimationFrame(frame);
  }

  stage.addEventListener('pointerdown', e => { e.preventDefault(); hit(e.clientX, e.clientY); });
  stage.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hit(); } });

  // Write the stressor on the bag, wrapped onto short lines.
  $('#bag-label').addEventListener('input', e => {
    const words = e.target.value.trim().split(/\s+/).filter(Boolean);
    const lines = [];
    for (const w of words) {
      if (lines.length && (lines[lines.length - 1] + ' ' + w).length <= 10) lines[lines.length - 1] += ` ${w}`;
      else lines.push(w);
    }
    $('#bag-text').innerHTML = lines.slice(0, 4).map((l, i) => `<tspan x="100" dy="${i ? 18 : -(lines.length - 1) * 9}">${esc(l)}</tspan>`).join('');
  });

  const save = () => { if (unsaved) { logUse('punch', unsaved); unsaved = 0; } };
  $('#bag-done').addEventListener('click', () => {
    save();
    $('#bag-msg').innerHTML = punches
      ? `${punches} punches. Now let your hands rest — <a href="#breathe">a minute of breathing</a> can help the calm settle in.`
      : 'Give it a go first 🙂';
  });
  window.addEventListener('pagehide', save);
  return { stop: save };
})();

// ---------- breathing ----------

tools.breathe = (() => {
  const PATTERNS = {
    box: { name: 'Box 4-4-4-4', desc: 'Equal counts of four. Used by athletes and first responders to steady their nerves.', phases: [['Breathe in', 4, 'in'], ['Hold', 4, 'hold'], ['Breathe out', 4, 'out'], ['Hold', 4, 'hold']] },
    478: { name: '4-7-8 for sleep', desc: 'A slow rhythm that helps with falling asleep and easing anxiety.', phases: [['Breathe in', 4, 'in'], ['Hold', 7, 'hold'], ['Breathe out', 8, 'out']] },
    calm: { name: 'Calm 4-6', desc: 'A longer out-breath tells your nervous system that you are safe.', phases: [['Breathe in', 4, 'in'], ['Breathe out', 6, 'out']] },
  };
  const orb = $('#orb');
  let pattern = 'box', running = false, timers = [], started = 0, rounds = 0;
  const names = Object.values(PATTERNS).map(p => p.name);
  chipGroup($('#patterns'), names, {
    selected: [PATTERNS.box.name], single: true,
    onChange: ([name]) => { stop(); pattern = Object.keys(PATTERNS).find(k => PATTERNS[k].name === name); describe(); },
  });
  const describe = () => { $('#pattern-desc').textContent = PATTERNS[pattern].desc; };
  describe();

  function setOrb(size, secs) {
    orb.style.transitionDuration = `${secs}s`;
    orb.style.width = orb.style.height = size;
  }

  function runPhase(i) {
    if (!running) return;
    const phases = PATTERNS[pattern].phases;
    if (i === 0 && timers.length) $('#rounds').textContent = `${++rounds} round${rounds > 1 ? 's' : ''}`;
    const [label, secs, kind] = phases[i];
    if (kind === 'in') setOrb('100%', secs);
    if (kind === 'out') setOrb('40%', secs);
    chime(kind === 'in' ? 396 : kind === 'out' ? 264 : 330);
    let left = secs;
    const show = () => { $('#orb-label').firstChild.textContent = label; $('#orb-count').textContent = left; };
    show();
    for (let s = 1; s < secs; s++) timers.push(setTimeout(() => { left--; show(); }, s * 1000));
    timers.push(setTimeout(() => runPhase((i + 1) % phases.length), secs * 1000));
  }

  function start() {
    running = true;
    started = Date.now();
    rounds = 0;
    $('#rounds').textContent = '';
    $('#breathe-toggle').textContent = 'Stop';
    runPhase(0);
  }

  function stop() {
    if (!running) return;
    running = false;
    timers.forEach(clearTimeout);
    timers = [];
    setOrb('40%', 1);
    $('#orb-label').firstChild.textContent = rounds ? 'Well done 🌿' : 'Ready?';
    $('#orb-count').textContent = '';
    $('#breathe-toggle').textContent = 'Start';
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds >= 10) logUse('breathe', seconds);
  }

  $('#breathe-toggle').addEventListener('click', () => (running ? stop() : start()));
  return { stop };
})();

// ---------- meditation ----------

tools.meditate = (() => {
  const PROMPTS = [
    'Breathe naturally. Notice the air moving in… and out.',
    'If your mind wanders, that’s okay. Gently come back to the breath.',
    'Notice where your body touches the chair or floor.',
    'Let your shoulders drop. Unclench your jaw.',
    'Thoughts are like clouds. Watch them pass without following them.',
    'Notice one sound near you, and one far away.',
    'With each out-breath, let go of a little tension.',
  ];
  let minutes = 5, sound = 'Rain', running = false, left = 0, tick = null, started = 0, nodes = [];
  chipGroup($('#durations'), ['1 min', '3 min', '5 min', '10 min'], {
    selected: ['5 min'], single: true,
    onChange: ([v]) => { minutes = parseInt(v, 10); if (!running) render(minutes * 60); },
  });
  chipGroup($('#sounds'), ['Rain', 'Ocean', 'Brown noise', 'Silence'], { selected: ['Rain'], single: true, onChange: ([v]) => { sound = v; } });
  const render = s => { $('#timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  function ambience() {
    if (sound === 'Silence') return;
    const ctx = audio();
    const src = ctx.createBufferSource();
    src.buffer = noise(sound === 'Rain' ? 'white' : 'brown', 4);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = sound === 'Rain' ? 2200 : sound === 'Ocean' ? 900 : 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(sound === 'Rain' ? 0.06 : 0.35, ctx.currentTime + 3);
    src.connect(filter).connect(gain).connect(ctx.destination);
    nodes = [src, gain];
    if (sound === 'Ocean') {
      // slow swell, like waves rolling in
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.09;
      depth.gain.value = 0.25;
      lfo.connect(depth).connect(gain.gain);
      lfo.start();
      nodes.push(lfo);
    }
    src.start();
  }

  function silence() {
    const ctx = audio();
    const [src, gain, lfo] = nodes;
    if (gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    }
    setTimeout(() => { src?.stop(); lfo?.stop(); }, 1600);
    nodes = [];
  }

  function start() {
    running = true;
    started = Date.now();
    left = minutes * 60;
    render(left);
    bell();
    ambience();
    $('#ripple').classList.add('on');
    $('#med-toggle').textContent = 'End session';
    $('#med-prompt').textContent = PROMPTS[0];
    let elapsed = 0;
    tick = setInterval(() => {
      left--; elapsed++;
      render(left);
      if (elapsed % 30 === 0) $('#med-prompt').textContent = PROMPTS[(elapsed / 30) % PROMPTS.length];
      if (left <= 0) stop(true);
    }, 1000);
  }

  function stop(finished = false) {
    if (!running) return;
    running = false;
    clearInterval(tick);
    silence();
    bell(finished ? 0.18 : 0.08);
    $('#ripple').classList.remove('on');
    $('#med-toggle').textContent = 'Begin';
    $('#med-prompt').textContent = finished
      ? 'Well done. Take a moment before you move on — notice how you feel. 🌿'
      : 'Every minute counts. Come back whenever you like.';
    render(minutes * 60);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds >= 15) logUse('meditate', seconds);
  }

  $('#med-toggle').addEventListener('click', () => (running ? stop() : start()));
  render(minutes * 60);
  return { stop: () => stop() };
})();

// ---------- bubble wrap ----------

tools.bubbles = (() => {
  let popped = 0, unsaved = 0;
  function sheet() {
    $('#bubbles').innerHTML = Array.from({ length: 60 }, () => '<button class="bubble" aria-label="Bubble"></button>').join('');
  }
  $('#bubbles').addEventListener('pointerdown', e => {
    const b = e.target.closest('.bubble');
    if (!b || b.classList.contains('popped')) return;
    b.classList.add('popped');
    b.disabled = true;
    pop();
    popped++; unsaved++;
    $('#pop-count').textContent = `${popped} popped`;
    if (!$('.bubble:not(.popped)')) toast('Sheet cleared! Grab a new one 🫧');
  });
  const save = () => { if (unsaved) { logUse('bubbles', unsaved); unsaved = 0; } };
  $('#new-sheet').addEventListener('click', () => { save(); sheet(); });
  sheet();
  return { stop: save };
})();

// ---------- let it go ----------

tools.letgo = (() => {
  $('#release').addEventListener('click', () => {
    const text = $('#worry').value.trim();
    if (!text) return $('#worry').focus();
    const card = document.createElement('div');
    card.className = 'worry';
    card.textContent = text;
    $('#worry-zone').replaceChildren(card);
    $('#worry').value = '';
    $('#released-msg').classList.add('hidden');
    requestAnimationFrame(() => card.classList.add('away'));
    card.addEventListener('animationend', () => {
      card.remove();
      $('#released-msg').classList.remove('hidden');
    });
    logUse('letgo');
  });
  return {};
})();

// ---------- 5-4-3-2-1 grounding ----------

tools.ground = (() => {
  const STEPS = [
    [5, 'things you can see', '👀', 'Look around slowly. Name five things you can see right now — big or small.'],
    [4, 'things you can touch', '✋', 'Notice four things you can feel: your feet on the floor, your clothes, the chair, the air.'],
    [3, 'things you can hear', '👂', 'Listen carefully. Three sounds — near or far, loud or faint.'],
    [2, 'things you can smell', '👃', 'Two smells around you. Can’t smell anything? Name two smells you love.'],
    [1, 'thing you can taste', '👅', 'One taste — or one thing you’re grateful for right now.'],
  ];
  let i = 0;
  const answers = STEPS.map(([n]) => Array(n).fill(''));

  function render() {
    $('#ground-bar').style.width = `${(i / STEPS.length) * 100}%`;
    $('#ground-back').style.visibility = i ? 'visible' : 'hidden';
    if (i === STEPS.length) {
      $('#ground-step').innerHTML = `<div class="ground-num">🌿</div><h3>You're here. You're present.</h3>
        <p class="muted">Take one more slow breath. Notice how your body feels compared to a few minutes ago.</p>
        <a class="btn secondary" href="/home.html">Check in how I feel</a>`;
      $('#ground-next').textContent = 'Start again';
      return;
    }
    const [n, what, emoji, help] = STEPS[i];
    $('#ground-step').innerHTML = `<div class="ground-num">${n}</div><h3>${emoji} ${n} ${what}</h3><p class="muted">${help}</p>
      ${answers[i].map((v, k) => `<input type="text" data-k="${k}" value="${esc(v)}" placeholder="${k + 1}." aria-label="${what} ${k + 1}">`).join('')}`;
    $$('#ground-step input').forEach(inp => inp.addEventListener('input', () => { answers[i][inp.dataset.k] = inp.value; }));
    $('#ground-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
  }

  $('#ground-next').addEventListener('click', () => {
    if (i === STEPS.length) { i = 0; answers.forEach(a => a.fill('')); }
    else if (++i === STEPS.length) logUse('ground');
    render();
  });
  $('#ground-back').addEventListener('click', () => { i = Math.max(0, i - 1); render(); });
  render();
  return {};
})();

// ---------- doodle ----------

tools.doodle = (() => {
  const canvas = $('#doodle-canvas');
  const ctx = canvas.getContext('2d');
  const COLORS = ['#2b3445', '#5b8dbf', '#4a9ea6', '#5e9e80', '#e0a32e', '#cf7f69', '#d27070', '#8e80c4'];
  let color = COLORS[1], mirror = 'Mandala', drawing = false, last = null, ready = false, used = false;

  $('#swatches').innerHTML = COLORS.map((c, i) => `<button class="swatch" style="--c:${c}" aria-label="Colour ${i + 1}" aria-pressed="${c === color}" data-c="${c}"></button>`).join('');
  $('#swatches').addEventListener('click', e => {
    const s = e.target.closest('.swatch');
    if (!s) return;
    color = s.dataset.c;
    $$('.swatch').forEach(x => x.setAttribute('aria-pressed', x === s));
  });
  chipGroup($('#mirror'), ['Free', 'Mirror', 'Mandala'], { selected: ['Mandala'], single: true, onChange: ([v]) => { mirror = v; } });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    if (canvas.width) copy.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fffdf9';
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (copy.width) ctx.drawImage(copy, 0, 0, rect.width, rect.height);
    ready = true;
  }

  // Every stroke is repeated through the chosen symmetry around the canvas centre.
  function transforms() {
    const w = canvas.width / (window.devicePixelRatio || 1), h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2, cy = h / 2;
    if (mirror === 'Free') return [p => p];
    if (mirror === 'Mirror') return [p => p, p => ({ x: w - p.x, y: p.y })];
    const out = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      for (const flip of [1, -1]) {
        out.push(p => {
          const dx = (p.x - cx) * flip, dy = p.y - cy;
          return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
        });
      }
    }
    return out;
  }

  const point = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = point(e); canvas.setPointerCapture(e.pointerId); used = true; });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = point(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = Number($('#brush').value);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    for (const t of transforms()) {
      const a = t(last), b = t(p);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => canvas.addEventListener(ev, () => { drawing = false; }));

  $('#doodle-clear').addEventListener('click', () => { canvas.width = 0; resize(); });
  $('#doodle-save').addEventListener('click', () => {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aurora-doodle.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });
  window.addEventListener('resize', () => { if (ready) resize(); });

  return {
    start: () => { if (!ready) requestAnimationFrame(resize); },
    stop: () => { if (used) { logUse('doodle'); used = false; } },
  };
})();

// ---------- routing between tools ----------

(async () => {
  await boot('user');
  let current = null;
  function show(scroll) {
    const name = tools[location.hash.slice(1)] ? location.hash.slice(1) : 'punch';
    if (current && current !== name) tools[current].stop?.();
    current = name;
    $$('.tool').forEach(t => { t.hidden = t.id !== `tool-${name}`; });
    $$('#picker a').forEach(a => a.setAttribute('aria-current', a.getAttribute('href') === `#${name}`));
    tools[name].start?.();
    if (scroll) $(`#tool-${name}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.addEventListener('hashchange', () => show(true));
  show(!!location.hash);
})();
