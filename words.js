// words.js — tokenizer, stop-words and keyness statistics for X Feed Analyzer.
// Pure functions shared by the word clouds and the co-mention table (clouds.js, viewer.js).
// Loaded by viewer.html after search.js. Nothing here touches the DOM.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Stop-words: English function words, X / internet noise, and the most common
  // function words of a few other languages so bilingual timelines do not fill the
  // clouds with "de", "la", "que". Single-letter tokens and pure numbers are dropped
  // by the tokenizer anyway.
  // ---------------------------------------------------------------------------
  const EN = `a about above after again against all almost also although always am among an and another any anyone
    anything anyway anywhere are aren't around as at back be became because become becomes been before behind being
    below between both but by came can can't cannot come could couldn't did didn't do does doesn't doing don't done
    down during each either else enough even ever every everyone everything everywhere few for from further get gets
    getting go goes going gone got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
    herself him himself his how how's however i i'd i'll i'm i've if in into is isn't it it'd it'll it's its itself
    just keep kept know knew let let's like likely made make makes many may maybe me might mine more most much must
    mustn't my myself neither never no nor not nothing now of off often on once one ones only onto or other others
    otherwise ought our ours ourselves out over own per put rather really said same say says see seem seemed seems
    seen several shall shan't she she'd she'll she's should shouldn't since so some someone something sometimes
    somewhere still such take taken than that that's the their theirs them themselves then there there's these they
    they'd they'll they're they've thing things this those though through thus to too toward towards under until up
    upon us use used uses using very via want wants was wasn't way we we'd we'll we're we've well went were weren't
    what what's whatever when when's where where's whether which while who who's whoever whom whose why why's will
    with within without won't would wouldn't yes yet you you'd you'll you're you've your yours yourself yourselves
    think thinks thought tell told need needs try trying feel feels felt find found call called ask asked lot lots
    good bad big new old little actually basically literally probably definitely quite pretty sure kind sort less
    least already today yesterday tomorrow day days week weeks month months year years time times people person
    guy guys man men woman women`;

  const NOISE = `rt amp gt lt http https www t.co im ive dont cant wont didnt doesnt isnt wasnt thats youre theyre
    lol lmao omg btw tbh imo imho idk ok okay yeah yep nah ur pls plz thx ty gonna gotta wanna kinda sorta ppl bc rn
    af smh fr ngl`;

  const OTHER = `el la los las un una unos unas de del al en y o que qué es son por para con sin como más muy pero si
    no lo le les se su sus mi mis tu tus este esta esto ese esa eso aquel ya también hay ha han está están fue ser era
    der die das den dem des ein eine einer eines einem einen und oder aber nicht ist sind war waren wird werden ich du
    er sie es wir ihr mich dich sich uns euch mein dein sein unser euer zu von mit auf für aus bei nach über unter vor
    an im am auch noch nur schon wie was wer wo wenn dass als
    le les l un une des du au aux et ou mais ne pas plus moins qui quoi dont où ce cet cette ces il elle ils elles je
    nous vous on sa son ses mon ma mes ton ta tes notre nos votre vos leur leurs est sont été être avoir ont dans sur
    sous avec sans pour par très aussi comme bien
    os as um uma uns umas do da dos das na nos nas ao à não sim é foi ter tem têm muito mas seu sua seus suas meu
    minha eu ele ela nós vós eles elas isso isto aquilo já também`;

  const STOPWORDS = new Set((EN + ' ' + NOISE + ' ' + OTHER).split(/\s+/).filter(Boolean));

  const URL_RE = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|co|gov|edu|me|ly|tv|app|dev|xyz|info|news|uk|de|fr|es|it|nl|ca|au|jp|ch|se|eu|us)(?:\/\S*)?(?![\p{L}\p{N}])/giu;
  const MENTION_RE = /(^|[^\p{L}\p{N}_@])@\w{1,15}(?!\w)/gu;
  const EMOJI_RE = /^\p{Extended_Pictographic}/u;
  // A token, or a run of sentence punctuation (which breaks bigrams the way a stop-word does).
  const SCAN_RE = /(#?[\p{L}\p{N}][\p{L}\p{N}'_-]*|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)|([.,;:!?…()\[\]{}"«»—–|\/\n]+)/gu;
  const DIGITS_RE = /^\p{N}+$/u;

  // Tokens of one post, lower-cased, in order. URLs and @mentions are removed; #hashtags and
  // emoji are kept. Stop-words, single characters, pure numbers and sentence punctuation become
  // `null` so that bigrams are only formed from words that were actually adjacent in the text.
  function tokenize(text) {
    const out = [];
    if (!text) return out;
    const s = String(text).replace(URL_RE, ' ').replace(MENTION_RE, '$1 ').replace(/[’‘`´]/g, "'").toLowerCase();
    for (const m of s.matchAll(SCAN_RE)) {
      if (m[2] !== undefined) { out.push(null); continue; }
      let t = m[1];
      if (EMOJI_RE.test(t)) {
        // Text-style symbols below U+2600 (©, ®, ™, ‼ …) are not worth a slot in a cloud.
        if (t.codePointAt(0) < 0x2600) { out.push(null); continue; }
        out.push(t);
        continue;
      }
      t = t.replace(/['_-]+$/g, '').replace(/'s$/, '');
      if (t.length < 2 || DIGITS_RE.test(t) || STOPWORDS.has(t) || STOPWORDS.has(t.replace(/^#/, ''))) { out.push(null); continue; }
      out.push(t);
    }
    return out;
  }

  // Mentions of every unigram and every adjacent bigram in one post. Bigram keys contain a space.
  function countTokens(tokens) {
    const m = new Map();
    let prev = null;
    for (const t of tokens) {
      if (t === null) { prev = null; continue; }
      m.set(t, (m.get(t) || 0) + 1);
      if (prev !== null) { const b = prev + ' ' + t; m.set(b, (m.get(b) || 0) + 1); }
      prev = t;
    }
    return m;
  }

  // Sum per-post count maps into a corpus: tf = mentions, df = posts containing the term,
  // n = total unigram tokens (the size used for expected frequencies).
  function aggregate(countMaps) {
    const tf = new Map();
    const df = new Map();
    let n = 0;
    let posts = 0;
    for (const c of countMaps) {
      posts++;
      for (const [k, v] of c) {
        tf.set(k, (tf.get(k) || 0) + v);
        df.set(k, (df.get(k) || 0) + 1);
        if (k.indexOf(' ') < 0) n += v;
      }
    }
    return { tf, df, n, posts };
  }

  // Signed log-likelihood keyness (Dunning's G²): how surprising a's share of n1 tokens is next to
  // b's share of n2 tokens. Positive when the term is over-represented in the target.
  function g2(a, b, n1, n2) {
    const t = a + b;
    if (!t || !n1 || !n2) return 0;
    const e1 = (n1 * t) / (n1 + n2);
    const e2 = (n2 * t) / (n1 + n2);
    let g = 0;
    if (a) g += a * Math.log(a / e1);
    if (b) g += b * Math.log(b / e2);
    g *= 2;
    return a / n1 >= b / n2 ? g : -g;
  }

  // The terms that characterise `target`, a corpus from aggregate(), against `total`, the corpus
  // it is part of (the background is total minus target).
  //   mode: 'distinctive' — keyness, needs at least minCount uses; falls back to 'frequent' when
  //         there is no background (the target is the whole corpus).
  //         'frequent'    — plain mention counts.
  //   exclude(term): drop a term (used to keep the anchor term out of its own cloud).
  // Bigrams that account for at least half of their rarer word's uses (and occur twice) are kept
  // as phrases and their mentions come out of the two words, so "gas prices" does not also
  // show up as "gas" and "prices".
  function topTerms({ target, total, mode = 'distinctive', max = 60, minCount = 2, exclude = null }) {
    const bg = total && total.n > target.n ? total : null;
    const useKey = mode === 'distinctive' && Boolean(bg);
    const n1 = target.n;
    const n2 = bg ? bg.n - target.n : 0;

    const adjT = new Map();
    const adjA = new Map();
    const keepBi = new Set();
    for (const [k, v] of target.tf) {
      const sp = k.indexOf(' ');
      if (sp < 0 || v < 2) continue;
      const w1 = k.slice(0, sp);
      const w2 = k.slice(sp + 1);
      const c1 = target.tf.get(w1) || 0;
      const c2 = target.tf.get(w2) || 0;
      if (v >= 0.5 * Math.min(c1, c2)) {
        keepBi.add(k);
        adjT.set(w1, (adjT.get(w1) || 0) + v);
        adjT.set(w2, (adjT.get(w2) || 0) + v);
        if (bg) {
          const vb = bg.tf.get(k) || 0;
          adjA.set(w1, (adjA.get(w1) || 0) + vb);
          adjA.set(w2, (adjA.get(w2) || 0) + vb);
        }
      }
    }

    const rows = [];
    for (const [k, v] of target.tf) {
      const isBi = k.indexOf(' ') >= 0;
      if (isBi && !keepBi.has(k)) continue;
      const a = isBi ? v : Math.max(0, v - (adjT.get(k) || 0));
      if (a < (useKey ? Math.max(1, minCount) : 1)) continue;
      if (exclude && exclude(k)) continue;
      let rest = 0;
      if (bg) {
        const tot = isBi ? (bg.tf.get(k) || 0) : Math.max(0, (bg.tf.get(k) || 0) - (adjA.get(k) || 0));
        rest = Math.max(0, tot - a);
      }
      let weight = a;
      if (useKey) {
        weight = g2(a, rest, n1, n2);
        if (weight <= 0) continue;
      }
      rows.push({ term: k, weight, count: a, posts: target.df.get(k) || 0, rest });
    }
    rows.sort((x, y) => y.weight - x.weight || y.count - x.count || x.term.localeCompare(y.term));
    return { terms: rows.slice(0, Math.max(1, max)), mode: useKey ? 'distinctive' : 'frequent' };
  }

  // ---------------------------------------------------------------------------
  // Co-mentions: in the posts that mention `anchor`, how often does each keyword come up?
  // ---------------------------------------------------------------------------

  function countMatches(regexG, str) {
    regexG.lastIndex = 0;
    let n = 0;
    let m;
    while ((m = regexG.exec(str)) && n < 1000) {
      if (m[0].length === 0) regexG.lastIndex++;
      n++;
    }
    return n;
  }

  // Regex source for a cloud word or phrase: whole-word, spaces tolerate punctuation between words.
  // With `unicode` (compile with the u flag) word characters include every script, so "мир" no
  // longer matches inside "миром"; without it they are ASCII \w, as search.js does for whole word.
  const wordPattern = (term, unicode = false) => {
    const w = unicode ? '[\\p{L}\\p{N}_]' : '\\w';
    const gap = unicode ? '[^\\p{L}\\p{N}_]+' : '\\W+';
    return `(?<!${w})` + root.XPCSearch.escapeRegex(term).replace(/ /g, gap) + `(?!${w})`;
  };

  // One regex source that matches posts containing every part, in any order. Each occurrence of
  // any part is a match (so all of them highlight); the lookbehind checks, from the start of the
  // text, that every part occurs somewhere. The start test sits last in the lookbehind because
  // lookbehinds run right to left: it fails fast everywhere but position 0.
  function allPattern(parts) {
    const ps = (parts || []).filter(Boolean);
    if (ps.length < 2) return ps[0] || '';
    const alt = ps.map((p) => `(?:${p})`).join('|');
    const need = ps.map((p) => `(?=[\\s\\S]*?(?:${p}))`).join('');
    return `(?:${alt})(?<=${need}(?<![\\s\\S])[\\s\\S]*)`;
  }

  // posts:    already filtered (author, dates, replies, ...)
  // anchor:   { label, pattern } compiled with `options`, or { label, count(text) → mentions }
  // keywords: [{ label, pattern }] compiled with `options`; when empty, `auto` (plain words) is used
  //           as whole-word patterns instead
  // Returns rows sorted by co-mentioned posts, plus the same count over every post, so a keyword
  // that never matches anywhere is visibly a typo rather than a quiet zero.
  function comentions({ posts, anchor, keywords, options, auto = null }) {
    const errors = [];
    const opts = { ...(options || {}), pattern: '' };
    // The anchor's own error is reported by the caller (it is shown next to the term box).
    const ar = root.XPCSearch.compile({ ...opts, pattern: anchor ? anchor.pattern : '' });
    const count = anchor && typeof anchor.count === 'function' ? anchor.count : ar.regexG ? (text) => countMatches(ar.regexG, text) : null;

    let cols = [];
    let isAuto = false;
    if (keywords && keywords.length) {
      for (const k of keywords) {
        const r = root.XPCSearch.compile({ ...opts, pattern: k.pattern });
        if (r.error || !r.regexG) { errors.push(`${k.label}: ${r.error || 'empty pattern'}`); continue; }
        cols.push({ label: k.label, pattern: k.pattern, isRegex: Boolean(opts.regex), regexG: r.regexG, posts: 0, mentions: 0, allPosts: 0, allMentions: 0 });
      }
    } else if (auto && auto.length) {
      isAuto = true;
      for (const term of auto) {
        const pattern = wordPattern(term, true);
        const r = root.XPCSearch.compile({ ...opts, pattern, regex: true, wholeWord: false, unicode: true });
        if (r.error || !r.regexG) continue;
        cols.push({ label: term, pattern, isRegex: true, regexG: r.regexG, posts: 0, mentions: 0, allPosts: 0, allMentions: 0 });
      }
    }

    let nPosts = 0;
    let aPosts = 0;
    let aMentions = 0;
    const aAuthors = new Set();
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const post of posts || []) {
      nPosts++;
      const t = post.time ? new Date(post.time).getTime() : NaN;
      if (!Number.isNaN(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      const text = post.text || '';
      const hit = count ? count(text) : 0;
      if (hit) { aPosts++; aMentions += hit; aAuthors.add(post.handle); }
      for (const c of cols) {
        const n = countMatches(c.regexG, text);
        if (!n) continue;
        c.allPosts++;
        c.allMentions += n;
        if (hit) { c.posts++; c.mentions += n; }
      }
    }

    const rows = cols.map((c, i) => {
      const share = aPosts ? c.posts / aPosts : 0;
      const allShare = nPosts ? c.allPosts / nPosts : 0;
      return {
        label: c.label, pattern: c.pattern, isRegex: c.isRegex, posts: c.posts, mentions: c.mentions, share,
        allPosts: c.allPosts, allMentions: c.allMentions, allShare,
        lift: allShare > 0 ? share / allShare : null, order: i,
      };
    });
    rows.sort((x, y) => y.posts - x.posts || y.allPosts - x.allPosts || x.order - y.order);

    return {
      anchor: { label: anchor ? anchor.label : '', pattern: anchor ? anchor.pattern : '', posts: aPosts, mentions: aMentions, authors: aAuthors.size, valid: Boolean(count) },
      rows, auto: isAuto, errors, nPosts,
      from: Number.isFinite(tMin) ? tMin : null, to: Number.isFinite(tMax) ? tMax : null,
    };
  }

  root.XPCWords = { STOPWORDS, tokenize, countTokens, aggregate, g2, topTerms, comentions, countMatches, wordPattern, allPattern };
})(typeof self !== 'undefined' ? self : this);
