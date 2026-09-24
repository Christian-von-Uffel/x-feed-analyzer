// test/coord.test.js — checks for coord.js (coordination evidence for a topic). Run: node test/coord.test.js
// Push fixtures are posts from the IRA's #KochFarms (Nov 2015) and #PhosphorusDisaster (Mar 2015)
// hoaxes, from the FiveThirtyEight / Clemson release of the handles Twitter gave Congress.
const assert = require('node:assert/strict');
globalThis.self = globalThis;
require('../search.js');
require('../words.js');
require('../coord.js');
const C = self.XPCCoord;

const at = (hhmmss) => `2015-11-26T${hhmmss}.000Z`;
let id = 0;
const post = (handle, time, text, extra = {}) => ({ id: String(++id), handle, time, text, ...extra });

// --- text ---------------------------------------------------------------------------
assert.deepEqual(C.tokens('OMG @bob scary #Turkey https://t.co/x #KochFarms'), ['omg', 'scary', 'turkey', 'kochfarms']);
assert.deepEqual(C.tokens('OMG scary #Turkey #KochFarms', new Set(['kochfarms'])), ['omg', 'scary', 'turkey'], 'topic words ignored');
assert.deepEqual(C.hashtags('#DogThanking These people deserved it. #vegan #KochFarms &#39;'), ['dogthanking', 'vegan', 'kochfarms']);

// credit markers: the post says where its words came from
assert.ok(C.credited('R.I.P. The beloved angel has passed away. (via @PerezHilton)'));
assert.ok(C.credited('RT @oxfordgirl Friday prayer rally is cancelled'));
assert.ok(C.credited('(@kevlar33) Note to self: are we not doing any more note to self anymore?'));
assert.ok(!C.credited('wooow RT! Don’t eat fucking #Turkey from #KochFarms'), '"RT!" names no source');
assert.ok(!C.credited('@SenAngusKing should we be afraid of the water contamination with phosphorus?'), 'addressing is not crediting');

// links: scheme, www and ellipsis dropped; a post's own photo is not a shared link
assert.equal(C.linkKey('https://www.fox-news.ga/idaho…'), 'fox-news.ga/idaho');
assert.equal(C.linkKey('https://twitter.com/zubovnik/status/643332738230165504/photo/1', '643332738230165504'), null);
assert.equal(C.linkKey('https://twitter.com/other/status/1/photo/1', '2'), 'x.com/other/status/1');
assert.equal(C.linkKey('https://t.co/abc'), null);
assert.equal(C.linkKey('http://tweet.sg'), null, 'a bare domain (an app signature, or a link card captured as its domain) is not a shared item');
assert.equal(C.linkKey('nytimes.com/'), null);

// --- copy groups -------------------------------------------------------------------------
{
  const rows = C.prepare([
    post('christinacrisss', at('23:16:25'), '#DogThanking These people deserved it. #vegan #KochFarms #FSIS #NewYork #FoodPoisoning #Turkey'),
    post('barelybarboza', at('00:46:19'), '#DogThanking These people deserved it. #vegan #KochFarms #FSIS #Turkey https://t.co/ChuNvGvUZ3'),
    post('deborah_norris_', at('01:19:27'), '@problogger OMG  These people deserved it. #vegan #KochFarms #FSIS #Turkey'),
    post('a', at('10:00:00'), 'Good morning everyone, have a great day'),
    post('b', at('10:00:05'), 'Good morning everyone, have a great day'),
    post('c', at('10:00:00'), 'Why #KochFarms think that they can kill innocent people?! That’s awful!'),
  ], { ignore: ['kochfarms', 'foodpoisoning'] });
  const cg = C.copyGroups(rows);
  const g = cg.groupOf[0];
  assert.ok(g >= 0 && cg.groupOf[1] === g && cg.groupOf[2] === g, 'light edits of one template form one group');
  assert.equal(cg.groupOf[5], -1, 'a different text stays out');
  assert.equal(cg.groupOf[3], -1, 'a short greeting cannot link strangers (too few content words)');
  assert.equal(cg.groups[g].accounts.size, 3);
}

// --- co-action and repeat pairs ----------------------------------------------------------------
{
  // Fans copying one celebrity post: the same text and the same link from one post is one event.
  const fans = C.prepare([
    post('fan1', at('16:45:00'), 'R.I.P. Farrah Fawcett, the beloved angel has passed away today, so sad', { links: ['bit.ly/DVCgs'] }),
    post('fan2', at('16:47:00'), 'R.I.P. Farrah Fawcett, the beloved angel has passed away today, so sad', { links: ['bit.ly/DVCgs'] }),
  ]);
  const m1 = C.measure(fans, C.traces(fans, C.copyGroups(fans)), 3600000);
  assert.equal(m1.accounts, 1, 'both co-acted');
  assert.equal(m1.repeatPairs, 0, 'one copied post is not a repeat, even with a text and a link');

  // Two accounts copying two different templates within the hour do repeat.
  const ring = C.prepare([
    post('pruitt_li', at('23:20:00'), 'Holy hell! That is scary! Walmart turkey from New York again, stay away'),
    post('tammy_tamh', at('23:24:00'), 'Holy hell! That is scary! Walmart turkey from New York again, stay away'),
    post('pruitt_li', at('23:31:00'), 'Who knows where can I buy normal turkey this year? Walmart is selling poison'),
    post('tammy_tamh', at('23:40:00'), 'Who knows where can I buy normal turkey this year? Walmart is selling poison'),
    post('dd_merr', at('23:59:00'), 'Who knows where can I buy normal turkey this year? Walmart is selling poison'),
  ]);
  const items = C.traces(ring, C.copyGroups(ring));
  const m2 = C.measure(ring, items, 3600000);
  assert.equal(m2.repeatPairs, 1, 'pruitt_li and tammy_tamh repeat; dd_merr joined once');
  assert.deepEqual(m2.clusters[0].accounts, ['pruitt_li', 'tammy_tamh']);
  assert.equal(C.measure(ring, items, 60000).repeatPairs, 0, 'minutes apart: nothing within one minute');

  // Credited copies are open sharing and stay out of the traces.
  const open = C.prepare([
    post('source', at('20:31:00'), 'Confirmed: Friday prayer rally is cancelled, but this is coming late', { links: ['bit.ly/aU2F7'] }),
    post('relay', at('20:36:00'), 'RT @source Confirmed: Friday prayer rally is cancelled, but this is coming late', { links: ['bit.ly/aU2F7'] }),
  ]);
  assert.equal(C.traces(open, C.copyGroups(open)).length, 0);
}

// --- copies aimed at people ------------------------------------------------------------------------
{
  const q = 'should we be afraid of the water contamination with phosphorus? They say it`s massive!!';
  const rows = C.prepare([
    post('acejinev', '2015-03-10T20:47:21Z', '@CaptWG ' + q, { replyTo: ['CaptWG'] }),
    post('ryanmaxwell_1', '2015-03-10T20:54:52Z', '@PullmanRegional ' + q, { replyTo: ['PullmanRegional'] }),
    post('lelandgraves_', '2015-03-10T21:33:49Z', '@SenAngusKing ' + q, { replyTo: ['SenAngusKing'] }),
    post('k1', at('23:20:00'), '@NYCGetInsured Turkey this year is not just news #Walmart #Turkey #USDA', { replyTo: ['NYCGetInsured'] }),
    post('k2', at('23:21:00'), '@NYCGetInsured Turkey this year is not just news #Walmart #Turkey #USDA', { replyTo: ['NYCGetInsured'] }),
    post('k3', at('23:25:00'), '@NYCGetInsured Turkey this year is not just news #Walmart #Turkey #USDA', { replyTo: ['NYCGetInsured'] }),
  ], { ignore: ['phosphorus'] });
  const a = C.aimed(rows, C.copyGroups(rows));
  assert.equal(a.templatedGroups, 1, 'one question put to three different accounts');
  assert.equal(a.templatedTargets, 3);
  assert.equal(a.swarmedTargets, 1, 'three accounts sent one text to @nycgetinsured');
  assert.equal(a.targets, 4);
}

// --- concentration and look-alike handles ---------------------------------------------------------------
{
  const rows = C.prepare([
    ...[0, 7, 15, 30, 55].map((m) => post('jasper_fly', `2014-12-14T00:${String(m).padStart(2, '0')}:00Z`, 'Ebola in Atlanta, post ' + m)),
    post('someone', '2014-12-14T00:10:00Z', 'Is this true about Atlanta?'),
    post('someone', '2014-12-14T03:10:00Z', 'Still nothing from the hospital.'),
  ]);
  const c = C.concentration(rows);
  assert.deepEqual(c.heavyAccounts, ['jasper_fly'], 'five posts inside an hour');
  assert.equal(c.topAccountShare, 5 / 7);
  assert.equal(c.accounts, 2);
}
assert.deepEqual(C.lookalikes(['jenne191', 'jenne493', 'jenne669', 'pwau_sydney', 'alice']), [['jenne191', 'jenne493', 'jenne669']]);
assert.deepEqual(C.lookalikes(['martines_tweets', 'pruitt_li', 'tammy_tamh']), [], 'campaign personas need not look alike');

// --- report ------------------------------------------------------------------------------------------------
{
  const texts = ['Holy hell! That is scary! Walmart turkey from New York again, stay away', 'Who knows where can I buy normal turkey this year? Walmart is selling poison', 'Vomiting is not the best way to spend Thanksgiving with the family #fail'];
  const posts = [];
  ['pruitt_li', 'tammy_tamh', 'dd_merr'].forEach((h, k) => texts.forEach((t, j) => posts.push(post(h, at(`23:${String(10 + j * 12 + k * 3).padStart(2, '0')}:00`), t))));
  posts.push(post('bystander', at('23:30:00'), 'Has anyone else heard anything about the turkey story? Sounds made up to me'));
  const r = C.report(posts);
  assert.equal(r.posts, 10);
  assert.equal(r.copy.groups3, 3);
  assert.equal(r.copy.share, 9 / 10, 'nine of ten eligible posts copy another account');
  assert.deepEqual(r.copy.gapBands, { minute: 0, tenMinutes: 3, hour: 0, longer: 0 });
  assert.deepEqual(r.windows.map((w) => w.repeatPairs), [0, 3, 3], 'no pair within a minute; all three pairs within ten');
  assert.equal(r.windows[2].repeatAccounts, 3 / 4);
  assert.equal(r.timeline.hours.length, 1);
}

console.log('coord.test.js: all checks passed');
