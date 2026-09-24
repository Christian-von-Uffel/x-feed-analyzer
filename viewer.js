// viewer.js — X Feed Analyzer viewer: regex search over the local catalogue.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const rt = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime : null;

  const PRESETS = XPCSearch.PRESETS;

  const PAGE = 100;
  const CENTER_VIEWS = ['posts', 'network', 'compare'];
  const STATE_KEY = 'xpc-viewer-state';

  const state = {
    posts: [],
    results: [],      // [{ post, hits }]
    shown: 0,
    regex: null,
    regexG: null,
    pendingNew: 0,
    filtered: [],     // posts passing the filters, before the pattern is applied
    filteredNoAuthor: [], // the same without the author filter: the author-comparison views use this
    filterSig: '',    // signature of the filters that produced `filtered`
    loadStamp: 0,     // bumped on every load() so caches keyed on posts invalidate
    panel: null,      // { view, model, svg } of the compare panel, shown on the page and exported
    panelSig: '',     // inputs that produced `panel`; unchanged inputs skip the rebuild
    panelBack: null,  // { author, options, label } from before a click on a word / row / cell, so it can be undone
    baseSig: '',      // signature of the filters that produced `filteredNoAuthor` (no author filter, no network pick)
    typeCounts: {},   // per post type: how many results carry it, ignoring the type filter (plus `all`)
    legacyMedia: 0,   // results captured before images and videos were told apart
    rangeMode: { likes: 'min', reposts: 'min', chars: 'min' }, // per threshold slider: an exact minimum, or a top share (%) of the matching posts
    rangeCut: { likes: 0, reposts: 0, chars: 0 }, // the minimum each slider applied in the last apply(), a top-% slider's worked out from the posts
    rangeRanked: {},  // per top-% slider: the values it ranks, ascending (Infinity = truncated, always long)
    pick: null,       // { kind: 'node' | 'edge', ..., label } from a click on the network: the list shows only the posts behind it
    network: null,    // { model, svg, renderOpts, applyView } of the interaction network, shown on the page and exported
    networkSig: '',   // inputs that produced `network`; unchanged inputs keep the layout (and any dragging) as it is
    nwFocus: null,    // handle the network is focused on (its ego network), or null
    nwView: { k: 1, tx: 0, ty: 0 }, // pan and zoom of the on-page graph
    listMode: 'by',   // with an account chosen: 'by' lists their posts, 'interactions' the posts behind their connections
    listModeEffective: 'by', // what the list actually shows (an account with no captured posts falls back to interactions)
    focusCounts: null, // { by, interactions } for the chosen account, behind the toggle
    handles: new Set(), // every captured handle, lower-case
    view: 'posts',    // what the main column shows: 'posts', or the 'network' map or the 'compare' (topics) panel expanded
    paneTab: 'account', // context pane tab: 'account' (the map and the account's numbers) or 'topics'
    ctxSig: '',       // inputs that produced the account details
    quoteCounts: new Map(), // post id -> how many captured posts quote it
    termTrail: [],    // cloud words clicked in the term cloud after the typed term: every one must appear too
    chord: null,      // the X search tray while open: { groups, accounts, armed, held, seeded, editing }
    chordScope: 'them', // who that X search covers: 'them' (the tray's accounts), 'others' (everyone but them) or 'all'
    chordPin: false,  // keep the tray open when Shift comes up (persisted)
  };

  const MATRIX_SIZE = 1080;

  const els = {
    pattern: $('#pattern'),
    toggles: Array.from(document.querySelectorAll('.toggle[data-opt]')),
    regexOpts: Array.from(document.querySelectorAll('#regex-flags input[data-opt]')),
    regexFlags: $('#regex-flags'), searchMenu: $('#search-menu'),
    preset: $('#preset'), author: $('#author'), authorWrap: $('.chip-wrap'), authorClear: $('#author-clear'), authorX: $('#author-x'), from: $('#from'), to: $('#to'),
    types: Array.from(document.querySelectorAll('.types input.type')), typesAll: $('#types-all'), typesAllN: $('#types-all-n'),
    typesSummary: $('#types-summary'), typeHint: $('#type-hint'), pickPill: $('#pick-pill'),
    exportMenu: $('#export-menu'), selTools: $('#sel-tools'), toast: $('#toast'),
    chips: $('#filter-chips'),
    posts: $('#posts'), expanded: $('#expanded'), expandedTitle: $('#expanded-title'), expandedClose: $('#expanded-close'), centerHost: $('#center-host'),
    nwHost: $('#nw-host'), mxHost: $('#mx-host'), nwAway: $('#nw-away'), mxAway: $('#mx-away'), acctDetails: $('#acct-details'),
    ctxTabs: Array.from(document.querySelectorAll('.ctx-tabs button')), ctxAccount: $('#ctx-account'), ctxTopics: $('#ctx-topics'), nwExpand: $('#nw-expand'), mxExpand: $('#mx-expand'),
    minLikes: $('#min-likes'), minReposts: $('#min-reposts'), minChars: $('#min-chars'), sortSeg: $('#sort'), listMode: $('#list-mode'), minPosts: $('#min-posts'),
    ranges: Array.from(document.querySelectorAll('.range')),
    theme: $('#theme'), error: $('#error'), list: $('#list'), empty: $('#empty'), more: $('#more'), resultCount: $('#result-count'),
    kpiPosts: $('#kpi-posts'), kpiAuthors: $('#kpi-authors'),
    authorRows: $('#author-rows'), authorsHint: $('#authors-hint'), newPill: $('#new-pill'),
    authorSuggest: $('#author-suggest'),
    matrix: $('#matrix'), mxKeywords: $('#mx-keywords'), mxTitle: $('#mx-title'), mxMetric: $('#mx-metric'),
    mxRows: $('#mx-rows'), mxTheme: $('#mx-theme'), mxTable: $('#mx-table'), mxError: $('#mx-error'), mxExport: $('#mx-export'),
    mxView: $('#mx-view'), mxTableWrap: $('#mx-table-wrap'), mxTableHead: $('#mx-table-head'), mxTableBody: $('#mx-table-body'),
    mxTabs: Array.from(document.querySelectorAll('.mx-tab')), mxTerm: $('#mx-term'), mxTermCount: $('#mx-term-count'),
    mxWeight: $('#mx-weight'), mxWords: $('#mx-words'), mxHint: $('#mx-hint'),
    mxTrail: $('#mx-trail'), chordTray: $('#chord-tray'), chordOpen: $('#chord-open'), chordSuggest: $('#chord-suggest'),
    chordAccts: $('#chord-accts'), chordWords: $('#chord-words'), chordAcctIn: $('#chord-acct-in'), chordWordIn: $('#chord-word-in'),
    chordSeg: $('#chord-seg'), chordNote: $('#chord-note'), chordPin: $('#chord-pin'), chordGo: $('#chord-go'), chordQ: $('#chord-q'),
    mxBack: $('#mx-back'), resultsBack: $('#results-back'), resultsHead: $('.results-head'),
    network: $('#network'), nwTypes: Array.from(document.querySelectorAll('input[data-nw-type]')), nwMin: $('#nw-min'), nwNodes: $('#nw-nodes'),
    nwPattern: $('#nw-pattern'), nwTitle: $('#nw-title'), nwTheme: $('#nw-theme'), nwExport: $('#nw-export'),
    nwUnfocus: $('#nw-unfocus'), nwChoose: $('#nw-choose'), nwFocusLine: $('#nw-focus'), nwError: $('#nw-error'), nwView: $('#nw-view'), nwTip: $('#nw-tip'), nwCard: $('#nw-card'), nwStage: $('.nw-stage'),
    nwSummary: $('#nw-summary'), nwCapture: $('#nw-capture'), views: Array.from(document.querySelectorAll('.views a')),
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const fmtNum = (n) => {
    if (n === null || n === undefined) return '–';
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Non-empty lines in a post: paragraphs plus list items, the shape talking points arrive in.
  const lineCount = (text) => (text ? String(text).split('\n').filter((l) => l.trim()).length : 0);

  function countMatches(str) {
    const re = state.regexG;
    re.lastIndex = 0;
    let n = 0;
    let m;
    while ((m = re.exec(str)) && n < 1000) {
      if (m[0].length === 0) re.lastIndex++;
      n++;
    }
    return n;
  }

  // Web addresses in post text. X keeps each link's whole address in the page and only hides the
  // part past its display cut, so the capture holds it in full, usually followed by X's "…".
  const TEXT_URL_RE = /https?:\/\/[^\s…<>"]+/gi;

  // Sentence punctuation after an address is not part of it; a ")" is only when the address opened one.
  function trimUrl(s) {
    s = s.replace(/[.,;:!?'"]+$/, '');
    if (s.endsWith(')') && !s.includes('(')) s = s.slice(0, -1);
    return s;
  }

  // An http(s) href for a captured link ("https://…", or a bare "example.com/path" from a link
  // card), or null. Imports are untrusted, so nothing but http and https reaches an <a>.
  function webHref(s) {
    s = trimUrl(String(s || '').trim());
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (e) { return null; }
  }

  function webLink(text, href) {
    const a = document.createElement('a');
    a.className = 'web';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  }

  // The post text with the pattern's matches marked and its web addresses made links.
  function highlighted(text) {
    const frag = document.createDocumentFragment();
    const marks = [];
    const re = state.regexG;
    if (re) {
      re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = re.exec(text)) && guard++ < 2000) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        marks.push([m.index, m.index + m[0].length]);
      }
    }
    const urls = [];
    for (const m of text.matchAll(TEXT_URL_RE)) {
      const url = trimUrl(m[0]);
      const href = webHref(url);
      if (href) urls.push([m.index, m.index + url.length, href]);
    }
    if (!marks.length && !urls.length) { frag.append(text); return frag; }

    // Cut the text wherever a match or an address starts or ends, then rebuild it piece by piece,
    // so a match that runs into or out of an address is still marked.
    const cuts = new Set([0, text.length]);
    for (const [s, e] of marks) { cuts.add(s); cuts.add(e); }
    for (const [s, e] of urls) { cuts.add(s); cuts.add(e); }
    const at = Array.from(cuts).sort((x, y) => x - y);
    let mi = 0;
    let ui = 0;
    let openUrl = null;
    let a = null;
    for (let i = 0; i < at.length - 1; i++) {
      const s = at[i];
      const piece = text.slice(s, at[i + 1]);
      while (mi < marks.length && marks[mi][1] <= s) mi++;
      while (ui < urls.length && urls[ui][1] <= s) ui++;
      const url = ui < urls.length && urls[ui][0] <= s ? urls[ui] : null;
      if (url !== openUrl) {
        openUrl = url;
        a = url ? webLink('', url[2]) : null;
        if (a) frag.append(a);
      }
      const parent = a || frag;
      if (mi < marks.length && marks[mi][0] <= s) {
        const mark = document.createElement('mark');
        mark.textContent = piece;
        parent.append(mark);
      } else {
        parent.append(piece);
      }
    }
    return frag;
  }

  // ---------------------------------------------------------------------------
  // Search options (editor-style toggles + regex flags popover)
  // ---------------------------------------------------------------------------

  function getOptions() {
    const o = { pattern: els.pattern.value };
    for (const b of els.toggles) o[b.dataset.opt] = b.getAttribute('aria-pressed') === 'true';
    for (const c of els.regexOpts) o[c.dataset.opt] = c.checked;
    return XPCSearch.normalize(o);
  }

  function setOptions(raw) {
    const o = XPCSearch.normalize(raw);
    els.pattern.value = o.pattern;
    for (const b of els.toggles) b.setAttribute('aria-pressed', String(o[b.dataset.opt]));
    for (const c of els.regexOpts) c.checked = o[c.dataset.opt];
    els.regexFlags.hidden = !o.regex;
  }

  function flipToggle(opt) {
    const b = els.toggles.find((t) => t.dataset.opt === opt);
    if (!b) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    apply();
  }

  // ---------------------------------------------------------------------------
  // Persisted UI state
  // ---------------------------------------------------------------------------

  function saveState() {
    const s = {
      ...getOptions(),
      author: els.author.value,
      from: els.from.value,
      to: els.to.value,
      types: selectedTypes(),
      minLikes: els.minLikes.value,
      minReposts: els.minReposts.value,
      minChars: els.minChars.value,
      rangeMode: { ...state.rangeMode },
      sort: getSort(),
      listMode: state.listMode,
      minPosts: els.minPosts.value,
      view: state.view,
      paneTab: state.paneTab,
      mxView: panelView(),
      mxTerm: els.mxTerm.value,
      mxTrail: state.termTrail,
      chordScope: state.chordScope,
      chordPin: state.chordPin,
      mxWeight: els.mxWeight.value,
      mxWords: els.mxWords.value,
      mxKeywords: els.mxKeywords.value,
      mxTitle: els.mxTitle.value,
      mxMetric: els.mxMetric.value,
      mxRows: els.mxRows.value,
      mxTheme: els.mxTheme.value,
      theme: els.theme.value,
      mxTable: els.mxTable.checked,
      nwTypes: nwTypes(),
      nwMin: els.nwMin.value,
      nwNodes: els.nwNodes.value,
      nwPattern: els.nwPattern.checked,
      nwTitle: els.nwTitle.value,
      nwTheme: els.nwTheme.value,
    };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function restoreState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!s) return;
    setOptions(s); // understands both the current shape and the old { flags, literal } one
    els.author.value = s.author || '';
    els.from.value = s.from || '';
    els.to.value = s.to || '';
    // Post types: a list of selected kinds. The older per-chip modes keep their "only" chips.
    setSelectedTypes(Array.isArray(s.types) ? s.types
      : s.types && typeof s.types === 'object' ? Object.keys(s.types).filter((t) => s.types[t] === 'only') : []);
    els.minLikes.value = s.minLikes || '';
    els.minReposts.value = s.minReposts || '';
    els.minChars.value = s.minChars || '';
    for (const k of RANGE_KEYS) state.rangeMode[k] = s.rangeMode && s.rangeMode[k] === 'top' ? 'top' : 'min';
    setSort(s.sort || 'captured');
    state.listMode = s.listMode === 'interactions' ? 'interactions' : 'by';
    els.minPosts.value = s.minPosts || '3';
    state.view = CENTER_VIEWS.includes(s.view) ? s.view : 'posts';
    state.paneTab = s.paneTab === 'topics' ? 'topics' : 'account';
    setPanelView(s.mxView || 'authors');
    els.mxTerm.value = s.mxTerm || '';
    state.termTrail = Array.isArray(s.mxTrail) ? s.mxTrail.filter((w) => typeof w === 'string' && w) : [];
    state.chordScope = ['them', 'others', 'all'].includes(s.chordScope) ? s.chordScope : 'them';
    state.chordPin = s.chordPin === true;
    els.mxWeight.value = s.mxWeight === 'frequent' ? 'frequent' : 'distinctive';
    els.mxWords.value = s.mxWords || '60';
    els.mxKeywords.value = s.mxKeywords || '';
    els.mxTitle.value = s.mxTitle || '';
    els.mxMetric.value = s.mxMetric || 'posts';
    els.mxRows.value = s.mxRows || '12';
    els.mxTheme.value = s.mxTheme || 'auto';
    els.theme.value = s.theme || 'light';
    applyTheme();
    els.mxTable.checked = Boolean(s.mxTable);
    if (s.nwTypes && typeof s.nwTypes === 'object') for (const c of els.nwTypes) c.checked = s.nwTypes[c.dataset.nwType] !== false;
    els.nwMin.value = s.nwMin || '1';
    els.nwNodes.value = s.nwNodes || '60';
    els.nwPattern.checked = Boolean(s.nwPattern);
    els.nwTitle.value = s.nwTitle || '';
    els.nwTheme.value = s.nwTheme || 'auto';
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  function compile() {
    const r = XPCSearch.compile(getOptions());
    state.regex = r.regex;
    state.regexG = r.regexG;
    els.regexFlags.hidden = !r.options.regex;
    if (r.error) {
      els.error.textContent = 'Invalid regex: ' + r.error;
      els.error.hidden = false;
      els.pattern.classList.add('bad');
    } else {
      els.error.hidden = true;
      els.pattern.classList.remove('bad');
    }
  }

  function readFilters() {
    const authorRaw = els.author.value.trim();
    return {
      authorExact: authorRaw.startsWith('@') ? authorRaw.slice(1).toLowerCase() : null,
      authorSub: authorRaw && !authorRaw.startsWith('@') ? authorRaw.toLowerCase() : null,
      from: els.from.value ? new Date(els.from.value + 'T00:00:00').getTime() : null,
      to: els.to.value ? new Date(els.to.value + 'T23:59:59.999').getTime() : null,
      types: selectedTypes(),
      // Exact minimums; a top-% slider's is worked out in apply() from the posts the other filters leave.
      minLikes: state.rangeMode.likes === 'min' ? Number(els.minLikes.value) || 0 : 0,
      minReposts: state.rangeMode.reposts === 'min' ? Number(els.minReposts.value) || 0 : 0,
      minChars: state.rangeMode.chars === 'min' ? Number(els.minChars.value) || 0 : 0,
      top: Object.fromEntries(RANGE_KEYS.map((k) => [k, state.rangeMode[k] === 'top' ? Math.min(100, Number(rangeInputs()[k].value) || 0) : 0])),
      sort: getSort(),
      focus: authorRaw.startsWith('@') ? authorRaw.slice(1) : null, // the account chip, when it names one account
    };
  }

  function passesAuthor(post, q) {
    if (q.authorExact !== null && (post.handle || '').toLowerCase() !== q.authorExact) return false;
    if (q.authorSub !== null) {
      const h = (post.handle || '').toLowerCase();
      const n = (post.name || '').toLowerCase();
      if (!h.includes(q.authorSub) && !n.includes(q.authorSub)) return false;
    }
    return true;
  }

  // The date filter. The author, type, threshold and network-pick filters are applied separately.
  function passesDate(post, q) {
    if (q.from === null && q.to === null) return true;
    const t = post.time ? new Date(post.time).getTime() : NaN;
    if (q.from !== null && !(t >= q.from)) return false;
    if (q.to !== null && !(t <= q.to)) return false;
    return true;
  }

  // The three threshold sliders. X collapses long posts behind “Show more” and we may only hold
  // the preview, so a truncated post is long-form by definition and passes the length filter.
  const RANGE_KEYS = ['likes', 'reposts', 'chars'];
  const rangeValue = (post, key) => (key === 'likes' ? (post.likes || 0) : key === 'reposts' ? (post.reposts || 0) : (post.text || '').length);
  const rangeMin = (q, key) => (key === 'likes' ? q.minLikes : key === 'reposts' ? q.minReposts : q.minChars);
  const setRangeMin = (q, key, v) => { q[key === 'likes' ? 'minLikes' : key === 'reposts' ? 'minReposts' : 'minChars'] = v; };
  const passesRange = (post, q, key) => !rangeMin(q, key) || (key === 'chars' && post.truncated) || rangeValue(post, key) >= rangeMin(q, key);

  // ---------------------------------------------------------------------------
  // Threshold sliders: min likes, min reposts, min chars. Each draws the distribution of the posts
  // passing every other filter behind its thumb, with p50 / p90 / p99 ticks, and says how many
  // posts pass. All three are heavy-tailed, so their tracks are log-scaled (linear when the range
  // is tiny). The number box next to each slider takes an exact value and is what gets persisted.
  // ---------------------------------------------------------------------------

  const POS_MAX = 1000;
  const BINS = 40;
  const rangeInputs = () => ({ likes: els.minLikes, reposts: els.minReposts, chars: els.minChars });

  function rangeScale(key, max) {
    if (max < 20) {
      return { toValue: (pos) => Math.round((pos / POS_MAX) * max), toPos: (v) => (max ? (Math.min(v, max) / max) * POS_MAX : 0) };
    }
    const L = Math.log(max + 1);
    return { toValue: (pos) => Math.round(Math.exp((pos / POS_MAX) * L) - 1), toPos: (v) => (Math.log(Math.max(0, Math.min(v, max)) + 1) / L) * POS_MAX };
  }

  // Number of values >= v in a sorted array.
  function countAtLeast(sorted, v) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return sorted.length - lo;
  }
  const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);

  // The minimum that keeps the top `pct`% of `sorted` (ascending; Infinity = a truncated post, long
  // whatever its captured length). Ties make an exact share impossible, so of "at least v" and
  // "more than v" (v the value at the cut) it takes whichever keeps a share nearer the asked one,
  // the smaller on a tie, but never nothing when the posts are all tied.
  function topCutoff(sorted, pct) {
    const n = sorted.length;
    if (!n || pct >= 100) return 0;
    const want = Math.max(1, Math.round((n * pct) / 100));
    let v = sorted[n - want];
    const atLeast = countAtLeast(sorted, v);
    const above = countAtLeast(sorted, v + 1); // counts are whole numbers
    if (above && Math.abs(above - want) <= Math.abs(atLeast - want)) v = sorted[n - above];
    // Only truncated posts make the cut: any captured length above the longest full post will do.
    if (v === Infinity) v = (sorted.filter(Number.isFinite).pop() || 0) + 1;
    return v;
  }

  const rangeUnit = { likes: 'likes', reposts: 'reposts', chars: 'chars' };
  const isTop = (key) => state.rangeMode[key] === 'top';
  // The minimum a slider stands for right now: its number, or for a top-% slider the cutoff of that share.
  function rangeCutNow(key) {
    const n = Number(rangeInputs()[key].value) || 0;
    if (!isTop(key)) return n;
    const ranked = state.rangeRanked[key];
    if (n <= 0 || n >= 100 || !ranked) return 0;
    return topCutoff(ranked, n);
  }

  function renderRanges() {
    const inputs = rangeInputs();
    for (const el of els.ranges) {
      const key = el.dataset.key;
      const values = (state.rangeCtx && state.rangeCtx[key]) ? state.rangeCtx[key].slice().sort((a, b) => a - b) : [];
      const max = values.length ? values[values.length - 1] : 0;
      const scale = rangeScale(key, max);
      const thumb = el.querySelector('.thumb');
      const hist = el.querySelector('.hist');
      const ticks = el.querySelector('.ticks');
      const ro = el.querySelector('.ro');
      const topMode = isTop(key);
      const pctSet = topMode ? Math.min(100, Number(inputs[key].value) || 0) : 0;
      const current = rangeCutNow(key);
      el.querySelector('.rl').textContent = (topMode ? 'top ' : 'min ') + rangeUnit[key];
      for (const b of el.querySelectorAll('.rmode button')) b.setAttribute('aria-checked', String(b.dataset.mode === state.rangeMode[key]));
      const box = inputs[key];
      box.max = topMode ? '100' : '';
      box.step = topMode ? '1' : key === 'chars' ? '100' : '1';
      box.placeholder = topMode ? '100' : '0';
      box.setAttribute('aria-label', topMode ? `Top share of posts by ${rangeUnit[key]}, in percent` : `Minimum ${rangeUnit[key]}, exact value`);
      el.classList.toggle('empty', !values.length);
      thumb.disabled = !values.length;
      el.dataset.max = String(max);
      // Histogram: counts per bin along the track, square-rooted so the long tail stays visible.
      const bins = new Array(BINS).fill(0);
      for (const v of values) bins[Math.min(BINS - 1, Math.floor((scale.toPos(v) / POS_MAX) * BINS))]++;
      const top = Math.sqrt(Math.max(1, ...bins));
      const cut = scale.toPos(current);
      hist.innerHTML = bins.map((n, i) => {
        if (!n) return '';
        const h = Math.max(0.6, (Math.sqrt(n) / top) * 20);
        const out = ((i + 1) / BINS) * POS_MAX <= cut ? ' class="out"' : '';
        return `<rect x="${i}" y="${(20 - h).toFixed(2)}" width="1" height="${h.toFixed(2)}"${out}><title>${n.toLocaleString()} posts</title></rect>`;
      }).join('');
      // Percentile ticks
      ticks.textContent = '';
      if (values.length >= 4 && max > 0) {
        let lastLeft = -1;
        for (const [p, label] of [[0.5, 'p50'], [0.9, 'p90'], [0.99, 'p99']]) {
          const v = percentile(values, p);
          const left = (scale.toPos(v) / POS_MAX) * 100;
          if (left - lastLeft < 9) continue; // labels would collide
          lastLeft = left;
          const t = document.createElement('div');
          t.className = 'tick';
          t.style.left = left.toFixed(1) + '%';
          t.title = `${label}: ${v.toLocaleString()} ${rangeUnit[key]}`;
          const sp = document.createElement('span');
          sp.textContent = label;
          t.append(sp);
          ticks.append(t);
        }
      }
      thumb.value = String(Math.round(scale.toPos(current)));
      // Truncated posts below the cut still pass the length sliders, so count them in.
      const trunc = (state.rangeTrunc && state.rangeTrunc[key]) ? state.rangeTrunc[key].slice().sort((a, b) => a - b) : [];
      const n = countAtLeast(values, current) + (trunc.length - countAtLeast(trunc, current));
      const pct = values.length ? (n / values.length) * 100 : 0;
      const pctText = n && pct < 1 ? '<1%' : Math.round(pct) + '%';
      if (topMode && pctSet > 0 && pctSet < 100) {
        ro.innerHTML = `top <b>${pctSet}%</b> · ≥ ${current.toLocaleString()} · ${n.toLocaleString()} of ${values.length.toLocaleString()}` + (Math.round(pct) !== pctSet ? ` (${pctText})` : '');
        ro.title = `The top ${pctSet}% of these posts by ${rangeUnit[key]} have at least ${current.toLocaleString()}; the cutoff moves as the pattern and the other filters change.` + (Math.round(pct) !== pctSet ? ' Posts tied at the cutoff make the share inexact.' : '');
      } else {
        ro.innerHTML = current
          ? `≥ <b>${current.toLocaleString()}</b> · ${n.toLocaleString()} of ${values.length.toLocaleString()} (${pctText})`
          : `any · ${values.length.toLocaleString()} ${values.length === 1 ? 'post' : 'posts'}`;
        ro.title = '';
      }
    }
  }

  function wireRanges() {
    const inputs = rangeInputs();
    for (const el of els.ranges) {
      const key = el.dataset.key;
      const thumb = el.querySelector('.thumb');
      thumb.addEventListener('input', () => {
        const max = Number(el.dataset.max) || 0;
        const v = rangeScale(key, max).toValue(Number(thumb.value));
        inputs[key].value = !v ? '' : isTop(key) ? String(shareAtLeast(key, v) || '') : String(v);
        renderRanges(); // readout and shading move with the thumb; the list follows after the debounce
        applyDebounced();
      });
      // ≥ / top %: the number carries over as the same cut, so switching alone changes nothing.
      el.querySelector('.rmode').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-mode]');
        if (!b || b.dataset.mode === state.rangeMode[key]) return;
        const cut = rangeCutNow(key);
        const pct = cut ? shareAtLeast(key, cut) : 0; // measured in the mode being left
        state.rangeMode[key] = b.dataset.mode;
        if (b.dataset.mode === 'min') inputs[key].value = cut ? String(cut) : '';
        else inputs[key].value = pct && pct < 100 ? String(pct) : '';
        apply();
      });
    }
  }

  // The whole-percent share of a top-% slider's posts with at least `v`, 1 at the least.
  function shareAtLeast(key, v) {
    const ranked = isTop(key) ? state.rangeRanked[key] || []
      : ((state.rangeCtx && state.rangeCtx[key]) || []).slice().sort((a, b) => a - b);
    if (!ranked.length) return 0;
    const n = countAtLeast(ranked, v) + (key === 'chars' && !isTop(key) ? truncBelow(v) : 0);
    return Math.max(1, Math.min(100, Math.round((n / ranked.length) * 100)));
  }
  const truncBelow = (v) => ((state.rangeTrunc && state.rangeTrunc.chars) || []).filter((x) => x < v).length;

  // ---------------------------------------------------------------------------
  // Post types: reply, repost, quote, original, image, video, link. A multi-select dropdown:
  // nothing ticked (= "all posts") shows everything; tick some and a post shows if it is any of them.
  // ---------------------------------------------------------------------------

  const TYPES = ['reply', 'repost', 'quote', 'original', 'image', 'video', 'link'];
  // Same pattern as the "Contains a link" smart filter, for posts captured before links were recorded.
  const LINK_RE = /\b(?:https?:\/\/|[a-z0-9-]+\.[a-z]{2,}(?:\/|\b))/i;

  function typeFlags(post) {
    return {
      reply: Boolean(post.isReply),
      repost: Boolean(post.isRepost),
      quote: Boolean(post.isQuote),
      original: !post.isReply && !post.isRepost && !post.isQuote,
      image: Boolean(post.hasImage),
      video: Boolean(post.hasVideo),
      link: post.hasLink === undefined || post.hasLink === null ? LINK_RE.test(post.text || '') : Boolean(post.hasLink),
    };
  }
  // Captured before images and videos were told apart: media of an unknown kind.
  const legacyMedia = (post) => Boolean(post.hasMedia) && post.hasImage === undefined;

  const selectedTypes = () => els.types.filter((c) => c.checked).map((c) => c.dataset.type);
  function setSelectedTypes(list) {
    const s = new Set(Array.isArray(list) ? list.filter((t) => TYPES.includes(t)) : []);
    for (const c of els.types) c.checked = s.has(c.dataset.type);
    syncTypesAll();
  }
  // "all posts" is ticked exactly when nothing else is; the summary names what is selected.
  function syncTypesAll() {
    const sel = els.types.filter((c) => c.checked);
    els.typesAll.checked = !sel.length;
    const names = sel.map((c) => c.parentElement.querySelector('.l').textContent);
    els.typesSummary.textContent = !sel.length ? 'all' : names.length <= 3 ? names.join(', ') : `${names.length} kinds`;
  }
  const passesTypes = (selected, flags) => !selected.length || selected.some((t) => flags[t]);

  // Narrowing from a click on the network: the posts behind one account's connections, or one connection.
  function passesPick(post, pick) {
    if (!pick) return true;
    if (pick.kind === 'quotesOf') return Boolean(post.quotedId) && post.quotedId === pick.id;
    const edges = XPCNetwork.edgesOf(post, pick.types);
    if (pick.kind === 'edge' || pick.kind === 'pair') {
      const from = pick.from.toLowerCase();
      const to = pick.to.toLowerCase();
      return edges.some((e) => (pick.kind === 'pair' || e.type === pick.type) && e.from.toLowerCase() === from && e.to.toLowerCase() === to);
    }
    const h = pick.handle.toLowerCase();
    return edges.some((e) => e.from.toLowerCase() === h || e.to.toLowerCase() === h);
  }

  // ---------------------------------------------------------------------------
  // One account for the whole page: the chip in the scope bar. Set from anywhere (an author row,
  // a handle on a card, a circle on the map, the address bar); the list, the map and the clouds
  // all read it. With an account chosen the list shows the posts by them or, on the toggle, the
  // posts behind their connections (what a click on the map used to show).
  // ---------------------------------------------------------------------------

  function setFocus(handle) {
    els.author.value = handle ? '@' + handle : '';
    state.pick = null; // an arrow pick belongs to the previous map
    state.nwView = { k: 1, tx: 0, ty: 0 };
    apply();
  }

  function renderFocusChip() {
    els.authorWrap.classList.toggle('set', Boolean(state.nwFocus));
    els.authorClear.hidden = !els.author.value;
    els.authorX.hidden = !state.nwFocus;
    if (state.nwFocus) {
      els.authorX.href = `https://x.com/${encodeURIComponent(state.nwFocus)}`;
      els.authorX.title = `Open @${state.nwFocus} on X`;
    }
  }

  function renderListMode() {
    const focus = state.nwFocus;
    els.listMode.hidden = !focus;
    if (!focus) return;
    const c = state.focusCounts || { by: 0, interactions: 0 };
    for (const b of els.listMode.querySelectorAll('button')) {
      const m = b.dataset.mode;
      const on = m === state.listModeEffective;
      b.setAttribute('aria-checked', String(on));
      b.disabled = !on && !c[m];
      b.textContent = m === 'by' ? `By @${focus} · ${c.by.toLocaleString()}` : `Interactions with @${focus} · ${c.interactions.toLocaleString()}`;
      b.title = m === 'by' ? `Posts written by @${focus}` : `Posts that quote, reply to, repost or mention @${focus}, and @${focus}'s posts that do that to others`;
    }
  }

  // Sort order: a segmented control in the results header. "Matches" only exists with a pattern.
  const SORT_LABELS = { newest: 'newest first', oldest: 'oldest first', likes: 'most liked first', views: 'most viewed first', longest: 'longest first', hits: 'most matches first', captured: 'recently captured first' };
  const sortButtons = () => Array.from(els.sortSeg.querySelectorAll('button[data-sort]'));
  const getSort = () => { const b = sortButtons().find((x) => x.getAttribute('aria-checked') === 'true'); return b ? b.dataset.sort : 'captured'; };
  function setSort(v) {
    const known = sortButtons().some((b) => b.dataset.sort === v) ? v : 'captured';
    for (const b of sortButtons()) b.setAttribute('aria-checked', String(b.dataset.sort === known));
  }
  const effectiveSort = (sort) => (sort === 'hits' && !state.regex ? 'newest' : sort);

  // Chips in the scope bar for the thresholds set in the rail.
  function renderChips() {
    const inputs = rangeInputs();
    const active = RANGE_KEYS.map((k) => ({ key: k, value: Number(inputs[k].value) || 0, top: isTop(k) })).filter((c) => c.value > 0 && !(c.top && c.value >= 100));
    els.chips.textContent = '';
    els.chips.hidden = !active.length;
    for (const c of active) {
      const el = document.createElement('span');
      el.className = 'chip';
      el.append(c.top ? `top ${c.value}% ${rangeUnit[c.key]} (≥ ${state.rangeCut[c.key].toLocaleString()})` : `${rangeUnit[c.key]} ≥ ${c.value.toLocaleString()}`);
      const x = document.createElement('button');
      x.type = 'button';
      x.title = 'Remove this filter';
      x.textContent = '✕';
      x.addEventListener('click', () => { inputs[c.key].value = ''; apply(); });
      el.append(x);
      els.chips.append(el);
    }
  }

  // The address carries the section and the account: viewer.html#network&account=hub_beta.
  function parseHash() {
    const out = { section: null, account: null };
    for (const part of location.hash.replace(/^#/, '').split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq < 0) { if (CENTER_VIEWS.includes(part)) out.section = part; continue; }
      if (part.slice(0, eq) === 'account') { try { out.account = decodeURIComponent(part.slice(eq + 1)).replace(/^@/, ''); } catch (e) { /* ignore */ } }
    }
    return out;
  }
  function syncHash() {
    const parts = [];
    if (state.view && state.view !== 'posts') parts.push(state.view);
    if (state.nwFocus) parts.push('account=' + encodeURIComponent(state.nwFocus));
    const h = parts.length ? '#' + parts.join('&') : '';
    if (h !== location.hash) history.replaceState(null, '', h || location.pathname + location.search);
  }
  // A hash typed or pasted into the address bar (the header links keep the account themselves).
  function applyHash() {
    const h = parseHash();
    if (h.account && (state.nwFocus || '').toLowerCase() !== h.account.toLowerCase()) setFocus(h.account);
    if (h.section && h.section !== state.view) setView(h.section);
  }

  function apply() {
    compile();
    const q = readFilters();
    const focus = q.focus;
    state.nwFocus = focus;
    // With an account chosen the list shows the posts by them, or the posts behind their
    // connections; an account none of whose posts are captured can only show the latter.
    const mode = focus ? (state.listMode === 'interactions' || !state.handles.has(focus.toLowerCase()) ? 'interactions' : 'by') : 'by';
    state.listModeEffective = mode;
    const nodePick = focus ? { kind: 'node', handle: focus, types: nwTypeSet() } : null;
    const inList = (post) => {
      if (state.pick) return passesPick(post, state.pick); // an arrow click narrows to the posts behind that connection
      if (mode === 'interactions') return passesPick(post, nodePick);
      return passesAuthor(post, q);
    };
    const authors = new Map();
    const everyone = new Map(); // every captured user, ignoring filters — feeds the account chip
    const results = [];
    const filtered = [];
    const filteredNoAuthor = [];
    const focusCounts = { by: 0, interactions: 0 };

    const typeCounts = { all: 0 };
    for (const t of TYPES) typeCounts[t] = 0;
    let legacy = 0;
    // What each slider is calibrated to: the posts passing every filter except that slider's own,
    // the pattern included. A top-% slider ranks the posts passing every filter but the sliders,
    // so its cutoff never depends on another top-% slider's and "top 50% of likes" on a search
    // means the better-liked half of the posts that match it.
    const ctx = { likes: [], reposts: [], chars: [] };
    const ctxTrunc = { chars: [] }; // truncated posts pass the length slider whatever their captured value
    const topKeys = RANGE_KEYS.filter((k) => state.rangeMode[k] === 'top');
    const hitsOf = new Map(); // pattern matches per post, counted once for both passes
    const hitsFor = (post) => { let h = hitsOf.get(post); if (h === undefined) { h = state.regex ? countMatches(post.text || '') : 0; hitsOf.set(post, h); } return h; };
    const matches = (post) => !state.regex || hitsFor(post) > 0;
    const ranked = Object.fromEntries(topKeys.map((k) => [k, []]));
    if (topKeys.length) {
      for (const post of state.posts) {
        if (!passesDate(post, q) || !passesTypes(q.types, typeFlags(post)) || !inList(post) || !matches(post)) continue;
        for (const k of topKeys) {
          const v = rangeValue(post, k);
          ctx[k].push(v);
          if (k === 'chars' && post.truncated) ctxTrunc.chars.push(v);
          ranked[k].push(k === 'chars' && post.truncated ? Infinity : v);
        }
      }
      for (const k of topKeys) setRangeMin(q, k, q.top[k] > 0 ? topCutoff(ranked[k].sort((a, b) => a - b), q.top[k]) : 0);
    }
    state.rangeRanked = topKeys.length ? ranked : {};
    for (const k of RANGE_KEYS) state.rangeCut[k] = rangeMin(q, k);

    for (const post of state.posts) {
      let e = everyone.get(post.handle);
      if (!e) { e = { handle: post.handle, name: post.name, posts: 0 }; everyone.set(post.handle, e); }
      e.posts++;
      if (!passesDate(post, q)) continue;
      // A post failing the type filter still counts towards the numbers in the type menu, which
      // say how many posts each kind would show, so it is carried up to the pattern test.
      const f = typeFlags(post);
      const typeOk = passesTypes(q.types, f);
      const ok = { likes: passesRange(post, q, 'likes'), reposts: passesRange(post, q, 'reposts'), chars: passesRange(post, q, 'chars') };
      const listed = inList(post);
      if (typeOk && listed && matches(post)) {
        for (const k of RANGE_KEYS) {
          if (state.rangeMode[k] === 'top' || !RANGE_KEYS.every((o) => o === k || ok[o])) continue;
          const v = rangeValue(post, k);
          ctx[k].push(v);
          if (k === 'chars' && post.truncated) ctxTrunc[k].push(v);
        }
      }
      if (!ok.likes || !ok.reposts || !ok.chars) continue;
      if (typeOk) filteredNoAuthor.push(post);
      const matched = () => matches(post);
      // Both numbers on the "By them / Interactions with them" toggle, whichever is showing.
      if (focus && typeOk && matched()) {
        if (passesAuthor(post, q)) focusCounts.by++;
        if (passesPick(post, nodePick)) focusCounts.interactions++;
      }
      if (!listed) continue;
      let a = null;
      if (typeOk) {
        filtered.push(post);
        a = authors.get(post.handle);
        if (!a) { a = { handle: post.handle, name: post.name, posts: 0, matches: 0 }; authors.set(post.handle, a); }
        a.posts++;
      }
      if (!matched()) continue;
      typeCounts.all++;
      for (const t of TYPES) if (f[t]) typeCounts[t]++;
      if (!typeOk) continue;
      if (legacyMedia(post)) legacy++;
      a.matches++;
      results.push({ post, hits: hitsFor(post) });
    }
    state.typeCounts = typeCounts;
    state.legacyMedia = legacy;
    state.rangeCtx = ctx;
    state.rangeTrunc = ctxTrunc;
    state.focusCounts = focusCounts;
    renderRanges();
    renderChips();
    renderNetworkSummary(filteredNoAuthor);

    const byTime = (a, b) => (b.post.time || '').localeCompare(a.post.time || '');
    const sorters = {
      newest: byTime,
      oldest: (a, b) => -byTime(a, b),
      likes: (a, b) => (b.post.likes || 0) - (a.post.likes || 0) || byTime(a, b),
      views: (a, b) => (b.post.views || 0) - (a.post.views || 0) || byTime(a, b),
      longest: (a, b) => (b.post.text || '').length - (a.post.text || '').length || byTime(a, b),
      hits: (a, b) => b.hits - a.hits || byTime(a, b),
      captured: (a, b) => (b.post.firstSeen || 0) - (a.post.firstSeen || 0),
    };
    results.sort(sorters[effectiveSort(q.sort)] || sorters.captured);

    state.results = results;
    state.filtered = filtered;
    state.filteredNoAuthor = filteredNoAuthor;
    state.shown = 0;
    renderResults(true);
    state.allAuthors = Array.from(everyone.values()).sort((a, b) => b.posts - a.posts);
    // The chip suggests every captured user, then every account that only appears through an interaction.
    const inter = new Map((state.nwAccounts || []).map((a) => [a.handle.toLowerCase(), a]));
    state.chipAccounts = state.allAuthors
      .map((a) => ({ ...a, received: (inter.get(a.handle.toLowerCase()) || { received: 0 }).received }))
      .concat((state.nwAccounts || []).filter((a) => !everyone.has(a.handle) && !state.handles.has(a.handle.toLowerCase())).map((a) => ({ handle: a.handle, name: a.name, posts: 0, received: a.received })));
    state.nameByHandle = new Map(state.chipAccounts.map((a) => [a.handle.toLowerCase(), a.name || '']));
    renderAuthors(authors);
    renderFocusChip();
    if (!els.authorSuggest.hidden) authorSuggest.render();
    renderKpis(authors.size);
    state.baseSig = JSON.stringify([{ ...q, sort: null, authorExact: null, authorSub: null, focus: null }, state.posts.length, state.loadStamp]);
    state.filterSig = JSON.stringify([state.baseSig, state.pick ? state.pick.label : null, mode]);
    renderTypeMenu();
    updatePickPill();
    renderListMode();
    renderPanel();
    renderNetwork();
    renderContext();
    if (state.panelBack && els.author.value === state.panelBack.author && els.pattern.value === state.panelBack.options.pattern) state.panelBack = null;
    updateBackPills();
    syncHash();
    saveState();
  }

  // ---------------------------------------------------------------------------
  // Compare panel: author clouds, term cloud, co-mentions, and the author × keyword heat-map.
  // Every view honours the search options and the filters, never the main pattern.
  // ---------------------------------------------------------------------------

  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  // Page theme: light by default; "auto" follows the OS. Resolved value lands on <html data-theme>.
  const pageTheme = () => (els.theme.value === 'auto' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : els.theme.value);
  function applyTheme() { document.documentElement.dataset.theme = pageTheme(); }
  // Images on the page follow the page theme; each export menu chooses the downloaded image's theme.
  const exportTheme = (sel) => (sel.value === 'auto' ? pageTheme() : sel.value);

  const VIEWS = ['authors', 'term', 'comention', 'matrix'];
  const HINTS = {
    authors: 'One cloud per author, most posts first, with the chosen account always first; the author filter above is not applied here, so every cloud stays while you browse. Distinctive = words this author uses more than the other authors shown (log-likelihood keyness, used at least twice); frequent = plain counts. Type a term to restrict every cloud to posts that mention it. Click a word to read that author’s posts with it below; the tile stays outlined and ← Back clears the filter. Shift-click words and release Shift to search X for them (the account’s posts, everyone else’s, or everyone’s); Alt-click a word for its own term cloud.',
    term: 'Words from every post that mentions the term. Distinctive = compared with the rest of the current filter; the term itself is left out. Uses the search options (Aa, ab, .*) and the filters above, not the main pattern. Click a word to narrow the cloud to posts that also contain it (the list shows them; the trail under the term steps back). Shift-click words and release Shift to search X for them, starting from the term.',
    comention: 'For posts that mention the term: how many also mention each keyword (one per line, optional label before  :: ). Leave the keywords empty to see the term’s most distinctive words instead. “Matches nowhere” means the keyword matches no post at all, so a typo cannot hide as a zero. Click a row to see the posts.',
    matrix: 'Counts each keyword per author. Uses the search options (Aa, ab, .*) and the filters above, but not the main pattern or the author filter. Authors with fewer than “min posts” are hidden. Click a cell to search that author and keyword; ← Back clears it again.',
  };

  const panelView = () => (VIEWS.includes(els.matrix.dataset.view) ? els.matrix.dataset.view : 'authors');
  function setPanelView(view) {
    if (!VIEWS.includes(view)) view = 'authors';
    els.matrix.dataset.view = view;
    for (const b of els.mxTabs) b.setAttribute('aria-selected', String(b.dataset.view === view));
  }

  // Word counts per post, cached on the post object (load() replaces the objects, so the cache follows).
  const tokenCache = new WeakMap();
  function countsFor(post) {
    let c = tokenCache.get(post);
    if (!c) { c = XPCWords.countTokens(XPCWords.tokenize(post.text || '')); tokenCache.set(post, c); }
    return c;
  }
  // Corpus counts for a post array, cached on the array (apply() makes new arrays, so this follows).
  const aggCache = new WeakMap();
  function aggregateFor(posts) {
    let a = aggCache.get(posts);
    if (!a) { a = XPCWords.aggregate(posts.map(countsFor)); aggCache.set(posts, a); }
    return a;
  }

  // Outline the tile whose posts are showing in the list below.
  function markActiveTile() {
    const raw = els.author.value.trim();
    const active = raw.startsWith('@') ? raw.slice(1).toLowerCase() : '';
    for (const tile of els.mxView.querySelectorAll('.tile')) {
      tile.classList.toggle('active', Boolean(active) && (tile.dataset.handle || '').toLowerCase() === active);
    }
  }

  // How the term and keywords were matched, printed on every export so a zero is never a mystery.
  function matchNote(o) {
    const parts = [o.matchCase ? 'match case' : 'case-insensitive', o.wholeWord ? 'whole word' : 'substring', o.regex ? 'regex' : 'plain text'];
    return `Matching: ${parts.join(' · ')}. Counts only what one person scrolled past on X, not all of X.`;
  }

  function dateRange(posts) {
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const p of posts) {
      const t = p.time ? new Date(p.time).getTime() : NaN;
      if (!Number.isNaN(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
    }
    return { from: Number.isFinite(tMin) ? tMin : null, to: Number.isFinite(tMax) ? tMax : null };
  }

  // The typed term plus the words clicked into the trail after it. `regex.test` passes posts that
  // contain all of them; `exclude` keeps every one of them out of the clouds; `label` reads
  // “term › word › word” for titles.
  const trailRegex = (w) => XPCSearch.compile({ pattern: XPCWords.wordPattern(w, true), regex: true, unicode: true });
  function compileTerm(options) {
    const term = els.mxTerm.value.trim();
    if (!term) return { term: '', label: '', regex: null, exclude: null, count: null, error: null };
    const r = XPCSearch.compile({ ...options, pattern: term });
    if (r.error) return { term, label: term, regex: null, exclude: null, count: null, error: r.error };
    const trail = state.termTrail.map(trailRegex).filter((c) => c.regex).map((c) => c.regex);
    const all = [r.regex, ...trail];
    const test = (s) => all.every((x) => x.test(s));
    return {
      term,
      label: [term, ...state.termTrail].join(' › '),
      regex: trail.length ? { test } : r.regex,
      exclude: (k) => all.some((x) => x.test(k)),
      // Mentions of the typed term, in posts that also have every trail word (the co-mention anchor).
      count: (s) => (test(s) ? XPCWords.countMatches(r.regexG, s) : 0),
      error: null,
    };
  }

  const panelInts = () => ({
    maxRows: Math.max(1, Math.min(60, Number(els.mxRows.value) || 12)),
    minPosts: Math.max(1, Number(els.minPosts.value) || 1),
    maxWords: Math.max(5, Math.min(150, Number(els.mxWords.value) || 60)),
    weight: els.mxWeight.value === 'frequent' ? 'frequent' : 'distinctive',
  });

  function buildAuthorClouds(t, termPosts, base) {
    const { maxRows, minPosts, maxWords, weight } = panelInts();
    const posts = t.regex ? termPosts : base;
    const groups = new Map();
    for (const p of posts) {
      let g = groups.get(p.handle);
      if (!g) { g = { handle: p.handle, name: p.name || p.handle, posts: [] }; groups.set(p.handle, g); }
      g.posts.push(p);
    }
    // The chosen account always gets the first tile, even below "min posts" or outside the top rows.
    const chosen = state.nwFocus ? groups.get(Array.from(groups.keys()).find((h) => h.toLowerCase() === state.nwFocus.toLowerCase())) : null;
    const authors = Array.from(groups.values())
      .filter((g) => g !== chosen && g.posts.length >= minPosts)
      .sort((a, b) => b.posts.length - a.posts.length || a.handle.localeCompare(b.handle))
      .slice(0, chosen ? maxRows - 1 : maxRows);
    if (chosen) authors.unshift(chosen);
    const total = aggregateFor(posts);
    const exclude = t.exclude;
    const out = authors.map((g) => {
      const { terms, mode } = XPCWords.topTerms({ target: XPCWords.aggregate(g.posts.map(countsFor)), total, mode: weight, max: maxWords, exclude });
      return { handle: g.handle, name: g.name, posts: g.posts.length, words: terms, mode, pinned: g === chosen };
    });
    const mode = out.length && out.every((a) => a.mode === 'frequent') ? 'frequent' : weight;
    return { authors: out, mode, term: t.label, nPosts: posts.length, nAuthors: groups.size, ...dateRange(posts) };
  }

  function buildTermCloud(t, termPosts) {
    const { maxWords, weight } = panelInts();
    if (!t.regex) return { term: '', words: [], mode: weight, nPosts: 0, nAuthors: 0, totalPosts: state.filtered.length, from: null, to: null };
    const { terms, mode } = XPCWords.topTerms({
      target: XPCWords.aggregate(termPosts.map(countsFor)), total: aggregateFor(state.filtered), mode: weight, max: maxWords, exclude: t.exclude,
    });
    return { term: t.label, words: terms, mode, nPosts: termPosts.length, nAuthors: new Set(termPosts.map((p) => p.handle)).size, totalPosts: state.filtered.length, ...dateRange(termPosts) };
  }

  function buildComentions(t, termPosts, options) {
    const { weight } = panelInts();
    const keywords = XPCMatrix.parseKeywords(els.mxKeywords.value);
    let auto = null;
    if (!keywords.length && t.regex && termPosts.length) {
      auto = XPCWords.topTerms({
        target: XPCWords.aggregate(termPosts.map(countsFor)), total: aggregateFor(state.filtered), mode: weight, max: 15, exclude: t.exclude,
      }).terms.map((w) => w.term);
    }
    const anchor = state.termTrail.length && t.count ? { label: t.label, pattern: t.term, count: t.count } : { label: t.term, pattern: t.term };
    return XPCWords.comentions({ posts: state.filtered, anchor, keywords, options, auto });
  }

  function buildMatrix(options, base) {
    const { maxRows, minPosts } = panelInts();
    return XPCMatrix.build({ posts: base, keywords: XPCMatrix.parseKeywords(els.mxKeywords.value), options, metric: els.mxMetric.value, maxRows, minPosts });
  }

  function renderPanel() {
    if (!panelVisible()) return;
    const view = panelView();
    setPanelView(view);
    els.mxHint.textContent = HINTS[view];
    const options = { ...getOptions(), pattern: '' };
    // The author-comparison views ignore the author filter: clicking a word narrows the list below
    // to that author while every cloud stays on screen.
    const authorView = view === 'authors' || view === 'matrix';
    const base = authorView ? state.filteredNoAuthor : state.filtered;
    const sig = JSON.stringify([state.filterSig, authorView ? state.nwFocus : els.author.value, view, options, els.mxTerm.value, state.termTrail, els.mxKeywords.value, els.mxTitle.value, els.mxMetric.value,
      els.mxRows.value, els.mxWords.value, els.mxWeight.value, els.minPosts.value, pageTheme(), els.mxTable.checked]);
    renderTrail();
    if (sig === state.panelSig) { markActiveTile(); markChord(); return; }
    state.panelSig = sig;

    const errors = [];
    const t = compileTerm(options);
    if (t.error) errors.push('term: ' + t.error);
    const termPosts = t.regex ? base.filter((p) => t.regex.test(p.text || '')) : [];
    if (t.term && !t.error) {
      const n = termPosts.length;
      const a = new Set(termPosts.map((p) => p.handle)).size;
      const trail = state.termTrail.length > 0;
      els.mxTermCount.textContent = n
        ? `${n.toLocaleString()} ${n === 1 ? 'post' : 'posts'} by ${a.toLocaleString()} ${a === 1 ? 'author' : 'authors'} mention ${trail ? 'all of them' : 'it'}`
        : trail ? 'no post mentions all of them' : 'no post mentions it (check spelling, or the Aa / ab / .* options)';
      els.mxTermCount.classList.toggle('none', n === 0);
    } else {
      els.mxTermCount.textContent = t.error ? 'not a valid pattern' : '';
      els.mxTermCount.classList.toggle('none', Boolean(t.error));
    }

    const render = { theme: pageTheme(), size: MATRIX_SIZE, title: els.mxTitle.value.trim(), note: matchNote(options), maxWords: panelInts().maxWords };
    let model;
    let draw; // renders the model with any options, so an export can use its own theme
    if (view === 'authors') {
      model = buildAuthorClouds(t, termPosts, base);
      draw = (r) => XPCClouds.renderAuthorClouds(model, r);
    } else if (view === 'term') {
      model = buildTermCloud(t, termPosts);
      draw = (r) => XPCClouds.renderTermCloud(model, r);
    } else if (view === 'comention') {
      model = buildComentions(t, termPosts, options);
      errors.push(...model.errors);
      draw = (r) => XPCClouds.renderComentions(model, r);
    } else {
      model = buildMatrix(options, base);
      errors.push(...model.errors);
      draw = (r) => XPCMatrix.renderSvg(model, r);
    }
    const svg = draw(render);
    state.panel = { view, model, svg, render, draw };

    els.mxError.hidden = errors.length === 0;
    els.mxError.textContent = errors.length ? 'Skipped: ' + errors.join(' · ') : '';
    els.mxView.innerHTML = svg;
    els.mxView.hidden = els.mxTable.checked;
    els.mxTableWrap.hidden = !els.mxTable.checked;
    if (els.mxTable.checked) renderPanelTable(view, model);
    markActiveTile();
    markChord();
  }

  function renderPanelTable(view, model) {
    const th = (text, num) => { const c = document.createElement('th'); if (num) c.className = 'num'; c.textContent = text; return c; };
    const td = (text, cls, title) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text; if (title) c.title = title; return c; };
    const authorCell = (name, handle) => {
      const c = document.createElement('td');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = name || handle;
      const h = document.createElement('span'); h.className = 'h'; h.textContent = '@' + handle;
      c.append(n, h);
      return c;
    };
    const head = document.createElement('tr');
    const body = document.createDocumentFragment();

    if (view === 'authors') {
      head.append(th('Author'), th('Posts', true), th(model.mode === 'distinctive' ? 'Distinctive words (mentions)' : 'Frequent words (mentions)'));
      for (const a of model.authors) {
        const tr = document.createElement('tr');
        tr.append(authorCell(a.name, a.handle), td(a.posts.toLocaleString(), 'num'), td(a.words.slice(0, 30).map((w) => `${w.term} (${w.count})`).join(', ') || '–', 'words'));
        body.append(tr);
      }
    } else if (view === 'term') {
      head.append(th('#', true), th('Word'), th('Mentions', true), th('Posts', true), th('Elsewhere', true), th('Keyness', true));
      model.words.forEach((w, i) => {
        const tr = document.createElement('tr');
        tr.className = 'link';
        tr.append(td(String(i + 1), 'num'), td(w.term), td(w.count.toLocaleString(), 'num'), td(w.posts.toLocaleString(), 'num'), td(w.rest.toLocaleString(), 'num'), td(model.mode === 'distinctive' ? Math.round(w.weight).toLocaleString() : '–', 'num'));
        tr.addEventListener('click', (e) => wordClick(e, w.term, null, 'panel'));
        body.append(tr);
      });
    } else if (view === 'comention') {
      head.append(th('Keyword'), th('Posts with both', true), th('Share', true), th('Mentions', true), th('Posts overall', true), th('Share overall', true), th('Lift', true));
      for (const r of model.rows) {
        const tr = document.createElement('tr');
        tr.className = 'link';
        const none = r.allPosts === 0;
        tr.append(td(r.label, null, r.pattern), td(r.posts.toLocaleString(), 'num'), td(Math.round(r.share * 100) + '%', 'num'), td(r.mentions.toLocaleString(), 'num'),
          td(none ? '0 (matches nowhere)' : r.allPosts.toLocaleString(), 'num' + (none ? ' none' : '')), td(Math.round(r.allShare * 100) + '%', 'num'), td(r.lift === null ? '–' : r.lift.toFixed(1) + '×', 'num'));
        tr.addEventListener('click', () => searchPanel({ pattern: r.pattern, isRegex: r.isRegex }));
        body.append(tr);
      }
    } else {
      head.append(th('Author'), th('Posts', true));
      for (const c of model.cols) { const h = th(c.label, true); h.title = c.pattern; head.append(h); }
      head.append(th('Total', true));
      for (const r of model.rows) {
        const tr = document.createElement('tr');
        tr.append(authorCell(r.name, r.handle), td(r.posts.toLocaleString(), 'num'));
        r.values.forEach((v, i) => {
          const silent = Boolean(r.silent && r.silent[i]);
          tr.append(td(XPCMatrix.fmtValue(v, model.metric), 'num' + (v > 0 && v === model.max ? ' hot' : '') + (silent ? ' silent' : ''),
            `${r.hitPosts[i]} of ${r.posts} posts, ${r.mentions[i]} mentions` + (silent ? ` · unusually silent: at the overall rate about ${Math.round(r.expected[i])} would be expected` : '')));
        });
        tr.append(td(XPCMatrix.fmtValue(r.total, model.metric), 'num'));
        body.append(tr);
      }
    }
    els.mxTableHead.textContent = '';
    els.mxTableHead.append(head);
    els.mxTableBody.textContent = '';
    els.mxTableBody.append(body);
  }

  // Clicking a word, a co-mention row or a heat-map cell sets the author filter and the search
  // pattern for the list below. Remember where the user was so one click undoes it.
  function rememberBeforeClick() {
    if (state.panelBack) return; // a second click keeps the original starting point
    const options = getOptions();
    const label = !els.author.value.trim() && !options.pattern ? 'Back to all posts' : 'Back to the previous search';
    state.panelBack = { author: els.author.value, options, label };
  }

  function updateBackPills() {
    const b = state.panelBack;
    for (const el of [els.mxBack, els.resultsBack]) {
      el.hidden = !b;
      el.textContent = b ? '← ' + b.label : '';
    }
  }

  function goBack() {
    const b = state.panelBack;
    if (!b) return;
    state.panelBack = null;
    setOptions(b.options);
    els.author.value = b.author;
    apply();
    if (state.view === 'compare') scrollTo(els.matrix);
  }

  // Search the main list for a cloud word or a co-mention keyword, together with the term (and the
  // words in its trail) when one is set, and optionally filtered to an author. Switches the search
  // box to regex mode. `stay` keeps the current view, so a drill in the expanded cloud stays put.
  function searchPanel({ word = null, pattern = null, isRegex = true, handle = null, withTerm = true, stay = false }) {
    rememberBeforeClick();
    const opts = getOptions();
    const termRaw = withTerm ? els.mxTerm.value.trim() : '';
    const term = termRaw ? (opts.regex ? termRaw : XPCSearch.escapeRegex(termRaw)) : '';
    // Cloud words and automatic co-mention rows use \p{L} word classes, which need the u flag.
    // Turn it on unless the term box holds a regex that is invalid under it; then fall back to
    // ASCII word characters.
    const uni = opts.unicode || !term || !XPCSearch.compile({ ...opts, pattern: term, regex: true, unicode: true }).error;
    let k = '';
    if (word !== null) k = XPCWords.wordPattern(word, uni);
    else if (pattern) k = isRegex || opts.regex ? pattern : XPCSearch.escapeRegex(pattern);
    if (!uni) k = k.replaceAll('[^\\p{L}\\p{N}_]+', '\\W+').replaceAll('[\\p{L}\\p{N}_]', '\\w');
    const trail = term ? state.termTrail.map((w) => XPCWords.wordPattern(w, uni)) : [];
    const src = XPCWords.allPattern(Array.from(new Set([term, ...trail, k])));
    if (!src) return;
    setOptions({ ...opts, pattern: src, regex: true, unicode: opts.unicode || (uni && src.includes('\\p{')) });
    if (handle !== null) els.author.value = '@' + handle;
    apply();
    if (stay) return;
    setView('posts');
    scrollTo(els.resultsHead);
  }

  // One click on a cloud word, wherever the cloud is. Shift gathers words for an X search (with
  // Option too, as an alternative in the last chip), Alt (Option) alone opens the word's own term
  // cloud, a plain click in the term cloud drills into it, and elsewhere a plain click lists the
  // posts with the word. `where` is 'panel' (Topics) or 'account'.
  function wordClick(e, word, handle, where) {
    if (!word) return;
    const inPanel = where === 'panel';
    if (e.shiftKey) {
      trayNear(e);
      chordAdd(word, handle || (inPanel ? state.nwFocus : null), inPanel, e.altKey);
      return;
    }
    if (e.altKey) { pivot(word); return; }
    if (inPanel && panelView() === 'term') { drill(word); return; }
    searchPanel({ word, handle, withTerm: inPanel });
  }

  // The term cloud narrows as you click: the word joins the trail after the term, the cloud redraws
  // from the posts that have all of them, and the list shows those posts.
  function drill(word) {
    if (!els.mxTerm.value.trim()) return;
    if (!state.termTrail.includes(word)) state.termTrail.push(word);
    searchPanel({ stay: state.view !== 'posts' });
    renderPanel();
    saveState();
  }

  // Step back to an earlier point on the trail (0 = the typed term alone). The list follows only
  // while it still shows a cloud click (the Back pill is up), so a search typed since is kept.
  function trailTo(i) {
    state.termTrail = state.termTrail.slice(0, i);
    if (state.panelBack) searchPanel({ stay: true });
    renderPanel();
    saveState();
  }

  // Alt-click: start a fresh term cloud from the word.
  function pivot(word) {
    els.mxTerm.value = getOptions().regex ? XPCSearch.escapeRegex(word) : word;
    state.termTrail = [];
    setPanelView('term');
    if (state.view === 'network') setView('compare');
    else if (state.view === 'posts' && state.paneTab !== 'topics') setPaneTab('topics');
    else renderPanel();
    saveState();
  }

  function renderTrail() {
    const host = els.mxTrail;
    const term = els.mxTerm.value.trim();
    host.textContent = '';
    host.hidden = !term || !state.termTrail.length;
    if (host.hidden) return;
    const steps = [term, ...state.termTrail];
    steps.forEach((w, i) => {
      if (i) host.append(el('span', 'sep', '›'));
      if (i === steps.length - 1) { host.append(el('span', 'crumb here', w)); return; }
      const b = el('button', 'crumb', w);
      b.type = 'button';
      b.title = i ? `Back to posts with ${steps.slice(0, i + 1).map((x) => `“${x}”`).join(' and ')}` : `Back to every post with “${w}”`;
      b.addEventListener('click', () => trailTo(i));
      host.append(b);
    });
  }

  // ---------------------------------------------------------------------------
  // The X search tray: accounts and words gathered by Shift-clicking them anywhere on the page, or
  // typed. Releasing Shift opens one X search (Latest) for all of them, in a background tab so
  // several can go out in a row and capture pulls the results in. Once the tray is touched (or
  // pinned) it stays open until Enter or Search X. A word chip is a group of alternatives, typed
  // and shown as "iran | gas prices"; X gets (iran OR "gas prices"), and the chips are AND-ed.
  // ---------------------------------------------------------------------------

  const CHORD_SCOPES = [
    { key: 'them', label: (hs) => (hs.length === 1 ? `@${hs[0]}` : `These ${hs.length}`), tip: (hs) => (hs.length === 1 ? `Only @${hs[0]}’s posts` : `Only posts from these ${hs.length} accounts`) },
    { key: 'others', label: () => 'Everyone else', tip: (hs) => `Other accounts on the same words: leaves out ${hs.length === 1 ? '@' + hs[0] : 'these ' + hs.length}` },
    { key: 'all', label: () => 'Everyone', tip: () => 'Any account: the accounts are left out of the search' },
  ];
  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  const sameHandle = (a, b) => a.toLowerCase() === b.toLowerCase();
  // A typed term goes into the X search only when it reads as words (| for either), not as a regex.
  const plainTerm = (term, opts) => !opts.regex || /^[\p{L}\p{N}#@_' |-]+$/u.test(term);

  function chordStart(fromPanel) {
    if (state.chord) return state.chord;
    // Words picked from a cloud narrowed by the term start from the term and its trail.
    const groups = [];
    const term = fromPanel ? els.mxTerm.value.trim() : '';
    if (term) {
      if (plainTerm(term, getOptions())) groups.push(XPCXSearch.alternatives(term));
      for (const w of state.termTrail) groups.push([w]);
    }
    state.chord = { groups: groups.filter((g) => g.length), accounts: [], armed: false, held: false, seeded: false, editing: null };
    return state.chord;
  }

  // Armed = releasing Shift searches. Not once the tray has been touched, nor while it is pinned.
  const arm = (c) => { c.armed = !state.chordPin && !c.held; };

  // The tray sits at the bottom, or at the top when the click is low on the screen, so it never
  // covers what is being picked from.
  const trayNear = (e) => els.chordTray.classList.toggle('at-top', e.clientY > window.innerHeight / 2);

  function chordAdd(word, handle, fromPanel, orJoin) {
    const c = chordStart(fromPanel);
    // The account whose cloud it is joins with the first word; taken out, it stays out.
    if (handle && !c.seeded && !c.accounts.length) addAccounts(c, [handle]);
    c.seeded = true;
    const key = word.toLowerCase();
    const last = c.groups[c.groups.length - 1];
    if (orJoin && last) {
      // Shift+Option: the word becomes (or stops being) an alternative in the last chip.
      const i = last.findIndex((a) => a.toLowerCase() === key);
      if (i >= 0) last.splice(i, 1); else last.push(word);
      if (!last.length) c.groups.pop();
    } else {
      const i = c.groups.findIndex((g) => g.length === 1 && g[0].toLowerCase() === key);
      if (i >= 0) c.groups.splice(i, 1); else c.groups.push([word]);
    }
    arm(c);
    renderChord();
  }

  // An account added on purpose while the switch says Everyone (which leaves accounts out) turns
  // the switch back to these accounts.
  const accountsWanted = () => { if (state.chordScope === 'all') { state.chordScope = 'them'; saveState(); } };

  // Adds the valid handles not already there; returns the tokens that are not handles.
  function addAccounts(c, tokens) {
    const bad = [];
    for (const raw of tokens) {
      const h = String(raw || '').trim().replace(/^@/, '');
      if (!h) continue;
      if (!HANDLE_RE.test(h)) { bad.push(raw); continue; }
      if (!c.accounts.some((a) => sameHandle(a, h))) c.accounts.push(h);
    }
    return bad;
  }

  // Shift-click on an account, wherever it is, puts it in the tray instead of choosing it; again
  // takes it out. Returns false for a plain click, so the caller does its usual thing.
  function shiftAccount(e, handle) {
    if (!e || !e.shiftKey || !handle) return false;
    e.preventDefault();
    trayNear(e);
    const c = chordStart(false);
    c.seeded = true;
    const i = c.accounts.findIndex((a) => sameHandle(a, handle));
    if (i >= 0) c.accounts.splice(i, 1);
    else { addAccounts(c, [handle]); accountsWanted(); }
    arm(c);
    renderChord();
    return true;
  }

  // The header button: an empty tray (or the open one), ready to type into.
  function chordOpen() {
    const c = chordStart(false);
    c.held = true;
    arm(c);
    els.chordTray.classList.remove('at-top');
    renderChord();
    els.chordAcctIn.focus();
  }

  // What is typed but not yet a chip still counts: words in the preview and the search, handles
  // only when searching (a half-typed handle would search the wrong account).
  function pendingGroup() {
    const alts = XPCXSearch.alternatives(els.chordWordIn.value);
    return alts.length ? alts : null;
  }

  function commitWords(c) {
    const g = pendingGroup();
    const at = c.editing ? Math.min(c.editing.at, c.groups.length) : c.groups.length;
    if (g) c.groups.splice(at, 0, g);
    c.editing = null;
    els.chordWordIn.value = '';
  }

  function commitAccounts(c) {
    const n = c.accounts.length;
    els.chordAcctIn.value = addAccounts(c, els.chordAcctIn.value.split(/[\s,]+/)).join(' ');
    if (c.accounts.length > n) accountsWanted();
  }

  // Click a word chip: its text goes back into the box to change, and returns to the same place.
  function chordEdit(i) {
    const c = state.chord;
    if (!c || !c.groups[i]) return;
    if (pendingGroup()) commitWords(c);
    const [g] = c.groups.splice(i, 1);
    c.editing = { at: i, group: g };
    els.chordWordIn.value = g.join(' | ');
    renderChord();
    els.chordWordIn.focus();
    els.chordWordIn.setSelectionRange(els.chordWordIn.value.length, els.chordWordIn.value.length);
  }

  const chordScopeOf = (c) => (c.accounts.length ? state.chordScope : 'all');
  function chordQueries(c) {
    const g = pendingGroup();
    const groups = g ? [...c.groups, g] : c.groups;
    return XPCXSearch.wordsQueries(groups, { handles: c.accounts, scope: chordScopeOf(c) });
  }

  function chordCancel() {
    state.chord = null;
    els.chordAcctIn.value = '';
    els.chordWordIn.value = '';
    if (els.chordTray.contains(document.activeElement)) document.activeElement.blur();
    chordSuggest.hide();
    renderChord();
  }

  function chordFire() {
    const c = state.chord;
    if (!c) return;
    commitWords(c);
    commitAccounts(c);
    const qs = chordQueries(c);
    chordCancel();
    if (!qs.length) return;
    let bg = false;
    for (const q of qs) bg = openTab(XPCXSearch.searchUrl(q));
    showToast(qs.length > 1 ? `Searching X in ${qs.length} ${bg ? 'background ' : ''}tabs, the accounts split between them` : `Searching X${bg ? ' in a background tab' : ''}: ${qs[0]}`);
  }

  // Extension pages open the tab behind this one; the test page (no chrome.tabs) falls back to a new window.
  function openTab(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) { chrome.tabs.create({ url, active: false }); return true; }
    window.open(url, '_blank', 'noopener');
    return false;
  }

  function markChord() {
    const words = state.chord ? new Set(state.chord.groups.flat().map((w) => w.toLowerCase())) : null;
    for (const w of document.querySelectorAll('#mx-view .w, .ctx-cloud-view .w')) w.classList.toggle('chord', Boolean(words && words.has(String(w.dataset.word || '').toLowerCase())));
  }

  function chordChip(kind, text, i, tip) {
    const chip = el('span', 'chord-chip ' + kind);
    const t = el(kind === 'word' ? 'button' : 'span', 'chord-t', text);
    if (kind === 'word') {
      t.type = 'button';
      t.dataset.act = 'edit';
      t.dataset.i = String(i);
      t.title = 'Edit (| separates the alternatives)';
    }
    const x = el('button', 'chord-x', '✕');
    x.type = 'button';
    x.dataset.act = 'drop';
    x.dataset.kind = kind;
    x.dataset.i = String(i);
    x.title = tip;
    chip.append(t, x);
    return chip;
  }

  // The chips and the scope switch are redrawn; the two text boxes are left alone, so typing and
  // focus survive a redraw.
  function renderChord() {
    const tray = els.chordTray;
    const c = state.chord;
    markChord();
    tray.hidden = !c;
    if (!c) return;
    els.chordAccts.textContent = '';
    c.accounts.forEach((h, i) => els.chordAccts.append(chordChip('acct', '@' + h, i, `Leave out @${h}`)));
    els.chordWords.textContent = '';
    c.groups.forEach((g, i) => els.chordWords.append(chordChip('word', g.join(' | '), i, `Leave out “${g.join(' | ')}”`)));
    const n = c.accounts.length;
    els.chordSeg.hidden = !n;
    els.chordSeg.textContent = '';
    CHORD_SCOPES.forEach((s, i) => {
      if (!n) return;
      const b = el('button', null, s.label(c.accounts));
      b.type = 'button';
      b.dataset.act = 'scope';
      b.dataset.scope = s.key;
      b.title = `${s.tip(c.accounts)} · Shift+${i + 1}`;
      b.setAttribute('aria-pressed', String(state.chordScope === s.key));
      els.chordSeg.append(b);
    });
    tray.classList.toggle('scope-all', Boolean(n) && state.chordScope === 'all');
    els.chordPin.setAttribute('aria-pressed', String(state.chordPin));
    renderChordQuery();
  }

  function renderChordQuery() {
    const c = state.chord;
    if (!c) return;
    const qs = chordQueries(c);
    els.chordGo.disabled = !qs.length;
    els.chordQ.textContent = qs.join('\n') || ' ';
    const notes = [];
    if (qs.length > 1) notes.push(`Opens ${qs.length} searches`);
    else if (qs[0] && qs[0].length > XPCXSearch.MAX_QUERY) notes.push('Long for X: it may cut this off');
    else if (!qs.length && c.accounts.length && state.chordScope === 'others') notes.push('Add a word to search everyone else');
    if (c.armed) notes.push('Release ⇧ to search · Esc cancels');
    els.chordNote.textContent = notes.join(' · ');
    els.chordNote.hidden = !notes.length;
    els.chordNote.title = qs.length > 1 ? `X takes about ${XPCXSearch.MAX_QUERY} characters a search, so the accounts are split over ${qs.length} searches, each in its own tab` : '';
  }

  // Scroll an element to the top of the viewport, below the sticky header.
  function scrollTo(el) {
    const header = document.querySelector('.top');
    const top = el.getBoundingClientRect().top + window.scrollY - ((header && header.offsetHeight) || 0) - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function panelFilename(ext) {
    const view = panelView();
    const term = slug(els.mxTerm.value.trim()).slice(0, 40);
    const custom = slug(els.mxTitle.value.trim());
    const base = custom || ({ authors: term ? 'posts-mentioning' : 'who-says-what', term: 'goes-with', comention: 'comes-up-with', matrix: 'who-mentions-what' }[view] + (term && view !== 'matrix' ? '-' + term : ''));
    return `${base}-${stamp()}.${ext}`;
  }

  // The image as shown, or redrawn in the theme chosen in the export menu.
  function panelExportSvg() {
    const p = state.panel;
    if (!p || !p.svg) return null;
    const theme = exportTheme(els.mxTheme);
    return theme === p.render.theme ? p.svg : p.draw({ ...p.render, theme });
  }

  function exportPanelSvg() {
    const svg = panelExportSvg();
    if (!svg) return;
    download(panelFilename('svg'), new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml;charset=utf-8' }));
  }

  async function exportPanelPng() {
    const svg = panelExportSvg();
    if (!svg) return;
    try {
      const png = await XPCMatrix.toPng(svg, MATRIX_SIZE, 2);
      download(panelFilename('png'), png);
    } catch (e) {
      els.mxError.textContent = 'PNG export failed: ' + e.message;
      els.mxError.hidden = false;
    }
  }

  function exportPanelCsv() {
    if (!state.panel || !state.panel.model) return;
    const { view, model } = state.panel;
    const text = view === 'authors' ? XPCClouds.authorsCsv(model)
      : view === 'term' ? XPCClouds.termCsv(model)
        : view === 'comention' ? XPCClouds.comentionsCsv(model)
          : XPCMatrix.toCsv(model);
    download(panelFilename('csv'), new Blob([text], { type: 'text/csv;charset=utf-8' }));
  }

  // ---------------------------------------------------------------------------
  // Interaction network: who quotes, replies to, reposts and mentions whom. Uses the filters
  // (never the author filter) and, on request, the search pattern. Clicking an account focuses
  // the graph on it and lists the posts behind its connections; clicking a connection lists its posts.
  // ---------------------------------------------------------------------------

  const NETWORK_SIZE = 1080;
  const nwTypes = () => { const o = {}; for (const c of els.nwTypes) o[c.dataset.nwType] = c.checked; return o; };
  const nwTypeSet = () => new Set(els.nwTypes.filter((c) => c.checked).map((c) => c.dataset.nwType));

  function renderTypeMenu() {
    const fmt = (n) => (n === undefined ? '' : n.toLocaleString());
    els.typesAllN.textContent = fmt(state.typeCounts.all);
    for (const c of els.types) c.parentElement.querySelector('.n').textContent = fmt(state.typeCounts[c.dataset.type]);
    const legacy = state.legacyMedia || 0;
    els.typeHint.hidden = !legacy;
    els.typeHint.textContent = legacy
      ? `${legacy.toLocaleString()} of the posts shown ${legacy === 1 ? 'was' : 'were'} captured before images and videos were told apart: ${legacy === 1 ? 'it carries' : 'they carry'} a “media” tag and ${legacy === 1 ? 'is' : 'are'} not counted as images or videos. Scroll past ${legacy === 1 ? 'it' : 'them'} again on X to update.`
      : '';
  }

  function updatePickPill() {
    const p = state.pick;
    els.pickPill.hidden = !p;
    els.pickPill.textContent = p ? '✕ ' + (p.pill || `only posts behind ${p.label}`) : '';
  }

  function pickEdge(from, to, type) {
    state.pick = { kind: 'edge', from, to, type, types: nwTypeSet(), label: `@${from} ${XPCNetwork.typeOf(type).verb} @${to}` };
    apply();
  }

  function networkBase() {
    const base = state.filteredNoAuthor;
    if (!els.nwPattern.checked || !state.regex) return base;
    return base.filter((p) => state.regex.test(p.text || ''));
  }

  function renderNetwork() {
    if (!networkVisible()) return;
    const types = Array.from(nwTypeSet());
    const minWeight = Math.max(1, Number(els.nwMin.value) || 1);
    const compact = state.view !== 'network';
    const maxNodes = Math.min(compact ? 30 : 200, Math.max(5, Math.min(200, Number(els.nwNodes.value) || 60)));
    const usePattern = els.nwPattern.checked && Boolean(state.regex);
    const sig = JSON.stringify([state.baseSig, types, minWeight, maxNodes, usePattern ? [els.pattern.value, getOptions()] : null, state.nwFocus]);
    const renderOpts = { theme: pageTheme(), size: NETWORK_SIZE, title: els.nwTitle.value.trim(), note: networkNote(usePattern), compact };
    if (sig === state.networkSig && state.network) {
      // Same graph: only repaint when the title or theme changed, keeping positions and the view.
      if (JSON.stringify(renderOpts) !== JSON.stringify(state.network.renderOpts)) paintNetwork(renderOpts, true);
      updateFocusUi();
      return;
    }
    state.networkSig = sig;
    const model = XPCNetwork.build({ posts: networkBase(), types, minWeight, maxNodes, focus: state.nwFocus });
    XPCNetwork.layout(model, XPCNetwork.plotBox(NETWORK_SIZE));
    state.nwView = { k: 1, tx: 0, ty: 0 };
    state.network = { model, svg: '', renderOpts: null, applyView: null };
    paintNetwork(renderOpts, false);
    els.nwError.hidden = !model.focusMissing;
    els.nwError.textContent = model.focusMissing ? `@${state.nwFocus} has no interactions in these posts. Show everyone, or change the interaction types.` : '';
  }

  function networkNote(usePattern) {
    const p = usePattern ? `Only posts matching “${els.pattern.value.length > 30 ? els.pattern.value.slice(0, 29) + '…' : els.pattern.value}”. ` : '';
    return p + 'Arrows point from who acted to who was acted on. Counts only what one person scrolled past on X, not all of X.';
  }

  // Draw the SVG (the same string that is exported) and wire up hover, drag, pan and zoom.
  function paintNetwork(renderOpts, keepView) {
    const net = state.network;
    net.renderOpts = renderOpts;
    net.svg = XPCNetwork.renderSvg(net.model, renderOpts);
    if (!keepView) state.nwView = { k: 1, tx: 0, ty: 0 };
    els.nwView.innerHTML = net.svg;
    closeCard();
    wireNetwork();
    updateFocusUi();
  }

  function updateFocusUi() {
    const f = state.nwFocus;
    els.nwUnfocus.hidden = !f;
    els.nwChoose.hidden = Boolean(f);
    els.nwCapture.hidden = !f;
    els.nwCapture.textContent = '';
    els.nwFocusLine.textContent = f ? `Network of @${f}` : 'Everyone';
    if (!f) return;
    // Where to go on X, with capture on, to add more of this account's connections to the map.
    els.nwCapture.append(captureLinks(f));
  }

  // Where to go on X, with capture on, to add more of an account's connections to the map.
  function captureLinks(f) {
    const frag = document.createDocumentFragment();
    frag.append('Capture more: ',
      xLink('their posts ↗', `https://x.com/${f}`, 'Scroll their profile with capture on'), ' · ',
      xLink('their replies ↗', `https://x.com/${f}/with_replies`, 'Scroll their Replies tab with capture on'), ' · ',
      xLink('quotes of them ↗', `https://x.com/search?q=${encodeURIComponent(`x.com/${f}/status`)}&f=live`, 'Search X for posts that link to one of their posts, which is what a quote post does'));
    return frag;
  }

  // The line under the "Network map" summary, kept current even while the panel is closed.
  function renderNetworkSummary(posts) {
    const all = new Set(XPCNetwork.TYPES.map((t) => t.key));
    const enabled = nwTypeSet();
    const focus = (state.nwFocus || '').toLowerCase();
    let focusN = 0;
    const focusWith = new Set();
    const accounts = new Map();
    const acc = (handle, name) => {
      const k = handle.toLowerCase();
      let a = accounts.get(k);
      if (!a) { a = { handle, name: null, received: 0, sent: 0, recv: { quote: 0, reply: 0, repost: 0, mention: 0 } }; accounts.set(k, a); }
      if (name && !a.name) a.name = name;
      return a;
    };
    let n = 0;
    let withAny = 0;
    for (const p of posts) {
      const edges = XPCNetwork.edgesOf(p, all);
      if (!edges.length) continue;
      withAny++;
      n += edges.length;
      acc(p.handle, p.name);
      if (p.quotedHandle && p.quotedName) acc(p.quotedHandle, p.quotedName);
      for (const e of edges) {
        if (!enabled.has(e.type)) continue;
        acc(e.from, null).sent++;
        const to = acc(e.to, null);
        to.received++;
        to.recv[e.type]++;
        if (focus) {
          const from = e.from.toLowerCase();
          const to = e.to.toLowerCase();
          if (from === focus || to === focus) { focusN++; focusWith.add(from === focus ? to : from); }
        }
      }
    }
    state.nwTotals = { n, withAny };
    state.nwAccounts = Array.from(accounts.values())
      .filter((a) => a.received + a.sent > 0)
      .sort((a, b) => b.received - a.received || b.sent - a.sent || a.handle.localeCompare(b.handle));
    els.nwSummary.textContent = focus
      ? `network of @${state.nwFocus} · ${focusN.toLocaleString()} interaction${focusN === 1 ? '' : 's'} with ${focusWith.size.toLocaleString()} account${focusWith.size === 1 ? '' : 's'}`
      : n
        ? `${n.toLocaleString()} interactions in ${withAny.toLocaleString()} of these posts · who quotes, replies to and reposts whom`
        : 'who quotes, replies to and reposts whom · nothing captured yet: open a post’s quotes or replies on X with capture on';
  }

  const xLink = (text, href, title, cls) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    if (title) a.title = title;
    if (cls) a.className = cls;
    return a;
  };

  // ---------------------------------------------------------------------------
  // The workbench: filters in the rail, the posts in the middle, and the context pane on the
  // right with the map (Account tab) or the clouds (Topics tab), both drawn small. The header
  // links expand either into the main column in place of the posts: the same block moves.
  // ---------------------------------------------------------------------------

  const networkVisible = () => state.view === 'network' || state.paneTab === 'account';
  const panelVisible = () => state.view === 'compare' || state.paneTab === 'topics';

  function applyViewUi() {
    const view = state.view;
    els.posts.hidden = view !== 'posts';
    els.expanded.hidden = view === 'posts';
    els.expandedTitle.textContent = view === 'network' ? 'Network map' : view === 'compare' ? 'Topics' : '';
    const netHost = view === 'network' ? els.centerHost : els.nwHost;
    if (els.network.parentElement !== netHost) netHost.append(els.network);
    els.network.classList.toggle('compact', view !== 'network');
    els.nwAway.hidden = view !== 'network';
    const mxHost = view === 'compare' ? els.centerHost : els.mxHost;
    if (els.matrix.parentElement !== mxHost) mxHost.append(els.matrix);
    els.matrix.classList.toggle('compact', view !== 'compare');
    els.mxAway.hidden = view !== 'compare';
    for (const a of els.views) a.classList.toggle('active', a.dataset.section === view);
    for (const b of els.ctxTabs) b.setAttribute('aria-selected', String(b.dataset.tab === state.paneTab));
    els.ctxAccount.hidden = state.paneTab !== 'account';
    els.ctxTopics.hidden = state.paneTab !== 'topics';
  }

  function setView(view) {
    if (!CENTER_VIEWS.includes(view)) view = 'posts';
    state.view = view;
    if (view === 'network') state.paneTab = 'account';
    if (view === 'compare') state.paneTab = 'topics';
    applyViewUi();
    closeCard();
    renderNetwork();
    renderPanel();
    renderContext();
    syncHash();
    saveState();
    if (view !== 'posts') window.scrollTo({ top: 0 });
  }

  function setPaneTab(tab) {
    state.paneTab = tab === 'topics' ? 'topics' : 'account';
    applyViewUi();
    renderNetwork();
    renderPanel();
    renderContext();
    saveState();
  }

  // ---------------------------------------------------------------------------
  // The Account tab under the small map: the chosen account's numbers, who amplifies them and
  // whom they amplify, their most amplified post and the capture links; with no account, the
  // most interacted-with accounts. While an arrow is picked on the expanded map the posts behind
  // it list here instead, since the main list is behind the map.
  // ---------------------------------------------------------------------------

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const nameFor = (handle) => (state.nameByHandle && state.nameByHandle.get(String(handle).toLowerCase())) || '';
  const zeroTypes = () => ({ quote: 0, reply: 0, repost: 0, mention: 0 });
  const breakdown = (counts, word) => XPCNetwork.TYPES.filter((t) => counts[t.key]).map((t) => `${t[word]} ${counts[t.key].toLocaleString()}`).join(' · ');

  // Everything the account exchanges with others, by type and by account, from the posts in scope.
  function focusStats(handle, types) {
    const h = handle.toLowerCase();
    const st = { in: zeroTypes(), out: zeroTypes(), inAccounts: { quote: new Set(), reply: new Set(), repost: new Set(), mention: new Set() }, by: new Map(), total: 0 };
    const rec = (other) => {
      const k = other.toLowerCase();
      let r = st.by.get(k);
      if (!r) { r = { handle: other, in: zeroTypes(), out: zeroTypes(), inTotal: 0, outTotal: 0 }; st.by.set(k, r); }
      return r;
    };
    for (const p of networkBase()) {
      for (const e of XPCNetwork.edgesOf(p, types)) {
        const from = e.from.toLowerCase();
        const to = e.to.toLowerCase();
        if (to === h && from !== h) {
          st.in[e.type]++;
          st.inAccounts[e.type].add(from);
          const r = rec(e.from);
          r.in[e.type]++;
          r.inTotal++;
          st.total++;
        } else if (from === h && to !== h) {
          st.out[e.type]++;
          const r = rec(e.to);
          r.out[e.type]++;
          r.outTotal++;
          st.total++;
        }
      }
    }
    return st;
  }

  function pickPair(from, to) {
    state.pick = { kind: 'pair', from, to, types: nwTypeSet(), label: `@${from} → @${to}` };
    apply();
  }

  // A ranked list: name, bar, number. `value` gives the number, `tip` the title, `onPick` the click.
  function ctxRows(title, rows, value, tip, onPick) {
    const frag = document.createDocumentFragment();
    frag.append(el('h4', null, title));
    const max = Math.max(1, ...rows.map(value));
    for (const r of rows) {
      const row = el('div', 'ctx-row');
      row.title = tip(r);
      const who = el('span', 'who');
      const nm = nameFor(r.handle) || r.name;
      if (nm) who.append(el('b', null, nm), ' ');
      who.append(el('span', 'h', '@' + r.handle));
      const bar = el('span', 'bar');
      bar.style.width = Math.max(4, Math.round((value(r) / max) * 70)) + 'px';
      row.append(who, bar, el('span', 'n', value(r).toLocaleString()));
      row.addEventListener('click', (e) => { if (!shiftAccount(e, r.handle)) onPick(r); });
      frag.append(row);
    }
    return frag;
  }

  function postMini(p, withAuthor) {
    const c = el('div', 'ctx-card');
    const top = el('div', 'd');
    if (withAuthor) {
      const who = el('span', 'who', p.name || p.handle);
      who.append(' ', el('span', 'h', '@' + p.handle));
      top.append(who, ' · ');
    }
    top.append(fmtDay(p.time));
    c.append(top, el('div', 't', (p.text || '').replace(/\s+/g, ' ').trim() || '(no text)'));
    const ft = el('div', 'ft');
    const quotesHere = state.quoteCounts.get(p.id) || 0;
    ft.append(`${fmtNum(p.reposts)} reposts · ${fmtNum(p.likes)} likes${quotesHere ? ` · ${quotesHere} quote${quotesHere === 1 ? '' : 's'} here` : ''}`,
      xLink('open ↗', p.url, 'Open on X'), xLink('quotes ↗', p.url + '/quotes', 'Who quotes it, on X'));
    c.append(ft);
    return c;
  }

  function renderContext() {
    if (state.paneTab !== 'account') return;
    const types = nwTypeSet();
    const picked = state.view === 'network' && state.pick;
    // networkBase() narrows to the pattern when that box is ticked, so the pattern is part of the key.
    const usePattern = els.nwPattern.checked && Boolean(state.regex);
    const sig = JSON.stringify([state.baseSig, state.nwFocus, Array.from(types), picked ? [state.pick.label, state.pick.id || null, state.results.length] : null, pageTheme(), els.mxWeight.value, usePattern ? [els.pattern.value, getOptions()] : null]);
    if (sig === state.ctxSig) return;
    state.ctxSig = sig;
    const host = els.acctDetails;
    host.textContent = '';
    if (picked) { renderPickedPosts(host); return; }
    if (state.nwFocus) renderAccountDetails(host, state.nwFocus, types); else renderLeaders(host);
  }

  function renderAccountDetails(host, f, types) {
    const st = focusStats(f, types);
    const h3 = el('h3', null, '@' + f);
    const nm = nameFor(f);
    if (nm) h3.append(el('span', 'h', nm));
    h3.append(el('span', 'grow'));
    const clear = el('button', 'pill', '✕ Everyone');
    clear.type = 'button';
    clear.title = 'Back to the map of everyone';
    clear.addEventListener('click', () => setFocus(null));
    h3.append(clear);
    host.append(h3);
    if (!st.total) {
      host.append(el('p', 'ctx-empty', `No interactions with @${f} in these posts. Open their posts, replies or the quotes of them on X with capture on, then Refresh.`));
    } else {
      const stats = el('div', 'stats');
      for (const t of XPCNetwork.TYPES) {
        if (!types.has(t.key) || (!st.in[t.key] && !st.out[t.key])) continue;
        const line = el('div');
        const n = st.inAccounts[t.key].size;
        if (st.in[t.key]) line.append(`${t.past} `, el('b', null, st.in[t.key].toLocaleString() + '×'), ' by ', el('b', null, n.toLocaleString()), ` account${n === 1 ? '' : 's'}`);
        if (st.out[t.key]) line.append(st.in[t.key] ? ' · ' : '', `${t.label} sent `, el('b', null, st.out[t.key].toLocaleString()));
        stats.append(line);
      }
      host.append(stats);
    }
    const mine = state.filteredNoAuthor.filter((p) => (p.handle || '').toLowerCase() === f.toLowerCase());
    host.append(accountCloud(f, mine));
    if (st.total) {
      const inRows = Array.from(st.by.values()).filter((r) => r.inTotal > 0).sort((a, b) => b.inTotal - a.inTotal).slice(0, 6);
      if (inRows.length) host.append(ctxRows(`Who amplifies @${f}`, inRows, (r) => r.inTotal, (r) => breakdown(r.in, 'label') + ' · click for the posts', (r) => pickPair(r.handle, f)));
      const outRows = Array.from(st.by.values()).filter((r) => r.outTotal > 0).sort((a, b) => b.outTotal - a.outTotal).slice(0, 6);
      if (outRows.length) host.append(ctxRows(`@${f} amplifies`, outRows, (r) => r.outTotal, (r) => breakdown(r.out, 'label') + ' · click for the posts', (r) => pickPair(f, r.handle)));
    }
    const top = mine.reduce((best, p) => (!best || (p.reposts || 0) > (best.reposts || 0) || ((p.reposts || 0) === (best.reposts || 0) && (p.likes || 0) > (best.likes || 0)) ? p : best), null);
    if (top) {
      const wrap = el('div');
      wrap.append(el('h4', null, 'Most amplified post'), postMini(top, false));
      host.append(wrap);
    }
    const links = el('p', 'ctx-links');
    links.append(captureLinks(f));
    host.append(links);
  }

  // What the account talks about: their words against everyone else's in the current filter,
  // falling back to plain counts when nothing stands out yet. Click a word for their posts with it.
  function accountCloud(f, mine) {
    const wrap = el('div', 'ctx-cloud');
    const head = el('h4', null, 'Talks about');
    const save = el('button', 'link-btn', 'Save image ↓');
    save.type = 'button';
    save.title = `Download @${f}’s cloud as a PNG to share, in the page’s theme`;
    const all = el('button', 'link-btn', 'All clouds →');
    all.type = 'button';
    all.title = 'Compare with the other authors in the Topics tab; this account’s cloud comes first';
    all.addEventListener('click', () => { setPanelView('authors'); setPaneTab('topics'); });
    head.append(el('span', 'grow'), save, all);
    wrap.append(head);
    save.hidden = true;
    if (!mine.length) {
      wrap.append(el('p', 'ctx-empty', `None of @${f}’s own posts are captured in this filter.`));
      return wrap;
    }
    const target = XPCWords.aggregate(mine.map(countsFor));
    const total = aggregateFor(state.filteredNoAuthor);
    const weight = els.mxWeight.value === 'frequent' ? 'frequent' : 'distinctive';
    // 60 words for the saved image; the pane shows the top 30.
    let r = XPCWords.topTerms({ target, total, mode: weight, max: 60 });
    if (!r.terms.length && r.mode === 'distinctive') r = XPCWords.topTerms({ target, total, mode: 'frequent', max: 60 });
    if (!r.terms.length) {
      wrap.append(el('p', 'ctx-empty', 'Not enough words yet.'));
      return wrap;
    }
    const view = el('div', 'ctx-cloud-view');
    view.innerHTML = XPCClouds.renderMiniCloud({ handle: f, name: nameFor(f), words: r.terms.slice(0, 30), mode: r.mode }, { theme: pageTheme() });
    head.title = `Click a word for @${f}’s posts with it · Shift-click words, release Shift to search X · Alt-click for the word’s term cloud`;
    markChord();
    save.hidden = false;
    save.addEventListener('click', async () => {
      const svg = XPCClouds.renderAccountCloud({ handle: f, name: nameFor(f), words: r.terms, mode: r.mode, posts: mine.length, ...dateRange(mine) }, { theme: pageTheme(), size: MATRIX_SIZE });
      try {
        download(`${slug(f)}-words-${stamp()}.png`, await XPCMatrix.toPng(svg, MATRIX_SIZE, 2));
      } catch (e) {
        showToast('Could not save the image: ' + e.message);
      }
    });
    view.addEventListener('click', (e) => {
      const w = e.target.closest('.w');
      if (w) wordClick(e, w.dataset.word, f, 'account');
    });
    wrap.append(view);
    return wrap;
  }

  function renderLeaders(host) {
    const h3 = el('h3', null, 'Everyone');
    h3.append(el('span', 'grow'));
    const choose = el('button', 'link-btn', 'Choose an account ↑');
    choose.type = 'button';
    choose.title = 'Choose an account in the bar at the top';
    choose.addEventListener('click', () => els.author.focus());
    h3.append(choose);
    host.append(h3);
    const totals = state.nwTotals || { n: 0, withAny: 0 };
    const rows = (state.nwAccounts || []).filter((a) => a.received > 0).slice(0, 10);
    if (!rows.length) {
      host.append(el('p', 'ctx-empty', 'No interactions captured yet. Open a post’s quotes or replies on X with capture on, then Refresh.'));
      return;
    }
    host.append(el('div', 'stats', `${totals.n.toLocaleString()} interactions in ${totals.withAny.toLocaleString()} posts · ${(state.nwAccounts || []).length.toLocaleString()} accounts`));
    host.append(ctxRows('Most interacted with', rows, (a) => a.received, (a) => breakdown(a.recv, 'past') + ' · click to choose', (a) => setFocus(a.handle)));
  }

  function renderPickedPosts(host) {
    const p = state.pick;
    const posts = state.results.map((r) => r.post);
    const h3 = el('h3', null, p.kind === 'quotesOf' ? `Quotes of ${p.label}` : `Posts behind ${p.label}`);
    h3.append(el('span', 'grow'));
    const clear = el('button', 'pill', '✕');
    clear.type = 'button';
    clear.title = 'Stop showing only the posts behind this connection';
    clear.addEventListener('click', () => { state.pick = null; apply(); });
    h3.append(clear);
    host.append(h3);
    const list = el('div', 'ctx-posts');
    for (const post of posts.slice(0, 30)) list.append(postMini(post, true));
    host.append(list);
    const ft = el('p', 'ctx-links');
    const show = el('button', 'link-btn', `Show ${posts.length === 1 ? 'it' : `all ${posts.length.toLocaleString()}`} in the list →`);
    show.type = 'button';
    show.addEventListener('click', () => setView('posts'));
    ft.append(show);
    host.append(ft);
  }

  function tipLine(parent, text, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    parent.append(d);
  }

  function nodeTip(n, model) {
    const frag = document.createDocumentFragment();
    const b = document.createElement('b');
    b.textContent = n.name || '@' + n.handle;
    frag.append(b);
    tipLine(frag, `@${n.handle} · ${n.captured ? `${n.posts.toLocaleString()} post${n.posts === 1 ? '' : 's'} captured` : 'none of their posts captured'}`, 'h');
    for (const t of XPCNetwork.TYPES) {
      if (!model.types.includes(t.key)) continue;
      tipLine(frag, `${t.past} ${n.in[t.key].toLocaleString()} · sent ${t.label} ${n.out[t.key].toLocaleString()}`);
    }
    tipLine(frag, `received ${n.received.toLocaleString()} · sent ${n.sent.toLocaleString()} · click to focus, drag to move`, 'k');
    return frag;
  }

  function edgeTip(g, model) {
    const e = model.edges.find((x) => String(x.from) === g.dataset.i && String(x.to) === g.dataset.j && x.type === g.dataset.type);
    const frag = document.createDocumentFragment();
    const b = document.createElement('b');
    b.textContent = `@${g.dataset.from} ${XPCNetwork.typeOf(g.dataset.type).verb} @${g.dataset.to}`;
    frag.append(b);
    tipLine(frag, `${e ? e.count.toLocaleString() : '?'} post${e && e.count === 1 ? '' : 's'} · click to list them`, 'k');
    return frag;
  }

  function wireNetwork() {
    const svg = els.nwView.querySelector('svg');
    const net = state.network;
    const pan = svg && svg.querySelector('g.pan');
    if (!svg || !pan) { if (net) net.applyView = null; return; }
    const { model } = net;
    const nodeEls = Array.from(svg.querySelectorAll('g.node'));
    const edgeEls = Array.from(svg.querySelectorAll('g.edge'));
    const applyView = () => { const v = state.nwView; pan.setAttribute('transform', `translate(${v.tx.toFixed(1)} ${v.ty.toFixed(1)}) scale(${v.k.toFixed(3)})`); };
    net.applyView = applyView;
    applyView();

    // Screen → image units (the SVG is 1080 × 1080 user units, shown scaled).
    const toSvg = (clientX, clientY) => {
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      return { x: vb.x + ((clientX - r.left) / r.width) * vb.width, y: vb.y + ((clientY - r.top) / r.height) * vb.height };
    };
    const arrow = net.renderOpts && net.renderOpts.compact ? XPCNetwork.ARROW * XPCNetwork.COMPACT_SCALE : XPCNetwork.ARROW;

    const near = {};
    for (const e of model.edges) {
      (near[e.from] = near[e.from] || new Set()).add(e.to);
      (near[e.to] = near[e.to] || new Set()).add(e.from);
    }
    const lightNode = (i) => {
      svg.classList.add('hover');
      nodeEls.forEach((g, j) => g.classList.toggle('lit', j === i || Boolean(near[i] && near[i].has(j))));
      edgeEls.forEach((g) => g.classList.toggle('lit', Number(g.dataset.i) === i || Number(g.dataset.j) === i));
    };
    const lightEdge = (edge) => {
      svg.classList.add('hover');
      const i = Number(edge.dataset.i);
      const j = Number(edge.dataset.j);
      nodeEls.forEach((g, k) => g.classList.toggle('lit', k === i || k === j));
      edgeEls.forEach((g) => g.classList.toggle('lit', g === edge));
    };
    const hideTip = () => { els.nwTip.hidden = true; };
    const unlight = () => {
      svg.classList.remove('hover');
      nodeEls.forEach((g) => g.classList.remove('lit'));
      edgeEls.forEach((g) => g.classList.remove('lit'));
      hideTip();
    };
    const showTip = (frag, clientX, clientY) => {
      const stage = els.nwStage.getBoundingClientRect();
      els.nwTip.textContent = '';
      els.nwTip.append(frag);
      els.nwTip.hidden = false;
      let x = clientX - stage.left + 14;
      const y = clientY - stage.top + 14;
      if (x + els.nwTip.offsetWidth > stage.width) x = Math.max(0, clientX - stage.left - els.nwTip.offsetWidth - 14);
      els.nwTip.style.left = x + 'px';
      els.nwTip.style.top = y + 'px';
    };

    let drag = null; // { kind: 'pan' | 'node', i, g, sx, sy, ox, oy, moved }
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const g = e.target.closest('g.node');
      const p = toSvg(e.clientX, e.clientY);
      if (g) {
        const i = Number(g.dataset.i);
        drag = { kind: 'node', i, g, sx: p.x, sy: p.y, ox: model.nodes[i].x, oy: model.nodes[i].y, moved: false, edge: null };
        g.classList.add('dragging');
      } else {
        drag = { kind: 'pan', sx: p.x, sy: p.y, ox: state.nwView.tx, oy: state.nwView.ty, moved: false, edge: e.target.closest('g.edge') };
        svg.classList.add('panning');
      }
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) {
        const g = e.target.closest('g.node');
        const edge = g ? null : e.target.closest('g.edge');
        if (g) { lightNode(Number(g.dataset.i)); showTip(nodeTip(model.nodes[Number(g.dataset.i)], model), e.clientX, e.clientY); }
        else if (edge) { lightEdge(edge); showTip(edgeTip(edge, model), e.clientX, e.clientY); }
        else unlight();
        return;
      }
      hideTip();
      const p = toSvg(e.clientX, e.clientY);
      const dx = p.x - drag.sx;
      const dy = p.y - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === 'pan') {
        state.nwView.tx = drag.ox + dx;
        state.nwView.ty = drag.oy + dy;
        applyView();
        return;
      }
      const n = model.nodes[drag.i];
      n.x = Math.round((drag.ox + dx / state.nwView.k) * 10) / 10;
      n.y = Math.round((drag.oy + dy / state.nwView.k) * 10) / 10;
      drag.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
      for (const g of edgeEls) {
        const i = Number(g.dataset.i);
        const j = Number(g.dataset.j);
        if (i !== drag.i && j !== drag.i) continue;
        const d = XPCNetwork.edgePath(model.nodes[i], model.nodes[j], g.dataset.type, arrow);
        for (const path of g.querySelectorAll('path')) path.setAttribute('d', d);
      }
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      svg.classList.remove('panning');
      if (d.g) d.g.classList.remove('dragging');
      if (d.moved) {
        // Keep the export in step with where the accounts were dragged.
        if (d.kind === 'node') net.svg = XPCNetwork.renderSvg(model, net.renderOpts);
        return;
      }
      if (d.kind === 'node') {
        const h = model.nodes[d.i].handle;
        unlight();
        if (shiftAccount(e, h)) return;
        setFocus(state.nwFocus && state.nwFocus.toLowerCase() === h.toLowerCase() ? null : h);
      } else if (d.edge) {
        unlight();
        pickEdge(d.edge.dataset.from, d.edge.dataset.to, d.edge.dataset.type);
        openEdgeCard(d.edge, e.clientX, e.clientY);
      } else {
        closeCard();
      }
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', () => { if (!drag) unlight(); });
    // The wheel zooms only once the graph has been clicked (or with Ctrl / ⌘ held), so scrolling
    // past the panel still scrolls the page.
    let engaged = false;
    svg.addEventListener('pointerdown', () => { engaged = true; });
    svg.addEventListener('pointerleave', () => { engaged = false; });
    svg.addEventListener('wheel', (e) => {
      if (!engaged && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      const v = state.nwView;
      const k = Math.max(0.4, Math.min(8, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      v.tx = p.x - (p.x - v.tx) * (k / v.k);
      v.ty = p.y - (p.y - v.ty) * (k / v.k);
      v.k = k;
      applyView();
    }, { passive: false });
  }

  const fmtDay = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '?';
  };

  function closeCard() {
    els.nwCard.hidden = true;
    els.nwCard.textContent = '';
  }

  // Clicking an arrow opens a card on it: the posts behind that connection, each with a link to
  // the post on X and to the posts that quote it (who picked up that framing).
  function openEdgeCard(edgeEl, clientX, clientY) {
    const { model } = state.network;
    const e = model.edges.find((x) => String(x.from) === edgeEl.dataset.i && String(x.to) === edgeEl.dataset.j && x.type === edgeEl.dataset.type);
    if (!e) return;
    const t = XPCNetwork.typeOf(e.type);
    const posts = e.ids.map((id) => state.postById.get(id)).filter(Boolean).sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    const card = els.nwCard;
    card.textContent = '';
    const hd = document.createElement('div');
    hd.className = 'hd';
    const title = document.createElement('b');
    title.textContent = `@${e.fromHandle} ${t.verb} @${e.toHandle}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.title = 'Close';
    close.textContent = '×';
    close.addEventListener('click', closeCard);
    hd.append(title, close);
    card.append(hd);
    const what = e.type === 'repost' ? 'the reposted post' : e.type === 'quote' ? 'the quote post' : e.type === 'reply' ? 'the reply' : 'the post';
    for (const p of posts.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'row';
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = fmtDay(p.time);
      const tx = document.createElement('span');
      tx.className = 't';
      tx.textContent = (p.text || '').replace(/\s+/g, ' ').trim() || '(no text)';
      tx.title = (p.text || '').slice(0, 400);
      row.append(d, tx, xLink('open ↗', p.url, `Open ${what} on X`), xLink('quotes ↗', p.url + '/quotes', `Who quotes ${what}`));
      if (e.type === 'quote' && p.quotedHandle && p.quotedId) row.append(xLink('original ↗', `https://x.com/${p.quotedHandle}/status/${p.quotedId}/quotes`, 'Who else quotes the post it quotes'));
      card.append(row);
    }
    const ft = document.createElement('div');
    ft.className = 'ft';
    ft.textContent = `${posts.length.toLocaleString()} post${posts.length === 1 ? '' : 's'}${posts.length > 8 ? ', all' : ''} listed ${state.view === 'network' ? 'beside the map' : 'in the list'}`;
    card.append(ft);
    card.hidden = false;
    const stage = els.nwStage.getBoundingClientRect();
    let x = clientX - stage.left + 12;
    let y = clientY - stage.top + 12;
    if (x + card.offsetWidth > stage.width) x = Math.max(0, stage.width - card.offsetWidth - 4);
    if (y + card.offsetHeight > stage.height) y = Math.max(0, clientY - stage.top - card.offsetHeight - 12);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  function networkFilename(ext) {
    const custom = slug(els.nwTitle.value.trim());
    const base = custom || (state.nwFocus ? `${slug(state.nwFocus)}-network-map` : 'account-network-map');
    return `${base}-${stamp()}.${ext}`;
  }

  // The map as shown (positions included), or redrawn in the theme chosen in the export menu.
  function networkExportSvg() {
    const net = state.network;
    if (!net || !net.svg) return null;
    const theme = exportTheme(els.nwTheme);
    return XPCNetwork.renderSvg(net.model, { ...net.renderOpts, theme, compact: false }); // never the compact drawing
  }

  function exportNetworkSvg() {
    const svg = networkExportSvg();
    if (!svg) return;
    download(networkFilename('svg'), new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml;charset=utf-8' }));
  }

  async function exportNetworkPng() {
    const svg = networkExportSvg();
    if (!svg) return;
    try {
      download(networkFilename('png'), await XPCMatrix.toPng(svg, NETWORK_SIZE, 2));
    } catch (e) {
      els.nwError.textContent = 'PNG export failed: ' + e.message;
      els.nwError.hidden = false;
    }
  }

  function exportNetworkCsv(edges) {
    if (!state.network || !state.network.model) return;
    const text = edges ? XPCNetwork.edgesCsv(state.network.model) : XPCNetwork.accountsCsv(state.network.model);
    download(networkFilename((edges ? 'connections' : 'accounts') + '.csv'), new Blob([text], { type: 'text/csv;charset=utf-8' }));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderKpis(authorCount) {
    els.kpiPosts.textContent = state.posts.length.toLocaleString();
    els.kpiAuthors.textContent = authorCount.toLocaleString();
  }

  function postCard(post, hits) {
    const card = document.createElement('article');
    card.className = 'post';
    card.dataset.id = post.id;

    const header = document.createElement('header');
    const name = document.createElement('a');
    name.className = 'name';
    name.href = `https://x.com/${post.handle}`;
    name.target = '_blank';
    name.rel = 'noopener';
    name.textContent = post.name || post.handle;
    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '@' + post.handle;
    handle.title = 'Choose this account';
    handle.addEventListener('click', (e) => shiftAccount(e, post.handle) || setFocus(post.handle));
    const time = document.createElement('time');
    time.dateTime = post.time || '';
    const link = document.createElement('a');
    link.href = post.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '· ' + fmtDate(post.time);
    time.append(link);
    header.append(name, handle, time);

    // [label, handle the tag filters by when clicked]
    const tags = [];
    const replyTo = Array.isArray(post.replyTo) ? post.replyTo : [];
    if (post.isReply) tags.push(replyTo.length ? [`reply to ${replyTo.map((h) => '@' + h).join(' ')}${post.replyInferred ? ' (inferred)' : ''}`, replyTo[0]] : ['reply']);
    if (post.isRepost) tags.push(post.repostedBy ? [`reposted by @${post.repostedBy}`, post.repostedBy] : ['repost']);
    const reposters = Array.isArray(post.reposters) ? post.reposters.filter((h) => h.toLowerCase() !== (post.repostedBy || '').toLowerCase()) : [];
    if (reposters.length) tags.push(reposters.length === 1 ? [`reposted by @${reposters[0]}`, reposters[0]] : [`reposted by ${reposters.length} accounts`]);
    if (post.isQuote) tags.push(post.quotedHandle ? [`quotes @${post.quotedHandle}`, post.quotedHandle] : ['quote']);
    if (post.hasImage) tags.push([post.images > 1 ? `${post.images} images` : 'image']);
    if (post.hasVideo) tags.push(['video']);
    if (typeFlags(post).link) tags.push(['link']);
    if (legacyMedia(post)) tags.push(['media']);
    if (post.isPinned) tags.push(['pinned']);
    if (post.truncated) tags.push(['truncated']);
    if (post.lang) tags.push([post.lang]);
    for (const [t, h] of tags) {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = t;
      if (h) {
        s.classList.add('to');
        s.title = (post.replyInferred && t.startsWith('reply') ? 'Taken from the post page, where X hides the “Replying to” line: it may answer another reply in the thread. ' : '') + `Choose @${h}`;
        s.addEventListener('click', (e) => shiftAccount(e, h) || setFocus(h));
      }
      header.append(s);
    }
    const grow = document.createElement('span');
    grow.className = 'grow';
    header.append(grow, cardMenu(post));

    const text = document.createElement('div');
    text.className = 'text';
    if (post.stub) {
      text.classList.add('stub');
      text.textContent = 'Only its reposters are known so far. Open the post on X with capture on to fill in the rest.';
    } else {
      text.append(highlighted(post.text || ''));
    }

    const extras = [];
    if (post.isQuote && (post.quotedHandle || post.quotedText || post.quotedId)) {
      // The original, when the catalogue holds it: its full text beats what X showed in the quote card.
      const orig = post.quotedId ? state.postById.get(post.quotedId) || null : null;
      const qHandle = (orig && orig.handle) || post.quotedHandle || null;
      const qName = (orig && orig.name) || post.quotedName || null;
      const qText = (orig && orig.text) || post.quotedText || '';
      const sep = () => '·';
      const qd = document.createElement('div');
      qd.className = 'quoted';
      const by = document.createElement('div');
      by.className = 'q-by';
      const arrow = document.createElement('span');
      arrow.className = 'q-arrow';
      arrow.textContent = '↳';
      arrow.title = 'The post this one quotes';
      const nm = document.createElement('b');
      nm.textContent = qName || (qHandle ? '@' + qHandle : 'Quoted post');
      by.append(arrow, nm);
      if (qHandle) {
        const hh = document.createElement('span');
        hh.className = 'h to';
        hh.textContent = '@' + qHandle;
        hh.title = `Choose @${qHandle}`;
        hh.addEventListener('click', (e) => shiftAccount(e, qHandle) || setFocus(qHandle));
        by.append(hh);
      }
      if (orig && orig.time) by.append(sep(), fmtDay(orig.time));
      if (orig) {
        const inCat = document.createElement('span');
        inCat.className = 'q-in';
        inCat.textContent = 'in the catalogue';
        inCat.title = 'The original is captured, so this is its full text';
        by.append(sep(), inCat);
        const qn = state.quoteCounts.get(orig.id) || 0;
        if (qn) by.append(sep(), quoteCount(orig, qn));
      }
      if (qHandle && post.quotedId) {
        const base = `https://x.com/${qHandle}/status/${post.quotedId}`;
        by.append(sep(), xLink('open ↗', base, 'Open the quoted post on X', 'h'), sep(), xLink('its quotes ↗', base + '/quotes', 'Open the posts quoting the quoted post on X. With capture on, each one joins the network map.', 'h'));
      }
      qd.append(by);
      if (qText) {
        const qt = document.createElement('div');
        qt.className = 'q-text';
        qt.textContent = qText;
        if (!orig) qt.title = 'As X showed it in the quote card, which may be cut short. Open the original on X with capture on and its full text is used here.';
        qd.append(qt);
      }
      extras.push(qd);
    }
    if (Array.isArray(post.links) && post.links.length) {
      const ld = document.createElement('div');
      ld.className = 'links';
      ld.append('🔗 ');
      post.links.forEach((l, i) => {
        if (i) ld.append(' · ');
        const href = webHref(l);
        ld.append(href ? webLink(String(l), href) : String(l));
      });
      extras.push(ld);
    }

    // Two footer rows: the numbers, then length, provenance and the links to X.
    const footer = document.createElement('footer');
    const row = (cls) => { const d = document.createElement('div'); d.className = 'row ' + cls; return d; };
    const stats = row('stats');
    const metric = (label, v) => {
      if (v === null || v === undefined) return null;
      const s = document.createElement('span');
      s.textContent = `${fmtNum(v)} ${label}`;
      return s;
    };
    for (const m of [metric('replies', post.replies), metric('reposts', post.reposts), metric('likes', post.likes), metric('bookmarks', post.bookmarks), metric('views', post.views)]) if (m) stats.append(m);
    if (state.regex && hits) {
      const h = document.createElement('span');
      h.className = 'hits';
      h.textContent = hits === 1 ? '1 match' : `${hits} matches`;
      stats.append(h);
    }
    const qn = state.quoteCounts.get(post.id) || 0;
    if (qn) stats.append(quoteCount(post, qn));
    const meta = row('meta');
    const chars = (post.text || '').length;
    if (chars) {
      const lines = lineCount(post.text);
      const len = document.createElement('span');
      len.className = 'len';
      len.title = post.truncated ? 'Captured preview only: X collapsed the full post behind “Show more”' : 'Characters and non-empty lines';
      len.textContent = `${chars.toLocaleString()} chars · ${lines} ${lines === 1 ? 'line' : 'lines'}${post.truncated ? '+' : ''}`;
      meta.append(len);
    }
    const cap = document.createElement('span');
    cap.textContent = `captured ${fmtDate(post.firstSeen ? new Date(post.firstSeen).toISOString() : '')}${post.context ? ' from ' + post.context : ''}`;
    const gap = document.createElement('span');
    gap.className = 'grow';
    meta.append(cap, gap);
    if (!post.stub) meta.append(copiesMenu(post));
    meta.append(
      xLink('quotes ↗', post.url + '/quotes', 'Open the posts quoting this one on X. With capture on, each one joins the network map as “quotes @' + post.handle + '”.', 'x'),
      xLink('replies ↗', post.url, 'Open this post with its replies on X. With capture on, each reply joins the network map as “reply to @' + post.handle + '”.', 'x'));
    footer.append(stats, meta);

    card.append(header, text, ...extras, footer);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Content operations on a card: the ··· menu (open, copy, remove with undo), "find copies"
  // (an X search composed by xsearch.js), and "N quotes here" (the captured posts quoting it).
  // ---------------------------------------------------------------------------

  // Lookups over the loaded posts: by id, every captured handle, and how many captured posts quote each post.
  function indexPosts() {
    state.postById = new Map(state.posts.map((p) => [p.id, p]));
    state.handles = new Set(state.posts.map((p) => (p.handle || '').toLowerCase()));
    const q = new Map();
    for (const p of state.posts) if (p.quotedId) q.set(p.quotedId, (q.get(p.quotedId) || 0) + 1);
    state.quoteCounts = q;
  }

  function cardMenu(post) {
    const d = document.createElement('details');
    d.className = 'menu more-menu card-menu';
    const sm = document.createElement('summary');
    sm.textContent = '···';
    sm.setAttribute('aria-label', 'More');
    sm.title = 'Open, copy or remove';
    const list = document.createElement('div');
    list.className = 'popover menu-list';
    const item = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { d.open = false; fn(); });
      return b;
    };
    const open = xLink('Open on X ↗', post.url, 'Open the post on X');
    open.addEventListener('click', () => { d.open = false; });
    list.append(open,
      item('Copy text', 'Copy the post text', () => copyText(post.text || '', 'Text copied')),
      item('Copy link', 'Copy the post’s address on X', () => copyText(post.url, 'Link copied')),
      item('Remove from catalogue', 'Delete this post from the local catalogue. Undo is offered for a few seconds.', () => removePost(post), 'danger'));
    d.append(sm, list);
    return d;
  }

  const refreshBadge = () => { if (rt) rt.sendMessage({ type: 'badge' }, () => void chrome.runtime.lastError); };

  async function removePost(post) {
    await XPCDB.remove([post.id]);
    refreshBadge();
    state.posts = state.posts.filter((p) => p.id !== post.id);
    indexPosts();
    apply();
    showToast(`Removed the post by @${post.handle}`, async () => {
      await XPCDB.upsertMany([post]);
      refreshBadge();
      if (!state.postById.has(post.id)) state.posts = state.posts.concat([post]);
      indexPosts();
      apply();
    });
  }

  let toastTimer = null;
  function showToast(text, undo) {
    const t = els.toast;
    t.querySelector('.t').textContent = text;
    const u = t.querySelector('.undo');
    u.hidden = !undo;
    u.onclick = undo ? () => { hideToast(); undo(); } : null;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 8000 : 2500);
  }
  function hideToast() { clearTimeout(toastTimer); els.toast.hidden = true; }

  function copyText(text, done) {
    const p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
    p.then(() => showToast(done), () => showToast('Could not copy'));
  }

  // "N quotes here": the captured posts that quote this one, which is who picked up its framing.
  function quoteCount(post, n) {
    const q = document.createElement('span');
    q.className = 'q-count';
    q.textContent = `${n} quote${n === 1 ? '' : 's'} here`;
    q.title = 'Captured posts that quote this one: click to list them';
    q.addEventListener('click', () => pickQuotesOf(post));
    return q;
  }

  function pickQuotesOf(post) {
    state.pick = { kind: 'quotesOf', id: post.id, types: nwTypeSet(), label: `@${post.handle}’s post`, pill: `only the quotes of @${post.handle}’s post` };
    apply();
    if (state.view !== 'posts') setView('posts');
    scrollTo(els.resultsHead);
  }

  // "find copies": an X search for copies and near-copies of the post, composed by xsearch.js
  // from its rarest phrases (rarity judged against the catalogue) in a window around its date.
  // The query is shown and editable, because a word never captured may still be common on X.
  function copiesMenu(post) {
    const d = document.createElement('details');
    d.className = 'menu copies';
    const sm = document.createElement('summary');
    sm.textContent = 'find copies';
    sm.title = 'Compose an X search for copies and near-copies of this post';
    const pop = document.createElement('div');
    pop.className = 'popover';
    d.append(sm, pop);
    d.addEventListener('toggle', () => { if (d.open && !pop.childElementCount) fillCopies(pop, post); });
    return d;
  }

  function fillCopies(pop, post) {
    const agg = aggregateFor(state.posts);
    const c = XPCXSearch.compose(post, { df: agg.df, N: agg.posts });
    pop.append(el('h4', null, 'Find copies of this post on X'));
    const ta = document.createElement('textarea');
    ta.value = c.query;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'X search query, editable');
    ta.placeholder = 'The post is too short to search by phrase.';
    const why = el('p', 'why', c.describe.join(' '));
    const acts = el('div', 'acts');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'pill';
    open.textContent = 'Open on X ↗';
    open.title = 'Search X for the query above, latest first';
    open.addEventListener('click', () => { const url = XPCXSearch.searchUrl(ta.value.trim()); if (url) window.open(url, '_blank', 'noopener'); });
    acts.append(open);
    if (c.looseUrl) acts.append(xLink('reworded ↗', c.looseUrl, `Looser: posts with its rarest words in any order (${c.keywords.join(', ')}), for talking points that were reworded`));
    if (c.webUrl) acts.append(xLink('web ↗', c.webUrl, 'Search the web for the first phrase'));
    const note = el('p', 'note', 'Open it with capture on and scroll the results, then Refresh here: every copy joins the catalogue, and its author the map. X keeps copypasta out of recommendations, so scrolling alone under-samples copies.');
    pop.append(ta, why, acts, note);
  }

  // ---------------------------------------------------------------------------
  // Selection toolbar: select text in a post and act on it: filter the list to it, add it to the
  // Topics keywords, search X for the phrase, or copy it.
  // ---------------------------------------------------------------------------

  function selectedPostText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 300) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const host = (node.nodeType === 1 ? node : node.parentElement);
    if (!host || !host.closest('.post .text, .post .q-text, .ctx-card .t')) return null;
    return { text, rect: range.getBoundingClientRect() };
  }

  function showSelTools() {
    const s = selectedPostText();
    const t = els.selTools;
    if (!s) { t.hidden = true; return; }
    t.hidden = false;
    t.dataset.text = s.text;
    const w = t.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, s.rect.left + s.rect.width / 2 - w / 2));
    const above = s.rect.top - t.offsetHeight - 8;
    t.style.left = x + 'px';
    t.style.top = (above < 64 ? s.rect.bottom + 8 : above) + 'px';
  }

  // Append a keyword to the Topics list and show it where keywords are used (the heat map, or
  // co-mentions if that is the current view). A phrase with regex characters gets a label.
  function addKeyword(text) {
    const escaped = XPCSearch.escapeRegex(text);
    const line = getOptions().regex && escaped !== text ? `${text} :: ${escaped}` : text;
    const cur = els.mxKeywords.value;
    if (!cur.split('\n').some((l) => l.trim() === line)) els.mxKeywords.value = (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + line;
    if (!['comention', 'matrix'].includes(panelView())) setPanelView('matrix');
    if (state.view === 'compare') { renderPanel(); saveState(); } else setPaneTab('topics');
    showToast(`Added “${text}” to the keywords`);
  }

  let selTimer = null;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(showSelTools, 200); });
  window.addEventListener('scroll', () => { if (!els.selTools.hidden) showSelTools(); }, { passive: true });
  els.selTools.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection while clicking
  els.selTools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    const text = els.selTools.dataset.text || '';
    if (!b || !text) return;
    const act = b.dataset.act;
    if (act === 'filter') { setOptions({ ...getOptions(), pattern: text, regex: false, wholeWord: false }); apply(); if (state.view !== 'posts') setView('posts'); }
    else if (act === 'keyword') addKeyword(text);
    else if (act === 'x') window.open(XPCXSearch.searchUrl('"' + text.replace(/"/g, '') + '"'), '_blank', 'noopener');
    else if (act === 'copy') copyText(text, 'Copied');
    if (act !== 'copy') window.getSelection().removeAllRanges();
    els.selTools.hidden = true;
  });

  function renderResults(reset) {
    if (reset) { els.list.textContent = ''; state.shown = 0; }
    const slice = state.results.slice(state.shown, state.shown + PAGE);
    const frag = document.createDocumentFragment();
    for (const { post, hits } of slice) frag.append(postCard(post, hits));
    els.list.append(frag);
    state.shown += slice.length;

    const total = state.results.length;
    els.more.hidden = state.shown >= total;
    els.more.textContent = `Show more (${(total - state.shown).toLocaleString()} left)`;
    els.resultCount.textContent = (state.regex
      ? `${total.toLocaleString()} of ${state.posts.length.toLocaleString()} posts match`
      : `${total.toLocaleString()} of ${state.posts.length.toLocaleString()} posts`) + ` · ${SORT_LABELS[effectiveSort(getSort())]}`;
    els.sortSeg.classList.toggle('has-pattern', Boolean(state.regex));
    els.empty.hidden = total > 0;
    els.empty.textContent = state.posts.length
      ? 'No posts match. Loosen the pattern or filters.'
      : 'Nothing captured yet. Browse x.com with capture on, then come back and hit Refresh.';
  }

  function renderAuthors(authors) {
    const minPosts = Math.max(1, Number(els.minPosts.value) || 1);
    const hasRegex = Boolean(state.regex);
    const rows = Array.from(authors.values()).filter((a) => a.posts >= minPosts);
    rows.forEach((a) => { a.rate = a.posts ? a.matches / a.posts : 0; });
    rows.sort(hasRegex
      ? (a, b) => b.rate - a.rate || b.matches - a.matches || b.posts - a.posts
      : (a, b) => b.posts - a.posts);

    els.authorsHint.textContent = hasRegex
      ? 'Rate = share of an author\'s captured posts that match the pattern. Click a row to choose that account.'
      : 'Enter a pattern to see per-author match rates. Click a row to choose that account.';

    const active = (els.author.value.trim().startsWith('@') ? els.author.value.trim().slice(1) : '').toLowerCase();
    const frag = document.createDocumentFragment();
    for (const a of rows.slice(0, 500)) {
      const tr = document.createElement('tr');
      if (active && a.handle.toLowerCase() === active) tr.classList.add('active');
      const tdA = document.createElement('td');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = a.name || a.handle;
      const h = document.createElement('span');
      h.className = 'h';
      h.textContent = '@' + a.handle;
      tdA.append(n, h);
      const tdP = document.createElement('td'); tdP.className = 'num'; tdP.textContent = a.posts.toLocaleString();
      const tdR = document.createElement('td'); tdR.className = 'num';
      if (hasRegex) {
        const bar = document.createElement('span');
        bar.className = 'bar';
        bar.style.width = Math.round(a.rate * 40) + 'px';
        tdR.append(bar, Math.round(a.rate * 100) + '%');
      } else {
        tdR.textContent = '–';
      }
      if (hasRegex) tr.title = `${a.matches.toLocaleString()} of ${a.posts.toLocaleString()} posts match`;
      tr.append(tdA, tdP, tdR);
      tr.addEventListener('click', (e) => {
        if (shiftAccount(e, a.handle)) return;
        const already = els.author.value.trim().toLowerCase() === '@' + a.handle.toLowerCase();
        setFocus(already ? null : a.handle);
      });
      frag.append(tr);
    }
    els.authorRows.textContent = '';
    els.authorRows.append(frag);
  }

  // ---------------------------------------------------------------------------
  // Author autocomplete: the author filter input suggests every captured user as you type
  // ---------------------------------------------------------------------------

  const SUGGEST_MAX = 12;

  // Attach a suggestion list to a text input. items() returns [{ handle, name, ... }] in the order
  // to prefer, meta(a) is the grey text on the right, onPick(handle) runs when one is chosen and
  // onClear() when Escape empties the input. `empty` is the line shown when nothing matches, or a
  // function of what was typed.
  function makeSuggest({ input, list, items, meta, onPick, onClear, empty, showAll = false }) {
    let sel = -1;
    const matches = (a, q) => (a.handle || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q);
    const suggestions = (find) => {
      const q = (find.startsWith('@') ? find.slice(1) : find).toLowerCase();
      if (!q) return showAll ? items().slice(0, SUGGEST_MAX) : [];
      const rank = (a) => {
        const h = (a.handle || '').toLowerCase();
        const n = (a.name || '').toLowerCase();
        if (h === q) return -1;
        if (h.startsWith(q)) return 0;
        if (n.startsWith(q)) return 1;
        if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
        return 3;
      };
      return items()
        .filter((a) => matches(a, q))
        .map((a, i) => ({ a, r: rank(a), i }))
        .sort((x, y) => x.r - y.r || x.i - y.i)
        .slice(0, SUGGEST_MAX)
        .map((x) => x.a);
    };
    const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; };
    const select = (i) => {
      const opts = Array.from(list.querySelectorAll('[role="option"]'));
      sel = opts.length ? Math.max(-1, Math.min(i, opts.length - 1)) : -1;
      opts.forEach((li, k) => li.setAttribute('aria-selected', String(k === sel)));
      if (sel >= 0) opts[sel].scrollIntoView({ block: 'nearest' });
    };
    const pick = (handle) => { hide(); onPick(handle); };
    const render = () => {
      if (document.activeElement !== input) { hide(); return; }
      const find = input.value.trim();
      const found = suggestions(find);
      list.textContent = '';
      if (!find && !showAll) { hide(); return; }
      if (!found.length) {
        const li = document.createElement('li');
        li.className = 'none';
        li.textContent = typeof empty === 'function' ? empty(find) : empty;
        list.append(li);
      }
      found.forEach((a, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.handle = a.handle;
        const n = document.createElement('span'); n.className = 'n'; n.textContent = a.name || a.handle;
        const h = document.createElement('span'); h.className = 'h'; h.textContent = '@' + a.handle;
        const c = document.createElement('span'); c.className = 'c'; c.textContent = meta(a);
        li.append(n, h, c);
        // mousedown, not click: the input would blur (and close the list) before a click lands.
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(a.handle); });
        li.addEventListener('mousemove', () => select(i));
        list.append(li);
      });
      sel = Math.min(sel, found.length - 1);
      select(sel);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', hide);
    input.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key === 'ArrowUp') return; // ⌘↑ goes to the top of the page
      const open = !list.hidden;
      const opts = list.querySelectorAll('[role="option"]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) render(); else select(sel + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) select(sel - 1);
      } else if (e.key === 'Enter') {
        // An empty box picks only a suggestion moved to with the arrows.
        if (!open || !opts.length || (sel < 0 && !input.value.trim())) return;
        e.preventDefault();
        pick(opts[sel >= 0 ? sel : 0].dataset.handle);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (open) { hide(); return; }
        if (input.value) { input.value = ''; onClear(); } else input.blur();
      }
    });
    return { render, hide };
  }

  const accountMeta = (a) => (a.posts ? `${a.posts.toLocaleString()} post${a.posts === 1 ? '' : 's'}` : 'no posts captured') + (a.received ? ` · ${a.received.toLocaleString()} received` : '');

  // The account chip suggests every captured user, then every account that appears only through an interaction.
  const authorSuggest = makeSuggest({
    input: els.author,
    list: els.authorSuggest,
    items: () => state.chipAccounts || [],
    meta: accountMeta,
    onPick: (handle) => setFocus(handle),
    onClear: () => setFocus(null),
    empty: 'No account matches',
    showAll: true,
  });
  // Typing replaces the chosen account rather than appending to it.
  els.author.addEventListener('focus', () => els.author.select());

  // The tray's account box suggests the same accounts, less those already in the tray; a handle
  // never captured is added as typed.
  const chordSuggest = makeSuggest({
    input: els.chordAcctIn,
    list: els.chordSuggest,
    items: () => (state.chipAccounts || []).filter((a) => !state.chord || !state.chord.accounts.some((h) => sameHandle(h, a.handle))),
    meta: accountMeta,
    onPick: (handle) => {
      if (!state.chord) return;
      addAccounts(state.chord, [handle]);
      accountsWanted();
      els.chordAcctIn.value = '';
      renderChord();
      chordSuggest.render();
    },
    onClear: () => {},
    empty: (find) => {
      const h = find.replace(/^@/, '');
      return HANDLE_RE.test(h) ? `Not captured · Enter adds @${h}` : 'Not a handle: letters, digits and _ only';
    },
    showAll: true,
  });

  // ---------------------------------------------------------------------------
  // Data: load, export, import, delete
  // ---------------------------------------------------------------------------

  async function load() {
    els.resultCount.textContent = 'Loading…';
    state.posts = await XPCDB.getAll();
    indexPosts();
    state.loadStamp = Date.now();
    state.pendingNew = 0;
    els.newPill.hidden = true;
    apply();
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  function exportJson() {
    const posts = state.results.map((r) => r.post);
    const payload = { app: 'x-post-catalogue', version: 1, exportedAt: new Date().toISOString(), count: posts.length, query: els.pattern.value, posts };
    download(`x-posts-${stamp()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  }

  const CSV_COLUMNS = ['id', 'url', 'handle', 'name', 'time', 'text', 'lang', 'isReply', 'replyTo', 'isRepost', 'repostedBy', 'reposters', 'isQuote', 'quotedHandle', 'quotedId', 'quotedText', 'mentions',
    'hasImage', 'images', 'hasVideo', 'hasLink', 'links', 'hasMedia', 'isPinned', 'truncated', 'replies', 'reposts', 'likes', 'bookmarks', 'views', 'firstSeen', 'lastSeen', 'seenCount', 'context'];

  function exportCsv() {
    const rows = [CSV_COLUMNS];
    for (const { post } of state.results) {
      rows.push(CSV_COLUMNS.map((c) => {
        const v = post[c];
        if ((c === 'firstSeen' || c === 'lastSeen') && typeof v === 'number') return new Date(v).toISOString();
        if (Array.isArray(v)) return v.join(' ');
        return v;
      }));
    }
    download(`x-posts-${stamp()}.csv`, new Blob([XPCMatrix.csvText(rows)], { type: 'text/csv;charset=utf-8' }));
  }

  async function importJson(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { alert('Could not parse that file as JSON.'); return; }
    const posts = Array.isArray(data) ? data : (data && Array.isArray(data.posts) ? data.posts : null);
    if (!posts) { alert('Expected an array of posts or an export from this extension.'); return; }
    // An imported file is untrusted: keep records with the shapes the page relies on, and rebuild
    // any link that does not point at X, so a javascript: or look-alike URL never reaches an <a>.
    const valid = posts
      .filter((p) => p && (typeof p.id === 'string' || typeof p.id === 'number') && typeof p.handle === 'string' && p.handle
        && (p.text === undefined || p.text === null || typeof p.text === 'string'))
      .map((p) => ({ ...p, id: String(p.id), url: /^https:\/\/(x|twitter)\.com\//.test(p.url || '') ? p.url : `https://x.com/${encodeURIComponent(p.handle)}/status/${encodeURIComponent(String(p.id))}` }));
    const r = await XPCDB.upsertMany(valid);
    refreshBadge();
    await load();
    alert(`Imported ${valid.length.toLocaleString()} ${valid.length === 1 ? 'post' : 'posts'}: ${r.inserted.toLocaleString()} new, ${r.updated.toLocaleString()} merged.`);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  let applyTimer = null;
  const applyDebounced = () => { clearTimeout(applyTimer); applyTimer = setTimeout(apply, 120); };

  els.pattern.addEventListener('input', applyDebounced);
  els.author.addEventListener('input', applyDebounced);
  els.minLikes.addEventListener('input', applyDebounced);
  els.minReposts.addEventListener('input', applyDebounced);
  els.minChars.addEventListener('input', applyDebounced);
  wireRanges();
  els.minPosts.addEventListener('input', applyDebounced);
  for (const el of [...els.regexOpts, els.from, els.to]) {
    el.addEventListener('change', apply);
  }
  els.sortSeg.addEventListener('click', (e) => { const b = e.target.closest('button[data-sort]'); if (!b) return; setSort(b.dataset.sort); apply(); });
  els.listMode.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.disabled) return;
    state.listMode = b.dataset.mode;
    state.pick = null;
    apply();
  });
  els.authorClear.addEventListener('click', () => setFocus(null));
  els.nwChoose.addEventListener('click', () => els.author.focus());
  for (const b of els.ctxTabs) b.addEventListener('click', () => setPaneTab(b.dataset.tab));
  els.expandedClose.addEventListener('click', () => setView('posts'));
  els.nwExpand.addEventListener('click', () => setView('network'));
  els.mxExpand.addEventListener('click', () => setView('compare'));
  for (const c of els.types) c.addEventListener('change', () => { syncTypesAll(); apply(); });
  els.typesAll.addEventListener('change', () => {
    if (els.typesAll.checked) for (const c of els.types) c.checked = false;
    syncTypesAll(); // cannot be unticked on its own: nothing selected is "all posts"
    apply();
  });
  els.pickPill.addEventListener('click', () => { state.pick = null; apply(); });
  for (const b of els.toggles) {
    b.addEventListener('click', () => { flipToggle(b.dataset.opt); els.pattern.focus(); });
  }
  // Menus close on any press outside them (pointerdown, so the network map's pointer capture cannot swallow it).
  document.addEventListener('pointerdown', (e) => {
    for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
  });
  els.preset.addEventListener('change', () => {
    const p = PRESETS[Number(els.preset.value)];
    els.preset.value = '';
    if (!p) return;
    setOptions({ ...getOptions(), pattern: p.pattern, regex: true, wholeWord: false });
    els.searchMenu.open = false;
    apply();
    els.pattern.focus();
  });
  els.more.addEventListener('click', () => renderResults(false));
  // Load the next page once the end of the list is within a screen of the viewport; the button
  // stays for keyboard users. Re-observing after each page reports the button's position afresh,
  // so a page that didn't push it out of range (tall window, short posts) loads the next one too.
  if ('IntersectionObserver' in window) {
    const moreObserver = new IntersectionObserver((entries) => {
      if (els.more.hidden || !entries.some((e) => e.isIntersecting)) return;
      renderResults(false);
      moreObserver.unobserve(els.more);
      moreObserver.observe(els.more);
    }, { rootMargin: '0px 0px 100% 0px' });
    moreObserver.observe(els.more);
  }
  $('#refresh').addEventListener('click', load);
  els.newPill.addEventListener('click', load);
  $('#export-json').addEventListener('click', () => { els.exportMenu.open = false; exportJson(); });
  $('#export-csv').addEventListener('click', () => { els.exportMenu.open = false; exportCsv(); });
  $('#import').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importJson(f); e.target.value = ''; });

  // Compare panel
  let panelTimer = null;
  const panelDebounced = () => { clearTimeout(panelTimer); panelTimer = setTimeout(() => { renderPanel(); saveState(); }, 150); };
  els.mxTerm.addEventListener('input', () => { state.termTrail = []; }); // a new term starts a new trail
  for (const el of [els.mxTerm, els.mxKeywords, els.mxTitle, els.mxRows, els.mxWords]) el.addEventListener('input', panelDebounced);
  for (const el of [els.mxMetric, els.mxWeight, els.mxTable]) el.addEventListener('change', () => { renderPanel(); saveState(); });
  els.mxTheme.addEventListener('change', saveState);
  for (const b of els.mxTabs) b.addEventListener('click', () => { setPanelView(b.dataset.view); renderPanel(); saveState(); });
  els.theme.addEventListener('change', () => { applyTheme(); renderPanel(); renderNetwork(); renderContext(); saveState(); });
  if (darkQuery) darkQuery.addEventListener('change', () => { if (els.theme.value === 'auto') { applyTheme(); renderPanel(); renderNetwork(); renderContext(); } });

  // Interaction network
  let nwTimer = null;
  const nwDebounced = () => { clearTimeout(nwTimer); nwTimer = setTimeout(() => { renderNetwork(); saveState(); }, 150); };
  for (const el of [els.nwMin, els.nwNodes, els.nwTitle]) el.addEventListener('input', nwDebounced);
  for (const el of els.nwTypes) el.addEventListener('change', apply); // the interaction types also decide what "interactions with them" lists
  els.nwPattern.addEventListener('change', () => { renderNetworkSummary(state.filteredNoAuthor); renderNetwork(); renderContext(); saveState(); });
  els.nwTheme.addEventListener('change', saveState);
  els.nwUnfocus.addEventListener('click', () => setFocus(null));
  // The X search tray: gather accounts and words while Shift is down, search when it comes up.
  const SHIFT_PICK = '.w, .handle, .tag.to, .h.to, .ctx-row, #author-rows tr';
  document.addEventListener('mousedown', (e) => {
    if (e.shiftKey && e.target.closest && e.target.closest(SHIFT_PICK)) e.preventDefault(); // no text selection
  });
  document.addEventListener('keyup', (e) => {
    // Any key coming up with Shift no longer held counts, not just e.key === 'Shift': some
    // keyboards and remote-control tools report the modifier with an empty key name.
    const c = state.chord;
    if (!c || !c.armed || (e.key !== 'Shift' && e.shiftKey)) return;
    if (chordQueries(c).length) chordFire();
    else if (c.accounts.length || c.groups.length) { c.held = true; arm(c); renderChordQuery(); } // e.g. accounts but "Everyone else": wait for a word
    else chordCancel();
  });
  document.addEventListener('keydown', (e) => {
    if (!state.chord || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // Shift+1 there is "!"
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i < 0 || !state.chord.accounts.length) return;
    e.preventDefault();
    state.chordScope = CHORD_SCOPES[i].key;
    renderChord();
    saveState();
  });
  // Shift may come up in another window; then the tray waits for its button instead.
  window.addEventListener('blur', () => { if (state.chord && state.chord.armed) { state.chord.armed = false; renderChordQuery(); } });
  // Touching the tray holds it open: Shift is needed to type | and capitals, and a click on a chip
  // should not send the search. Only the note is redrawn here, so the click still lands.
  const holdChord = () => {
    const c = state.chord;
    if (!c || c.held) return;
    c.held = true;
    arm(c);
    renderChordQuery();
  };
  els.chordTray.addEventListener('pointerdown', holdChord);
  els.chordTray.addEventListener('focusin', holdChord);
  els.chordTray.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    const c = state.chord;
    if (!b || !c) return;
    const act = b.dataset.act;
    if (act === 'drop') { (b.dataset.kind === 'acct' ? c.accounts : c.groups).splice(Number(b.dataset.i), 1); renderChord(); }
    else if (act === 'edit') chordEdit(Number(b.dataset.i));
    else if (act === 'scope') { state.chordScope = b.dataset.scope; renderChord(); saveState(); }
    else if (act === 'pin') { state.chordPin = !state.chordPin; arm(c); renderChord(); saveState(); }
    else if (act === 'go') chordFire();
    else if (act === 'cancel') chordCancel();
  });
  // Words: Enter makes the typed text a chip (| inside it for either), or searches when the box is
  // empty. Escape puts an edited chip back as it was.
  els.chordWordIn.addEventListener('input', renderChordQuery);
  els.chordWordIn.addEventListener('keydown', (e) => {
    const c = state.chord;
    if (!c) return;
    const v = els.chordWordIn.value;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (v.trim() || c.editing) { commitWords(c); renderChord(); } else chordFire();
    } else if (e.key === 'Escape' && (v || c.editing)) {
      e.preventDefault();
      if (c.editing) c.groups.splice(Math.min(c.editing.at, c.groups.length), 0, c.editing.group);
      c.editing = null;
      els.chordWordIn.value = '';
      renderChord();
    } else if (e.key === 'Backspace' && !v && c.groups.length) {
      c.groups.pop();
      renderChord();
    }
  });
  // Accounts: a suggestion is picked by the suggestion list; otherwise Enter, a space or a comma
  // adds what was typed (handles hold none of those, so a pasted list splits too).
  els.chordAcctIn.addEventListener('input', () => {
    const c = state.chord;
    const v = els.chordAcctIn.value;
    if (!c || !/[\s,]/.test(v)) return;
    const parts = v.split(/[\s,]+/);
    const rest = parts.pop();
    const n = c.accounts.length;
    const bad = addAccounts(c, parts);
    if (c.accounts.length > n) accountsWanted();
    els.chordAcctIn.value = [...bad, rest].filter(Boolean).join(' ');
    renderChord();
    chordSuggest.render();
  });
  els.chordAcctIn.addEventListener('keydown', (e) => {
    const c = state.chord;
    if (!c || e.defaultPrevented) return;
    const v = els.chordAcctIn.value;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (v.trim()) { commitAccounts(c); renderChord(); chordSuggest.render(); } else chordFire();
    } else if (e.key === 'Backspace' && !v && c.accounts.length) {
      c.accounts.pop();
      renderChord();
      chordSuggest.render();
    }
  });
  els.chordOpen.addEventListener('click', chordOpen);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.chord && !e.defaultPrevented) chordCancel(); // not when Escape only closed a list or cleared a box
    if (!els.nwCard.hidden) closeCard();
    els.selTools.hidden = true;
    for (const m of document.querySelectorAll('details.menu[open]')) m.open = false;
  });
  $('#nw-fit').addEventListener('click', () => { state.nwView = { k: 1, tx: 0, ty: 0 }; if (state.network && state.network.applyView) state.network.applyView(); });
  $('#nw-svg').addEventListener('click', () => { els.nwExport.open = false; exportNetworkSvg(); });
  $('#nw-png').addEventListener('click', () => { els.nwExport.open = false; exportNetworkPng(); });
  $('#nw-csv').addEventListener('click', () => { els.nwExport.open = false; exportNetworkCsv(false); });
  $('#nw-edges-csv').addEventListener('click', () => { els.nwExport.open = false; exportNetworkCsv(true); });
  els.mxTerm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.mxTerm.value) { e.preventDefault(); els.mxTerm.value = ''; state.termTrail = []; renderPanel(); saveState(); }
  });
  $('#mx-add').addEventListener('click', () => {
    const p = els.pattern.value.trim();
    if (!p) { els.mxKeywords.focus(); return; }
    const cur = els.mxKeywords.value;
    if (cur.split('\n').some((l) => l.trim() === p || l.trim().endsWith(' :: ' + p))) return;
    els.mxKeywords.value = (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + p;
    renderPanel();
    saveState();
  });
  els.mxBack.addEventListener('click', goBack);
  els.resultsBack.addEventListener('click', goBack);
  $('#mx-svg').addEventListener('click', () => { els.mxExport.open = false; exportPanelSvg(); });
  $('#mx-png').addEventListener('click', () => { els.mxExport.open = false; exportPanelPng(); });
  $('#mx-csv').addEventListener('click', () => { els.mxExport.open = false; exportPanelCsv(); });
  els.mxView.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) {
      rememberBeforeClick();
      const opts = getOptions();
      setOptions({ ...opts, pattern: cell.dataset.pattern });
      els.author.value = '@' + cell.dataset.handle;
      apply();
      setView('posts');
      scrollTo(els.resultsHead);
      return;
    }
    const w = e.target.closest('.w');
    if (w) { wordClick(e, w.dataset.word, w.dataset.handle || null, 'panel'); return; }
    const row = e.target.closest('.row');
    if (row) searchPanel({ pattern: row.dataset.pattern, isRegex: row.dataset.regex === '1' });
  });

  document.addEventListener('keydown', (e) => {
    // Editor shortcuts: Alt+C match case, Alt+W whole word, Alt+R regex.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const opt = { KeyC: 'matchCase', KeyW: 'wholeWord', KeyR: 'regex' }[e.code];
      if (opt) { e.preventDefault(); flipToggle(opt); return; }
    }
    if (e.key === '/' && document.activeElement !== els.pattern && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      els.pattern.focus();
      els.pattern.select();
    }
    if (e.key === 'Escape' && document.activeElement === els.pattern) {
      els.pattern.value = '';
      apply();
    }
    // ⌘↑: back to the top of the page, even from the search box (where the browser would only
    // move the caret) or a scrolling rail; multi-line boxes keep their own ⌘↑.
    if (e.key === 'ArrowUp' && e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      if (e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  for (let i = 0; i < PRESETS.length; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = PRESETS[i].label;
    els.preset.append(o);
  }

  if (rt) {
    rt.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'catalogueUpdated') return;
      state.pendingNew += msg.inserted || 0;
      if (state.pendingNew > 0) {
        els.newPill.textContent = `${state.pendingNew.toLocaleString()} new · refresh`;
        els.newPill.hidden = false;
      }
    });
  }

  for (const a of els.views) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      setView(a.dataset.section);
    });
  }
  window.addEventListener('hashchange', () => applyHash());

  restoreState();
  applyTheme();
  // The address wins over the remembered account, so a shared link opens on the right account.
  const initial = parseHash();
  if (initial.account) els.author.value = '@' + initial.account;
  if (initial.section) {
    state.view = initial.section;
    if (initial.section === 'network') state.paneTab = 'account';
    if (initial.section === 'compare') state.paneTab = 'topics';
  }
  applyViewUi();
  load();
})();
