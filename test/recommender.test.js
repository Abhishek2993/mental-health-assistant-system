const test = require('node:test');
const assert = require('node:assert');
const { recommend, search, MOVIES } = require('../server/recommender');

const hasData = MOVIES.length > 0;
const base = {
  movie_genres: ['Comedy', 'Sci-Fi'], book_genres: ['Fantasy'], music_families: ['Pop', 'Lo-fi & Chill'],
  daily_activities: ['Classes / lectures', 'Scrolling social media'], unwind: ['Listening to music'],
  sleep_hours: '5–6', screen_time: '6+ hours', occupation: 'College student',
};

test('returns every section', { skip: !hasData && 'run `npm run data` first' }, () => {
  const r = recommend(base, 'okay');
  assert.equal(r.movies.forYou.length, 10);
  assert.ok(r.movies.tryNew.length > 0);
  assert.equal(r.books.forYou.length, 10);
  assert.equal(r.music.moodMix.length, 12);
  assert.ok(r.activities.length > 0);
  assert.ok(r.insights.some(i => /sleep/i.test(i.text)));
});

test('never recommends the title you just watched, and caps franchises', { skip: !hasData }, () => {
  const ts = search('movies', 'Toy Story 3')[0];
  const r = recommend({ ...base, recent_movie_id: ts.id }, 'okay');
  const titles = r.movies.forYou.map(m => m.title);
  assert.ok(!titles.includes('Toy Story 3'));
  assert.ok(titles.filter(t => t.startsWith('Toy Story')).length <= 1);
});

test('"try something new" stays outside the genres you picked', { skip: !hasData }, () => {
  const r = recommend({ ...base, recent_movie_id: null }, 'okay');
  for (const m of r.movies.tryNew) assert.ok(!m.genres.some(g => base.movie_genres.includes(g)), m.title);
  for (const fam of r.music.newFamilies) assert.ok(!base.music_families.includes(fam));
});

test('anxious mood avoids horror and picks calmer songs than a happy mood', { skip: !hasData }, () => {
  const anxious = recommend({ ...base, movie_genres: ['Horror', 'Comedy'] }, 'anxious');
  const happy = recommend(base, 'happy');
  assert.ok(anxious.movies.forYou.filter(m => m.genres.includes('Horror')).length < 3);
  const avgEnergy = list => list.reduce((s, t) => s + t.energy, 0) / list.length;
  assert.ok(avgEnergy(anxious.music.moodMix) < avgEnergy(happy.music.moodMix));
});
