// Password hashing (scrypt) and cookie-based sessions.
const crypto = require('node:crypto');
const { db } = require('./db');

const COOKIE = 'aurora_session';
const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 864e5,
  });
}

function destroySession(req, res) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE);
}

function readToken(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

// Attaches req.user when a valid session cookie is present.
function loadUser(req, _res, next) {
  const token = readToken(req);
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.role, u.name, u.email, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, role: row.role, name: row.name, email: row.email };
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
}

const requireRole = role => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  if (req.user.role !== role) return res.status(403).json({ error: 'This area is not available for your account type.' });
  next();
};

module.exports = { hashPassword, verifyPassword, createSession, destroySession, loadUser, requireRole };
