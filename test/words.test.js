// test/words.test.js — checks for words.js (tokens, keyness, co-mentions) and clouds.js (layout).
//   node test/words.test.js
const assert = require('assert');
globalThis.self = globalThis;
require('../search.js');
require('../matrix.js');
require('../words.js');
require('../clouds.js');
const W = self.XPCWords;
const C = self.XPCClouds;

// --- tokenizer ---------------------------------------------------------------
const toks = W.tokenize("It's not about the tool — it's about the workflow. Ship it 🚀 https://t.co/abc @alice #AI Iran's gas prices, gas prices! 2024 x.com/foo");
assert.deepStrictEqual(toks.filter(Boolean), ['tool', 'workflow', 'ship', '🚀', '#ai', 'iran', 'gas', 'prices', 'gas', 'prices']);
assert.strictEqual(W.tokenize('Email me at bob@example.com ok').filter(Boolean).join(' '), 'email bob');
assert.deepStrictEqual(W.tokenize('© 2026 ™ ☀️ fine').filter(Boolean), ['☀️', 'fine']);

// Bigrams only across adjacent non-stop words: "state of emergency" must not yield "state emergency".
const c = W.countTokens(W.tokenize('state of emergency; gas prices and gas prices'));
assert.strictEqual(c.get('gas prices'), 2);
assert.strictEqual(c.get('state emergency'), undefined);
assert.strictEqual(c.get('emergency gas'), undefined);

// --- keyness -----------------------------------------------------------------
assert.ok(W.g2(10, 0, 100, 1000) > 0, 'over-represented term is positive');
assert.ok(W.g2(1, 100, 100, 1000) < 0, 'under-represented term is negative');
assert.strictEqual(W.g2(5, 50, 100, 1000), 0, 'same rate is zero');

const mk = (handle, texts) => texts.map((text, i) => ({ id: handle + i, handle, name: handle, text, time: '2026-09-0' + ((i % 9) + 1) + 'T10:00:00.000Z' }));
const alice = mk('alice', ['Iran regime change now', 'The regime in Iran is collapsing', 'Regime change is coming to Iran', 'Gas prices are up because of Iran', 'Regime regime regime']);
const bob = mk('bob', ['Vibe coding all day with agents', 'Agents are the future of coding', 'Shipping agents and vibe coding', 'Gas prices are a scam', 'coding coding coding']);
const carol = mk('carol', ['Just had a great coffee', 'Coffee and croissants', 'Best coffee in town', 'coffee coffee', 'Iran is in the news']);
const posts = [...alice, ...bob, ...carol];
const counts = posts.map((p) => W.countTokens(W.tokenize(p.text)));
const total = W.aggregate(counts);
assert.strictEqual(total.posts, 15);

const aliceAgg = W.aggregate(counts.slice(0, 5));
const dist = W.topTerms({ target: aliceAgg, total, mode: 'distinctive', max: 5 });
assert.strictEqual(dist.mode, 'distinctive');
assert.ok(['regime', 'iran', 'regime change'].includes(dist.terms[0].term), 'top distinctive word for alice: ' + dist.terms[0].term);
assert.ok(!dist.terms.some((t) => t.term === 'gas prices' && t.rest === 0), 'gas prices is also used by bob');
const freq = W.topTerms({ target: aliceAgg, total, mode: 'frequent', max: 3 });
assert.strictEqual(freq.mode, 'frequent');
// regime: 6 uses minus 2 folded into "regime change" = 4, tying with iran (4); ties break alphabetically.
assert.deepStrictEqual(freq.terms.slice(0, 2).map((t) => t.term + ':' + t.count), ['iran:4', 'regime:4']);
assert.strictEqual(freq.terms[2].term, 'regime change');
// No background → falls back to frequency
assert.strictEqual(W.topTerms({ target: total, total, mode: 'distinctive' }).mode, 'frequent');
// The anchor can be excluded from its own cloud
const noIran = W.topTerms({ target: aliceAgg, total, mode: 'frequent', exclude: (k) => /iran/.test(k) });
assert.ok(!noIran.terms.some((t) => t.term.includes('iran')));

// Collocation: "vibe coding" is kept as a phrase and its uses come out of "vibe" and "coding".
const bobAgg = W.aggregate(counts.slice(5, 10));
const bobFreq = W.topTerms({ target: bobAgg, total, mode: 'frequent', max: 20 });
const vc = bobFreq.terms.find((t) => t.term === 'vibe coding');
assert.ok(vc && vc.count === 2, 'vibe coding kept as a phrase');
assert.ok(!bobFreq.terms.some((t) => t.term === 'vibe'), 'vibe folded into the phrase');
assert.strictEqual(bobFreq.terms.find((t) => t.term === 'coding').count, 4, 'coding: 6 uses minus 2 in the phrase');

// --- co-mentions ---------------------------------------------------------------
const opts = self.XPCSearch.normalize({});
const cm = W.comentions({ posts, anchor: { label: 'iran', pattern: 'iran' }, keywords: [{ label: 'regime', pattern: 'regime' }, { label: 'gas prices', pattern: 'gas prices' }, { label: 'unicorns', pattern: 'unicorns' }], options: opts });
assert.strictEqual(cm.anchor.posts, 5);   // 4 alice + 1 carol (case-insensitive: "Iran")
assert.strictEqual(cm.anchor.authors, 2);
const row = (l) => cm.rows.find((r) => r.label === l);
assert.strictEqual(row('regime').posts, 3);
assert.strictEqual(row('regime').mentions, 3);
assert.strictEqual(row('regime').allPosts, 4);
assert.strictEqual(row('gas prices').posts, 1);
assert.strictEqual(row('gas prices').allPosts, 2);
assert.strictEqual(row('unicorns').posts, 0);
assert.strictEqual(row('unicorns').allPosts, 0, 'a keyword matching nowhere is reported as such');
assert.strictEqual(cm.rows[0].label, 'regime', 'sorted by co-mentioned posts');
assert.ok(Math.abs(row('regime').lift - (3 / 5) / (4 / 15)) < 1e-9);
// Case-sensitive matching finds fewer posts and says so through the counts, never silently
const cs = W.comentions({ posts, anchor: { label: 'iran', pattern: 'iran' }, keywords: [{ label: 'regime', pattern: 'regime' }], options: { ...opts, matchCase: true } });
assert.strictEqual(cs.anchor.posts, 0);
// Auto rows when there are no keywords
const auto = W.comentions({ posts, anchor: { label: 'iran', pattern: 'iran' }, keywords: [], options: opts, auto: ['regime', 'gas prices'] });
assert.ok(auto.auto && auto.rows.length === 2 && auto.rows[0].isRegex);
assert.strictEqual(auto.rows.find((r) => r.label === 'gas prices').allPosts, 2);
// Invalid keyword is reported, not dropped silently
const bad = W.comentions({ posts, anchor: { label: 'iran', pattern: 'iran' }, keywords: [{ label: 'oops', pattern: '(' }], options: opts });
assert.strictEqual(bad.errors.length, 1);

// --- layout --------------------------------------------------------------------
const words = Array.from({ length: 60 }, (_, i) => ({ term: 'word' + i + (i % 3 ? '' : ' phrase'), weight: 60 - i, count: 60 - i, posts: 1, rest: 0 }));
const placed = C.fit(words, { x: 0, y: 0, w: 900, h: 700 }, { minFs: 12, maxFs: 80 });
assert.ok(placed.length >= 55, 'most words fit: ' + placed.length);
for (let i = 0; i < placed.length; i++) {
  const a = placed[i];
  assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 900 && a.y + a.h <= 700, 'inside the box');
  for (let j = i + 1; j < placed.length; j++) {
    const b = placed[j];
    assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `overlap ${a.term} / ${b.term}`);
  }
}
assert.ok(placed[0].fs > placed[placed.length - 1].fs, 'heaviest word is largest');

// --- renderers produce SVG with the numbers on them --------------------------------
const authorsModel = { authors: [{ handle: 'alice', name: 'Alice', posts: 5, words: dist.terms, mode: 'distinctive' }, { handle: 'bob', name: 'Bob', posts: 5, words: bobFreq.terms, mode: 'frequent' }], mode: 'distinctive', term: '', nPosts: 15, nAuthors: 3, from: Date.parse('2026-09-01'), to: Date.parse('2026-09-09') };
const svg1 = C.renderAuthorClouds(authorsModel, { theme: 'light', size: 1080, note: 'Matching: case-insensitive.' });
assert.ok(svg1.startsWith('<svg') && svg1.endsWith('</svg>') && svg1.includes('data-handle="alice"') && svg1.includes('15 posts by 3 authors'));
const svg2 = C.renderTermCloud({ term: 'iran', words: noIran.terms, mode: 'frequent', nPosts: 5, nAuthors: 2, totalPosts: 15, from: null, to: null }, { theme: 'dark' });
assert.ok(svg2.includes('5 of 15 posts by 2 authors mention it') && svg2.includes('class="w"'));
const svg3 = C.renderComentions(cm, { theme: 'light', note: 'Matching: case-insensitive · substring · regex.' });
assert.ok(svg3.includes('matches nowhere') && svg3.includes('class="row"') && svg3.includes('Matching: case-insensitive'));
assert.ok(C.renderTermCloud({ term: '', words: [], mode: 'distinctive', nPosts: 0, nAuthors: 0, totalPosts: 0, from: null, to: null }, {}).includes('Type a term'));
const pinnedSvg = C.renderAuthorClouds({ ...authorsModel, authors: [{ ...authorsModel.authors[1], pinned: true }, authorsModel.authors[0]] }, {});
assert.ok(pinnedSvg.indexOf('data-handle="bob"') < pinnedSvg.indexOf('data-handle="alice"') && pinnedSvg.includes('@bob · 5 posts · chosen'));
const mini = C.renderMiniCloud({ handle: 'alice', name: 'Alice', words: dist.terms, mode: 'distinctive' }, { theme: 'dark' });
assert.ok(mini.startsWith('<svg') && mini.endsWith('</svg>') && mini.includes('class="w"') && mini.includes('data-handle="alice"') && !mini.includes('<rect'));
assert.ok(!C.renderMiniCloud({ handle: 'x', words: [] }).includes('class="w"'));
const csv = C.comentionsCsv(cm);
assert.ok(csv.includes('unicorns,unicorns,0,0.0%,0,0,0.0%,'));

// --- allPattern: posts with every part, in any order; every part highlights --------
{
  const S = self.XPCSearch;
  const src = W.allPattern(['gas', W.wordPattern('mandate', true), 'price']);
  const r = S.compile({ pattern: src, regex: true, unicode: true });
  assert.equal(r.error, null);
  assert.ok(r.regex.test('Price of GAS and the mandate'));
  assert.ok(r.regex.test('mandate first,\nthen gas, then price'));
  assert.ok(!r.regex.test('gas price only'));
  assert.ok(!r.regex.test('gas price mandates'), 'whole-word part stays whole-word');
  assert.deepEqual('the mandate: gas up, price up, gas again'.match(r.regexG), ['mandate', 'gas', 'price', 'gas']);
  assert.equal(W.allPattern(['only']), 'only');
  assert.equal(W.allPattern([]), '');
  assert.equal(W.allPattern(['a', '', null]), 'a');
  // Works under the whole-word option and without the u flag too.
  const ww = S.compile({ pattern: W.allPattern(['cat', 'dog']), regex: true, wholeWord: true });
  assert.ok(ww.regex.test('dog and cat') && !ww.regex.test('dogs and cats'));
  // Long posts stay fast: the start test fails at once away from position 0.
  const long = 'filler word '.repeat(2000) + 'gas';
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) r.regex.test(long);
  assert.ok(Date.now() - t0 < 1000, 'allPattern is not quadratic on long posts');
  // comentions takes a count function in place of the anchor pattern.
  const cmFn = W.comentions({ posts: [{ handle: 'a', text: 'gas mandate' }, { handle: 'b', text: 'gas only' }], anchor: { label: 'gas › mandate', count: (t) => (/gas/.test(t) && /mandate/.test(t) ? 1 : 0) }, keywords: [{ label: 'gas', pattern: 'gas' }], options: {} });
  assert.equal(cmFn.anchor.posts, 1);
  assert.equal(cmFn.anchor.valid, true);
  assert.equal(cmFn.rows[0].posts, 1);
  assert.equal(cmFn.rows[0].allPosts, 2);
}

console.log('words.test.js: all checks passed');
