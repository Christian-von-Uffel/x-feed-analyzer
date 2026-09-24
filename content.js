// content.js — X Feed Analyzer
// Runs on x.com / twitter.com. Reads posts straight out of the rendered DOM (no API),
// sends them to the background worker for local storage, and applies a live regex
// filter to the timeline (highlight / dim / hide) as posts scroll into view.
(() => {
  'use strict';
  if (window.__xpcLoaded) return;
  window.__xpcLoaded = true;

  const XPCSearch = self.XPCSearch;
  if (!XPCSearch) { console.error('[X Feed Analyzer] search.js did not load'); return; }

  const DEFAULT_FILTER = { enabled: false, mode: 'highlight', field: 'text', ...XPCSearch.DEFAULT_OPTIONS };
  const PRESETS = XPCSearch.PRESETS;

  // Storage may hold the current shape or the legacy { flags: 'imsu' } shape.
  function toFilter(raw) {
    raw = raw || {};
    return { ...XPCSearch.normalize(raw), enabled: Boolean(raw.enabled), mode: raw.mode || 'highlight', field: raw.field || 'text' };
  }

  const state = {
    capture: true,
    filter: { ...DEFAULT_FILTER },
    regex: null,        // for .test()
    regexG: null,       // for iterating matches (highlight ranges)
    regexError: null,
    regexKey: '',
    total: null,        // posts in catalogue (from background)
    sessionPosts: new Map(), // id -> { text, handle, name } of every post seen in this tab
    sessionMatched: new Set(),
    cache: new Map(),   // id -> signature, to only send changed posts
    queue: new Map(),   // id -> post, pending flush
    reposters: new Map(), // focal post id -> Set of handles read from its /retweets page this session
    dead: false,
  };

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  // Serialise an element's visible text, turning emoji <img alt> back into characters.
  function textOf(el) {
    if (!el) return '';
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'IMG') { out += node.getAttribute('alt') || ''; return; }
      if (tag === 'BR') { out += '\n'; return; }
      for (const child of node.childNodes) walk(child);
    };
    walk(el);
    return out;
  }

  // Quoted posts are rendered inside a div[role="link"] card within the article.
  function isInQuoteCard(el, article) {
    let node = el.parentElement;
    while (node && node !== article) {
      if (node.tagName === 'DIV' && node.getAttribute('role') === 'link') return true;
      node = node.parentElement;
    }
    return false;
  }

  // First element matching selector that belongs to the article itself (not a quoted card).
  function own(article, selector) {
    for (const el of article.querySelectorAll(selector)) {
      if (!isInQuoteCard(el, article)) return el;
    }
    return null;
  }

  // Every element matching selector that belongs to the article itself (not a quoted card).
  function owned(article, selector) {
    return Array.from(article.querySelectorAll(selector)).filter((el) => !isInQuoteCard(el, article));
  }

  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/; // a profile link such as /alice
  const pushHandle = (list, h) => { if (h && !list.some((x) => x.toLowerCase() === h.toLowerCase())) list.push(h); };

  function parseNum(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().replace(/,/g, '');
    if (!s) return null;
    const m = s.match(/^([\d.]+)\s*([KkMmBb])?$/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (Number.isNaN(n)) return null;
    const unit = (m[2] || '').toUpperCase();
    if (unit === 'K') n *= 1e3;
    else if (unit === 'M') n *= 1e6;
    else if (unit === 'B') n *= 1e9;
    return Math.round(n);
  }

  function extractMetrics(article) {
    const out = { replies: null, reposts: null, likes: null, bookmarks: null, views: null };

    // Preferred: the action bar's aria-label, e.g. "12 replies, 3 reposts, 45 likes, 2 bookmarks, 1234 views".
    const groups = Array.from(article.querySelectorAll('div[role="group"][aria-label]'))
      .filter((g) => !isInQuoteCard(g, article));
    const group = groups[groups.length - 1];
    if (group) {
      const label = group.getAttribute('aria-label') || '';
      const re = /([\d,.]+)\s*(repl|repost|retweet|like|bookmark|view)/gi;
      let m;
      let any = false;
      while ((m = re.exec(label))) {
        const n = parseNum(m[1]);
        const k = m[2].toLowerCase();
        any = true;
        if (k.startsWith('repl')) out.replies = n;
        else if (k === 'repost' || k === 'retweet') out.reposts = n;
        else if (k === 'like') out.likes = n;
        else if (k === 'bookmark') out.bookmarks = n;
        else if (k === 'view') out.views = n;
      }
      if (any) {
        for (const key of Object.keys(out)) if (out[key] === null) out[key] = 0; // omitted from the label means zero
        return out;
      }
    }

    // Fallback: the visible counter next to each button ("1.2K").
    const fromButton = (selector) => {
      const el = own(article, selector);
      if (!el) return null;
      const span = el.querySelector('[data-testid="app-text-transition-container"]');
      const n = parseNum(span ? span.textContent : '');
      return n === null ? 0 : n;
    };
    out.replies = fromButton('button[data-testid="reply"]');
    out.reposts = fromButton('button[data-testid="retweet"], button[data-testid="unretweet"]');
    out.likes = fromButton('button[data-testid="like"], button[data-testid="unlike"]');
    out.bookmarks = fromButton('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
    out.views = fromButton('a[href$="/analytics"]');
    return out;
  }

  // Timelines show a "Replying to @someone and @other" line above the body. Returns the handles
  // it names, or null when there is no such line (threads do not show one).
  function extractReplyTo(article, textEl) {
    for (const span of article.querySelectorAll('span')) {
      if (textEl && textEl.contains(span)) break;
      if (!/^Replying to\b/.test(span.textContent || '')) continue;
      let box = span;
      for (let i = 0; i < 4 && box.parentElement && box.parentElement !== article; i++) {
        if (box.querySelector('a[href]')) break;
        box = box.parentElement;
      }
      const handles = [];
      for (const a of box.querySelectorAll('a[href]')) {
        const m = (a.getAttribute('href') || '').match(HANDLE_RE);
        if (m) pushHandle(handles, m[1]);
      }
      if (!handles.length) {
        for (const m of (box.textContent || '').matchAll(/@([A-Za-z0-9_]{1,15})/g)) pushHandle(handles, m[1]);
      }
      return handles;
    }
    return null;
  }

  // @handles inside the post text (not the reply line). Anchors first, then the raw text as a fallback.
  function extractMentions(textEl, text) {
    const out = [];
    if (textEl) {
      for (const a of textEl.querySelectorAll('a[href]')) {
        if (!textOf(a).trim().startsWith('@')) continue;
        const m = (a.getAttribute('href') || '').match(HANDLE_RE);
        if (m) pushHandle(out, m[1]);
      }
    }
    if (!out.length) {
      for (const m of (text || '').matchAll(/(?<![A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g)) pushHandle(out, m[1]);
    }
    return out;
  }

  const DOMAIN_RE = /^(?:from\s+)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?$/i;

  // Links as X displays them ("example.com/path…"), from the text and from a link-preview card.
  // X wraps every link in t.co, so the visible text is the only readable form of the URL.
  function extractLinks(article, textEl, text) {
    const out = [];
    const push = (v) => {
      v = String(v || '').replace(/[…\u2026]+$/, '').trim();
      if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    };
    if (textEl) {
      for (const a of textEl.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        const label = textOf(a).trim();
        if (label.startsWith('@') || label.startsWith('#') || label.startsWith('$')) continue;
        if (/^https?:\/\//i.test(href) || /^https?:\/\//i.test(label) || DOMAIN_RE.test(label)) push(label || href);
      }
    }
    const card = own(article, '[data-testid="card.wrapper"]');
    if (card) {
      let domain = null;
      for (const el of card.querySelectorAll('span, div')) {
        if (el.children.length) continue;
        const m = (el.textContent || '').trim().match(DOMAIN_RE);
        if (m) { domain = m[1]; break; }
      }
      if (!domain) {
        const a = card.querySelector('a[href]');
        const href = a ? a.getAttribute('href') || '' : '';
        if (/^https?:\/\//i.test(href)) domain = href;
      }
      if (domain && !out.some((x) => x.toLowerCase().startsWith(domain.toLowerCase()))) push(domain);
    }
    if (!out.length) {
      for (const m of (text || '').matchAll(/https?:\/\/\S+/g)) push(m[0]);
    }
    return { links: out, hasCard: Boolean(card) };
  }

  // The quoted post inside a quote tweet: author, id when the card links to it, and its text.
  function extractQuote(article) {
    let card = null;
    for (const c of article.querySelectorAll('div[role="link"]')) {
      if (c.querySelector('[data-testid="User-Name"]')) { card = c; break; }
    }
    if (!card) return null;
    let handle = null;
    let name = null;
    const nameEl = card.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
      for (const a of nameEl.querySelectorAll('a[href]')) {
        const m = (a.getAttribute('href') || '').match(HANDLE_RE);
        if (m) { handle = m[1]; break; }
      }
      const raw = textOf(nameEl);
      if (!handle) { const m = raw.match(/@([A-Za-z0-9_]{1,15})/); if (m) handle = m[1]; }
      name = raw.split('@')[0].replace(/[·\s]+$/, '').trim() || null;
    }
    let id = null;
    for (const a of card.querySelectorAll('a[href*="/status/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
      if (m) { id = m[2]; if (!handle) handle = m[1]; break; }
    }
    const textEl = card.querySelector('[data-testid="tweetText"]');
    return { handle, name, id, text: textEl ? textOf(textEl).trim() : '' };
  }

  function extractMedia(article) {
    const photos = owned(article, '[data-testid="tweetPhoto"]');
    const images = photos.filter((p) => !p.querySelector('video')).length;
    const hasVideo = Boolean(own(article, '[data-testid="videoPlayer"], [data-testid="videoComponent"], video'));
    return { images, hasImage: images > 0, hasVideo };
  }

  function extract(article) {
    const timeEl = own(article, 'a[href*="/status/"] time[datetime]');
    if (!timeEl) return null; // promoted posts and some cards have no permalink time
    const link = timeEl.closest('a');
    const m = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (!m) return null;
    const handle = m[1];
    const id = m[2];

    const textEl = own(article, '[data-testid="tweetText"]');
    const text = textEl ? textOf(textEl).trim() : '';

    let name = '';
    const nameEl = own(article, '[data-testid="User-Name"]');
    if (nameEl) {
      const anchors = Array.from(nameEl.querySelectorAll('a'));
      const nameAnchor = anchors.find((a) => !textOf(a).trim().startsWith('@'));
      name = nameAnchor ? textOf(nameAnchor).trim() : textOf(nameEl).split('@')[0].trim();
    }

    const social = own(article, '[data-testid="socialContext"]');
    const socialText = social ? textOf(social).trim() : '';
    const isRepost = /\b(repost|retweet)/i.test(socialText);
    let repostedBy = null;
    if (isRepost && social) {
      const a = social.closest('a') || social.querySelector('a');
      const h = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
      repostedBy = h ? h[1] : (socialText.replace(/\s*(reposted|retweeted).*$/i, '').trim() || null);
    }

    const replyTo = extractReplyTo(article, textEl);
    const quote = extractQuote(article);
    const media = extractMedia(article);
    const { links, hasCard } = extractLinks(article, textEl, text);

    return {
      id,
      url: `https://x.com/${handle}/status/${id}`,
      handle,
      name,
      text,
      lang: textEl ? (textEl.getAttribute('lang') || null) : null,
      time: timeEl.getAttribute('datetime'),
      isReply: replyTo !== null,
      replyTo: replyTo || [],
      replyInferred: false,
      isRepost,
      repostedBy,
      isPinned: /\bpinned\b/i.test(socialText),
      isQuote: quote !== null,
      quotedHandle: quote ? quote.handle : null,
      quotedName: quote ? quote.name : null,
      quotedId: quote ? quote.id : null,
      quotedText: quote ? quote.text : null,
      mentions: extractMentions(textEl, text),
      hasImage: media.hasImage,
      images: media.images,
      hasVideo: media.hasVideo,
      hasLink: links.length > 0 || hasCard,
      links,
      hasMedia: media.hasImage || media.hasVideo || hasCard,
      truncated: Boolean(own(article, '[data-testid="tweet-text-show-more-link"]')),
      ...extractMetrics(article),
      context: location.pathname + location.search,
    };
  }

  function signature(post) {
    const { context, ...rest } = post;
    return JSON.stringify(rest);
  }

  // ---------------------------------------------------------------------------
  // Live filter
  // ---------------------------------------------------------------------------

  const HIGHLIGHT_NAME = 'xpc-match';
  const supportsHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
  const highlight = supportsHighlight ? new Highlight() : null;
  if (highlight) CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  const rangesByArticle = new WeakMap();

  function compileFilter() {
    state.regex = null;
    state.regexG = null;
    state.regexError = null;
    const f = state.filter;
    if (!f.enabled || !f.pattern) return;
    const r = XPCSearch.compile(f);
    state.regex = r.regex;
    state.regexG = r.regexG;
    state.regexError = r.error;
  }

  function fieldValue(post, field) {
    switch (field) {
      case 'handle': return post.handle || '';
      case 'name': return post.name || '';
      case 'all': return `${post.name || ''} @${post.handle || ''}\n${post.text || ''}`;
      default: return post.text || '';
    }
  }

  function clearRanges(article) {
    const ranges = rangesByArticle.get(article);
    if (!ranges) return;
    for (const r of ranges) highlight.delete(r);
    rangesByArticle.delete(article);
  }

  // Map an offset in the serialised text back to a DOM boundary point.
  function setBoundary(range, segments, offset, isStart) {
    for (const seg of segments) {
      if (offset < seg.start || offset > seg.end) continue;
      if (isStart && offset === seg.end) continue;   // start at the beginning of the next segment instead
      if (!isStart && offset === seg.start) continue; // end at the end of the previous segment instead
      if (seg.isText) {
        if (isStart) range.setStart(seg.node, offset - seg.start);
        else range.setEnd(seg.node, offset - seg.start);
      } else if (isStart) {
        range.setStartBefore(seg.node);
      } else {
        range.setEndAfter(seg.node);
      }
      return true;
    }
    return false;
  }

  function highlightMatches(article, textEl) {
    if (!highlight) return 0;
    clearRanges(article);
    if (!textEl || !state.regexG) return 0;

    const segments = [];
    let str = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        segments.push({ node, start: str.length, end: str.length + node.nodeValue.length, isText: true });
        str += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'IMG') {
        const alt = node.getAttribute('alt') || '';
        if (alt) {
          segments.push({ node, start: str.length, end: str.length + alt.length, isText: false });
          str += alt;
        }
        return;
      }
      if (node.tagName === 'BR') {
        segments.push({ node, start: str.length, end: str.length + 1, isText: false });
        str += '\n';
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(textEl);

    const ranges = [];
    const re = state.regexG;
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(str)) && guard++ < 500) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const range = new Range();
      if (!setBoundary(range, segments, m.index, true)) continue;
      if (!setBoundary(range, segments, m.index + m[0].length, false)) continue;
      ranges.push(range);
      highlight.add(range);
    }
    rangesByArticle.set(article, ranges);
    return ranges.length;
  }

  function countMatches(str) {
    const re = state.regexG;
    if (!re) return 0;
    re.lastIndex = 0;
    let n = 0;
    let m;
    while ((m = re.exec(str)) && n < 500) {
      if (m[0].length === 0) re.lastIndex++;
      n++;
    }
    return n;
  }

  function applyFilterTo(article, post) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    article.classList.remove('xpc-match', 'xpc-dim');
    if (cell) cell.classList.remove('xpc-hide');
    delete article.dataset.xpcHits;

    if (!state.regex) {
      clearRanges(article);
      return;
    }
    const f = state.filter;
    const hay = fieldValue(post, f.field);
    if (state.regex.test(hay)) {
      state.sessionMatched.add(post.id);
      article.classList.add('xpc-match');
      const textEl = (f.field === 'text' || f.field === 'all') ? own(article, '[data-testid="tweetText"]') : null;
      const hits = textEl ? highlightMatches(article, textEl) : countMatches(hay);
      article.dataset.xpcHits = hits > 1 ? `${hits} matches` : 'match';
    } else {
      state.sessionMatched.delete(post.id);
      clearRanges(article);
      if (f.mode === 'dim') article.classList.add('xpc-dim');
      else if (f.mode === 'hide' && cell) cell.classList.add('xpc-hide');
    }
  }

  // Drop highlight ranges whose nodes X has already removed from the page.
  function pruneDetachedRanges() {
    if (!highlight) return;
    for (const r of Array.from(highlight)) {
      if (!r.startContainer || !r.startContainer.isConnected) highlight.delete(r);
    }
  }

  // ---------------------------------------------------------------------------
  // Scanning and capture
  // ---------------------------------------------------------------------------

  let scanTimer = null;
  let flushTimer = null;

  function scheduleScan() {
    if (scanTimer || state.dead) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 250);
  }

  // A post's own page: /handle/status/id (not its /quotes, /retweets or /likes lists).
  const STATUS_PAGE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/;
  const QUOTES_PAGE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/quotes\/?$/;
  const RETWEETS_PAGE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/retweets\/?$/;
  const REPLIES_TAB = /^\/([A-Za-z0-9_]{1,15})\/with_replies\/?$/;

  // A post's /retweets page lists the accounts that reposted it as user cells, not as posts.
  // Read their handles and queue a stub record for the focal post carrying them; db.js unions
  // the list into whatever it already holds for that post. X virtualises the list, so only the
  // rows that have been scrolled into view are ever seen.
  function scanReposters() {
    const m = RETWEETS_PAGE.exec(location.pathname);
    if (!m) return;
    const [, author, id] = m;
    let seen = state.reposters.get(id);
    if (!seen) { seen = new Set(); state.reposters.set(id, seen); }
    const before = seen.size;
    for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
      for (const a of cell.querySelectorAll('a[href]')) {
        const h = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        if (h && h[1].toLowerCase() !== 'i') { seen.add(h[1]); break; }
      }
    }
    if (!state.capture || seen.size === before) return;
    const post = {
      id,
      url: `https://x.com/${author}/status/${id}`,
      handle: author,
      reposters: Array.from(seen),
      stub: true, // only the fields above are known until the post itself is seen
      context: location.pathname + location.search,
    };
    const sig = signature(post);
    if (state.cache.get(id) !== sig) {
      state.cache.set(id, sig);
      state.queue.set(id, post);
    }
  }

  function scan() {
    if (state.dead) return;
    scanReposters();
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    // On a post's own page X hides the "Replying to" line, so the posts under the focal post are
    // taken as replies to its author (flagged replyInferred), up to the first heading below it
    // ("Discover more" / "More posts" recommendations are not replies).
    const focal = STATUS_PAGE.exec(location.pathname);
    let focalSeen = false;
    let stopAt = null;
    for (const article of articles) {
      let post = null;
      try { post = extract(article); } catch (e) { /* layout we don't understand; skip */ }
      if (!post) continue;
      if (focal) {
        if (post.id === focal[2]) {
          focalSeen = true;
          for (const h of document.querySelectorAll('h2, [role="heading"]')) {
            if (article.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) { stopAt = h; break; }
          }
        } else if (focalSeen && !post.isReply && !post.isRepost && post.handle.toLowerCase() !== focal[1].toLowerCase()
          && !(stopAt && (stopAt.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING))) {
          post.isReply = true;
          post.replyTo = [focal[1]];
          post.replyInferred = true;
        }
      }
      article.dataset.xpcId = post.id;
      state.sessionPosts.set(post.id, { text: post.text, handle: post.handle, name: post.name });
      if (state.capture) {
        const sig = signature(post);
        if (state.cache.get(post.id) !== sig) {
          state.cache.set(post.id, sig);
          state.queue.set(post.id, post);
        }
      }
      applyFilterTo(article, post);
    }
    if (state.cache.size > 20000) state.cache.clear();
    pruneDetachedRanges();
    if (state.queue.size) scheduleFlush();
    updatePanelStats();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 1000);
  }

  function markDead(reason) {
    if (state.dead) return;
    state.dead = true;
    try { observer.disconnect(); } catch (e) { /* ignore */ }
    if (rescanInterval) clearInterval(rescanInterval);
    const host = document.getElementById('xpc-host');
    if (host) host.remove();
    if (highlight) highlight.clear();
    console.info('[X Feed Analyzer] stopped:', reason);
  }

  function send(message, callback) {
    if (state.dead) return;
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (/context invalidated|Extension context/i.test(err.message || '')) markDead(err.message);
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      if (/context invalidated/i.test(String(e && e.message))) markDead(e.message);
    }
  }

  function flush() {
    if (!state.capture || !state.queue.size) { state.queue.clear(); return; }
    const posts = Array.from(state.queue.values());
    state.queue.clear();
    send({ type: 'upsert', posts }, (res) => {
      if (res && res.ok) {
        state.total = res.total;
        updatePanelStats();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Settings sync
  // ---------------------------------------------------------------------------

  let persistTimer = null;
  function persistFilter() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { chrome.storage.local.set({ filter: { ...state.filter } }); } catch (e) { /* ignore */ }
    }, 250);
  }

  // X's virtual scroller drops posts from the page once they're well off screen, so a new
  // pattern is tested against the text kept for every post seen in this tab, not just the DOM.
  function recountMatches() {
    state.sessionMatched.clear();
    if (!state.regex) return;
    for (const [id, post] of state.sessionPosts) {
      if (state.regex.test(fieldValue(post, state.filter.field))) state.sessionMatched.add(id);
    }
  }

  function rescanAll() {
    compileFilter();
    const key = state.regex ? `${state.regex.source}/${state.regex.flags}/${state.filter.field}` : '';
    if (key !== state.regexKey) { state.regexKey = key; recountMatches(); }
    scan();
    updatePanelStats();
    updatePanelError();
  }

  function loadSettings() {
    try {
      chrome.storage.local.get({ capture: true, filter: DEFAULT_FILTER }, (res) => {
        if (chrome.runtime.lastError) return;
        state.capture = res.capture !== false;
        state.filter = toFilter(res.filter);
        syncPanelFromState();
        rescanAll();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.capture) state.capture = changes.capture.newValue !== false;
        if (changes.filter) state.filter = toFilter(changes.filter.newValue);
        syncPanelFromState();
        rescanAll();
      });
    } catch (e) {
      // running without extension APIs; keep defaults
    }
  }

  // ---------------------------------------------------------------------------
  // Panel UI (Shadow DOM so X's styles can't touch it)
  // ---------------------------------------------------------------------------

  const PANEL_CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      width: 44px; height: 44px; border-radius: 50%; border: 0;
      background: #1d9bf0; color: #fff; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
      display: grid; place-items: center;
      font: 700 18px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .fab.active { background: #f4a52a; color: #111; }
    .fab:hover { filter: brightness(1.08); }
    .fab-badge {
      position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 999px; background: #0f1419; color: #fff; border: 2px solid #f4a52a;
      font: 700 10px/14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: grid; place-items: center;
    }
    .fab-badge[hidden] { display: none; }
    .panel {
      position: fixed; right: 20px; bottom: 76px; z-index: 2147483000; width: 360px; max-width: calc(100vw - 32px);
      background: #16181c; color: #e7e9ea; border: 1px solid #2f3336; border-radius: 16px; padding: 14px;
      box-shadow: 0 10px 34px rgba(0,0,0,.55);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .panel[hidden] { display: none; }
    .hd { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .title { font-weight: 700; font-size: 15px; }
    .grow { flex: 1; }
    .icon { background: transparent; border: 0; color: #8b98a5; font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 8px; }
    .icon:hover { background: #24272c; color: #fff; }
    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
    label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; color: #e7e9ea; }
    input[type="checkbox"], input[type="radio"] { accent-color: #1d9bf0; margin: 0; width: 14px; height: 14px; }
    input[type="text"] {
      flex: 1; min-width: 0; background: #0f1419; color: #e7e9ea; border: 1px solid #3b4046; border-radius: 8px;
      padding: 7px 9px; font: 13px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; outline: none;
    }
    input[type="text"]:focus { border-color: #1d9bf0; }
    input[type="text"].bad { border-color: #f4212e; }
    select {
      background: #0f1419; color: #e7e9ea; border: 1px solid #3b4046; border-radius: 8px; padding: 6px 8px;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 150px;
    }
    .btn {
      background: #1d9bf0; color: #fff; border: 0; border-radius: 999px; padding: 7px 14px; font-weight: 700; cursor: pointer;
      font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .btn:hover { filter: brightness(1.08); }
    .err { color: #f4212e; font-size: 12px; margin: 4px 0; word-break: break-word; }
    .err[hidden] { display: none; }
    .stats { color: #8b98a5; font-size: 12px; margin: 8px 0 4px; }
    .ctx { margin: 0 0 6px; line-height: 1.4; }
    .ctx[hidden] { display: none; }
    .btn.map { background: #202327; border: 1px solid #3b4046; }
    .stats b { color: #e7e9ea; }
    .muted { color: #8b98a5; font-size: 11px; }
    .modes label { padding: 4px 8px; border: 1px solid #3b4046; border-radius: 999px; font-size: 12px; }
    .modes label:has(input:checked) { border-color: #1d9bf0; background: rgba(29,155,240,.15); }
    .search-box { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
    .search-box input[type="text"] { width: 100%; padding-right: 92px; }
    .toggles { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; }
    .toggle {
      width: 26px; height: 22px; padding: 0; border-radius: 4px; border: 1px solid transparent;
      background: transparent; color: #8b98a5; cursor: pointer; display: grid; place-items: center;
    }
    .toggle:hover { background: #24272c; color: #e7e9ea; }
    .toggle[aria-pressed="true"] { background: rgba(29,155,240,.18); border-color: #1d9bf0; color: #e7e9ea; }
    .glyph { font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; letter-spacing: -0.02em; }
    .glyph.mono { font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .glyph.ww { position: relative; padding: 0 2px 2px; border-bottom: 1.5px solid currentColor; }
    .glyph.ww::before, .glyph.ww::after { content: ''; position: absolute; bottom: -1.5px; width: 1.5px; height: 4px; background: currentColor; }
    .glyph.ww::before { left: 0; }
    .glyph.ww::after { right: 0; }
    .regex-options { position: relative; font-size: 12px; color: #8b98a5; }
    .regex-options[hidden] { display: none; }
    .regex-options summary {
      cursor: pointer; list-style: none; user-select: none; white-space: nowrap;
      padding: 5px 9px; border: 1px solid #3b4046; border-radius: 8px; background: #0f1419;
    }
    .regex-options summary::-webkit-details-marker { display: none; }
    .regex-options summary::after { content: ' ▾'; }
    .regex-options[open] summary { border-color: #1d9bf0; }
    .regex-options .popover {
      position: absolute; bottom: calc(100% + 6px); right: 0; z-index: 1; width: 320px;
      background: #16181c; border: 1px solid #3b4046; border-radius: 12px; padding: 10px 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.5); display: grid; gap: 10px;
    }
    .opt { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; line-height: 1.4; color: #8b98a5; }
    .opt input { margin-top: 3px; flex: none; }
    .opt b { color: #e7e9ea; display: block; }
    .opt code { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; background: #24272c; padding: 0 4px; border-radius: 3px; color: #e7e9ea; }
    kbd { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b98a5; }
  `;

  let panel = null; // { host, shadow, els }

  function buildPanel() {
    if (panel || !document.body) return;
    const host = document.createElement('div');
    host.id = 'xpc-host';
    const shadow = host.attachShadow({ mode: 'closed' }); // closed: x.com's scripts can't read the filter
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = PANEL_CSS;
      shadow.appendChild(style);
    }

    const presetOptions = PRESETS.map((p, i) => `<option value="${i}">${p.label.replace(/</g, '&lt;')}</option>`).join('');
    shadow.innerHTML += `
      <button class="fab" title="X Feed Analyzer: live filter" aria-label="X Feed Analyzer live filter">⌕<span class="fab-badge" hidden>0</span></button>
      <div class="panel" hidden>
        <div class="hd">
          <span class="title">Live filter</span>
          <span class="muted">regex on posts as they load</span>
          <span class="grow"></span>
          <button class="icon close" title="Close" aria-label="Close">×</button>
        </div>
        <div class="row">
          <label><input type="checkbox" class="enabled"> Enable filter</label>
          <span class="grow"></span>
          <select class="preset" title="Smart content filters"><option value="">Smart content filters…</option>${presetOptions}</select>
        </div>
        <div class="row">
          <div class="search-box">
            <input type="text" class="pattern" placeholder="Search, e.g. —  or  [—–]  or  \\bdelve\\b" spellcheck="false" autocomplete="off">
            <div class="toggles" role="group" aria-label="Search options">
              <button type="button" class="toggle" data-opt="matchCase" aria-pressed="false" title="Match Case (Alt+C)"><span class="glyph">Aa</span></button>
              <button type="button" class="toggle" data-opt="wholeWord" aria-pressed="false" title="Match Whole Word (Alt+W)"><span class="glyph ww">ab</span></button>
              <button type="button" class="toggle" data-opt="regex" aria-pressed="true" title="Use Regular Expression (Alt+R)"><span class="glyph mono">.*</span></button>
            </div>
          </div>
        </div>
        <div class="row">
          <label>in
            <select class="field" title="Which field to search">
              <option value="text">Post text</option>
              <option value="handle">@handle</option>
              <option value="name">Display name</option>
              <option value="all">Text + author</option>
            </select>
          </label>
          <span class="grow"></span>
          <details class="regex-options">
            <summary title="Extra regular-expression flags">Regex options</summary>
            <div class="popover">
              <label class="opt"><input type="checkbox" data-opt="multiline"><span><b>Multiline</b><code>^</code> and <code>$</code> also match at line breaks inside a post.</span></label>
              <label class="opt"><input type="checkbox" data-opt="dotAll"><span><b>Dot matches newlines</b><code>.</code> can match a line break.</span></label>
              <label class="opt"><input type="checkbox" data-opt="unicode"><span><b>Unicode</b>Enables <code>\\p{Emoji}</code>-style classes; emoji count as one character.</span></label>
            </div>
          </details>
        </div>
        <div class="row modes">
          <label><input type="radio" name="mode" value="highlight"> Highlight</label>
          <label><input type="radio" name="mode" value="dim"> Dim others</label>
          <label><input type="radio" name="mode" value="hide"> Hide others</label>
        </div>
        <div class="err" hidden></div>
        <div class="stats"><b class="matched">0</b> matched of <b class="seen">0</b> seen this session · <b class="total">–</b> catalogued</div>
        <div class="muted ctx" hidden></div>
        <div class="row">
          <label title="Store posts you scroll past in the local catalogue"><input type="checkbox" class="capture"> Capture posts</label>
          <span class="grow"></span>
          <button class="btn map" title="Open the catalogue at the network map: who quotes, replies to and reposts whom">Network map</button>
          <button class="btn open">Open catalogue</button>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const q = (s) => shadow.querySelector(s);
    const els = {
      fab: q('.fab'), fabBadge: q('.fab-badge'), panel: q('.panel'), close: q('.close'),
      enabled: q('.enabled'), preset: q('.preset'), pattern: q('.pattern'),
      toggles: Array.from(shadow.querySelectorAll('.toggle')),
      regexOpts: Array.from(shadow.querySelectorAll('.regex-options input[data-opt]')),
      regexOptions: q('.regex-options'), field: q('.field'),
      modes: Array.from(shadow.querySelectorAll('input[name="mode"]')),
      err: q('.err'), matched: q('.matched'), seen: q('.seen'), total: q('.total'),
      capture: q('.capture'), open: q('.open'), map: q('.map'), ctx: q('.ctx'),
    };
    panel = { host, shadow, els };

    els.fab.addEventListener('click', () => {
      els.panel.hidden = !els.panel.hidden;
      if (!els.panel.hidden) els.pattern.focus();
    });
    els.close.addEventListener('click', () => { els.panel.hidden = true; });

    const onFilterInput = () => {
      const opts = { pattern: els.pattern.value };
      for (const b of els.toggles) opts[b.dataset.opt] = b.getAttribute('aria-pressed') === 'true';
      for (const c of els.regexOpts) opts[c.dataset.opt] = c.checked;
      state.filter = {
        ...XPCSearch.normalize(opts),
        enabled: els.enabled.checked,
        mode: (els.modes.find((r) => r.checked) || {}).value || 'highlight',
        field: els.field.value,
      };
      els.regexOptions.hidden = !state.filter.regex;
      rescanAll();
      persistFilter();
    };
    const flipToggle = (opt) => {
      const b = els.toggles.find((t) => t.dataset.opt === opt);
      if (!b) return;
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      onFilterInput();
    };
    els.enabled.addEventListener('change', onFilterInput);
    els.pattern.addEventListener('input', onFilterInput);
    els.toggles.forEach((b) => b.addEventListener('click', () => { flipToggle(b.dataset.opt); els.pattern.focus(); }));
    els.regexOpts.forEach((c) => c.addEventListener('change', onFilterInput));
    // Editor shortcuts while the pattern box is focused: Alt+C / Alt+W / Alt+R.
    els.pattern.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const opt = { KeyC: 'matchCase', KeyW: 'wholeWord', KeyR: 'regex' }[e.code];
      if (opt) { e.preventDefault(); flipToggle(opt); }
    });
    shadow.addEventListener('click', (e) => {
      if (els.regexOptions.open && !e.composedPath().includes(els.regexOptions)) els.regexOptions.open = false;
    });
    els.field.addEventListener('change', onFilterInput);
    els.modes.forEach((r) => r.addEventListener('change', onFilterInput));
    els.preset.addEventListener('change', () => {
      const p = PRESETS[Number(els.preset.value)];
      els.preset.value = '';
      if (!p) return;
      els.pattern.value = p.pattern;
      els.enabled.checked = true;
      for (const b of els.toggles) {
        if (b.dataset.opt === 'regex') b.setAttribute('aria-pressed', 'true');
        if (b.dataset.opt === 'wholeWord') b.setAttribute('aria-pressed', 'false');
      }
      onFilterInput();
    });
    els.capture.addEventListener('change', () => {
      state.capture = els.capture.checked;
      try { chrome.storage.local.set({ capture: state.capture }); } catch (e) { /* ignore */ }
      if (state.capture) { state.cache.clear(); scan(); }
    });
    els.open.addEventListener('click', () => send({ type: 'openViewer' }));
    els.map.addEventListener('click', () => send({ type: 'openViewer', hash: 'network' }));

    // Keep X's keyboard shortcuts from firing while typing in the panel.
    for (const evt of ['keydown', 'keyup', 'keypress']) {
      host.addEventListener(evt, (e) => e.stopPropagation());
    }

    syncPanelFromState();
    updatePanelStats();
  }

  function syncPanelFromState() {
    if (!panel) return;
    const { els } = panel;
    const f = state.filter;
    if (els.enabled.checked !== Boolean(f.enabled)) els.enabled.checked = Boolean(f.enabled);
    if (els.pattern.value !== (f.pattern || '')) els.pattern.value = f.pattern || '';
    for (const b of els.toggles) {
      const want = String(Boolean(f[b.dataset.opt]));
      if (b.getAttribute('aria-pressed') !== want) b.setAttribute('aria-pressed', want);
    }
    for (const c of els.regexOpts) { const want = Boolean(f[c.dataset.opt]); if (c.checked !== want) c.checked = want; }
    els.regexOptions.hidden = !f.regex;
    if (els.field.value !== (f.field || 'text')) els.field.value = f.field || 'text';
    els.modes.forEach((r) => { const want = r.value === (f.mode || 'highlight'); if (r.checked !== want) r.checked = want; });
    if (els.capture.checked !== Boolean(state.capture)) els.capture.checked = Boolean(state.capture);
    updatePanelError();
  }

  function updatePanelError() {
    if (!panel) return;
    const { els } = panel;
    if (state.regexError) {
      els.err.textContent = 'Invalid regex: ' + state.regexError;
      els.err.hidden = false;
      els.pattern.classList.add('bad');
    } else {
      els.err.hidden = true;
      els.pattern.classList.remove('bad');
    }
  }

  // What this page feeds into the network map, when it is one of the pages that grow it.
  function pageContext() {
    const p = location.pathname;
    let m;
    if ((m = QUOTES_PAGE.exec(p))) return `This page lists the posts quoting @${m[1]}’s post. Each one captured joins the network map as “quotes @${m[1]}”.`;
    if ((m = RETWEETS_PAGE.exec(p))) {
      const n = (state.reposters.get(m[2]) || new Set()).size;
      return `This page lists the accounts that reposted @${m[1]}’s post. ${n ? `${n} read so far; scroll for more.` : 'Scroll to read them.'} Each joins the network map as “reposts @${m[1]}”.`;
    }
    if ((m = STATUS_PAGE.exec(p))) return `This page shows the replies to @${m[1]}’s post. Each one captured joins the network map as “reply to @${m[1]}”.`;
    if ((m = REPLIES_TAB.exec(p))) return `@${m[1]}’s replies. Those shown with a “Replying to” line join the network map.`;
    return '';
  }

  function updatePanelStats() {
    if (!panel) return;
    const { els } = panel;
    const ctx = state.capture ? pageContext() : '';
    els.ctx.hidden = !ctx;
    els.ctx.textContent = ctx;
    const active = Boolean(state.regex);
    els.matched.textContent = active ? String(state.sessionMatched.size) : '–';
    els.seen.textContent = String(state.sessionPosts.size);
    els.total.textContent = state.total === null ? '–' : state.total.toLocaleString();
    els.fab.classList.toggle('active', active);
    els.fabBadge.hidden = !active;
    els.fabBadge.textContent = String(state.sessionMatched.size);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  const observer = new MutationObserver(scheduleScan);
  let rescanInterval = null;

  function boot() {
    buildPanel();
    loadSettings();
    send({ type: 'count' }, (res) => { if (res && res.ok) { state.total = res.total; updatePanelStats(); } });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    rescanInterval = setInterval(scan, 2000); // catches like/view counters that update in place
    scan();
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
