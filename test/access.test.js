// End-to-end API test of the therapist access rule, against a throwaway database.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert');

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-')), 'test.db');
process.env.AURORA_DB = dbFile;
const app = require('../server/index');

let base, server;
test.before(() => new Promise(resolve => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; resolve(); }); }));
test.after(() => server.close());

// A tiny cookie-keeping client per person.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('therapists only see users who booked them, until the booking is cancelled', async () => {
  const user = client(), drA = client(), drB = client();

  assert.equal((await user('POST', '/api/auth/signup', {
    name: 'Test User', email: 'user@example.test', password: 'password-123', mood: 'stressed',
    profile: { music_families: ['Pop'], movie_genres: ['Comedy'] },
  })).status, 201);
  const me = (await user('GET', '/api/me')).body;
  assert.equal(me.mood, 'stressed');

  const therapist = (email) => ({
    name: 'Dr. Test', email, password: 'password-123', license_no: 'X1', specialization: 'Anxiety', city: 'Pune', clinic_address: 'Somewhere',
  });
  assert.equal((await drA('POST', '/api/auth/therapist/signup', therapist('a@example.test'))).status, 201);
  assert.equal((await drB('POST', '/api/auth/therapist/signup', therapist('b@example.test'))).status, 201);
  const drAId = (await drA('GET', '/api/me')).body.user.id;
  const userId = me.user.id;

  // No booking yet: no access.
  assert.equal((await drA('GET', `/api/therapist/patients/${userId}`)).status, 403);

  // Booking without consent is rejected.
  const when = new Date(Date.now() + 864e5).toISOString();
  assert.equal((await user('POST', '/api/appointments', { therapist_id: drAId, scheduled_at: when })).status, 400);
  const booked = await user('POST', '/api/appointments', { therapist_id: drAId, scheduled_at: when, consent: true });
  assert.equal(booked.status, 201);

  // Shared vs private journal entries.
  await user('POST', '/api/journal', { body: 'shared thought', shared: true });
  await user('POST', '/api/journal', { body: 'private thought', shared: false });

  const record = await drA('GET', `/api/therapist/patients/${userId}`);
  assert.equal(record.status, 200);
  assert.deepEqual(record.body.journal.map(j => j.body), ['shared thought']);
  assert.equal((await drB('GET', `/api/therapist/patients/${userId}`)).status, 403, 'other therapist stays locked out');

  // Roles are separated.
  assert.equal((await drA('GET', '/api/journal')).status, 403);
  assert.equal((await user('GET', '/api/therapist/patients')).status, 403);

  // Cancelling withdraws access.
  await user('POST', `/api/appointments/${booked.body.id}/cancel`);
  assert.equal((await drA('GET', `/api/therapist/patients/${userId}`)).status, 403);
});

test('wrong portal and wrong password are rejected', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { email: 'a@example.test', password: 'password-123' })).status, 403);
  assert.equal((await c('POST', '/api/auth/login', { email: 'user@example.test', password: 'nope-nope' })).status, 401);
});
