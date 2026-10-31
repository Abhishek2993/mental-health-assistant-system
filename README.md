# Aurora — Mental Health Assistant System

A calm, mood-aware web app that gives people a non-judgmental place to talk, things to enjoy, ways to blow off steam, and a private path to a real therapist.

It includes a chatbot with sentiment analysis, mood tracking, a journal, meditation, emergency contacts and therapist connection, plus:

- **Relatable sign-up** — a recent movie, a book, the music you listen to, what your day looks like, and how you feel right now.
- **Recommendations** built from those answers, with a *try something new* section in every category.
- **Mood-adaptive interface** — the colours shift with your latest check-in.
- **Separate therapist portal** — a therapist sees a person's data *only* after that person books an in-person session with them.
- **Stress buster zone** — punching bag, breathing, meditation, bubble wrap, "let it go", 5-4-3-2-1 grounding and a mandala doodle pad.

> Aurora is a support tool, not a medical service. It does not diagnose, and in a crisis it points people to Indian helplines (Tele-MANAS 14416, Vandrevala Foundation, iCall, 112).

## Quick start

Requires **Node.js 22.13+**. SQLite is built into Node, so there are no native modules to compile.

```bash
npm run setup     # install deps, download datasets, create demo accounts
npm start         # http://localhost:3000
```

`npm run dev` restarts the server on file changes. `npm test` runs the test suite.

### Demo accounts

All demo accounts use the password `aurora-demo-123`.

| Role | Email | Notes |
|---|---|---|
| User | `demo@aurora.test` | Two weeks of mood history, journal, a confirmed session with Dr. Mehta |
| User | `kabir@aurora.test` | Booked with Dr. Iyer only |
| Therapist | `ananya.mehta@aurora.test` | Can open Aarav's record |
| Therapist | `rohan.iyer@aurora.test` | Can open Kabir's record, **not** Aarav's |
| Therapist | `sara.khan@aurora.test` | No patients until someone books her |

Therapists sign in at `/therapist/login.html`.

## Features

| Area | What it does |
|---|---|
| **Sign-up** (`/signup.html`) | 6 short steps: about you → recently watched (autocomplete from MovieLens) → a book (autocomplete from goodbooks-10k) → music → your typical day, sleep & screen time → how you feel right now. |
| **Recommendations** (`/recommendations.html`) | Movies, books, a mood-matched playlist (links open in Spotify) and activities for the week, each with a reason ("Because you enjoyed Toy Story 3", "light & uplifting"). Each category has a **Try something new** row. A *What we noticed* panel explains patterns (sleep, screen time, music energy, recent moods). You can switch mood or shuffle. |
| **Talk to Aurora** (`/chat.html`) | Intent matching (TF-IDF) with negation handling, AFINN sentiment, short-term memory ("yes" accepts the last suggestion), FAQ answers from an open dataset, crisis detection with helplines, and action buttons linking into the app. Emotions noticed in chat feed the mood history. |
| **Mood theming** | Seven moods, each with a gentle palette: warm peach when low, sage green when stressed, sea teal when anxious, cool blue when frustrated, lavender when tired, sunny amber when happy. |
| **Stress buster zone** (`/stress.html`) | 🥊 Punching bag (physics, power meter, write your stressor on the bag) · 🌬️ Box / 4-7-8 / 4-6 breathing · 🪷 Meditation timer with synthesised rain, ocean or brown noise · 🫧 Bubble wrap · 🎈 Write a worry and watch it float away (never saved) · 🌳 5-4-3-2-1 grounding · 🎨 Mandala doodle pad. |
| **Journal** (`/journal.html`) | Mood-tagged entries with prompts. Each entry is private unless you tick *share with my therapist*. Includes a 30-day mood chart. |
| **Therapists** (`/therapists.html`) | Browse and filter by city, then request an in-person session. Booking requires explicit consent to share data. Cancelling removes the therapist's access. |
| **Therapist portal** (`/therapist/…`) | Confirm, decline or complete sessions. Each patient record shows the sign-up profile, 60-day mood chart, daily chat-sentiment trend (never the message text), shared journal entries, crisis-flag count and private notes. |

## How the therapist access rule works

A therapist can open a person's record only when an `appointments` row exists with that therapist, `consent = 1`, and a status of `requested`, `confirmed` or `completed` (`therapistCanAccess` in `server/db.js`). Every patient endpoint is guarded by it. Declined or cancelled bookings grant nothing. Chat messages themselves are never exposed; therapists see only the daily average sentiment. `test/access.test.js` checks all of this end to end.

## Datasets (all free and open)

`npm run data` (`scripts/fetch-datasets.js`) downloads these into `data/raw/` and writes compact JSON to `data/`. Neither folder is committed.

| Dataset | Used for | Source / licence |
|---|---|---|
| MovieLens *latest-small* | 1,650 movies with genres + average ratings | GroupLens Research, University of Minnesota (research use) |
| goodbooks-10k | ~10k books with Goodreads shelves mapped to 20 genres | Zygmunt Zając — CC BY-SA 4.0 |
| Spotify Tracks Dataset | 3,735 tracks with valence/energy for mood matching | `maharshipandya/spotify-tracks-dataset` on Hugging Face — BSD |
| Mental Health FAQ | 170+ Q&A pairs the chatbot can answer from | `heliosbrahma/mental_health_chatbot_dataset` on Hugging Face — MIT |
| AFINN-165 | Sentiment lexicon | via the `sentiment` npm package — MIT |

The chatbot intents (`server/data/intents.json`), short definitions (`server/data/faq_extra.json`) and activity ideas (`server/data/activities.json`) were written for this project.

## Design choices

- **Fonts:** *Nunito* for body text (rounded, friendly, very legible) and *Fraunces* in its "soft" style for headings (warm and human).
- **Text colour:** deep slate `#2B3445` on warm off-white rather than pure black on white, which is easier on tired eyes. Every accent passes WCAG AA against white button text.
- Modelled on what Wysa, Headspace, Calm and Youper do well: lots of whitespace, large rounded cards, pill buttons, one accent colour at a time, and crisis resources that are easy to find.
- The soft aurora glow in the corner nods to the original Aurora prototype's northern-lights theme.
- Honours `prefers-reduced-motion` and works at phone width.

## Project structure

```
server/
  index.js          Express app and all API routes
  db.js             SQLite schema (node:sqlite) + therapist access rule
  auth.js           scrypt password hashing, cookie sessions, role guard
  chatbot.js        intent/FAQ retrieval, sentiment, crisis detection
  recommender.js    content-based recommendations + profile insights
  data/             hand-written intents, FAQ additions, activities
scripts/
  fetch-datasets.js download + preprocess open datasets
  seed.js           demo accounts
public/             HTML/CSS/JS front end (no build step)
  therapist/        therapist portal pages
test/               node:test suites (chatbot, recommender, access control)
```

## Future work

- Use a language model for more natural conversation, keeping the crisis screen and FAQ grounding.
- Self-assessment check-ins (e.g. PHQ-9 / GAD-7) shared with consent.
- Reminders, multilingual support (Hindi, Marathi), and a mobile app wrapper.
- Therapist availability calendars instead of free-form time requests.
