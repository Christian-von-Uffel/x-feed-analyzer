// test/network.test.js — checks for network.js (interaction graph model, layout, SVG, CSV).
//   node test/network.test.js
const assert = require('assert');
globalThis.self = globalThis;
require('../search.js');
require('../matrix.js');
require('../words.js');
require('../clouds.js');
require('../network.js');
const N = self.XPCNetwork;

const post = (id, handle, extra = {}) => ({ id: String(id), handle, name: handle[0].toUpperCase() + handle.slice(1), text: '', time: `2026-09-${String((id % 20) + 1).padStart(2, '0')}T10:00:00.000Z`, ...extra });
const posts = [
  post(1, 'carol', { isQuote: true, quotedHandle: 'dave', quotedName: 'Dave D', quotedText: 'orig' }),
  post(2, 'carol', { isQuote: true, quotedHandle: 'dave' }),
  post(3, 'erin', { isReply: true, replyTo: ['alice', 'Dave'], mentions: ['alice', 'frank'] }),
  post(4, 'carol', { isRepost: true, repostedBy: 'bob' }),
  post(5, 'alice', { mentions: ['alice', 'Frank'] }),         // self-mention dropped
  post(6, 'alice', { isQuote: true, quotedHandle: 'Alice' }),  // self-quote dropped
  post(7, 'grace'),
];
// Reposters read from the post's /retweets page, alongside the timeline's "X reposted" line.
const reposted = post(8, 'grace', { isRepost: true, repostedBy: 'bob', reposters: ['Bob', 'carol', 'grace'] });

// --- edgesOf --------------------------------------------------------------------
const all = new Set(['quote', 'reply', 'repost', 'mention']);
assert.deepStrictEqual(N.edgesOf(posts[0], all), [{ from: 'carol', to: 'dave', type: 'quote' }]);
assert.deepStrictEqual(N.edgesOf(posts[2], all), [
  { from: 'erin', to: 'alice', type: 'reply' }, { from: 'erin', to: 'Dave', type: 'reply' }, { from: 'erin', to: 'frank', type: 'mention' },
], 'reply targets are not counted again as mentions');
assert.deepStrictEqual(N.edgesOf(posts[3], all), [{ from: 'bob', to: 'carol', type: 'repost' }], 'reposter → author');
assert.deepStrictEqual(N.edgesOf(posts[4], all), [{ from: 'alice', to: 'Frank', type: 'mention' }]);
assert.deepStrictEqual(N.edgesOf(posts[5], all), []);
assert.deepStrictEqual(N.edgesOf(reposted, all), [{ from: 'bob', to: 'grace', type: 'repost' }, { from: 'carol', to: 'grace', type: 'repost' }], 'one repost edge per reposter, deduplicated with repostedBy, self dropped');
assert.deepStrictEqual(N.edgesOf(posts[2], new Set(['quote'])), []);

// --- build ------------------------------------------------------------------------
const m = N.build({ posts, types: ['quote', 'reply', 'repost', 'mention'] });
assert.strictEqual(m.nPosts, 7);
assert.strictEqual(m.nInteractions, 7);
assert.strictEqual(m.ranking[0].handle, 'dave', 'dave receives the most (2 quotes + 1 reply)');
assert.strictEqual(m.ranking[0].received, 3);
assert.strictEqual(m.ranking[0].in.quote, 2);
assert.strictEqual(m.ranking[0].name, 'Dave D', 'name taken from the quote card');
assert.strictEqual(m.ranking[0].captured, false, 'dave has no posts of his own in the set');
const carol = m.ranking.find((n) => n.handle === 'carol');
assert.strictEqual(carol.sent, 2);
assert.strictEqual(carol.received, 1);
assert.strictEqual(carol.posts, 3);
assert.ok(!m.ranking.some((n) => n.handle === 'grace'), 'accounts without interactions are not ranked');
assert.strictEqual(m.nAccounts, 6);
const cd = m.allEdges.find((e) => e.fromHandle === 'carol' && e.toHandle === 'dave');
assert.strictEqual(cd.count, 2);
assert.deepStrictEqual(cd.ids, ['1', '2'], 'every connection keeps the ids of the posts behind it');
assert.strictEqual(m.allEdges[0], cd, 'heaviest connection first');
assert.strictEqual(m.nodes.length, 6);
assert.strictEqual(m.edges.length, 6);
// Drawn edges point at node indexes.
for (const e of m.edges) {
  assert.strictEqual(m.nodes[e.from].handle, e.fromHandle);
  assert.strictEqual(m.nodes[e.to].handle, e.toHandle);
}

// Types off → those edges gone.
const q = N.build({ posts, types: ['quote'] });
assert.strictEqual(q.nInteractions, 2);
assert.deepStrictEqual(q.types, ['quote']);
assert.strictEqual(q.nodes.length, 2);

// minWeight prunes light connections; the ranking still counts everything.
const heavy = N.build({ posts, minWeight: 2 });
assert.strictEqual(heavy.edges.length, 1);
assert.strictEqual(heavy.nodes.length, 2);
assert.strictEqual(heavy.nAccounts, 6);
assert.ok(heavy.ranking.find((n) => n.handle === 'erin').drawn === false);

// maxNodes keeps the most interacted-with accounts and drops edges to the rest.
const small = N.build({ posts, maxNodes: 2 });
assert.deepStrictEqual(small.nodes.map((n) => n.handle).sort(), ['carol', 'dave']);

// Focus: the ego network, case-insensitively.
const ego = N.build({ posts, focus: 'ALICE' });
assert.strictEqual(ego.focus, 'alice');
assert.deepStrictEqual(ego.nodes.map((n) => n.handle).sort(), ['alice', 'erin', 'frank'], 'a handle keeps the spelling it was first seen with');
assert.ok(ego.edges.every((e) => e.fromHandle === 'alice' || e.toHandle === 'alice' || (e.fromHandle === 'erin' && e.toHandle === 'frank')), 'edges among neighbours stay');
const missing = N.build({ posts, focus: 'nobody' });
assert.strictEqual(missing.focusMissing, true);
assert.strictEqual(missing.nodes.length, 0);

// --- layout -----------------------------------------------------------------------
const box = N.plotBox(1080);
N.layout(m, box);
for (const n of m.nodes) {
  assert.ok(n.r >= 7 && n.r <= 30, 'radius in range: ' + n.r);
  assert.ok(n.x >= box.x && n.x <= box.x + box.width, 'x inside box: ' + n.x);
  assert.ok(n.y >= box.y && n.y <= box.y + box.height, 'y inside box: ' + n.y);
}
const dave = m.nodes.find((n) => n.handle === 'dave');
assert.ok(m.nodes.every((n) => n.r <= dave.r), 'the most quoted account is the biggest');
for (let i = 0; i < m.nodes.length; i++) {
  for (let j = i + 1; j < m.nodes.length; j++) {
    const a = m.nodes[i]; const b = m.nodes[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, `nodes ${a.handle} and ${b.handle} do not overlap`);
  }
}
// Deterministic.
const m2 = N.layout(N.build({ posts }), box);
assert.deepStrictEqual(m2.nodes.map((n) => [n.handle, n.x, n.y]), m.nodes.map((n) => [n.handle, n.x, n.y]));

// --- svg --------------------------------------------------------------------------
const svg = N.renderSvg(m, { theme: 'light', size: 1080 });
assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
assert.ok(svg.includes('data-handle="dave"') && svg.includes('@dave'));
assert.ok(svg.includes('data-from="carol" data-to="dave"'));
assert.ok(svg.includes('quotes 2') && svg.includes('replies 2') && svg.includes('reposts 1') && svg.includes('mentions 2'), 'legend counts every type');
assert.ok(svg.includes('7 interactions between 6 accounts'));
assert.ok(svg.includes('Counts only what one person scrolled past'));
assert.ok(svg.includes('class="node focus"') === false);
const focusSvg = N.renderSvg(N.layout(ego, box), { theme: 'dark', size: 1080, title: 'T' });
assert.ok(focusSvg.includes('class="node focus"'));
assert.ok(N.renderSvg(missing, { size: 1080 }).includes('@nobody has no interactions'));
assert.ok(N.renderSvg(N.build({ posts: [] }), { size: 1080 }).includes('No interactions'));
// Every path is well-formed and every arrow marker exists.
const paths = svg.match(/ d="([^"]+)"/g) || [];
assert.ok(paths.length >= 12, 'hit + line path per edge');
assert.ok(paths.every((p) => /M-?[\d.]+ -?[\d.]+ Q-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+/.test(p) || p.includes('M0 0 L10 5')), 'paths are quadratic curves');
for (const t of N.TYPES) assert.ok(svg.includes(`id="nw-arrow-${t.key}"`));

// --- csv --------------------------------------------------------------------------
const csv = N.accountsCsv(m).split('\r\n');
assert.strictEqual(csv[0], '﻿name,handle,posts,received,quoted,replied_to,reposted,mentioned,sent,quotes_sent,replies_sent,reposts_sent,mentions_sent,in_catalogue,drawn');
assert.strictEqual(csv[1], 'Dave D,dave,0,3,2,1,0,0,0,0,0,0,0,0,1');
const ecsv = N.edgesCsv(m).split('\r\n');
assert.strictEqual(ecsv[0], '﻿from,to,type,posts');
assert.strictEqual(ecsv[1], 'carol,dave,quote,2');
assert.strictEqual(ecsv.length, 7);

console.log('network.test.js: all checks passed');
