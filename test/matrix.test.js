// test/matrix.test.js — checks for the author × keyword matrix (matrix.js), in particular the
// silence cue: a zero that the author's volume and the keyword's overall rate would not predict.
//   node test/matrix.test.js
const assert = require('assert');
globalThis.self = globalThis;
require('../search.js');
require('../matrix.js');
const M = self.XPCMatrix;

const mk = (handle, n, text) => Array.from({ length: n }, (_, i) => ({ id: `${handle}-${i}`, handle, name: handle.toUpperCase(), text: typeof text === 'function' ? text(i) : text, time: '2026-09-01T00:00:00Z' }));
const posts = [
  ...mk('alice', 40, (i) => (i < 20 ? 'gas prices again' : 'weather')), // 20 of 40 mention gas
  ...mk('bob', 40, (i) => (i < 2 ? 'oil is up' : 'sports')),            // never gas, oil twice
  ...mk('carol', 2, 'nothing'),                                           // too few posts to expect anything
  ...mk('dave', 40, 'nothing at all'),                                    // silent on both
];
const model = M.build({ posts, keywords: M.parseKeywords('gas\noil'), options: { regex: false }, metric: 'posts', maxRows: 12, minPosts: 1 });
const col = (label) => model.cols.findIndex((c) => c.label === label);
const row = (handle) => model.rows.find((r) => r.handle === handle);

assert.strictEqual(col('gas'), 0, 'densest column first');
assert.ok(!row('alice').silent[col('gas')], 'alice mentions gas');
assert.ok(row('bob').silent[col('gas')], 'bob never mentions gas though 40 posts at the overall rate would');
assert.ok(!row('bob').silent[col('oil')], 'bob mentions oil');
assert.ok(!row('carol'), 'carol has no hits and too few posts to be silent');
assert.ok(row('dave') && row('dave').total === 0 && row('dave').silent[col('gas')], 'dave is kept for the silence alone');
assert.ok(!row('dave').silent[col('oil')], 'oil is too rare overall to expect from dave');
assert.ok(Math.abs(row('bob').expected[col('gas')] - (20 / 122) * 40) < 0.1, 'expected = overall rate × posts');
assert.strictEqual(model.nSilent, 2);
assert.strictEqual(model.silenceMin, 3);

const svg = M.renderSvg(model, { theme: 'light', size: 1080 });
assert.strictEqual((svg.match(/class="cell silent"/g) || []).length, 2, 'two dashed cells');
assert.ok(svg.includes('unusually silent'), 'the footer explains the cue');
// The row cap keeps the dense rows and still appends the silent ones, most unexpected first.
const capped = M.build({ posts, keywords: M.parseKeywords('gas\noil'), options: { regex: false }, maxRows: 1 });
assert.deepStrictEqual(capped.rows.map((r) => r.handle), ['alice', 'bob', 'dave'], 'one dense row, then the silent rows');
assert.strictEqual(capped.silentExtra, 2);
const one = M.build({ posts, keywords: M.parseKeywords('gas\noil'), options: { regex: false }, maxRows: 2 });
assert.deepStrictEqual(one.rows.map((r) => r.handle), ['alice', 'bob', 'dave'], 'bob is dense (oil) and dave is appended');
assert.strictEqual(one.silentExtra, 1);

const none = M.build({ posts: posts.slice(0, 40), keywords: M.parseKeywords('gas'), options: { regex: false } });
assert.strictEqual(none.nSilent, 0);
assert.ok(!M.renderSvg(none, { theme: 'dark' }).includes('unusually silent'), 'no cue when nothing is silent');
console.log('matrix.test.js: all checks passed');
