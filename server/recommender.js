// Content-based recommendations built from the sign-up profile + current mood.
//
// Movies & books: genre similarity to the recent title or the picked genres (whichever
// matches better), blended with rating and popularity, then nudged by mood.
// Music: tracks from liked genre families ranked by distance to a mood target in
// Spotify's valence/energy space ("iso principle": meet the mood, then lift it gently).
// "Try something new": highly rated items from genres the person didn't pick; for music,
// the unpicked families whose average sound is closest to what they already like.
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const load = name => {
  const file = path.join(DATA, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`⚠  data/${name}.json missing — run \`npm run data\` to download the datasets.`);
    return [];
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const MOVIES = load('movies');
const BOOKS = load('books');
const MUSIC = load('music');
const ACTIVITIES = require('./data/activities.json');

const unique = list => [...new Set(list)];
const MOVIE_GENRES = unique(MOVIES.flatMap(m => m.genres)).filter(g => !['IMAX', 'Film-Noir'].includes(g)).sort();
const BOOK_GENRES = unique(BOOKS.flatMap(b => b.genres)).filter(g => g !== 'Children').sort();
const MUSIC_FAMILIES = unique(MUSIC.map(t => t.family)).sort();

const OPTIONS = {
  moods: [
    { id: 'happy', label: 'Happy', emoji: '😊' },
    { id: 'okay', label: 'Okay', emoji: '🙂' },
    { id: 'tired', label: 'Tired', emoji: '😴' },
    { id: 'stressed', label: 'Stressed', emoji: '😣' },
    { id: 'anxious', label: 'Anxious', emoji: '😟' },
    { id: 'low', label: 'Low', emoji: '😔' },
    { id: 'angry', label: 'Frustrated', emoji: '😤' },
  ],
  ageGroups: ['13–17', '18–24', '25–34', '35–44', '45+'],
  occupations: ['School student', 'College student', 'Working professional', 'Studying & working', 'Taking a break', 'Homemaker'],
  movieGenres: MOVIE_GENRES,
  bookGenres: BOOK_GENRES,
  musicFamilies: MUSIC_FAMILIES,
  dailyActivities: [
    'Classes / lectures', 'Desk or office work', 'Studying late', 'Commuting', 'Gym / workout', 'Sports',
    'Walking or jogging', 'Gaming', 'Scrolling social media', 'Binge-watching shows', 'Reading', 'Cooking',
    'Playing an instrument', 'Drawing / art', 'Coding / side projects', 'Household chores',
    'Looking after family', 'Hanging out with friends', 'Prayer / meditation', 'Part-time job',
  ],
  unwind: [
    'Listening to music', 'Sleeping / napping', 'Talking to friends', 'Gaming', 'Watching something',
    'Scrolling my phone', 'Going out', 'Being alone', 'Exercise', 'Eating something nice', 'Writing',
  ],
  sleepHours: ['Less than 5', '5–6', '7–8', 'More than 8'],
  screenTime: ['Under 2 hours', '2–4 hours', '4–6 hours', '6+ hours'],
  hopingFor: ['Manage stress', 'Sleep better', 'Feel less lonely', 'Understand my emotions', 'Build better habits', 'Just someone to talk to'],
};

// How each mood shifts movie/book genres (positive = boost).
const MOOD_GENRE_BIAS = {
  low: { Comedy: 0.15, Animation: 0.12, Musical: 0.1, Children: 0.06, Romance: 0.05, Horror: -0.3, War: -0.2, Thriller: -0.1, Humor: 0.15, Poetry: 0.08, 'Self-Help': 0.08 },
  anxious: { Comedy: 0.12, Animation: 0.12, Documentary: 0.06, Horror: -0.35, Thriller: -0.2, 'Mystery & Thriller': -0.15, Humor: 0.1, Psychology: 0.08 },
  stressed: { Comedy: 0.12, Adventure: 0.08, Animation: 0.08, Horror: -0.2, Thriller: -0.1, Crime: -0.05, Humor: 0.1, 'Philosophy & Spirituality': 0.06 },
  angry: { Action: 0.1, Comedy: 0.1, Adventure: 0.05, Horror: -0.1, 'Philosophy & Spirituality': 0.06 },
  tired: { Animation: 0.1, Comedy: 0.1, Romance: 0.06, Horror: -0.15, 'Graphic Novels': 0.06, Humor: 0.08 },
  happy: { Adventure: 0.06, 'Sci-Fi': 0.04, Musical: 0.05, Fantasy: 0.04 },
  okay: {},
};

// Target point in Spotify's valence/energy space for each mood.
const MOOD_SOUND = {
  happy: { valence: 0.8, energy: 0.72, label: 'Upbeat songs to ride the good mood' },
  okay: { valence: 0.62, energy: 0.55, label: 'Easy, feel-good listening' },
  tired: { valence: 0.6, energy: 0.5, label: 'Warm songs with a gentle lift' },
  stressed: { valence: 0.62, energy: 0.38, label: 'Slower, softer songs to let your shoulders drop' },
  anxious: { valence: 0.58, energy: 0.32, label: 'Calm, acoustic sounds to slow things down' },
  low: { valence: 0.58, energy: 0.45, label: 'Gentle songs that meet you where you are — and lift a little' },
  angry: { valence: 0.5, energy: 0.65, label: 'Some energy to let it out, without the edge' },
};

const MOOD_COPY = {
  happy: 'You’re feeling good — here are things to keep that going.',
  okay: 'A steady day. Here’s a mix of comfort picks and fresh ideas.',
  tired: 'You seem tired, so these lean cosy and low-effort.',
  stressed: 'You’re carrying some stress, so we’ve leaned towards lighter, calmer picks.',
  anxious: 'Feeling anxious? We’ve avoided anything tense and picked soothing options.',
  low: 'Feeling low is hard. These picks are gentle and quietly uplifting.',
  angry: 'Feeling frustrated? Some of these help you let it out, others help you cool down.',
};

const genreVector = genres => Object.fromEntries(genres.map(g => [g, 1]));

function similarity(vec, genres) {
  const norm = Math.sqrt(Object.values(vec).reduce((s, x) => s + x * x, 0)) || 1;
  const dot = genres.reduce((s, g) => s + (vec[g] || 0), 0);
  return dot / (norm * Math.sqrt(genres.length || 1));
}

const DARK_GENRES = ['Crime', 'Thriller', 'Horror', 'War', 'Mystery & Thriller'];

// Keep at most `max` items sharing any key (author, series, artist) so one series can't fill a list.
function diversify(ranked, keys, max) {
  const seen = new Map();
  return ranked.filter(i => {
    const ks = keys(i);
    if (ks.some(k => (seen.get(k) || 0) >= max)) return false;
    ks.forEach(k => seen.set(k, (seen.get(k) || 0) + 1));
    return true;
  });
}

const series = title => title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 2).join(' ');

const moodBias = (mood, genres) => genres.reduce((s, g) => s + ((MOOD_GENRE_BIAS[mood] || {})[g] || 0), 0);

// Sample from the top of a ranked list so "Show me different ones" gives new picks.
function choose(ranked, n, shuffle) {
  if (!shuffle) return ranked.slice(0, n);
  const pool = ranked.slice(0, n * 3);
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// Items are matched separately against the recent title and the picked genres and keep
// the better match, so neither source drowns out the other.
function rankTitles({ items, recent, picked, mood, exclude, quality, minVotes }) {
  const maxLogVotes = Math.log(Math.max(...items.map(i => i.votes), 2));
  const recentVec = genreVector(recent ? recent.genres : []);
  const pickedVec = genreVector(picked);
  return items
    .filter(i => !exclude.has(i.id) && i.votes >= minVotes)
    .map(i => {
      const fromRecent = similarity(recentVec, i.genres);
      const fromPicked = similarity(pickedVec, i.genres);
      const sim = Math.max(fromRecent, fromPicked);
      const bias = moodBias(mood, i.genres);
      const score = 0.55 * sim + 0.3 * quality(i) + 0.15 * (Math.log(i.votes) / maxLogVotes) + bias;
      return { item: i, score, sim, bias, viaRecent: fromRecent > fromPicked };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item, sim, bias, viaRecent }) => {
      let reason = viaRecent && recent
        ? `Because you enjoyed ${recent.title.split(':')[0]}`
        : `You like ${item.genres.find(g => pickedVec[g]) || item.genres[0]}`;
      if (bias > 0.08 && !item.genres.some(g => DARK_GENRES.includes(g))) reason += ' · light & uplifting';
      return { ...item, reason, match: Math.round(Math.min(sim, 1) * 100) };
    });
}

function tryNewTitles({ items, liked, mood, exclude, minRating, minVotes, n, shuffle }) {
  const fresh = items
    .filter(i => !exclude.has(i.id) && i.rating >= minRating && i.votes >= minVotes)
    .filter(i => i.genres.length && !i.genres.some(g => liked.has(g)) && moodBias(mood, i.genres) > -0.1)
    .sort((a, b) => (b.rating + moodBias(mood, b.genres) * 10) - (a.rating + moodBias(mood, a.genres) * 10));
  // One per new genre keeps the list varied.
  const byGenre = new Map();
  for (const i of fresh) if (!byGenre.has(i.genres[0])) byGenre.set(i.genres[0], i);
  return choose([...byGenre.values()], n, shuffle).map(i => ({ ...i, reason: `Something different: ${i.genres[0]}` }));
}

function recommendMovies(profile, mood, shuffle) {
  const recent = MOVIES.find(m => m.id === profile.recent_movie_id);
  const liked = new Set([...(recent ? recent.genres : []), ...profile.movie_genres]);
  const exclude = new Set(recent ? [recent.id] : []);
  // One film per franchise and at most 3 sharing the same lead genres keeps the list varied.
  const ranked = diversify(
    diversify(rankTitles({ items: MOVIES, recent, picked: profile.movie_genres, mood, exclude, quality: m => (m.rating - 5) / 5, minVotes: 20 }), m => [series(m.title)], 1),
    m => [m.genres.slice(0, 2).join('|')], 3);
  const forYou = choose(ranked, 10, shuffle);
  forYou.forEach(m => exclude.add(m.id));
  return {
    forYou,
    tryNew: tryNewTitles({ items: MOVIES, liked, mood, exclude, minRating: 7.4, minVotes: 30, n: 6, shuffle }),
  };
}

function recommendBooks(profile, mood, shuffle) {
  const recent = BOOKS.find(b => b.id === profile.recent_book_id);
  const liked = new Set([...(recent ? recent.genres : []), ...profile.book_genres]);
  const exclude = new Set(recent ? [recent.id] : []);
  const items = BOOKS.filter(b => !b.genres.includes('Children') && !/box(ed)? set|collection|#\d+-\d+|books \d+-\d+/i.test(b.title));
  const ranked = diversify(
    diversify(rankTitles({ items, recent, picked: profile.book_genres, mood, exclude, quality: b => (b.rating - 3.5) / 1.5, minVotes: 20000 }), b => [b.author, series(b.title)], 2),
    b => [b.genres[0]], 4);
  const forYou = choose(ranked, 10, shuffle);
  forYou.forEach(b => exclude.add(b.id));
  return {
    forYou,
    tryNew: tryNewTitles({ items, liked, mood, exclude, minRating: 4.1, minVotes: 30000, n: 6, shuffle }),
  };
}

const soundDistance = (t, target) => Math.hypot(t.valence - target.valence, t.energy - target.energy);

function centroid(tracks) {
  const n = tracks.length || 1;
  const sum = k => tracks.reduce((s, t) => s + t[k], 0) / n;
  return { valence: sum('valence'), energy: sum('energy'), acousticness: sum('acousticness'), tempo: sum('tempo') / 200 };
}

function recommendMusic(profile, mood, shuffle) {
  const target = MOOD_SOUND[mood] || MOOD_SOUND.okay;
  const families = profile.music_families.length ? profile.music_families : ['Pop'];
  const artist = (profile.favourite_artist || '').trim().toLowerCase();
  const calmBoost = ['anxious', 'stressed'].includes(mood);

  const scoreTrack = t =>
    (1 - soundDistance(t, target)) * 0.7 + (t.popularity / 100) * 0.3 +
    (calmBoost ? t.acousticness * 0.1 : 0) +
    (artist && t.artists.toLowerCase().includes(artist) ? 0.3 : 0);

  const mine = MUSIC.filter(t => families.includes(t.family));
  const ranked = diversify(
    mine.map(t => ({ t, s: scoreTrack(t) })).sort((a, b) => b.s - a.s).map(x => x.t),
    t => [...t.artists.split(', '), t.name.replace(/\s*[(-].*$/, '').toLowerCase()], 2)
    .filter((t, _, list) => list.findIndex(o => o.name.replace(/\s*[(-].*$/, '') === t.name.replace(/\s*[(-].*$/, '')) === list.indexOf(t));
  // Spread the mix across the person's families instead of letting one dominate.
  const perFamily = new Map();
  const balanced = [];
  for (const t of ranked) {
    const c = perFamily.get(t.family) || 0;
    if (c < Math.ceil(12 / families.length) + 1) { balanced.push(t); perFamily.set(t.family, c + 1); }
  }
  const moodMix = choose(balanced, 12, shuffle).map(t => ({
    ...t,
    reason: artist && t.artists.toLowerCase().includes(artist) ? `You listen to ${profile.favourite_artist}` : `${t.family} · fits your mood`,
  }));

  // Nearest unpicked families by average audio features.
  const mineCentre = centroid(mine);
  const others = [...new Set(MUSIC.map(t => t.family))]
    .filter(f => !families.includes(f))
    .map(f => {
      const c = centroid(MUSIC.filter(t => t.family === f));
      const d = Math.hypot(c.valence - mineCentre.valence, c.energy - mineCentre.energy, c.acousticness - mineCentre.acousticness, c.tempo - mineCentre.tempo);
      return { family: f, d };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const tryNew = others.flatMap(({ family }) =>
    choose(MUSIC.filter(t => t.family === family).sort((a, b) => scoreTrack(b) - scoreTrack(a)), 2, shuffle)
      .map(t => ({ ...t, reason: `Sounds close to what you like · ${family}` }))
  );

  return { label: target.label, moodMix, tryNew, newFamilies: others.map(o => o.family) };
}

// Turn the profile into simple signals the activity list is tagged with.
function signals(profile, mood) {
  const daily = new Set(profile.daily_activities);
  const unwind = new Set(profile.unwind);
  const has = (...xs) => xs.some(x => daily.has(x) || unwind.has(x));
  const s = new Set([mood]);
  if (['4–6 hours', '6+ hours'].includes(profile.screen_time)) s.add('high_screen');
  if (['Less than 5', '5–6'].includes(profile.sleep_hours)) s.add('low_sleep');
  if (has('Studying late')) s.add('night_owl');
  if (has('Scrolling social media', 'Scrolling my phone')) s.add('scroller');
  if (!has('Gym / workout', 'Sports', 'Walking or jogging', 'Exercise')) s.add('sedentary');
  else s.add('active');
  if (!has('Hanging out with friends', 'Talking to friends', 'Going out') || profile.hoping_for === 'Feel less lonely') s.add('social_low');
  if (has('Reading')) s.add('reader');
  if (profile.music_families.length || has('Listening to music', 'Playing an instrument')) s.add('likes_music');
  if (has('Drawing / art', 'Writing')) s.add('creative');
  if (has('Gaming')) s.add('gamer');
  if (has('Cooking')) s.add('cook');
  if (/student/i.test(profile.occupation || '') || has('Classes / lectures')) s.add('student');
  if (/work/i.test(profile.occupation || '') || has('Desk or office work', 'Part-time job')) s.add('worker');
  if (profile.hoping_for === 'Understand my emotions' || mood === 'anxious') s.add('overthinker');
  if (profile.hoping_for === 'Build better habits') s.add('procrastinator');
  return s;
}

function recommendActivities(profile, mood) {
  const sig = signals(profile, mood);
  const scored = ACTIVITIES
    .map(a => ({ ...a, hits: a.fits.filter(f => sig.has(f)) }))
    .filter(a => a.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || (b.hits.includes(mood) ? 1 : 0) - (a.hits.includes(mood) ? 1 : 0));
  const picked = [];
  const perCategory = {};
  for (const a of scored) {
    if ((perCategory[a.category] || 0) >= 2) continue;
    perCategory[a.category] = (perCategory[a.category] || 0) + 1;
    picked.push(a);
    if (picked.length === 6) break;
  }
  return picked.map(({ fits, hits, ...a }) => a);
}

function insights(profile, mood, recentMoods) {
  const out = [];
  const sig = signals(profile, mood);
  if (sig.has('low_sleep')) out.push({ icon: '🌙', text: `You sleep ${profile.sleep_hours} hours a night. Most people feel their best on 7–9 — sleep is a big lever for mood.` });
  if (sig.has('high_screen')) out.push({ icon: '📱', text: `${profile.screen_time} of screen time a day is a lot for your eyes and mind. Swapping even 30 minutes for something offline helps.` });
  if (sig.has('sedentary')) out.push({ icon: '🚶', text: 'Your days look mostly seated. Short bursts of movement are one of the fastest ways to ease stress.' });
  if (sig.has('social_low')) out.push({ icon: '🤝', text: 'You don’t mention much time with friends. Connection matters — even one call a week makes a difference.' });
  if (profile.movie_genres.length) out.push({ icon: '🎬', text: `You’re drawn to ${profile.movie_genres.slice(0, 3).join(', ')} — we used that, plus ${profile.recent_movie || 'your picks'}, to find films.` });
  if (profile.music_families.length) {
    const c = centroid(MUSIC.filter(t => profile.music_families.includes(t.family)));
    const feel = c.energy > 0.65 ? 'high-energy' : c.energy < 0.45 ? 'mellow' : 'balanced';
    out.push({ icon: '🎵', text: `Your music taste leans ${feel} (energy ${Math.round(c.energy * 100)}%, positivity ${Math.round(c.valence * 100)}%). We matched songs to how you feel today.` });
  }
  if (recentMoods.length >= 3) {
    const counts = {};
    recentMoods.forEach(m => { counts[m.mood] = (counts[m.mood] || 0) + 1; });
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const label = OPTIONS.moods.find(m => m.id === top)?.label.toLowerCase() || top;
    out.push({ icon: '📈', text: `In your last ${recentMoods.length} check-ins you felt ${label} most often (${n} times).` });
  }
  return out;
}

function recommend(profile, mood = 'okay', recentMoods = [], { shuffle = false } = {}) {
  return {
    mood,
    moodCopy: MOOD_COPY[mood] || MOOD_COPY.okay,
    insights: insights(profile, mood, recentMoods),
    movies: recommendMovies(profile, mood, shuffle),
    books: recommendBooks(profile, mood, shuffle),
    music: recommendMusic(profile, mood, shuffle),
    activities: recommendActivities(profile, mood),
  };
}

function search(kind, q, limit = 8) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return [];
  const list = kind === 'movies' ? MOVIES : BOOKS;
  return list
    .filter(i => i.title.toLowerCase().includes(query))
    .sort((a, b) => (b.title.toLowerCase().startsWith(query) - a.title.toLowerCase().startsWith(query)) || b.votes - a.votes)
    .slice(0, limit)
    .map(i => ({ id: i.id, title: i.title, year: i.year, author: i.author, genres: i.genres }));
}

module.exports = { recommend, search, OPTIONS, MOVIES, BOOKS };
