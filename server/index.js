const path = require('node:path');
const express = require('express');
const { db, therapistCanAccess, getProfile, JSON_FIELDS } = require('./db');
const auth = require('./auth');
const chatbot = require('./chatbot');
const recommender = require('./recommender');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(auth.loadUser);

const MOOD_IDS = recommender.OPTIONS.moods.map(m => m.id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v, allowed) => (Array.isArray(v) ? v.filter(x => !allowed || allowed.includes(x)).slice(0, 20) : []);
const firstName = name => name.split(' ')[0];

function latestMood(userId) {
  const row = db.prepare(`
    SELECT mood FROM moods WHERE user_id = ? AND created_at >= datetime('now', '-3 days')
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(userId);
  return row ? row.mood : 'okay';
}

function validateAccount(body) {
  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name) return { error: 'Please tell us your name.' };
  if (!EMAIL_RE.test(email)) return { error: 'That email doesn’t look right.' };
  if (password.length < 8) return { error: 'Use a password with at least 8 characters.' };
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { error: 'An account with this email already exists. Try signing in.' };
  return { name, email, password };
}

function profileFromBody(p = {}) {
  const O = recommender.OPTIONS;
  return {
    age_group: O.ageGroups.includes(p.age_group) ? p.age_group : null,
    occupation: O.occupations.includes(p.occupation) ? p.occupation : null,
    recent_movie_id: Number.isInteger(p.recent_movie_id) ? p.recent_movie_id : null,
    recent_movie: clean(p.recent_movie, 120) || null,
    movie_genres: cleanList(p.movie_genres, O.movieGenres),
    recent_book_id: Number.isInteger(p.recent_book_id) ? p.recent_book_id : null,
    recent_book: clean(p.recent_book, 160) || null,
    book_genres: cleanList(p.book_genres, O.bookGenres),
    music_families: cleanList(p.music_families, O.musicFamilies),
    favourite_artist: clean(p.favourite_artist, 80) || null,
    daily_activities: cleanList(p.daily_activities, O.dailyActivities),
    unwind: cleanList(p.unwind, O.unwind),
    sleep_hours: O.sleepHours.includes(p.sleep_hours) ? p.sleep_hours : null,
    screen_time: O.screenTime.includes(p.screen_time) ? p.screen_time : null,
    hoping_for: O.hopingFor.includes(p.hoping_for) ? p.hoping_for : null,
  };
}

function saveProfile(userId, profile) {
  const cols = Object.keys(profile);
  const values = cols.map(c => (JSON_FIELDS.includes(c) ? JSON.stringify(profile[c]) : profile[c]));
  db.prepare(`
    INSERT INTO profiles (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`)
    .run(userId, ...values);
}

// ---------- Auth ----------

app.post('/api/auth/signup', (req, res) => {
  const account = validateAccount(req.body);
  if (account.error) return res.status(400).json(account);
  const { lastInsertRowid: id } = db.prepare('INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('user', account.name, account.email, auth.hashPassword(account.password));
  saveProfile(id, profileFromBody(req.body.profile));
  const mood = MOOD_IDS.includes(req.body.mood) ? req.body.mood : null;
  if (mood) db.prepare('INSERT INTO moods (user_id, mood) VALUES (?, ?)').run(id, mood);
  auth.createSession(res, id);
  res.status(201).json({ ok: true, redirect: '/recommendations.html?welcome=1' });
});

app.post('/api/auth/therapist/signup', (req, res) => {
  const account = validateAccount(req.body);
  if (account.error) return res.status(400).json(account);
  const t = {
    license_no: clean(req.body.license_no, 40),
    specialization: clean(req.body.specialization, 120),
    city: clean(req.body.city, 60),
    clinic_address: clean(req.body.clinic_address, 240),
    years_experience: Math.max(0, Math.min(60, parseInt(req.body.years_experience, 10) || 0)),
    bio: clean(req.body.bio, 600),
  };
  if (!t.license_no || !t.specialization || !t.city || !t.clinic_address) {
    return res.status(400).json({ error: 'License number, specialisation, city and clinic address are required.' });
  }
  const { lastInsertRowid: id } = db.prepare('INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('therapist', account.name, account.email, auth.hashPassword(account.password));
  db.prepare(`INSERT INTO therapists (user_id, license_no, specialization, city, clinic_address, years_experience, bio)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, t.license_no, t.specialization, t.city, t.clinic_address, t.years_experience, t.bio);
  auth.createSession(res, id);
  res.status(201).json({ ok: true, redirect: '/therapist/dashboard.html' });
});

app.post('/api/auth/login', (req, res) => {
  const role = req.body.role === 'therapist' ? 'therapist' : 'user';
  const email = clean(req.body.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (user.role !== role) {
    const other = user.role === 'therapist' ? 'the therapist sign-in' : 'the regular sign-in';
    return res.status(403).json({ error: `This is a ${user.role} account — please use ${other}.` });
  }
  auth.createSession(res, user.id);
  res.json({ ok: true, redirect: role === 'therapist' ? '/therapist/dashboard.html' : '/home.html' });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const out = { user: req.user };
  if (req.user.role === 'user') {
    out.profile = getProfile(req.user.id);
    out.mood = latestMood(req.user.id);
  } else {
    out.therapist = db.prepare('SELECT * FROM therapists WHERE user_id = ?').get(req.user.id);
  }
  res.json(out);
});

// ---------- Public lookups ----------

app.get('/api/options', (_req, res) => res.json(recommender.OPTIONS));
app.get('/api/search/:kind(movies|books)', (req, res) => res.json(recommender.search(req.params.kind, req.query.q)));

// ---------- User area ----------

const user = express.Router();
user.use(auth.requireRole('user'));

user.put('/profile', (req, res) => {
  saveProfile(req.user.id, profileFromBody(req.body));
  res.json({ ok: true, profile: getProfile(req.user.id) });
});

user.post('/moods', (req, res) => {
  const mood = req.body.mood;
  if (!MOOD_IDS.includes(mood)) return res.status(400).json({ error: 'Unknown mood.' });
  const intensity = Math.max(1, Math.min(5, parseInt(req.body.intensity, 10) || 3));
  db.prepare('INSERT INTO moods (user_id, mood, intensity, note) VALUES (?, ?, ?, ?)')
    .run(req.user.id, mood, intensity, clean(req.body.note, 500) || null);
  res.status(201).json({ ok: true, mood });
});

user.get('/moods', (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
  res.json(db.prepare(`SELECT mood, intensity, note, source, created_at FROM moods
    WHERE user_id = ? AND created_at >= datetime('now', ?) ORDER BY created_at`).all(req.user.id, `-${days} days`));
});

user.get('/journal', (req, res) => {
  res.json(db.prepare('SELECT * FROM journal WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id));
});

user.post('/journal', (req, res) => {
  const body = clean(req.body.body, 10000);
  if (!body) return res.status(400).json({ error: 'Write a few words first.' });
  const mood = MOOD_IDS.includes(req.body.mood) ? req.body.mood : null;
  const { lastInsertRowid } = db.prepare('INSERT INTO journal (user_id, title, body, mood, sentiment, shared) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, clean(req.body.title, 120) || null, body, mood, chatbot.analyzeSentiment(body), req.body.shared ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM journal WHERE id = ?').get(lastInsertRowid));
});

user.patch('/journal/:id', (req, res) => {
  const r = db.prepare('UPDATE journal SET shared = ? WHERE id = ? AND user_id = ?').run(req.body.shared ? 1 : 0, req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Entry not found.' });
  res.json({ ok: true });
});

user.delete('/journal/:id', (req, res) => {
  db.prepare('DELETE FROM journal WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

user.get('/chat', (req, res) => {
  res.json(db.prepare('SELECT sender, text, intent, created_at FROM chats WHERE user_id = ? ORDER BY id DESC LIMIT 60')
    .all(req.user.id).reverse());
});

user.post('/chat', (req, res) => {
  const message = clean(req.body.message, 2000);
  if (!message) return res.status(400).json({ error: 'Say something first 🙂' });
  const reply = chatbot.respond(req.user.id, firstName(req.user.name), message);
  const insert = db.prepare('INSERT INTO chats (user_id, sender, text, intent, sentiment) VALUES (?, ?, ?, ?, ?)');
  insert.run(req.user.id, 'user', message, reply.intent, reply.sentiment);
  insert.run(req.user.id, 'bot', reply.reply, reply.intent, null);
  // Emotions noticed in chat feed the mood history (at most once per mood per 30 min).
  if (reply.mood) {
    const recent = db.prepare(`SELECT 1 FROM moods WHERE user_id = ? AND mood = ? AND created_at >= datetime('now', '-30 minutes')`)
      .get(req.user.id, reply.mood);
    if (!recent) db.prepare(`INSERT INTO moods (user_id, mood, source) VALUES (?, ?, 'chat')`).run(req.user.id, reply.mood);
  }
  res.json(reply);
});

user.delete('/chat', (req, res) => {
  db.prepare('DELETE FROM chats WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

user.get('/recommendations', (req, res) => {
  const profile = getProfile(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  const mood = MOOD_IDS.includes(req.query.mood) ? req.query.mood : latestMood(req.user.id);
  const recentMoods = db.prepare('SELECT mood FROM moods WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 14').all(req.user.id);
  res.json(recommender.recommend(profile, mood, recentMoods, { shuffle: req.query.shuffle === '1' }));
});

user.post('/stress-log', (req, res) => {
  const tool = clean(req.body.tool, 30);
  if (!tool) return res.status(400).json({ error: 'Missing tool.' });
  db.prepare('INSERT INTO stress_log (user_id, tool, amount) VALUES (?, ?, ?)')
    .run(req.user.id, tool, Math.max(0, Math.min(100000, parseInt(req.body.amount, 10) || 0)));
  res.status(201).json({ ok: true });
});

user.get('/summary', (req, res) => {
  const id = req.user.id;
  res.json({
    streak: db.prepare(`SELECT COUNT(DISTINCT date(created_at)) n FROM moods WHERE user_id = ? AND created_at >= datetime('now', '-7 days')`).get(id).n,
    journalCount: db.prepare('SELECT COUNT(*) n FROM journal WHERE user_id = ?').get(id).n,
    chats: db.prepare(`SELECT COUNT(*) n FROM chats WHERE user_id = ? AND sender = 'user'`).get(id).n,
    calmMinutes: Math.round(db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM stress_log WHERE user_id = ? AND tool IN ('breathe', 'meditate')`).get(id).s / 60),
    punches: db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM stress_log WHERE user_id = ? AND tool = 'punch'`).get(id).s,
    nextAppointment: db.prepare(`
      SELECT a.id, a.scheduled_at, a.status, u.name AS therapist, t.clinic_address
      FROM appointments a JOIN users u ON u.id = a.therapist_id JOIN therapists t ON t.user_id = a.therapist_id
      WHERE a.user_id = ? AND a.status IN ('requested', 'confirmed') AND a.scheduled_at >= datetime('now')
      ORDER BY a.scheduled_at LIMIT 1`).get(id) || null,
  });
});

user.get('/therapists', (req, res) => {
  const city = clean(req.query.city, 60);
  const rows = db.prepare(`
    SELECT u.id, u.name, t.specialization, t.city, t.clinic_address, t.years_experience, t.bio
    FROM users u JOIN therapists t ON t.user_id = u.id
    WHERE u.role = 'therapist' ${city ? 'AND t.city LIKE ?' : ''}
    ORDER BY t.city, u.name`).all(...(city ? [`%${city}%`] : []));
  res.json(rows);
});

user.get('/appointments', (req, res) => {
  res.json(db.prepare(`
    SELECT a.id, a.scheduled_at, a.status, a.reason, u.name AS therapist, t.clinic_address, t.city
    FROM appointments a JOIN users u ON u.id = a.therapist_id JOIN therapists t ON t.user_id = a.therapist_id
    WHERE a.user_id = ? ORDER BY a.scheduled_at DESC`).all(req.user.id));
});

user.post('/appointments', (req, res) => {
  const therapistId = parseInt(req.body.therapist_id, 10);
  const when = new Date(req.body.scheduled_at);
  const therapist = db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'therapist'`).get(therapistId);
  if (!therapist) return res.status(400).json({ error: 'Please choose a therapist.' });
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) return res.status(400).json({ error: 'Please pick a future date and time.' });
  if (!req.body.consent) return res.status(400).json({ error: 'Please confirm you’re happy to share your wellbeing data with this therapist.' });
  const iso = when.toISOString().slice(0, 16).replace('T', ' ');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO appointments (user_id, therapist_id, scheduled_at, reason, consent) VALUES (?, ?, ?, ?, 1)`)
    .run(req.user.id, therapistId, iso, clean(req.body.reason, 500) || null);
  res.status(201).json({ ok: true, id: Number(lastInsertRowid) });
});

user.post('/appointments/:id/cancel', (req, res) => {
  const r = db.prepare(`UPDATE appointments SET status = 'cancelled'
    WHERE id = ? AND user_id = ? AND status IN ('requested', 'confirmed')`).run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Appointment not found.' });
  res.json({ ok: true });
});

// ---------- Therapist area ----------

const therapist = express.Router();
therapist.use(auth.requireRole('therapist'));

therapist.get('/appointments', (req, res) => {
  res.json(db.prepare(`
    SELECT a.id, a.user_id, a.scheduled_at, a.status, a.reason, a.created_at, u.name AS patient, p.age_group, p.occupation
    FROM appointments a JOIN users u ON u.id = a.user_id LEFT JOIN profiles p ON p.user_id = a.user_id
    WHERE a.therapist_id = ? ORDER BY CASE a.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, a.scheduled_at`)
    .all(req.user.id));
});

therapist.post('/appointments/:id/status', (req, res) => {
  const allowed = { confirmed: ['requested'], declined: ['requested'], completed: ['confirmed'] };
  const next = req.body.status;
  if (!allowed[next]) return res.status(400).json({ error: 'Unknown status.' });
  const r = db.prepare(`UPDATE appointments SET status = ? WHERE id = ? AND therapist_id = ? AND status IN (${allowed[next].map(() => '?').join(',')})`)
    .run(next, req.params.id, req.user.id, ...allowed[next]);
  if (!r.changes) return res.status(409).json({ error: 'This appointment can’t be changed to that status.' });
  res.json({ ok: true });
});

// Patients = people who booked an offline session with this therapist and consented.
therapist.get('/patients', (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, p.age_group, p.occupation,
           MAX(a.scheduled_at) AS last_session,
           (SELECT mood FROM moods m WHERE m.user_id = u.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_mood
    FROM appointments a JOIN users u ON u.id = a.user_id LEFT JOIN profiles p ON p.user_id = u.id
    WHERE a.therapist_id = ? AND a.consent = 1 AND a.status IN ('requested', 'confirmed', 'completed')
    GROUP BY u.id ORDER BY u.name`).all(req.user.id));
});

function requirePatient(req, res, next) {
  const userId = parseInt(req.params.id, 10);
  if (!therapistCanAccess(req.user.id, userId)) {
    return res.status(403).json({ error: 'You can only view people who have booked an offline session with you.' });
  }
  req.patientId = userId;
  next();
}

therapist.get('/patients/:id', requirePatient, (req, res) => {
  const id = req.patientId;
  const sentiment = db.prepare(`
    SELECT date(created_at) AS day, ROUND(AVG(sentiment), 2) AS avg, COUNT(*) AS messages
    FROM chats WHERE user_id = ? AND sender = 'user' AND created_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day`).all(id);
  res.json({
    patient: db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(id),
    profile: getProfile(id),
    moods: db.prepare(`SELECT mood, intensity, note, source, created_at FROM moods WHERE user_id = ? AND created_at >= datetime('now', '-60 days') ORDER BY created_at`).all(id),
    journal: db.prepare('SELECT id, title, body, mood, created_at FROM journal WHERE user_id = ? AND shared = 1 ORDER BY created_at DESC').all(id),
    chatSentiment: sentiment,
    crisisFlags: db.prepare(`SELECT created_at FROM chats WHERE user_id = ? AND intent = 'crisis' AND sender = 'user' ORDER BY created_at DESC LIMIT 10`).all(id),
    appointments: db.prepare('SELECT id, scheduled_at, status, reason FROM appointments WHERE user_id = ? AND therapist_id = ? ORDER BY scheduled_at DESC').all(id, req.user.id),
    notes: db.prepare('SELECT id, body, created_at FROM therapist_notes WHERE user_id = ? AND therapist_id = ? ORDER BY created_at DESC').all(id, req.user.id),
  });
});

therapist.post('/patients/:id/notes', requirePatient, (req, res) => {
  const body = clean(req.body.body, 4000);
  if (!body) return res.status(400).json({ error: 'Note is empty.' });
  db.prepare('INSERT INTO therapist_notes (therapist_id, user_id, body) VALUES (?, ?, ?)').run(req.user.id, req.patientId, body);
  res.status(201).json({ ok: true });
});

app.use('/api/therapist', therapist);
app.use('/api', user);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`🌿 Aurora is running at http://localhost:${PORT}`));
}

module.exports = app;
