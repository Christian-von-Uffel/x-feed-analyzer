// coord.js — coordination evidence for one topic: which accounts left the same trace (the same or
// nearly the same text, the same link, the same set of hashtags) close together in time, which of
// them did so again and again, and how much of the topic a few accounts produced. Pure functions
// over catalogue posts; nothing here touches the DOM. Uses XPCWords.STOPWORDS when words.js is
// loaded.
//
// Every measure here was checked against three proven pushes (IRA hoaxes, 2014–15) and ordinary
// 2009 Twitter (Sentiment140); docs/research/coordination-validation.md has the numbers. In short:
//   - copies of the same text by three or more accounts within a minute were almost all spam
//     networks or several accounts with one owner, but the human-run pushes spaced their copies
//     minutes apart, so the report gives 1 min, 10 min and 1 h side by side;
//   - at 10 min to 1 h ordinary people also post the same words (holiday greetings, contests,
//     a celebrity's post copied by fans), so a copy alone is weak; what separated the pushes was
//     the same pair of accounts co-acting on two or more different posts ("repeat pairs");
//   - copies that credit their source ("via @x", "RT @x", "(@x)") are open sharing and are kept
//     out of the co-action;
//   - timing measured against reshuffled times, and how fast accounts arrive, did not separate
//     pushes from news, so they are not here.
// Nothing here says who is fake or paid. It measures coordination, which open campaigns, fans and
// outlets with one owner also show.
(function (root) {
  'use strict';

  const MIN = 60000;
  const HOUR = 60 * MIN;
  const WINDOWS = [MIN, 10 * MIN, HOUR];
  const stop = () => (root.XPCWords && root.XPCWords.STOPWORDS) || new Set();
  const pct = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  // Words of a post for copy matching: links and @mentions removed, hashtags kept as words,
  // lower-cased. `ignore` drops the words that define the topic (every post has them).
  function tokens(text, ignore = null) {
    const s = String(text || '')
      .replace(/https?:\/\/\S+|\b(?:pic\.twitter\.com|t\.co)\/\S+/gi, ' ')
      .replace(/(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]+/gu, '$1 ')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[’‘`´]/g, "'")
      .toLowerCase();
    const out = s.match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) || [];
    return ignore && ignore.size ? out.filter((w) => !ignore.has(w)) : out;
  }

  const hashtags = (text) => Array.from(String(text || '').toLowerCase().matchAll(/(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu), (m) => m[1]);

  // A post that names where its words came from: "via @x", "RT @x", "h/t @x", "(@x)".
  const CREDIT_RE = /(?:^|[^\p{L}\p{N}_])(?:via|rt|h\/t|ht|hat tip)\s*:?\s*@[\p{L}\p{N}_]+|\(@[\p{L}\p{N}_]+\)/iu;
  const credited = (text) => CREDIT_RE.test(String(text || ''));

  // A link as a trace key: no scheme, no "www.", no trailing slash or ellipsis. A post's own photo
  // or video (x.com/<author>/status/<own id>/photo/1) is not a shared link, and neither is a bare
  // domain: some apps append theirs to every post (tweet.sg in 2009), and a link card on X is
  // captured as its domain alone, so "nytimes.com" would join everyone who shared any article.
  function linkKey(link, ownId = null) {
    let s = String(link || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[……]+$/, '').replace(/\/+$/, '');
    if (!s) return null;
    if (/^(?:mobile\.)?(?:twitter|x)\.com\//.test(s)) {
      if (ownId && s.includes('/status/' + ownId)) return null;
      s = s.replace(/^mobile\./, '').replace(/^twitter\.com/, 'x.com').replace(/\/(?:photo|video)\/\d+$/, '');
    }
    if (/^(?:pic\.twitter\.com|t\.co)\//.test(s)) return null;
    return s.includes('/') ? s : null;
  }

  // ---------------------------------------------------------------------------
  // Near-duplicate groups: MinHash with banded LSH, confirmed on the shingle sets
  // ---------------------------------------------------------------------------

  const K = 48;
  const BANDS = 12;
  const ROWS = K / BANDS;

  function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const SEEDS = Array.from({ length: K }, (_, i) => hash32('xpc-seed-' + i));
  function mix(x, seed) {
    let h = (x ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function shingles(words, k = 3) {
    const out = new Set();
    for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(' '));
    return out;
  }

  // Copies or light edits: Jaccard of the shingle sets, or most of the shorter post contained in
  // the longer one (a copy given a new opening line, or trimmed).
  function similar(a, b, { jaccard = 0.5, containment = 0.8 } = {}) {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let inter = 0;
    for (const x of small) if (large.has(x)) inter++;
    if (!inter) return false;
    if (inter / (a.size + b.size - inter) >= jaccard) return true;
    return small.size >= 4 && inter / small.size >= containment;
  }

  // Groups of posts that are copies or light edits of each other. A post takes part when it has
  // at least `minWords` words and three content words, so "good morning" and a row of hashtags
  // cannot link strangers. Returns { groupOf (row index → group index or -1), groups }.
  function copyGroups(rows, { minWords = 6, jaccard = 0.5, containment = 0.8 } = {}) {
    const S = stop();
    const parent = rows.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const buckets = new Map();
    for (const r of rows) {
      const content = r.words.filter((w) => w.length > 2 && !S.has(w)).length;
      r.sh = r.words.length >= minWords && content >= 3 ? shingles(r.words) : null;
      if (!r.sh || !r.sh.size) continue;
      const sig = new Uint32Array(K).fill(0xffffffff);
      for (const s of r.sh) {
        const x = hash32(s);
        for (let k = 0; k < K; k++) { const v = mix(x, SEEDS[k]); if (v < sig[k]) sig[k] = v; }
      }
      for (let b = 0; b < BANDS; b++) {
        const key = b + ':' + Array.prototype.join.call(sig.subarray(b * ROWS, (b + 1) * ROWS), ',');
        const list = buckets.get(key);
        if (list) list.push(r.i); else buckets.set(key, [r.i]);
      }
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      // Check each member against the first few of its bucket rather than every pair, so a
      // template posted 2,000 times costs 2,000 checks, not two million.
      for (let j = 1; j < list.length; j++) {
        for (let h = 0; h < Math.min(j, 4); h++) {
          const a = list[j];
          const b = list[h];
          if (find(a) === find(b)) break;
          if (similar(rows[a].sh, rows[b].sh, { jaccard, containment })) { parent[find(a)] = find(b); break; }
        }
      }
    }
    const byRoot = new Map();
    for (const r of rows) {
      if (!r.sh) continue;
      const g = find(r.i);
      const list = byRoot.get(g);
      if (list) list.push(r.i); else byRoot.set(g, [r.i]);
    }
    const groupOf = new Int32Array(rows.length).fill(-1);
    const groups = [];
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      const id = groups.length;
      members.sort((a, b) => rows[a].t - rows[b].t);
      for (const i of members) groupOf[i] = id;
      groups.push({ id, members, accounts: new Set(members.map((i) => rows[i].acct)) });
    }
    return { groupOf, groups };
  }

  // The median, over a group's posts, of the time to the nearest copy by another account.
  function copyGap(rows, group) {
    const ms = group.members;
    const near = [];
    for (let k = 0; k < ms.length; k++) {
      const r = rows[ms[k]];
      let best = Infinity;
      for (let j = k - 1; j >= 0; j--) if (rows[ms[j]].acct !== r.acct) { best = r.t - rows[ms[j]].t; break; }
      for (let j = k + 1; j < ms.length; j++) if (rows[ms[j]].acct !== r.acct) { best = Math.min(best, rows[ms[j]].t - r.t); break; }
      if (best < Infinity) near.push(best);
    }
    return pct(near, 0.5);
  }

  // ---------------------------------------------------------------------------
  // Traces and co-action
  // ---------------------------------------------------------------------------

  // One row per post with what the measures need. `ignore` is the topic's own words and hashtags.
  function prepare(posts, { ignore = [] } = {}) {
    const ig = new Set(Array.from(ignore, (w) => String(w).toLowerCase().replace(/^#/, '')));
    const rows = [];
    for (const p of posts) {
      const t = new Date(p.time).getTime();
      const acct = String((p && p.handle) || '').toLowerCase();
      if (!acct || !Number.isFinite(t)) continue;
      const tags = Array.from(new Set(hashtags(p.text).filter((h) => !ig.has(h)))).sort();
      rows.push({
        i: rows.length, post: p, t, acct,
        words: tokens(p.text, ig),
        credited: credited(p.text),
        tagKey: tags.length >= 2 ? tags.join(' ') : null,
        links: Array.from(new Set((p.links || []).map((l) => linkKey(l, p.id)).filter(Boolean))),
        replyTo: Array.isArray(p.replyTo) ? p.replyTo.map((h) => String(h).toLowerCase()) : [],
        mentions: Array.isArray(p.mentions) ? p.mentions.map((h) => String(h).toLowerCase()) : [],
      });
    }
    return rows;
  }

  // Traces shared by at least two accounts: { kind: 'text' | 'link' | 'tags', key, members }.
  // Credited copies are left out: they say where they came from.
  function traces(rows, copies) {
    const map = new Map();
    const add = (kind, key, i) => {
      const k = kind + '\u0000' + key;
      let e = map.get(k);
      if (!e) { e = { kind, key, members: [] }; map.set(k, e); }
      e.members.push(i);
    };
    for (const r of rows) {
      if (r.credited) continue;
      if (copies.groupOf[r.i] >= 0) add('text', String(copies.groupOf[r.i]), r.i);
      for (const l of r.links) add('link', l, r.i);
      if (r.tagKey) add('tags', r.tagKey, r.i);
    }
    return Array.from(map.values()).filter((e) => new Set(e.members.map((i) => rows[i].acct)).size >= 2);
  }

  // Who co-acted within `win` ms. Per post, the trace kinds it co-acted on; per account pair
  // (key "a b", a < b), which of each side's posts took part. A pair repeats when both sides
  // used two or more different posts: one copied post that carries the same text and the same
  // link is one event, not two.
  function coact(rows, items, win) {
    const hit = rows.map(() => null);
    const pairs = new Map();
    for (const item of items) {
      const ms = item.members.slice().sort((a, b) => rows[a].t - rows[b].t);
      for (let x = 0; x < ms.length; x++) {
        for (let y = x + 1; y < ms.length && rows[ms[y]].t - rows[ms[x]].t <= win; y++) {
          const [p, q] = rows[ms[x]].acct < rows[ms[y]].acct ? [ms[x], ms[y]] : [ms[y], ms[x]];
          const a = rows[p].acct;
          const b = rows[q].acct;
          if (a === b) continue;
          (hit[p] = hit[p] || new Set()).add(item.kind);
          (hit[q] = hit[q] || new Set()).add(item.kind);
          const pk = a + ' ' + b;
          let e = pairs.get(pk);
          if (!e) { e = { a: new Set(), b: new Set(), kinds: new Set() }; pairs.set(pk, e); }
          e.a.add(p);
          e.b.add(q);
          e.kinds.add(item.kind);
        }
      }
    }
    return { hit, pairs };
  }

  const repeats = (e) => e.a.size >= 2 && e.b.size >= 2;

  // Connected groups of accounts joined by repeat pairs, largest first.
  function clustersOf(pairKeys) {
    const adj = new Map();
    for (const pk of pairKeys) {
      const [a, b] = pk.split(' ');
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
    const seen = new Set();
    const out = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const a = stack.pop();
        comp.push(a);
        for (const b of adj.get(a)) if (!seen.has(b)) { seen.add(b); stack.push(b); }
      }
      out.push(comp.sort());
    }
    return out.sort((a, b) => b.length - a.length);
  }

  // Handles in a cluster that share a stem and differ only by digits or a short tail
  // (jenne191, jenne493, jenne669). In 2009 Twitter a third of the synced copy groups had them,
  // against one in thirty of the copy groups spread over days.
  function lookalikes(handles) {
    const stem = (h) => String(h).toLowerCase().replace(/[\d_]+$/, '').replace(/\d+/g, '');
    const by = new Map();
    for (const h of handles) {
      const s = stem(h);
      if (s.length < 3) continue;
      const list = by.get(s);
      if (list) list.push(h); else by.set(s, [h]);
    }
    return Array.from(by.values()).filter((l) => l.length >= 2);
  }

  // The co-action numbers for one window.
  function measure(rows, items, win) {
    const { hit, pairs } = coact(rows, items, win);
    const accounts = new Set(rows.map((r) => r.acct)).size || 1;
    const n = rows.length || 1;
    const syncAccounts = new Set();
    const byKind = { text: 0, link: 0, tags: 0 };
    let syncPosts = 0;
    hit.forEach((kinds, i) => {
      if (!kinds) return;
      syncPosts++;
      syncAccounts.add(rows[i].acct);
      for (const k of kinds) byKind[k]++;
    });
    const repeatPairs = [];
    for (const [pk, e] of pairs) if (repeats(e)) repeatPairs.push(pk);
    const clusters = clustersOf(repeatPairs);
    const inRepeat = new Set(clusters.flat());
    return {
      window: win,
      posts: syncPosts / n,
      accounts: syncAccounts.size / accounts,
      byKind: { text: byKind.text / n, link: byKind.link / n, tags: byKind.tags / n },
      repeatPairs: repeatPairs.length,
      repeatAccounts: inRepeat.size / accounts,
      repeatPosts: rows.filter((r) => inRepeat.has(r.acct)).length / n,
      clusters: clusters.map((accts) => ({ accounts: accts, lookalikes: lookalikes(accts) })),
    };
  }

  // ---------------------------------------------------------------------------
  // Concentration, copies aimed at people, timeline
  // ---------------------------------------------------------------------------

  // How much of the topic a few accounts produce. A heavy poster has `heavy` or more posts on
  // the topic inside one hour; `medianGap` is the median time between an account's consecutive
  // posts on the topic (Ratkiewicz et al. 2011: nine accounts, 929 posts in 138 minutes).
  function concentration(rows, { heavy = 5 } = {}) {
    const per = new Map();
    for (const r of rows) {
      const list = per.get(r.acct);
      if (list) list.push(r.t); else per.set(r.acct, [r.t]);
    }
    const counts = Array.from(per.values(), (ts) => ts.length).sort((a, b) => b - a);
    const gaps = [];
    const heavyAccounts = [];
    let heavyPosts = 0;
    for (const [acct, ts] of per) {
      ts.sort((a, b) => a - b);
      for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
      let most = 0;
      for (let i = 0, j = 0; i < ts.length; i++) { while (ts[i] - ts[j] > HOUR) j++; most = Math.max(most, i - j + 1); }
      if (most >= heavy) { heavyAccounts.push(acct); heavyPosts += ts.length; }
    }
    const n = rows.length || 1;
    return {
      accounts: counts.length,
      postsPerAccount: rows.length / (counts.length || 1),
      topAccountShare: (counts[0] || 0) / n,
      heavyAccounts,
      heavyShare: heavyPosts / n,
      medianGap: pct(gaps, 0.5),
    };
  }

  // Copies aimed at people. A templated group is a copy group whose posts reply to or mention
  // `minTargets` or more different accounts: the same question put to senator after senator
  // (#PhosphorusDisaster, Doppelganger, STOIC). A swarmed target receives copies of one text
  // from `minSenders` or more accounts (#KochFarms; Pote et al. 2025 use five replies).
  function aimed(rows, copies, { minTargets = 3, minSenders = 3 } = {}) {
    const byGroup = new Map();
    const byTargetGroup = new Map();
    const add = (map, k, v) => { let s = map.get(k); if (!s) { s = new Set(); map.set(k, s); } s.add(v); };
    const targets = new Set();
    let addressing = 0;
    for (const r of rows) {
      const ts = Array.from(new Set([...r.replyTo, ...r.mentions])).filter((t) => t !== r.acct);
      if (!ts.length) continue;
      addressing++;
      for (const t of ts) targets.add(t);
      const g = copies.groupOf[r.i];
      if (g < 0 || r.credited) continue;
      for (const t of ts) { add(byGroup, g, t); add(byTargetGroup, t + '\u0000' + g, r.acct); }
    }
    const templated = Array.from(byGroup).filter(([, ts]) => ts.size >= minTargets);
    const senders = new Set();
    const reached = new Set();
    for (const [g, ts] of templated) {
      for (const i of copies.groups[g].members) senders.add(rows[i].acct);
      for (const t of ts) reached.add(t);
    }
    const swarmed = new Set();
    for (const [k, s] of byTargetGroup) if (s.size >= minSenders) swarmed.add(k.split('\u0000')[0]);
    return {
      addressingShare: addressing / (rows.length || 1),
      targets: targets.size,
      templatedGroups: templated.length,
      templatedSenders: senders.size,
      templatedTargets: reached.size,
      swarmedTargets: swarmed.size,
    };
  }

  // Hourly counts from the first post to the last, and the peak hour's share.
  function timeline(rows) {
    if (!rows.length) return { start: null, hours: [], peak: null, peakShare: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) { if (r.t < lo) lo = r.t; if (r.t > hi) hi = r.t; }
    const t0 = Math.floor(lo / HOUR) * HOUR;
    const hours = new Array(Math.floor((hi - t0) / HOUR) + 1).fill(0);
    for (const r of rows) hours[Math.floor((r.t - t0) / HOUR)]++;
    let peak = 0;
    for (let i = 1; i < hours.length; i++) if (hours[i] > hours[peak]) peak = i;
    return { start: t0, hours, peak: t0 + peak * HOUR, peakShare: hours[peak] / rows.length };
  }

  // ---------------------------------------------------------------------------
  // The report for one topic
  // ---------------------------------------------------------------------------

  // posts: catalogue posts on the topic. Reposts shown in a timeline are the original author's
  // post and belong in (their repost time is unknown). `ignore`: the topic's own words and
  // hashtags. `windows`: co-action windows in ms.
  function report(posts, { ignore = [], windows = WINDOWS } = {}) {
    const rows = prepare(posts, { ignore });
    const copies = copyGroups(rows);
    const items = traces(rows, copies);
    const eligible = rows.filter((r) => r.sh).length;
    const shared = copies.groups.filter((g) => g.accounts.size >= 2);
    const copied = rows.filter((r) => copies.groupOf[r.i] >= 0 && copies.groups[copies.groupOf[r.i]].accounts.size >= 2);
    const gapBands = { minute: 0, tenMinutes: 0, hour: 0, longer: 0 };
    for (const g of shared) {
      if (g.accounts.size < 3) continue;
      const gap = copyGap(rows, g);
      if (gap <= MIN) gapBands.minute++;
      else if (gap <= 10 * MIN) gapBands.tenMinutes++;
      else if (gap <= HOUR) gapBands.hour++;
      else gapBands.longer++;
    }
    return {
      posts: rows.length,
      ...concentration(rows),
      copy: {
        eligible,
        share: copied.filter((r) => !r.credited).length / (eligible || 1),
        credited: copied.filter((r) => r.credited).length,
        groups: shared.length,
        groups3: shared.filter((g) => g.accounts.size >= 3).length,
        largest: shared.reduce((m, g) => Math.max(m, g.accounts.size), 0),
        gapBands,
      },
      linkShare: rows.filter((r) => r.links.length).length / (rows.length || 1),
      aimed: aimed(rows, copies),
      timeline: timeline(rows),
      windows: windows.map((w) => measure(rows, items, w)),
    };
  }

  root.XPCCoord = { WINDOWS, tokens, hashtags, credited, linkKey, shingles, similar, copyGroups, copyGap, prepare, traces, coact, clustersOf, lookalikes, measure, concentration, aimed, timeline, report };
})(typeof self !== 'undefined' ? self : this);
