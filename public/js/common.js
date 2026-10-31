// Shared helpers for every page: API calls, nav, mood theming, charts.

const MOODS = [
  { id: 'happy', label: 'Happy', emoji: '😊', score: 5 },
  { id: 'okay', label: 'Okay', emoji: '🙂', score: 4 },
  { id: 'tired', label: 'Tired', emoji: '😴', score: 3 },
  { id: 'stressed', label: 'Stressed', emoji: '😣', score: 2 },
  { id: 'anxious', label: 'Anxious', emoji: '😟', score: 2 },
  { id: 'angry', label: 'Frustrated', emoji: '😤', score: 2 },
  { id: 'low', label: 'Low', emoji: '😔', score: 1 },
];
const moodInfo = id => MOODS.find(m => m.id === id) || MOODS[1];

const HELPLINES = [
  { name: 'Tele-MANAS (Govt. of India)', number: '14416', tel: '14416', note: 'Free · 24×7 · multiple languages' },
  { name: 'Vandrevala Foundation', number: '+91 9999 666 555', tel: '+919999666555', note: 'Call or WhatsApp · 24×7' },
  { name: 'iCall (TISS)', number: '+91 91529 87821', tel: '+919152987821', note: 'Mon–Sat · 10 am – 8 pm' },
  { name: 'Emergency', number: '112', tel: '112', note: 'Police · ambulance · immediate danger' },
];

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message) {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS".
const parseDate = s => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
const fmtDate = (s, opts = { day: 'numeric', month: 'short' }) => parseDate(s).toLocaleDateString(undefined, opts);
const fmtDateTime = s => parseDate(s).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function applyMood(mood) {
  document.documentElement.dataset.mood = mood;
  try { localStorage.setItem('aurora-mood', mood); } catch { /* storage unavailable */ }
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const USER_LINKS = [
  ['/home.html', 'Home'],
  ['/chat.html', 'Talk to Aurora'],
  ['/recommendations.html', 'For you'],
  ['/stress.html', 'Stress zone'],
  ['/journal.html', 'Journal'],
  ['/therapists.html', 'Therapists'],
];
const THERAPIST_LINKS = [['/therapist/dashboard.html', 'Dashboard']];

function renderNav(me) {
  const nav = $('#nav');
  if (!nav) return;
  const links = !me?.user ? [] : me.user.role === 'therapist' ? THERAPIST_LINKS : USER_LINKS;
  const here = location.pathname.replace(/\/$/, '/index.html');
  nav.innerHTML = `
    <div class="container nav-inner">
      <a class="brand" href="${me?.user ? links[0][0] : '/'}"><span class="brand-mark" aria-hidden="true"></span>Aurora
        ${me?.user?.role === 'therapist' ? '<span class="portal-badge">Therapist</span>' : ''}</a>
      <nav class="nav-links" aria-label="Main">
        ${links.map(([href, label]) => `<a href="${href}" ${here === href ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="nav-user">
        ${me?.user
          ? `<span class="avatar" title="${esc(me.user.name)}">${esc(me.user.name[0].toUpperCase())}</span>
             <button class="btn ghost small" id="logout">Sign out</button>`
          : `<a class="btn ghost small" href="/login.html">Sign in</a><a class="btn small" href="/signup.html">Get started</a>`}
      </div>
    </div>`;
  $('#logout')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    try { localStorage.removeItem('aurora-mood'); } catch { /* ignore */ }
    location.href = '/';
  });
}

// Every page calls this first. `role` = required account type (or null for public pages).
async function boot(role = null) {
  let me = { user: null };
  try { me = await api('/me'); } catch { /* offline: treat as signed out */ }
  if (role && me.user?.role !== role) {
    location.href = role === 'therapist' ? '/therapist/login.html' : '/login.html';
    return new Promise(() => {}); // stop the page while redirecting
  }
  if (me.user?.role === 'user' && me.mood) applyMood(me.mood);
  if (me.user?.role === 'therapist') applyMood('okay');
  renderNav(me);
  return me;
}

function moodPicker(container, { selected, onPick } = {}) {
  container.classList.add('moods');
  container.setAttribute('role', 'group');
  container.innerHTML = MOODS.map(m => `
    <button type="button" class="mood" data-mood="${m.id}" aria-pressed="${m.id === selected}">
      <span class="emoji" aria-hidden="true">${m.emoji}</span>${m.label}
    </button>`).join('');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.mood');
    if (!btn) return;
    $$('.mood', container).forEach(b => b.setAttribute('aria-pressed', b === btn));
    onPick?.(btn.dataset.mood);
  });
}

// Multi/single select chips bound to an array of values.
function chipGroup(container, options, { selected = [], single = false, onChange } = {}) {
  const values = new Set(selected);
  container.classList.add('chips');
  container.innerHTML = options.map(o => `<button type="button" class="chip" aria-pressed="${values.has(o)}">${esc(o)}</button>`).join('');
  container.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const value = chip.textContent;
    if (single) {
      values.clear();
      $$('.chip', container).forEach(c => c.setAttribute('aria-pressed', c === chip));
      values.add(value);
    } else {
      values.has(value) ? values.delete(value) : values.add(value);
      chip.setAttribute('aria-pressed', values.has(value));
    }
    onChange?.([...values]);
  });
  return { get: () => [...values], getOne: () => [...values][0] || null };
}

// Mood history as a soft line with coloured dots (one per check-in).
function moodChart(container, moods, { days = 14 } = {}) {
  const now = Date.now();
  const start = now - days * 864e5;
  const points = moods.map(m => ({ ...m, t: parseDate(m.created_at).getTime() })).filter(m => m.t >= start);
  if (!points.length) {
    container.innerHTML = '<div class="empty">No check-ins yet. Your mood history will appear here.</div>';
    return;
  }
  const W = 480, H = 170, pad = { l: 30, r: 14, t: 14, b: 26 };
  const x = t => pad.l + ((t - start) / (now - start)) * (W - pad.l - pad.r);
  const y = s => pad.t + ((5 - s) / 4) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(moodInfo(p.mood).score).toFixed(1)}`).join(' ');
  const ticks = [[0, 'start'], [Math.round(days / 2), 'middle'], [days, 'end']].map(([d, anchor]) => {
    const t = start + d * 864e5;
    return `<text x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`;
  });
  container.innerHTML = `
    <svg class="mood-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood over the last ${days} days">
      ${[5, 3, 1].map(s => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(s)}" y2="${y(s)}"/>
        <text x="4" y="${y(s) + 4}">${s === 5 ? '😊' : s === 3 ? '😐' : '😔'}</text>`).join('')}
      <path class="line" d="${path}"/>
      ${points.map(p => `<circle cx="${x(p.t)}" cy="${y(moodInfo(p.mood).score)}" r="6" fill="var(--m-${p.mood})" stroke="var(--surface)" stroke-width="2">
        <title>${moodInfo(p.mood).label} · ${fmtDateTime(p.created_at)}${p.source === 'chat' ? ' (noticed in chat)' : ''}</title></circle>`).join('')}
      ${ticks.join('')}
    </svg>
    <div class="legend">${MOODS.map(m => `<span style="--c: var(--m-${m.id})">${m.label}</span>`).join('')}</div>`;
}

function helplinesHTML() {
  return HELPLINES.map(h => `
    <div class="helpline"><strong>${esc(h.name)}</strong>
      <a href="tel:${h.tel}">${esc(h.number)}</a>
      <div class="muted small">${esc(h.note)}</div></div>`).join('');
}

// A tiny WebAudio helper shared by the stress zone tools.
let audioCtx;
function audio() {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
