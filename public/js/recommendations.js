// Gradient "posters" per genre, since the datasets don't include movie artwork.
const GENRE_COLORS = {
  Action: ['#c0573e', '#e29a5b'], Adventure: ['#2f7d6d', '#79c2a1'], Animation: ['#e08a3c', '#f2c45a'],
  Children: ['#5aa7d6', '#9bd3e8'], Comedy: ['#e3a72f', '#f4d27a'], Crime: ['#3c4458', '#6b7590'],
  Documentary: ['#5b7f5d', '#a4c19a'], Drama: ['#7d5a8c', '#b58fc2'], Fantasy: ['#6a5aa5', '#a99be0'],
  Horror: ['#3a2f3f', '#6e5466'], Musical: ['#c45b8a', '#eda0c0'], Mystery: ['#36506e', '#6f8fb5'],
  Romance: ['#cf6f7c', '#f0aab2'], 'Sci-Fi': ['#2f6a8c', '#6cb0d0'], Thriller: ['#46505f', '#7a8597'],
  War: ['#5e5b4c', '#9a957c'], Western: ['#a0683a', '#d3a46d'],
};
const FAMILY_EMOJI = {
  'Pop': '🎤', 'Bollywood & Indian': '🪕', 'Hip-Hop & Rap': '🎧', 'R&B & Soul': '🎷', 'Rock': '🎸', 'Indie': '🌙',
  'Metal': '🤘', 'Electronic & EDM': '🎛️', 'Lo-fi & Chill': '☕', 'Ambient & Piano': '🎹', 'Classical': '🎻',
  'Jazz & Blues': '🎺', 'Acoustic & Folk': '🪵', 'K-pop & J-pop': '💫', 'Latin': '💃', 'Reggae & Afrobeat': '🌴', 'World': '🌍',
};

const movieCard = m => {
  const [a, b] = GENRE_COLORS[m.genres[0]] || ['#5b8dbf', '#9fc0e0'];
  const href = m.imdb ? `https://www.imdb.com/title/tt${m.imdb}/` : `https://www.google.com/search?q=${encodeURIComponent(`${m.title} ${m.year} film`)}`;
  return `<a class="card media-card" href="${href}" target="_blank" rel="noopener">
    <div class="art" style="background:linear-gradient(135deg, ${a}, ${b})">${esc(m.title)}</div>
    <div class="body">
      <div class="title">${esc(m.title)} <span class="muted">(${m.year ?? '—'})</span></div>
      <div class="meta">${esc(m.genres.filter(g => g !== 'IMAX').slice(0, 3).join(' · '))}</div>
      <div class="meta">★ ${m.rating}/10 · ${m.votes} ratings</div>
      <div class="reason">${esc(m.reason)}</div>
    </div></a>`;
};

const bookCard = b => `
  <a class="card book-card" href="https://www.goodreads.com/book/show/${esc(b.goodreads)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
    ${b.cover ? `<img class="book-cover" src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;book-cover&quot;>📖</div>'">` : '<div class="book-cover">📖</div>'}
    <div>
      <div style="font-weight:800;line-height:1.3">${esc(b.title)}</div>
      <div class="small muted">${esc(b.author)}${b.year ? ` · ${b.year}` : ''}</div>
      <div class="small muted">★ ${b.rating.toFixed(2)} · ${esc(b.genres.join(', '))}</div>
      <div class="small" style="color:var(--accent-ink);font-weight:700;margin-top:6px">${esc(b.reason)}</div>
    </div>
  </a>`;

const trackRow = t => `
  <a class="track" href="https://open.spotify.com/track/${esc(t.id)}" target="_blank" rel="noopener">
    <span class="disc" style="background:var(--accent)">${FAMILY_EMOJI[t.family] || '🎵'}</span>
    <span>
      <div class="name">${esc(t.name)}</div>
      <div class="by">${esc(t.artists)}</div>
      <div class="meter"><span>mood<b style="width:${Math.round(t.valence * 40)}px"></b></span><span>energy<b style="width:${Math.round(t.energy * 40)}px"></b></span></div>
    </span>
    <span class="pill" title="${esc(t.reason)}">${esc(t.family)}</span>
  </a>`;

const activityCard = a => `
  <div class="card">
    <div class="card-icon">${a.emoji}</div>
    <h3>${esc(a.title)}</h3>
    <p class="muted small">${esc(a.why)}</p>
    <div class="row"><span class="pill accent">${a.minutes} min</span><span class="pill">${esc(a.category)}</span></div>
  </div>`;

(async () => {
  const me = await boot('user');
  let mood = me.mood || 'okay';

  if (new URLSearchParams(location.search).has('welcome')) {
    $('#welcome').classList.remove('hidden');
    $('#wname').textContent = me.user.name.split(' ')[0];
  }

  moodPicker($('#mood-switch'), { selected: mood, onPick: m => { mood = m; applyMood(m); load(); } });

  async function load(shuffle = false) {
    $$('#movies-for, #movies-new, #books-for, #books-new, #music-for, #music-new, #acts')
      .forEach(el => { el.innerHTML = '<div class="skeleton"></div>'; });
    const r = await api(`/recommendations?mood=${mood}${shuffle ? '&shuffle=1' : ''}`);
    $('#mood-copy').textContent = r.moodCopy;
    $('#insights').innerHTML = r.insights.map(i => `<div class="card plain insight"><span class="ic">${i.icon}</span><span>${esc(i.text)}</span></div>`).join('')
      || '<p class="muted">Check in a few times and we\'ll start spotting patterns.</p>';
    $('#movies-for').innerHTML = r.movies.forYou.map(movieCard).join('');
    $('#movies-new').innerHTML = r.movies.tryNew.map(movieCard).join('');
    $('#books-for').innerHTML = r.books.forYou.map(bookCard).join('');
    $('#books-new').innerHTML = r.books.tryNew.map(bookCard).join('');
    $('#music-label').textContent = r.music.label;
    $('#music-for').innerHTML = r.music.moodMix.map(trackRow).join('');
    $('#new-fams').textContent = r.music.newFamilies.join(', ');
    $('#music-new').innerHTML = r.music.tryNew.map(trackRow).join('');
    $('#acts').innerHTML = r.activities.map(activityCard).join('');
  }

  $('#shuffle').addEventListener('click', () => load(true));
  await load();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
