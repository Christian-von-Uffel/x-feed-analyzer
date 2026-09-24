// xsearch.js — composes an X (x.com) advanced search that looks for copies and near-copies of a
// post: its rarest phrases as exact matches, a date window anchored on the post, and a few
// exclusions. Pure functions; nothing here opens a tab. Loaded by viewer.html after words.js.
//
// Why phrases: a talking point travels with its wording. Two or three exact phrases from
// different parts of the post, joined with OR, find copies that were trimmed or given a new
// opening line. Rarity is judged against the local catalogue (how many captured posts contain
// each word), which is a proxy for X at large: a word never captured may still be common, so
// the caller should show the query and let people edit it.
(function (root) {
  'use strict';

  const stop = () => root.XPCWords.STOPWORDS;
  const DAY = 86400000;

  // The post as X's phrase search will see it, in order. A word is a string; `null` marks a
  // break a phrase must not cross: sentence punctuation, line breaks, quotes, brackets, dashes,
  // and tokens with digits (X tokenises "$4.00" and "4,000-pound" unpredictably).
  function words(text) {
    const s = String(text || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/(^|[^\p{L}\p{N}_])[@#][\p{L}\p{N}_]+/gu, '$1 ')
      .replace(/[’‘`´]/g, "'")
      .toLowerCase();
    const out = [];
    for (const m of s.matchAll(/([\p{L}][\p{L}']*)|([\p{N}][\p{L}\p{N}.,:%$-]*)|([.!?;:\n]+|[()[\]{}"“”«»—–|/]+)/gu)) {
      if (m[1]) {
        const w = m[1].replace(/^'+|'+$/g, '');
        if (w) out.push(w);
      } else if (out.length && out[out.length - 1] !== null) out.push(null);
    }
    return out;
  }

  // How much a word narrows a search, from catalogue document frequencies: log((N + 1) / (df + 1)).
  // Stop-words count nothing. `df` is the map from XPCWords.aggregate (keys have "'s" stripped).
  function weigher(df, N) {
    const S = stop();
    return (w) => {
      if (S.has(w)) return 0;
      const n = (df && df.get(w.replace(/'s$/, ''))) || 0;
      return Math.log((N + 1) / (n + 1)) + 0.5;
    };
  }

  // Up to `max` non-overlapping phrases of `size` words (shorter when a sentence is shorter),
  // spread over the post: the best window from each of `max` equal stretches. A window needs at
  // least two words that are not stop-words. Returns [{ phrase, score, start, end }] in text order.
  function phrases(text, { df = null, N = 0, size = 5, min = 3, max = 3 } = {}) {
    const ws = words(text);
    const weight = weigher(df, N);
    const wts = ws.map((w) => (w === null ? 0 : weight(w)));
    const n = ws.length;
    if (!n) return [];
    const total = ws.filter((w) => w !== null).length;
    const stretches = Math.max(1, Math.min(max, Math.floor(total / (size * 2))));
    const bounds = [];
    for (let s = 0; s < stretches; s++) bounds.push([Math.floor((n * s) / stretches), Math.floor((n * (s + 1)) / stretches)]);

    const out = [];
    let lastEnd = -1;
    for (const [lo, hi] of bounds) {
      let best = null;
      for (let start = Math.max(lo, lastEnd); start < hi; start++) {
        if (ws[start] === null) continue;
        for (let k = size; k >= min; k--) {
          const end = start + k;
          if (end > n) continue;
          let ok = true;
          let score = 0;
          let content = 0;
          for (let i = start; i < end; i++) {
            if (ws[i] === null) { ok = false; break; }
            score += wts[i];
            if (wts[i] > 0) content++;
          }
          if (!ok || content < 2) continue;
          // Prefer the longest window that fits; among equal lengths the rarest words win.
          if (!best || score > best.score) best = { start, end, score };
          break;
        }
      }
      if (!best) continue;
      const phrase = ws.slice(best.start, best.end).join(' ');
      if (out.some((o) => o.phrase === phrase)) continue;
      out.push({ phrase, score: Math.round(best.score * 100) / 100, start: best.start, end: best.end });
      lastEnd = best.end;
    }
    return out;
  }

  // The post's most searchable single words, for a looser "same talking points" query.
  function keywords(text, { df = null, N = 0, max = 5 } = {}) {
    const weight = weigher(df, N);
    const seen = new Map();
    for (const w of words(text)) {
      if (w === null || w.length < 4) continue;
      const e = seen.get(w) || { word: w, count: 0, order: seen.size };
      e.count++;
      seen.set(w, e);
    }
    return Array.from(seen.values())
      .map((e) => ({ ...e, score: weight(e.word) * (1 + Math.log(e.count)) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, max)
      .map((e) => e.word);
  }

  // A since/until window around a post. X's since: is inclusive and until: exclusive, both in UTC
  // days, so "after" days past the post needs one more day on until.
  function window(time, { before = 3, after = 1 } = {}) {
    const t = time ? new Date(time).getTime() : NaN;
    if (Number.isNaN(t)) return null;
    const day = (x) => new Date(x).toISOString().slice(0, 10);
    return { since: day(t - before * DAY), until: day(t + (after + 1) * DAY), before, after };
  }

  // Assemble the query string. Phrases are OR-ed as exact matches; keywords are AND-ed as plain
  // words; the two are alternatives, not usually combined.
  function build({ phrases: ph = [], keywords: kw = [], window: w = null, excludeHandle = null, replies = true, lang = null } = {}) {
    const parts = [];
    const quoted = ph.map((p) => (typeof p === 'string' ? p : p.phrase)).filter(Boolean).map((p) => `"${p.replace(/"/g, '')}"`);
    if (quoted.length > 1) parts.push('(' + quoted.join(' OR ') + ')');
    else if (quoted.length === 1) parts.push(quoted[0]);
    if (kw.length) parts.push(kw.join(' '));
    if (!parts.length) return '';
    if (w) parts.push(`since:${w.since}`, `until:${w.until}`);
    if (excludeHandle) parts.push(`-from:${String(excludeHandle).replace(/^@/, '')}`);
    if (!replies) parts.push('-filter:replies');
    if (lang) parts.push(`lang:${lang}`);
    return parts.join(' ');
  }

  // The viewer's X search tray (Shift-clicked cloud words and accounts, or typed) as one query.
  // Every term must appear (X ANDs space-separated terms). A term is a word or phrase, or several
  // alternatives written "iran | gas prices" (or given as an array), which X ORs:
  // (iran OR "gas prices"). Multi-word alternatives stay together as exact phrases.
  // scope: 'them' = only these accounts' posts, 'others' = everyone but them, 'all' = no author part.
  const alternatives = (term) => (Array.isArray(term) ? term : String(term || '').split('|'))
    .map((t) => String(t || '').replace(/"/g, '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  function termGroup(term) {
    const seen = new Set();
    const alts = [];
    for (const t of alternatives(term)) {
      if (seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      alts.push(t.includes(' ') ? `"${t}"` : t);
    }
    return alts.length > 1 ? `(${alts.join(' OR ')})` : alts[0] || '';
  }

  function handleList(handles) {
    const seen = new Set();
    const out = [];
    for (const raw of handles || []) {
      const h = String(raw || '').trim().replace(/^@/, '');
      if (!h || seen.has(h.toLowerCase())) continue;
      seen.add(h.toLowerCase());
      out.push(h);
    }
    return out;
  }

  function wordsQuery(terms, { handles = null, handle = null, scope = 'all' } = {}) {
    const seen = new Set();
    const parts = [];
    for (const term of terms || []) {
      const g = termGroup(term);
      if (!g || seen.has(g.toLowerCase())) continue;
      seen.add(g.toLowerCase());
      parts.push(g);
    }
    const hs = handleList(handles || (handle ? [handle] : []));
    if (hs.length && scope === 'them') parts.unshift(hs.length === 1 ? `from:${hs[0]}` : `(${hs.map((h) => `from:${h}`).join(' OR ')})`);
    else if (hs.length && scope === 'others' && parts.length) parts.push(...hs.map((h) => `-from:${h}`));
    return parts.join(' ');
  }

  // X's search API documents a 500-character query limit; a longer query in the search box can come
  // back empty or cut off without saying so. With many accounts, 'them' spreads them over several
  // queries that each fit. 'others' is never split (each search must leave every account out).
  const MAX_QUERY = 500;
  function wordsQueries(terms, { handles = [], scope = 'all', max = MAX_QUERY } = {}) {
    const hs = handleList(handles);
    const whole = wordsQuery(terms, { handles: hs, scope });
    if (scope !== 'them' || hs.length < 2 || whole.length <= max) return whole ? [whole] : [];
    const out = [];
    let batch = [];
    for (const h of hs) {
      if (batch.length && wordsQuery(terms, { handles: [...batch, h], scope }).length > max) {
        out.push(wordsQuery(terms, { handles: batch, scope }));
        batch = [];
      }
      batch.push(h);
    }
    out.push(wordsQuery(terms, { handles: batch, scope }));
    return out;
  }

  const searchUrl = (query, { latest = true } = {}) => (query ? `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query${latest ? '&f=live' : ''}` : null);
  const webUrl = (phrase) => (phrase ? `https://www.google.com/search?q=${encodeURIComponent('"' + phrase + '"')}` : null);

  const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  // until: is exclusive, so the last day the search covers is the day before it.
  const lastDay = (iso) => new Date(new Date(iso + 'T00:00:00Z').getTime() - DAY).toISOString().slice(0, 10);

  // Everything the viewer needs for one post: the phrase query (exact copies), the keyword query
  // (reworded talking points), both URLs, and plain-language lines explaining the query.
  function compose(post, { df = null, N = 0, before = 3, after = 1, replies = true, maxPhrases = 3 } = {}) {
    const text = (post && post.text) || '';
    const ph = phrases(text, { df, N, max: maxPhrases });
    const kw = keywords(text, { df, N });
    const w = window(post && post.time, { before, after });
    const handle = post && post.handle;
    const query = build({ phrases: ph, window: w, excludeHandle: handle, replies });
    const looseQuery = build({ keywords: kw, window: w, excludeHandle: handle, replies });
    const describe = [];
    if (ph.length) describe.push(`Posts containing any of these exact phrases: ${ph.map((p) => `“${p.phrase}”`).join(', ')}.`);
    else describe.push('No phrase long enough to search for; the post is too short or has no words.');
    if (w) describe.push(`Posted from ${fmtDay(w.since)} to ${fmtDay(lastDay(w.until))} (UTC): ${before} day${before === 1 ? '' : 's'} before this post to ${after} day${after === 1 ? '' : 's'} after it.`);
    if (handle) describe.push(`Not by @${handle}.`);
    if (!replies) describe.push('Replies left out.');
    describe.push('Opens the Latest tab, so the earliest poster in the window is at the bottom.');
    return {
      phrases: ph, keywords: kw, window: w, query, looseQuery,
      url: searchUrl(query), looseUrl: searchUrl(looseQuery), webUrl: webUrl(ph.length ? ph[0].phrase : null),
      describe,
    };
  }

  root.XPCXSearch = { words, weigher, phrases, keywords, window, build, alternatives, wordsQuery, wordsQueries, MAX_QUERY, searchUrl, webUrl, compose };
})(typeof self !== 'undefined' ? self : this);
