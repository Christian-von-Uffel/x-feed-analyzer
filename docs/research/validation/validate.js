// Reproduces the numbers in docs/research/coordination-validation.md with the repo's coord.js.
//   python3 extract.py <work dir>
//   node --max-old-space-size=12000 validate.js <work dir>
// Prints: a scorecard per case, the capture-density table for the three pushes, and, for all of
// Sentiment140, the copy groups posted by 3+ accounts within a minute and the repeat clusters
// (both listed so the labels in the write-up can be checked or redone).
globalThis.self = globalThis;
const path = require('path');
const fs = require('fs');
const REPO = path.join(__dirname, '..', '..', '..');
require(path.join(REPO, 'search.js'));
require(path.join(REPO, 'words.js'));
require(path.join(REPO, 'coord.js'));
const C = self.XPCCoord;
const work = process.argv[2] || '.';
const load = (k) => JSON.parse(fs.readFileSync(path.join(work, 'cases', k + '.json'), 'utf8')).filter((p) => !p.isRepost);
const pc = (x) => (100 * x).toFixed(1) + '%';

const CASES = [
  ['ira_koch', 'kochfarms,foodpoisoning,koch,farms,food,poisoning', 'push'],
  ['ira_phosphorus', 'phosphorusdisaster,phosphorus', 'push'],
  ['ira_ebola_atl', 'ebolainatlanta,ebola,atlanta', 'push'],
  ['s140_airfrance', 'air,france,airfrance', 'news'],
  ['s140_farrah', 'farrah,fawcett', 'news'],
  ['s140_carradine', 'david,carradine', 'news'],
  ['s140_mtvawards', 'mtv,movie,awards,mtvawards', 'scheduled'],
  ['s140_iran', 'iran,iranelection', 'news, activism'],
  ['s140_squarespace', 'squarespace', 'contest'],
  ['s140_followfriday', 'followfriday,ff', 'ritual'],
];

console.log('\n== Scorecards ==');
for (const [k, ig, kind] of CASES) {
  const r = C.report(load(k), { ignore: ig.split(',') });
  const w = r.windows;
  console.log(`${k.padEnd(18)} ${kind.padEnd(14)} posts ${r.posts} accounts ${r.accounts} per account ${r.postsPerAccount.toFixed(2)} top account ${pc(r.topAccountShare)} ` +
    `heavy ${r.heavyAccounts.length} (${pc(r.heavyShare)} of posts) median gap ${r.medianGap === null ? '-' : Math.round(r.medianGap / 1000) + ' s'} | ` +
    `copies ${pc(r.copy.share)} credited ${r.copy.credited} groups of 3+ ${r.copy.groups3} timing ${JSON.stringify(r.copy.gapBands)} | ` +
    `templated ${r.aimed.templatedGroups} to ${r.aimed.templatedTargets} targets, swarmed ${r.aimed.swarmedTargets} | ` +
    `repeat accounts 1 min ${pc(w[0].repeatAccounts)} 10 min ${pc(w[1].repeatAccounts)} 1 h ${pc(w[2].repeatAccounts)}, clusters ${w[2].clusters.map((c) => c.accounts.length).join(',') || '-'}`);
}

console.log('\n== Capture density: share of 40 random captures in which each signal clears its line ==');
let seed = 12345;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const [k, ig] of CASES.filter((c) => c[2] === 'push')) {
  const all = load(k);
  for (const rate of [1, 0.5, 0.25, 0.1, 0.05, 1 / 45]) {
    const trials = [];
    for (let t = 0; t < (rate === 1 ? 1 : 40); t++) {
      const sub = all.filter(() => rand() < rate);
      trials.push(sub.length >= 20 ? C.report(sub, { ignore: ig.split(','), windows: [3600000] }) : null);
    }
    const P = (f) => (trials.filter((r) => r && f(r)).length / trials.length).toFixed(2);
    const repeat = (r) => r.windows[0].clusters.some((c) => c.accounts.length >= 3);
    console.log(`${k} at ${(100 * rate).toFixed(1)}%: heavy>=3 ${P((r) => r.heavyAccounts.length >= 3)} top>=25% ${P((r) => r.topAccountShare >= 0.25)} ` +
      `copies>=20% ${P((r) => r.copy.share >= 0.2)} aimed ${P((r) => r.aimed.templatedGroups + r.aimed.swarmedTargets >= 2)} repeat cluster ${P(repeat)} | ` +
      `any ${P((r) => r.heavyAccounts.length >= 3 || r.topAccountShare >= 0.25 || r.copy.share >= 0.2 || repeat(r))}`);
  }
}

console.log('\n== Sentiment140: copy groups by 3+ accounts, and repeat clusters ==');
const rows = C.prepare(JSON.parse(fs.readFileSync(path.join(work, 'cases', 's140_all.json'), 'utf8')));
const copies = C.copyGroups(rows);
const bands = { minute: [], tenMinutes: 0, hour: 0, longer: 0 };
for (const g of copies.groups) {
  if (g.accounts.size < 3) continue;
  const gap = C.copyGap(rows, g);
  if (gap <= 60000) bands.minute.push(g);
  else if (gap <= 600000) bands.tenMinutes++;
  else if (gap <= 3600000) bands.hour++;
  else bands.longer++;
}
console.log(`accounts ${new Set(rows.map((r) => r.acct)).size}; copy groups by 3+ accounts whose copies sit within 1 min of another account's: ${bands.minute.length}; 1–10 min ${bands.tenMinutes}; 10–60 min ${bands.hour}; longer ${bands.longer}`);
bands.minute.sort((a, b) => b.accounts.size - a.accounts.size).forEach((g, i) => console.log(`  ${i + 1}. ${g.accounts.size} accounts | ${[...g.accounts].slice(0, 3).join(', ')} | ${rows[g.members[0]].post.text.replace(/\s+/g, ' ').slice(0, 80)}`));
const m = C.measure(rows, C.traces(rows, copies), 3600000);
const big = m.clusters.filter((c) => c.accounts.length >= 3);
console.log(`repeat pairs within 1 h: ${m.repeatPairs}; clusters ${m.clusters.length}, of which ${big.length} have 3+ accounts (${big.filter((c) => c.lookalikes.length).length} with look-alike handles)`);
big.forEach((c, i) => console.log(`  ${i + 1}. ${c.accounts.length} accounts | ${c.accounts.slice(0, 4).join(', ')}`));
