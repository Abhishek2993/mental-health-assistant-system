// Downloads free, openly available datasets and turns them into small JSON
// files the app can load quickly. Run once with `npm run data`.
//
//   Movies  : MovieLens "latest-small" (GroupLens Research)      -> data/movies.json
//   Books   : goodbooks-10k (Zygmunt Zając, CC BY-SA 4.0)       -> data/books.json
//   Music   : Spotify Tracks Dataset (maharshipandya, BSD)       -> data/music.json
//   Chat FAQ: Mental Health FAQ (heliosbrahma, MIT)              -> data/mh_faq.json
//
// Raw downloads are cached in data/raw/ so re-running is cheap.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DATA = path.join(__dirname, '..', 'data');
const RAW = path.join(DATA, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const SOURCES = {
  movielens: 'https://files.grouplens.org/datasets/movielens/ml-latest-small.zip',
  books: 'https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/books.csv',
  bookTags: 'https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/book_tags.csv',
  tags: 'https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/tags.csv',
  spotify: 'https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset/resolve/main/dataset.csv',
  faq: 'https://datasets-server.huggingface.co/rows?dataset=heliosbrahma%2Fmental_health_chatbot_dataset&config=default&split=train',
};

async function download(url, file) {
  const dest = path.join(RAW, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  process.stdout.write(`  downloading ${file} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
  return dest;
}

// Minimal RFC-4180 CSV parser (handles quoted fields, commas and newlines in quotes).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const readCSV = file => parseCSV(fs.readFileSync(file, 'utf8'));
const write = (name, data) => {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data));
  console.log(`  wrote data/${name} (${data.length} items)`);
};

async function movies() {
  console.log('Movies (MovieLens)');
  const zip = await download(SOURCES.movielens, 'ml-latest-small.zip');
  const dir = path.join(RAW, 'ml-latest-small');
  if (!fs.existsSync(dir)) execFileSync('unzip', ['-q', '-o', zip, '-d', RAW]);

  const stats = new Map();
  for (const r of readCSV(path.join(dir, 'ratings.csv'))) {
    const s = stats.get(r.movieId) || { sum: 0, n: 0 };
    s.sum += Number(r.rating); s.n++;
    stats.set(r.movieId, s);
  }
  const imdb = new Map(readCSV(path.join(dir, 'links.csv')).map(r => [r.movieId, r.imdbId]));

  const out = [];
  for (const m of readCSV(path.join(dir, 'movies.csv'))) {
    const s = stats.get(m.movieId);
    if (!s || s.n < 15 || m.genres === '(no genres listed)') continue;
    const match = m.title.trim().match(/^(.*?)\s*\((\d{4})\)$/);
    // Drop alternate titles: "Spirited Away (Sen to Chihiro no kamikakushi)" -> "Spirited Away"
    let title = (match ? match[1] : m.title.trim()).replace(/\s*\(.*\)$/, '');
    // "Matrix, The" -> "The Matrix"
    title = title.replace(/^(.*), (The|A|An)$/, '$2 $1');
    out.push({
      id: Number(m.movieId),
      title,
      year: match ? Number(match[2]) : null,
      genres: m.genres.split('|'),
      rating: Math.round((s.sum / s.n) * 2 * 10) / 10, // 0–10 scale
      votes: s.n,
      imdb: imdb.get(m.movieId) || null,
    });
  }
  write('movies.json', out);
}

// Goodreads shelves are messy; map them to a small set of readable genres.
const BOOK_GENRES = {
  'Fantasy': ['fantasy', 'epic-fantasy', 'urban-fantasy', 'high-fantasy', 'magic'],
  'Science Fiction': ['science-fiction', 'sci-fi', 'scifi', 'dystopian', 'dystopia', 'space'],
  'Mystery & Thriller': ['mystery', 'thriller', 'crime', 'suspense', 'mystery-thriller', 'detective'],
  'Romance': ['romance', 'contemporary-romance', 'love', 'chick-lit'],
  'Classics': ['classics', 'classic', 'literature', 'classic-literature'],
  'Self-Help': ['self-help', 'self-improvement', 'personal-development', 'productivity', 'motivation'],
  'Psychology': ['psychology', 'mental-health', 'neuroscience'],
  'Philosophy & Spirituality': ['philosophy', 'spirituality', 'religion', 'buddhism', 'mindfulness'],
  'Biography & Memoir': ['biography', 'memoir', 'autobiography', 'memoirs'],
  'History': ['history', 'historical', 'world-war-ii', 'ww2'],
  'Historical Fiction': ['historical-fiction'],
  'Young Adult': ['young-adult', 'ya', 'teen', 'ya-fiction'],
  'Humor': ['humor', 'humour', 'funny', 'comedy'],
  'Horror': ['horror', 'scary', 'ghosts'],
  'Poetry': ['poetry', 'poems'],
  'Science & Nature': ['science', 'popular-science', 'nature', 'physics', 'biology'],
  'Business': ['business', 'economics', 'finance', 'leadership'],
  'Contemporary Fiction': ['contemporary', 'contemporary-fiction', 'literary-fiction', 'realistic-fiction'],
  'Graphic Novels': ['graphic-novels', 'comics', 'manga', 'graphic-novel'],
  'Adventure': ['adventure', 'action'],
  // Tagged so the app can leave picture books out of recommendations.
  'Children': ['childrens', 'children', 'picture-books', 'picture-book', 'kids', 'childrens-books', 'children-s-books'],
};

async function books() {
  console.log('Books (goodbooks-10k)');
  const [booksFile, btFile, tagsFile] = await Promise.all([
    download(SOURCES.books, 'books.csv'),
    download(SOURCES.bookTags, 'book_tags.csv'),
    download(SOURCES.tags, 'tags.csv'),
  ]);
  const tagToGenre = new Map();
  const tagName = new Map(readCSV(tagsFile).map(t => [t.tag_id, t.tag_name]));
  for (const [genre, shelves] of Object.entries(BOOK_GENRES))
    for (const s of shelves) tagToGenre.set(s, genre);

  // goodreads_book_id -> { genre: count }
  const genreCounts = new Map();
  for (const bt of readCSV(btFile)) {
    const genre = tagToGenre.get(tagName.get(bt.tag_id));
    if (!genre) continue;
    const g = genreCounts.get(bt.goodreads_book_id) || {};
    g[genre] = (g[genre] || 0) + Number(bt.count);
    genreCounts.set(bt.goodreads_book_id, g);
  }

  const out = [];
  for (const b of readCSV(booksFile)) {
    const counts = genreCounts.get(b.goodreads_book_id);
    if (!counts) continue;
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = ranked[0][1];
    const genres = ranked.filter(([, c]) => c >= top * 0.2).slice(0, 3).map(([g]) => g);
    const title = (b.title || b.original_title).replace(/\s*\(.*?#\d+.*?\)\s*$/, '').trim();
    out.push({
      id: Number(b.book_id),
      title,
      author: b.authors.split(',')[0].trim(),
      year: b.original_publication_year ? Math.round(Number(b.original_publication_year)) : null,
      genres,
      rating: Number(b.average_rating),
      votes: Number(b.ratings_count),
      cover: b.image_url && !b.image_url.includes('nophoto') ? b.image_url : null,
      goodreads: b.goodreads_book_id,
    });
  }
  write('books.json', out);
}

// Spotify has 114 fine-grained genres; group them into families people recognise.
const MUSIC_FAMILIES = {
  'Pop': ['pop', 'power-pop', 'synth-pop', 'indie-pop', 'dance'],
  'Bollywood & Indian': ['indian', 'pop-film'],
  'Hip-Hop & Rap': ['hip-hop'],
  'R&B & Soul': ['r-n-b', 'soul', 'funk', 'gospel'],
  'Rock': ['rock', 'alt-rock', 'alternative', 'hard-rock', 'grunge', 'psych-rock', 'rock-n-roll', 'punk-rock', 'punk', 'british'],
  'Indie': ['indie', 'singer-songwriter', 'songwriter', 'emo'],
  'Metal': ['metal', 'heavy-metal', 'metalcore', 'death-metal', 'black-metal'],
  'Electronic & EDM': ['edm', 'electronic', 'house', 'deep-house', 'progressive-house', 'techno', 'trance', 'dubstep', 'electro', 'drum-and-bass'],
  'Lo-fi & Chill': ['chill', 'study', 'trip-hop', 'sleep'],
  'Ambient & Piano': ['ambient', 'piano', 'new-age', 'idm'],
  'Classical': ['classical', 'opera'],
  'Jazz & Blues': ['jazz', 'blues'],
  'Acoustic & Folk': ['acoustic', 'folk', 'guitar', 'country', 'bluegrass'],
  'K-pop & J-pop': ['k-pop', 'j-pop', 'j-rock', 'anime', 'mandopop', 'cantopop'],
  'Latin': ['latin', 'latino', 'reggaeton', 'salsa', 'samba'],
  'Reggae & Afrobeat': ['reggae', 'dancehall', 'afrobeat', 'ska'],
  'World': ['world-music', 'turkish', 'iranian', 'french', 'german', 'spanish', 'swedish', 'malay', 'brazil', 'mpb'],
};

async function music() {
  console.log('Music (Spotify Tracks Dataset)');
  const file = await download(SOURCES.spotify, 'spotify_tracks.csv');
  const genreToFamily = new Map();
  for (const [fam, gs] of Object.entries(MUSIC_FAMILIES)) for (const g of gs) genreToFamily.set(g, fam);

  const byGenre = new Map();
  const seen = new Set();
  const rows = readCSV(file).sort((a, b) => b.popularity - a.popularity);
  for (const r of rows) {
    const family = genreToFamily.get(r.track_genre);
    if (!family || r.explicit === 'True') continue;
    const key = `${r.track_name}|${r.artists}`.toLowerCase();
    if (seen.has(key) || seen.has(r.track_id)) continue;
    const list = byGenre.get(r.track_genre) || [];
    if (list.length >= 45) continue;
    seen.add(key); seen.add(r.track_id);
    list.push({
      id: r.track_id,
      name: r.track_name,
      artists: r.artists.split(';').slice(0, 2).join(', '),
      family,
      genre: r.track_genre,
      popularity: Number(r.popularity),
      valence: Number(Number(r.valence).toFixed(2)),
      energy: Number(Number(r.energy).toFixed(2)),
      acousticness: Number(Number(r.acousticness).toFixed(2)),
      tempo: Math.round(Number(r.tempo)),
    });
    byGenre.set(r.track_genre, list);
  }
  write('music.json', [...byGenre.values()].flat());
}

async function faq() {
  console.log('Mental health FAQ (heliosbrahma/mental_health_chatbot_dataset)');
  const file = path.join(RAW, 'mh_faq_rows.json');
  if (!fs.existsSync(file)) {
    const rows = [];
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${SOURCES.faq}&offset=${offset}&length=100`);
      if (!res.ok) throw new Error(`FAQ download failed: HTTP ${res.status}`);
      const page = await res.json();
      rows.push(...page.rows.map(r => r.row.text));
      if (rows.length >= page.num_rows_total) break;
    }
    fs.writeFileSync(file, JSON.stringify(rows));
  }
  const out = [];
  for (const text of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const m = text.match(/<HUMAN>:\s*([\s\S]*?)\s*<ASSISTANT>:\s*([\s\S]*)/);
    if (m) out.push({ q: m[1].trim(), a: m[2].trim() });
  }
  write('mh_faq.json', out);
}

(async () => {
  for (const step of [movies, books, music, faq]) {
    try { await step(); }
    catch (err) { console.error(`  ✗ ${step.name} failed: ${err.message}`); process.exitCode = 1; }
  }
  console.log(process.exitCode ? '\nSome datasets failed — re-run `npm run data`.' : '\nAll datasets ready.');
})();
