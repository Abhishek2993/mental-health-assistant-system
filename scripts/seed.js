// Creates demo accounts so both portals can be tried right away.
// Safe to re-run: existing demo accounts are left untouched.
const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { search } = require('../server/recommender');
const { analyzeSentiment } = require('../server/chatbot');

const PASSWORD = 'aurora-demo-123';

const THERAPISTS = [
  { name: 'Dr. Ananya Mehta', email: 'ananya.mehta@aurora.test', license_no: 'RCI-A12345', specialization: 'Anxiety, stress & student counselling', city: 'Pune', clinic_address: 'Serene Minds Clinic, 2nd floor, FC Road, Shivajinagar, Pune', years_experience: 9, bio: 'Clinical psychologist working with teenagers and young adults on exam stress, anxiety and self-esteem using CBT.' },
  { name: 'Dr. Rohan Iyer', email: 'rohan.iyer@aurora.test', license_no: 'RCI-B67890', specialization: 'Depression, grief & relationships', city: 'Mumbai', clinic_address: 'Harbour Wellness Centre, Linking Road, Bandra West, Mumbai', years_experience: 14, bio: 'Counselling psychologist focused on mood disorders, grief and relationship issues.' },
  { name: 'Dr. Sara Khan', email: 'sara.khan@aurora.test', license_no: 'RCI-C24680', specialization: 'Sleep, burnout & workplace stress', city: 'Pune', clinic_address: 'Mindful Space, Baner Road, Baner, Pune', years_experience: 6, bio: 'Helps working professionals with burnout, sleep problems and work-life balance.' },
];

function upsertUser(role, name, email) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return { id: existing.id, created: false };
  const { lastInsertRowid } = db.prepare('INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(role, name, email, hashPassword(PASSWORD));
  return { id: Number(lastInsertRowid), created: true };
}

const ago = (days, hour = 20) => {
  const d = new Date(Date.now() - days * 864e5);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const therapistIds = THERAPISTS.map(t => {
  const { id, created } = upsertUser('therapist', t.name, t.email);
  if (created) {
    db.prepare(`INSERT INTO therapists (user_id, license_no, specialization, city, clinic_address, years_experience, bio)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, t.license_no, t.specialization, t.city, t.clinic_address, t.years_experience, t.bio);
  }
  return id;
});

const movie = search('movies', 'Inception')[0];
const book = search('books', 'The Alchemist')[0];

const demo = upsertUser('user', 'Aarav Patil', 'demo@aurora.test');
if (demo.created) {
  const p = {
    age_group: '18–24', occupation: 'College student',
    recent_movie_id: movie?.id ?? null, recent_movie: movie?.title ?? 'Inception',
    movie_genres: JSON.stringify(['Sci-Fi', 'Comedy', 'Animation']),
    recent_book_id: book?.id ?? null, recent_book: book?.title ?? 'The Alchemist',
    book_genres: JSON.stringify(['Fantasy', 'Self-Help']),
    music_families: JSON.stringify(['Lo-fi & Chill', 'Bollywood & Indian', 'Indie']),
    favourite_artist: 'Arijit Singh',
    daily_activities: JSON.stringify(['Classes / lectures', 'Studying late', 'Gaming', 'Scrolling social media', 'Commuting']),
    unwind: JSON.stringify(['Listening to music', 'Gaming', 'Being alone']),
    sleep_hours: '5–6', screen_time: '6+ hours', hoping_for: 'Manage stress',
  };
  const cols = Object.keys(p);
  db.prepare(`INSERT INTO profiles (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
    .run(demo.id, ...cols.map(c => p[c]));

  const moodPlan = ['okay', 'stressed', 'stressed', 'anxious', 'okay', 'tired', 'low', 'stressed', 'okay', 'happy', 'okay', 'anxious', 'stressed', 'okay'];
  const insertMood = db.prepare('INSERT INTO moods (user_id, mood, intensity, source, created_at) VALUES (?, ?, ?, ?, ?)');
  moodPlan.forEach((mood, i) => insertMood.run(demo.id, mood, 2 + (i % 3), 'checkin', ago(moodPlan.length - i)));

  const entries = [
    [12, 'Mid-sems', 'Three exams this week and I barely slept. I feel like everyone else has it together and I am just faking it.', 'stressed', 1],
    [8, null, 'Played football with my hostel friends after a long time. Felt really good to laugh. Need to do this more.', 'happy', 1],
    [5, 'Late night thoughts', 'Couldn’t sleep again. Kept replaying the presentation in my head. Scrolled my phone till 3am which made it worse.', 'anxious', 1],
    [2, 'Private', 'Something I don’t want to share with anyone yet.', 'low', 0],
  ];
  const insertJournal = db.prepare('INSERT INTO journal (user_id, title, body, mood, sentiment, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [d, title, body, mood, shared] of entries) insertJournal.run(demo.id, title, body, mood, analyzeSentiment(body), shared, ago(d));

  const chats = [
    [6, 'I am so stressed about my exams', -0.33], [6, 'my parents keep comparing me with my cousin', -0.2],
    [3, 'I cant sleep, my mind wont stop', -0.25], [1, 'today was actually a good day', 0.6],
  ];
  const insertChat = db.prepare(`INSERT INTO chats (user_id, sender, text, sentiment, created_at) VALUES (?, 'user', ?, ?, ?)`);
  for (const [d, text, s] of chats) insertChat.run(demo.id, text, s, ago(d));

  const next = new Date(Date.now() + 3 * 864e5);
  next.setHours(11, 0, 0, 0);
  db.prepare(`INSERT INTO appointments (user_id, therapist_id, scheduled_at, reason, status, consent, created_at)
    VALUES (?, ?, ?, ?, 'confirmed', 1, ?)`)
    .run(demo.id, therapistIds[0], next.toISOString().slice(0, 16).replace('T', ' '), 'Exam stress and trouble sleeping', ago(2));
}

// A second user who has NOT booked with Dr. Mehta — used to show access is denied.
const other = upsertUser('user', 'Kabir Rao', 'kabir@aurora.test');
if (other.created) {
  db.prepare(`INSERT INTO profiles (user_id, occupation, music_families, movie_genres) VALUES (?, 'Working professional', '["Rock"]', '["Drama"]')`).run(other.id);
  db.prepare('INSERT INTO moods (user_id, mood) VALUES (?, ?)').run(other.id, 'tired');
  const when = new Date(Date.now() + 5 * 864e5);
  when.setHours(17, 30, 0, 0);
  db.prepare(`INSERT INTO appointments (user_id, therapist_id, scheduled_at, reason, consent) VALUES (?, ?, ?, ?, 1)`)
    .run(other.id, therapistIds[1], when.toISOString().slice(0, 16).replace('T', ' '), 'Feeling burnt out at work');
}

console.log(`Demo accounts ready (password for all: ${PASSWORD})
  User       demo@aurora.test        (patient of Dr. Ananya Mehta)
  User       kabir@aurora.test       (patient of Dr. Rohan Iyer)
  Therapist  ananya.mehta@aurora.test
  Therapist  rohan.iyer@aurora.test
  Therapist  sara.khan@aurora.test   (no patients yet)`);
