// test/xsearch.test.js — checks for the X search composer (xsearch.js). Run: node test/xsearch.test.js
// The fixture is the "$4 gallon of gasoline" chain post as four accounts posted it, plus controls.
const assert = require('node:assert/strict');
globalThis.self = globalThis;
require('../search.js');
require('../words.js');
require('../xsearch.js');
const X = self.XPCXSearch;
const W = self.XPCWords;

const core1 = "I keep hearing people complain that gasoline is over $4.00 a gallon. And yes, I'd love to see it at $2.00 again. But before we declare gasoline the most outrageously expensive liquid on Earth, let's put things in perspective.";
const core2 = (wife) => `For $4.00, I get a GALLON of gasoline. I pour it into a 4,000-pound machine, turn a key, and that gallon will haul me, ${wife ? 'my wife, ' : ''}the groceries, the golf clubs and half the junk in my trunk almost 30 miles down the highway. That's actually a pretty impressive day's work for $4.00.`;
const core3 = (room) => `Now let's compare. A restaurant sells me a 5-ounce glass of wine for $9. That's about $230 a gallon. And how far does it transport me? Usually from the dinner table to the ${room}'s room. A fancy coffee shop can charge $6 for a 16-ounce latte. That's $48 a gallon. It doesn't transport me 30 miles. It transports me from "Leave me alone" to "Okay, now you may speak."`;
const tail = "Bottled water at a convenience store might be $2.50 for 20 ounces. That's $16 a gallon, for something that occasionally falls out of the sky FOR FREE. A 12-ounce energy drink at $3.50 works out to more than $37 a gallon. Apparently caffeine becomes a precious mineral once you put lightning bolts on the can.";
const posts = [
  { handle: 'poster_a', time: '2026-09-19T12:00:00.000Z', text: `Perspective.\n\n${core1}\n${core2(false)}\n${core3('women')}\n${tail}` },
  { handle: 'poster_b', time: '2026-09-20T03:00:00.000Z', text: `${core1}\n\n${core2(true)}\n\n${core3('men')}` },
  { handle: 'poster_c', time: '2026-09-19T20:00:00.000Z', text: `Dang, perspective is everything...\n\nAnyone else ever thought of things this way?\n\n${core1}\n\n${core2(false)}` },
  { handle: 'poster_d', time: '2026-09-18T09:00:00.000Z', text: `${core1}\n\n${core2(true)}\n\n${core3('men')}` },
  { handle: 'c1', time: '2026-09-19T10:00:00.000Z', text: 'I keep hearing people complain that the trains are late again. Let us put things in perspective: the bus is worse.' },
  { handle: 'c2', time: '2026-09-19T10:00:00.000Z', text: 'A fancy coffee shop can charge whatever it wants, that is the market. Bottled water is a scam though.' },
  { handle: 'c3', time: '2026-09-19T10:00:00.000Z', text: 'Ship it 🚀 https://t.co/abc @alice #AI' },
  ...Array.from({ length: 40 }, (_, i) => ({ handle: 'filler' + i, time: '2026-09-19T10:00:00.000Z', text: `Thinking about the market and the highway today, post number ${i}. Gas prices are up again.` })),
];
const agg = W.aggregate(posts.map((p) => W.countTokens(W.tokenize(p.text))));
const opts = { df: agg.df, N: agg.posts };

// words(): breaks at sentence punctuation, line breaks, quotes and digit tokens; drops links, mentions, hashtags
const ws = X.words('For $4.00, I get a GALLON of gasoline. "Leave me alone" to https://t.co/x @bob #tag ok');
assert.deepEqual(ws, ['for', null, 'i', 'get', 'a', 'gallon', 'of', 'gasoline', null, 'leave', 'me', 'alone', null, 'to', 'ok']);

// phrases(): three, in text order, non-overlapping, no breaks inside, at least two content words each
const ph = X.phrases(posts[0].text, opts);
assert.equal(ph.length, 3);
for (let i = 0; i < ph.length; i++) {
  const p = ph[i];
  assert.ok(p.end - p.start >= 3 && p.end - p.start <= 5, 'phrase length');
  assert.ok(!/\d/.test(p.phrase), 'no digits: ' + p.phrase);
  if (i) assert.ok(p.start >= ph[i - 1].end, 'non-overlapping and ordered');
  assert.ok(p.phrase.split(' ').filter((w) => !W.STOPWORDS.has(w)).length >= 2, 'two content words: ' + p.phrase);
  assert.ok(posts[0].text.toLowerCase().replace(/[’‘]/g, "'").includes(p.phrase.split(' ')[0]), 'phrase words come from the post');
}
// the rarest stretch of the opening is the one about the "outrageously expensive liquid"
assert.ok(ph[0].phrase.includes('outrageously') || ph[0].phrase.includes('liquid'), 'rarest opening phrase, got: ' + ph[0].phrase);
// common catalogue words ("market", "highway", "gas prices") do not win a phrase
assert.ok(!ph.some((p) => /\bmarket\b|\bhighway\b/.test(p.phrase)), 'catalogue-common words lose');

// a short post yields no phrase (one content word) and an empty query rather than a bad one
assert.deepEqual(X.phrases(posts[6].text, opts), []);
const short = X.compose(posts[6], opts);
assert.equal(short.query, '');
assert.equal(short.url, null);
assert.ok(short.describe[0].startsWith('No phrase'));

// window(): UTC days, until exclusive
assert.deepEqual(X.window('2026-09-19T12:00:00.000Z'), { since: '2026-09-16', until: '2026-09-21', before: 3, after: 1 });
assert.deepEqual(X.window('2026-09-19T23:30:00.000Z', { before: 1, after: 0 }), { since: '2026-09-18', until: '2026-09-20', before: 1, after: 0 });
assert.equal(X.window(null), null);

// build(): phrases OR-ed in parentheses, operators after, exclusions
const q = X.build({ phrases: ['a b c', 'd e'], window: X.window('2026-09-19T12:00:00Z'), excludeHandle: '@poster_a', replies: false, lang: 'en' });
assert.equal(q, '("a b c" OR "d e") since:2026-09-16 until:2026-09-21 -from:poster_a -filter:replies lang:en');
assert.equal(X.build({ phrases: ['only one'] }), '"only one"');
assert.equal(X.build({ keywords: ['gasoline', 'latte'], excludeHandle: 'x' }), 'gasoline latte -from:x');
assert.equal(X.build({}), '');

// compose(): full result for the first post
const c = X.compose(posts[0], { ...opts, replies: false });
assert.equal(c.phrases.length, 3);
assert.ok(c.query.startsWith('("') && c.query.includes(' OR ') && c.query.includes('since:2026-09-16 until:2026-09-21 -from:poster_a -filter:replies'), c.query);
assert.ok(c.url.startsWith('https://x.com/search?q=') && c.url.endsWith('&src=typed_query&f=live'));
assert.ok(decodeURIComponent(c.url.slice('https://x.com/search?q='.length)).startsWith(c.query));
assert.ok(c.webUrl.includes(encodeURIComponent('"')));
assert.ok(c.keywords.length === 5 && c.keywords.every((k) => k.length >= 4 && !W.STOPWORDS.has(k)));
assert.ok(c.looseQuery.includes(c.keywords.join(' ')));
assert.equal(c.describe.length, 5);

// the same phrases are found in the copies, so the query would match them
for (const p of posts.slice(1, 4)) {
  const found = ph.filter((x) => X.words(p.text).join(' ').includes(x.phrase));
  assert.ok(found.length >= 1, p.handle + ' shares at least one phrase');
}

// wordsQuery: cloud words as one query, scoped to or away from an account
assert.equal(X.wordsQuery(['gas', 'price hikes', '#oil'], { handle: '@bob', scope: 'them' }), 'gas "price hikes" #oil from:bob');
assert.equal(X.wordsQuery(['gas', 'Gas', ' '], { handle: 'bob', scope: 'others' }), 'gas -from:bob');
assert.equal(X.wordsQuery(['gas'], { handle: 'bob', scope: 'all' }), 'gas');
assert.equal(X.wordsQuery(['gas'], { handle: null, scope: 'them' }), 'gas', 'no handle, no author part');
assert.equal(X.wordsQuery(['say "no"'], {}), '"say no"', 'quotes inside a term are dropped');
assert.equal(X.wordsQuery([], { handle: 'bob', scope: 'them' }), '');

console.log('xsearch.test.js: all checks passed');
console.log('\nFor the poster_a post:');
console.log('  phrases :', ph.map((p) => `“${p.phrase}” (${p.score})`).join(', '));
console.log('  query   :', c.query);
console.log('  loose   :', c.looseQuery);
console.log('  url     :', c.url);
console.log('  explain :', c.describe.join(' '));
