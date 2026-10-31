// Aurora's conversation engine.
//
// 1. Crisis screen  — self-harm language always gets helplines first.
// 2. Intent match   — TF-IDF over hand-written patterns (server/data/intents.json).
// 3. FAQ retrieval  — TF-IDF over the open Mental Health FAQ dataset (plus a few
//                     hand-written definitions in data/faq_extra.json) for factual questions.
// 4. Fallback       — an empathetic reply chosen by sentiment (AFINN-165 lexicon).
const path = require('node:path');
const fs = require('node:fs');
const Sentiment = require('sentiment');

const sentiment = new Sentiment();
const { actions: ACTIONS, intents: INTENTS } = require('./data/intents.json');

const faqFile = path.join(__dirname, '..', 'data', 'mh_faq.json');
// The dataset's own small talk ("Who are you?") is dropped — Aurora's intents cover that.
const FAQ = [
  ...require('./data/faq_extra.json'),
  ...(fs.existsSync(faqFile) ? JSON.parse(fs.readFileSync(faqFile, 'utf8')) : []),
].filter(f => !/^(hi|hello|hey)\b|who are you|what are you doing/i.test(f.q));

const CRISIS = [
  /\b(kill|hurt|harm|cut)(ting)? myself\b/,
  /\bsuicid(e|al)\b/,
  /\b(end|take) (my|my own) life\b/,
  /\bwant to die\b/,
  /\bdon'?t want to (live|be alive|exist)\b/,
  /\bno reason to live\b/,
  /\bbetter off (dead|without me)\b/,
  /\bself[- ]?harm\b/,
];

const CRISIS_REPLY =
  "I'm really sorry you're feeling this much pain, {name}, and I'm glad you told me. You deserve support from a real person right now. " +
  'Please reach out: Tele-MANAS 14416 (free, 24×7), Vandrevala Foundation +91 9999 666 555 (24×7), or iCall 9152987821. ' +
  "If you're in immediate danger, call 112. I'm still here with you — would you like to tell me what's happening?";

const FALLBACK = {
  negative: [
    "That sounds really hard, {name}. I'm here. Can you tell me a bit more about what's making you feel this way?",
    "I can hear that this is weighing on you. What part of it feels the heaviest right now?",
    "Thank you for sharing that with me. It's okay to feel this way. What do you think would help, even a little?",
  ],
  positive: [
    "That's really nice to hear! Tell me more 😊",
    "I love that. What else has been good lately?",
    "That sounds lovely, {name}. How did it make you feel?",
  ],
  neutral: [
    "I hear you. How does that make you feel?",
    "Tell me more about that — I'm listening.",
    "I see. What's been on your mind the most today?",
    "Mm-hmm. And how are you feeling about all of it?",
  ],
};

const STOPWORDS = new Set(
  'a an the i me my am is are was were be been being to of in on at for and or but so it its this that ' +
  'with just really very do does did have has had you your can could would should will about as by from'
    .split(' ')
);
const NEGATIONS = new Set(['not', 'no', 'never', 'cannot']);
// Patterns made only of these ("what are you" -> [what]) must not match every question.
const QUESTION_WORDS = new Set(['what', 'how', 'who', 'why', 'when', 'where', 'which']);

function stem(w) {
  if (w.length <= 4) return w;
  return w
    .replace(/(ing|edly|ed|ness|ful|ly|es)$/, '')
    .replace(/(.)\1$/, '$1')
    .replace(/s$/, '')
    .replace(/i$/, 'y');
}

// "I'm not feeling good" -> ["not_feel", "not_good"]: negation sticks to the next two words
// so "not happy" never matches the happy intent.
function tokenize(text) {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/can't|cannot/g, 'can not')
    .replace(/won't/g, 'will not')
    .replace(/n't\b/g, ' not')
    .replace(/'m\b/g, ' am')
    .replace(/'re\b/g, ' are')
    .replace(/'s\b/g, '')
    .replace(/'ve\b/g, ' have')
    .replace(/'ll\b/g, ' will')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let negate = 0;
  for (const w of words) {
    if (NEGATIONS.has(w)) { negate = 2; out.push('not'); continue; }
    if (STOPWORDS.has(w)) continue;
    const s = stem(w);
    out.push(negate > 0 ? `not_${s}` : s);
    if (negate > 0) negate--;
  }
  return out;
}

class TfIdfIndex {
  constructor(docs) {
    this.tokens = docs.map(tokenize);
    const df = new Map();
    for (const toks of this.tokens) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    this.idf = t => Math.log((docs.length + 1) / ((df.get(t) || 0) + 1)) + 1;
    this.vectors = this.tokens.map(toks => this.vectorize(toks));
  }

  vectorize(tokens) {
    const v = new Map();
    for (const t of tokens) v.set(t, (v.get(t) || 0) + 1);
    let norm = 0;
    for (const [t, tf] of v) { const w = tf * this.idf(t); v.set(t, w); norm += w * w; }
    v.norm = Math.sqrt(norm) || 1;
    return v;
  }

  // Blend of cosine similarity and coverage. Intents use pattern coverage (a short pattern
  // still matches inside a long, rambling message); the FAQ uses query coverage (a long
  // dataset question still matches a short query).
  search(text, { coverage = 'pattern' } = {}) {
    const q = this.vectorize(tokenize(text));
    const onlyQuestionWords = v => [...v.keys()].every(t => QUESTION_WORDS.has(t));
    const queryIsBare = onlyQuestionWords(q);
    return this.vectors.map((d, i) => {
      let dot = 0, covered = 0, total = 0;
      for (const [t, w] of d) {
        total += w;
        if (q.has(t)) { dot += w * q.get(t); covered += w; }
      }
      const cosine = dot / (d.norm * q.norm);
      if (onlyQuestionWords(d)) return { i, score: queryIsBare ? cosine : cosine * 0.5 };
      if (coverage === 'query') {
        let qCovered = 0, qTotal = 0;
        for (const [t, w] of q) { qTotal += w; if (d.has(t)) qCovered += w; }
        return { i, score: 0.4 * cosine + 0.6 * (qTotal ? qCovered / qTotal : 0) };
      }
      return { i, score: 0.5 * cosine + 0.5 * (total ? covered / total : 0) };
    });
  }
}

const patternOwner = [];
const intentIndex = new TfIdfIndex(
  INTENTS.flatMap((intent, k) => intent.patterns.map(p => { patternOwner.push(k); return p; }))
);
const faqIndex = new TfIdfIndex(FAQ.map(f => f.q));

// Per-user short-term memory: what Aurora last offered and said.
const memory = new Map();

const pick = (list, avoid) => {
  const options = list.length > 1 ? list.filter(r => r !== avoid) : list;
  return options[Math.floor(Math.random() * options.length)];
};
const fill = (text, name) => text.replaceAll('{name}', name);
const toActions = keys => (keys || []).map(k => ACTIONS[k]).filter(Boolean);

// Keep whole paragraphs (so numbered lists aren't cut mid-item); fall back to whole sentences.
function shorten(answer, max = 600) {
  const paragraphs = answer.split(/\n\s*\n/);
  let out = paragraphs[0];
  for (const p of paragraphs.slice(1)) {
    if (out.length + p.length + 2 > max) break;
    out += `\n\n${p}`;
  }
  if (out.length > max) {
    const sentences = out.match(/[^.!?]+[.!?]+(\s|$)/g) || [out];
    out = '';
    for (const s of sentences) { if (out && out.length + s.length > max) break; out += s; }
  }
  return out.trim() + (out.trim().length < answer.trim().length ? ' …' : '');
}

const faqReply = item => `Here's what I know about “${item.q.replace(/\?*$/, '?')}”\n\n${shorten(item.a)}`;

const NEGATIVE_MOODS = new Set(['stressed', 'anxious', 'low', 'angry', 'tired']);

// sentimentScore nudges ties: "I love my new job!" is not work stress.
function bestIntent(text, sentimentScore) {
  const best = new Map();
  for (const { i, score } of intentIndex.search(text)) {
    const k = patternOwner[i];
    let s = score;
    if (sentimentScore >= 0.4 && NEGATIVE_MOODS.has(INTENTS[k].mood)) s -= 0.2;
    if (sentimentScore <= -0.3 && INTENTS[k].mood === 'happy') s -= 0.2;
    if (s > (best.get(k) || 0)) best.set(k, s);
  }
  const short = tokenize(text).length <= 4;
  let top = null;
  for (const [k, score] of best) {
    const tag = INTENTS[k].tag;
    // "yes"/"no" only count as answers when the whole message is short.
    if ((tag === 'affirm' || tag === 'deny') && !short) continue;
    if (!top || score > top.score) top = { intent: INTENTS[k], score };
  }
  return top;
}

function respond(userId, firstName, message) {
  const text = String(message || '').trim().slice(0, 2000);
  const mem = memory.get(userId) || {};
  const score = sentiment.analyze(text).comparative;
  const name = firstName || 'friend';
  const result = (reply, extra = {}) => {
    memory.set(userId, { lastOffer: extra.offer || null, lastReply: reply });
    return {
      reply: fill(reply, name),
      intent: extra.intent || null,
      mood: extra.mood || null,
      actions: extra.actions || [],
      crisis: !!extra.crisis,
      sentiment: Math.round(score * 100) / 100,
    };
  };

  if (CRISIS.some(re => re.test(text.toLowerCase()))) {
    return result(CRISIS_REPLY, { intent: 'crisis', crisis: true, mood: 'low', actions: toActions(['helplines', 'therapists']) });
  }

  const match = bestIntent(text, score);

  // Factual questions ("what is a panic attack?") are answered from the FAQ dataset.
  const looksLikeQuestion = /\?$|^(what|how|why|is|are|can|does|do|should|who|when)\b/i.test(text);
  if (looksLikeQuestion && FAQ.length) {
    const top = faqIndex.search(text, { coverage: 'query' }).sort((a, b) => b.score - a.score)[0];
    if (top && top.score >= 0.5 && top.score >= (match ? match.score : 0) - 0.1) {
      return result(faqReply(FAQ[top.i]), { intent: 'faq', actions: toActions(['therapists']) });
    }
  }

  if (match && match.score >= 0.5) {
    const { intent } = match;
    if (intent.tag === 'affirm' && mem.lastOffer) {
      return result(mem.lastOffer.text, { intent: 'affirm', actions: toActions([mem.lastOffer.action]) });
    }
    return result(pick(intent.responses, mem.lastReply), {
      intent: intent.tag,
      mood: intent.mood,
      actions: toActions(intent.actions),
      offer: intent.offer,
    });
  }

  if (match && match.score >= 0.35) {
    const { intent } = match;
    return result(pick(intent.responses, mem.lastReply), {
      intent: intent.tag, mood: intent.mood, actions: toActions(intent.actions), offer: intent.offer,
    });
  }

  const tone = score <= -0.25 ? 'negative' : score >= 0.3 ? 'positive' : 'neutral';
  return result(pick(FALLBACK[tone], mem.lastReply), {
    intent: `fallback_${tone}`,
    actions: tone === 'negative' ? toActions(['journal', 'breathe']) : [],
  });
}

module.exports = { respond, tokenize, analyzeSentiment: text => sentiment.analyze(text).comparative };
