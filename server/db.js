// SQLite storage using Node's built-in driver (no native modules to compile).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.AURORA_DB || path.join(__dirname, '..', 'aurora.db');
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('user', 'therapist')),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the person told us at sign-up; drives recommendations.
CREATE TABLE IF NOT EXISTS profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_group        TEXT,
  occupation       TEXT,
  recent_movie_id  INTEGER,
  recent_movie     TEXT,
  movie_genres     TEXT NOT NULL DEFAULT '[]',
  recent_book_id   INTEGER,
  recent_book      TEXT,
  book_genres      TEXT NOT NULL DEFAULT '[]',
  music_families   TEXT NOT NULL DEFAULT '[]',
  favourite_artist TEXT,
  daily_activities TEXT NOT NULL DEFAULT '[]',
  unwind           TEXT NOT NULL DEFAULT '[]',
  sleep_hours      TEXT,
  screen_time      TEXT,
  hoping_for       TEXT
);

CREATE TABLE IF NOT EXISTS therapists (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  license_no       TEXT NOT NULL,
  specialization   TEXT NOT NULL,
  city             TEXT NOT NULL,
  clinic_address   TEXT NOT NULL,
  years_experience INTEGER NOT NULL DEFAULT 0,
  bio              TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moods (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood       TEXT NOT NULL,
  intensity  INTEGER NOT NULL DEFAULT 3,
  note       TEXT,
  source     TEXT NOT NULL DEFAULT 'checkin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  body       TEXT NOT NULL,
  mood       TEXT,
  sentiment  REAL,
  shared     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL CHECK (sender IN ('user', 'bot')),
  text       TEXT NOT NULL,
  intent     TEXT,
  sentiment  REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An offline (in-person) session request. This row is what grants a therapist
-- access to a user's data: no appointment, no access.
CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'confirmed', 'completed', 'declined', 'cancelled')),
  consent      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS therapist_notes (
  id           INTEGER PRIMARY KEY,
  therapist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stress_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool       TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moods_user ON moods(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appt_pair ON appointments(therapist_id, user_id);
`);

// Statuses under which a therapist may see a patient's data.
const ACTIVE_STATUSES = ['requested', 'confirmed', 'completed'];

function therapistCanAccess(therapistId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM appointments
    WHERE therapist_id = ? AND user_id = ? AND consent = 1
      AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
    LIMIT 1`).get(therapistId, userId, ...ACTIVE_STATUSES);
}

const JSON_FIELDS = ['movie_genres', 'book_genres', 'music_families', 'daily_activities', 'unwind'];

function getProfile(userId) {
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!p) return null;
  for (const f of JSON_FIELDS) p[f] = JSON.parse(p[f] || '[]');
  return { ...p };
}

module.exports = { db, therapistCanAccess, getProfile, JSON_FIELDS };
