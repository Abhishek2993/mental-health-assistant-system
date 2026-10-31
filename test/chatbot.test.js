const test = require('node:test');
const assert = require('node:assert');
const { respond } = require('../server/chatbot');

const intentOf = msg => respond(Math.random(), 'Sam', msg).intent;

test('crisis language always gets helplines', () => {
  for (const msg of ['i want to kill myself', 'I have been thinking about suicide', "I don't want to live anymore", 'everyone would be better off without me']) {
    const r = respond(1, 'Sam', msg);
    assert.equal(r.intent, 'crisis', msg);
    assert.ok(r.crisis);
    assert.match(r.reply, /14416/);
  }
});

test('recognises common feelings', () => {
  assert.equal(intentOf('I am feeling stressed today'), 'stressed');
  assert.equal(intentOf('I feel so anxious about tomorrow'), 'anxious');
  assert.equal(intentOf('I feel lonely'), 'lonely');
  assert.equal(intentOf("I can't sleep at night"), 'sleep');
  assert.equal(intentOf('my dog died yesterday'), 'grief');
});

test('negation flips meaning', () => {
  assert.equal(intentOf('I am not happy'), 'sad');
  assert.equal(intentOf("I'm not okay"), 'sad');
});

test('positive sentiment beats a negative keyword', () => {
  assert.equal(intentOf('i love my new job, everything is great'), 'happy');
});

test('factual questions are answered from the FAQ dataset', () => {
  const r = respond(2, 'Sam', 'What is anxiety?');
  assert.equal(r.intent, 'faq');
  assert.match(r.reply, /anxiety/i);
  assert.equal(intentOf('What is a panic attack?'), 'faq');
});

test('a bare question word does not trigger the about-me intent', () => {
  assert.equal(intentOf('what is depression'), 'faq');
  assert.equal(intentOf('who are you'), 'about_bot');
});

test('"yes" accepts the last offer', () => {
  respond(3, 'Sam', 'I am so stressed out');
  const r = respond(3, 'Sam', 'yes');
  assert.equal(r.intent, 'affirm');
  assert.equal(r.actions[0].href, '/stress.html#breathe');
});

test('replies are personalised with the first name', () => {
  assert.match(respond(4, 'Priya', 'I feel sad').reply + respond(4, 'Priya', 'hello').reply, /Priya/);
});
