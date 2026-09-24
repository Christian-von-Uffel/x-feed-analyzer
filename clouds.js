// clouds.js — word clouds and the co-mention chart for X Feed Analyzer.
// Pure rendering: takes models built in viewer.js from words.js and returns SVG strings.
// Like matrix.js, the same SVG is shown on the page and written to the SVG / PNG exports.
// Loaded by viewer.html after matrix.js (it reuses the matrix colour themes).
(function (root) {
  'use strict';

  const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  const fmtDay = (t) => (t === null ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  const themes = () => root.XPCMatrix.THEMES;
  const pct = (v) => (v >= 0.1 || v === 0 ? Math.round(v * 100) + '%' : (v * 100).toFixed(1) + '%');
  const n = (v, word) => `${v.toLocaleString()} ${word}${v === 1 ? '' : 's'}`;

  const MODES = {
    distinctive: 'distinctive words',
    frequent: 'most frequent words',
  };

  // ---------------------------------------------------------------------------
  // Text measurement: a canvas when there is a document (the viewer), a heuristic otherwise (tests).
  // ---------------------------------------------------------------------------

  let ctx = null;
  function context() {
    if (ctx !== null) return ctx;
    try {
      const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      ctx = c ? c.getContext('2d') : false;
    } catch (e) { ctx = false; }
    return ctx;
  }

  function measure(text, fs, weight) {
    const c = context();
    if (c) {
      c.font = `${weight} ${fs}px ${FONT}`;
      if (!c.font.includes(`${fs}px`)) c.font = `${weight} ${fs}px sans-serif`;
      const m = c.measureText(text);
      const asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : fs * 0.74;
      const desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : fs * 0.22;
      return { w: m.width, asc, desc };
    }
    return { w: text.length * fs * (weight >= 700 ? 0.6 : 0.56), asc: fs * 0.74, desc: fs * 0.22 };
  }

  // ---------------------------------------------------------------------------
  // Layout: heaviest word first, each on an elliptical spiral out from the centre until its box
  // overlaps nothing. Font size runs from minFs to maxFs on a square-root scale of weight.
  // Deterministic (no randomness), so an export is reproducible.
  // ---------------------------------------------------------------------------

  // spiral 'rect' walks a rectangle instead of an ellipse, so the words reach the box's corners.
  function layout(words, box, { minFs = 10, maxFs = 60, pad = 2, spiral = 'ellipse' } = {}) {
    const placed = [];
    if (!words.length || box.w <= 0 || box.h <= 0) return placed;
    const wMax = words[0].weight;
    const wMin = words[words.length - 1].weight;
    const sx = Math.sqrt(box.w / box.h);
    const sy = 1 / sx;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const rMax = Math.max(box.w / (2 * sx), box.h / (2 * sy)) * 1.05;
    const A = 2;   // spiral pitch, px per radian
    const DS = 5;  // step along the spiral, px
    for (const wd of words) {
      const v = wMax > wMin ? (wd.weight - wMin) / (wMax - wMin) : 1;
      const fs = Math.round((minFs + (maxFs - minFs) * Math.sqrt(v)) * 10) / 10;
      const fw = v >= 0.5 ? 700 : 600;
      const m = measure(wd.term, fs, fw);
      const w = m.w + pad * 2;
      const h = m.asc + m.desc + pad * 2;
      if (w > box.w || h > box.h) continue;
      let t = 0;
      let ok = false;
      let x = 0;
      let y = 0;
      for (;;) {
        const r = A * t;
        if (r > rMax) break;
        const k = spiral === 'rect' ? Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))) : 1;
        x = cx + (r * Math.cos(t) * sx) / k;
        y = cy + (r * Math.sin(t) * sy) / k;
        const l = x - w / 2;
        const tp = y - h / 2;
        if (l >= box.x && tp >= box.y && l + w <= box.x + box.w && tp + h <= box.y + box.h) {
          ok = true;
          for (const p of placed) {
            if (l < p.x + p.w && l + w > p.x && tp < p.y + p.h && tp + h > p.y) { ok = false; break; }
          }
          if (ok) break;
        }
        t += DS / Math.max(r, DS);
      }
      if (!ok) continue;
      placed.push({ ...wd, fs, fw, v, x: x - w / 2, y: y - h / 2, w, h, cx: x, cy: y, asc: m.asc, desc: m.desc });
    }
    return placed;
  }

  // Shrink the type until (nearly) every word fits; keep the layout that placed the most words.
  function fit(words, box, opts) {
    let best = null;
    let scale = 1;
    for (let i = 0; i < 6; i++) {
      const p = layout(words, box, { ...opts, minFs: Math.max(7, opts.minFs * Math.sqrt(scale)), maxFs: opts.maxFs * scale });
      if (!best || p.length > best.length) best = p;
      if (p.length >= words.length) break;
      scale *= 0.85;
    }
    return best;
  }

  // Grow the type as far as the box allows: the largest scale that still places all but the
  // lightest 5% of the words (bisected to within 1%), or failing that the layout that places the
  // most. Used for the shared images, where empty space is waste.
  function fill(words, box, opts) {
    const need = words.length - Math.floor(words.length * 0.05);
    const at = (scale) => layout(words, box, { ...opts, minFs: Math.max(7, opts.minFs * Math.sqrt(scale)), maxFs: opts.maxFs * scale });
    let best = null;
    let lo = 0;
    let hi = 0;
    for (let scale = 2; scale > 0.3; scale *= 0.85) {
      const p = at(scale);
      if (p.length >= need) { best = p; lo = scale; break; }
      if (!best || p.length > best.length) best = p;
      hi = scale;
    }
    if (!lo || !hi) return best;
    while (hi / lo > 1.01) {
      const mid = Math.sqrt(lo * hi);
      const p = at(mid);
      if (p.length >= need) { best = p; lo = mid; } else hi = mid;
    }
    return best;
  }

  // Heavier words get the stronger end of the matrix ramp: dark blues on the light theme, light
  // blues on the dark one. Both ends read at 4.5:1 or better on their background.
  function inkRamp(T) { return T.ramp.slice(7); }

  function wordTags(placed, T, { handle = '', tip }) {
    const ramp = inkRamp(T);
    const out = [];
    for (const p of placed) {
      const col = ramp[Math.min(ramp.length - 1, Math.floor(p.v * ramp.length))];
      const baseline = p.cy + (p.asc - p.desc) / 2;
      out.push(`<text class="w" x="${p.cx.toFixed(1)}" y="${baseline.toFixed(1)}" font-size="${p.fs}" font-weight="${p.fw}" fill="${col}" text-anchor="middle" data-word="${esc(p.term)}"${handle ? ` data-handle="${esc(handle)}"` : ''}><title>${esc(tip(p))}</title>${esc(p.term)}</text>`);
    }
    return out;
  }

  const wordTip = (p, mode) => `${p.term}: ${p.count} mention${p.count === 1 ? '' : 's'} in ${p.posts} post${p.posts === 1 ? '' : 's'}` +
    (mode === 'distinctive' ? ` · ${p.rest} elsewhere · keyness ${Math.round(p.weight)}` : '');

  // Shared frame: background, title, subtitle, footer. Returns { out, T, pad, top, bottom }.
  function frame({ theme, size, title, subtitle, note }) {
    const T = themes()[theme] || themes().light;
    const S = size;
    const pad = Math.round(S * 0.045);
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${esc(title)}: ${esc(subtitle)}" font-family="${esc(FONT)}">`);
    out.push(`<rect width="${S}" height="${S}" fill="${T.bg}"/>`);
    const titleY = pad + 30;
    out.push(`<text x="${pad}" y="${titleY}" font-size="30" font-weight="800" fill="${T.text}">${esc(trunc(title, 60))}</text>`);
    out.push(`<text x="${pad}" y="${titleY + 26}" font-size="15" fill="${T.muted}">${esc(trunc(subtitle, 130))}</text>`);
    const footerY = S - pad;
    const footer1 = note || 'Counts only what one person scrolled past on X, not all of X.';
    const footer2 = `X Feed Analyzer · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
    out.push(`<text x="${pad}" y="${footerY - 18}" font-size="13" fill="${T.muted}">${esc(footer1)}</text>`);
    out.push(`<text x="${pad}" y="${footerY}" font-size="13" fill="${T.muted}">${esc(footer2)}</text>`);
    return { out, T, S, pad, top: titleY + 26 + 22, bottom: S - pad - 44 };
  }

  function message(out, S, T, text) {
    out.push(`<text x="${S / 2}" y="${S / 2}" font-size="18" fill="${T.muted}" text-anchor="middle">${esc(text)}</text>`);
    out.push('</svg>');
    return out.join('\n');
  }

  const rangeOf = (model) => (model.from !== null && model.from !== undefined ? `${fmtDay(model.from)} – ${fmtDay(model.to)}` : 'no dates');

  // ---------------------------------------------------------------------------
  // Author clouds: one tile per author.
  // model: { authors: [{ handle, name, posts, words, mode }], mode, term, nPosts, nAuthors, from, to }
  // ---------------------------------------------------------------------------

  function renderAuthorClouds(model, { theme = 'light', size = 1080, title = '', maxWords = 60, note = '' } = {}) {
    const term = model.term || '';
    const titleText = title || (term ? `Posts mentioning “${term}”` : 'Who says what');
    const subtitle = `${MODES[model.mode] || MODES.distinctive} per author · ${n(model.nPosts, 'post')} by ${n(model.nAuthors, 'author')}` +
      (term ? ` mention it` : '') + ` · ${rangeOf(model)}`;
    const f = frame({ theme, size, title: titleText, subtitle, note });
    const { out, T, S, pad } = f;
    const authors = model.authors;
    const N = authors.length;
    if (!N) return message(out, S, T, term ? `No author has enough posts mentioning “${term}” in the current filter.` : 'No author has enough posts in the current filter.');

    // Grid: pick the column count whose tiles are closest to 1.4:1 with the least empty slots.
    const gridW = S - 2 * pad;
    const gridH = f.bottom - f.top;
    const gap = 12;
    let cols = 1;
    let bestScore = Infinity;
    for (let c = 1; c <= N; c++) {
      const r = Math.ceil(N / c);
      const tw = (gridW - gap * (c - 1)) / c;
      const th = (gridH - gap * (r - 1)) / r;
      const score = Math.abs(Math.log(tw / th) - Math.log(1.4)) + (0.6 * (r * c - N)) / N;
      if (score < bestScore) { bestScore = score; cols = c; }
    }
    const rows = Math.ceil(N / cols);
    const tw = (gridW - gap * (cols - 1)) / cols;
    const th = (gridH - gap * (rows - 1)) / rows;
    const nameFs = Math.max(11, Math.min(15, th * 0.07));
    const handleFs = Math.max(9, Math.min(12, th * 0.055));
    const headH = nameFs + handleFs + 14;
    const budget = Math.max(6, Math.min(maxWords, Math.floor((tw * th) / 2600)));

    for (let i = 0; i < N; i++) {
      const a = authors[i];
      const x = pad + (i % cols) * (tw + gap);
      const y = f.top + Math.floor(i / cols) * (th + gap);
      out.push(`<g class="tile" data-handle="${esc(a.handle)}">`);
      out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="10" fill="${T.zero}" stroke="${T.line}"/>`);
      const maxChars = Math.floor((tw - 20) / (nameFs * 0.55));
      out.push(`<text x="${(x + 10).toFixed(1)}" y="${(y + 8 + nameFs).toFixed(1)}" font-size="${nameFs.toFixed(1)}" font-weight="700" fill="${T.text}">${esc(trunc(a.name || a.handle, maxChars))}</text>`);
      const meta = `@${a.handle} · ${n(a.posts, 'post')}` + (a.pinned ? ' · chosen' : '');
      out.push(`<text x="${(x + 10).toFixed(1)}" y="${(y + 10 + nameFs + handleFs).toFixed(1)}" font-size="${handleFs.toFixed(1)}" fill="${T.muted}">${esc(trunc(meta, Math.floor((tw - 20) / (handleFs * 0.55))))}</text>`);
      const box = { x: x + 8, y: y + headH, w: tw - 16, h: th - headH - 8 };
      const words = a.words.slice(0, budget);
      const placed = words.length ? fit(words, box, { minFs: 9, maxFs: Math.max(14, Math.min(34, th * 0.14)) }) : [];
      if (!placed.length) {
        out.push(`<text x="${(x + tw / 2).toFixed(1)}" y="${(y + th / 2 + 4).toFixed(1)}" font-size="12" fill="${T.muted}" text-anchor="middle">${esc(a.mode === 'distinctive' ? 'nothing distinctive yet' : 'not enough words')}</text>`);
      } else {
        out.push(...wordTags(placed, T, { handle: a.handle, tip: (p) => `${a.name || a.handle}: ${wordTip(p, a.mode)}` }));
      }
      out.push('</g>');
    }
    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Mini cloud: one author's words with no frame, for the Account tab beside the posts.
  // Transparent background so it sits on the pane; words keep data-word / data-handle for clicks.
  // ---------------------------------------------------------------------------

  function renderMiniCloud({ handle = '', name = '', words = [], mode = 'distinctive' }, { theme = 'light', width = 360, height = 190 } = {}) {
    const T = themes()[theme] || themes().light;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${MODES[mode] || MODES.distinctive} of @${handle}`)}" font-family="${esc(FONT)}">`];
    const placed = words.length ? fit(words, { x: 4, y: 4, w: width - 8, h: height - 8 }, { minFs: 10, maxFs: 34 }) : [];
    out.push(...wordTags(placed, T, { handle, tip: (p) => `${name || '@' + handle}: ${wordTip(p, mode)}` }));
    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Account cloud: one author's words, framed as a square image to download and share.
  // A small title, then the handle, then the display name and counts; the product name signs the
  // bottom-right corner on a line of its own. The cloud fills the rest, keeping a 5% margin from the
  // edges and the header and one signature type height above the signature.
  // model: { handle, name, words, mode, posts, from, to }
  // ---------------------------------------------------------------------------

  function renderAccountCloud(model, { theme = 'light', size = 1080, maxWords = 60 } = {}) {
    const T = themes()[theme] || themes().light;
    const S = size;
    const u = S / 1080;
    const margin = Math.round(S * 0.05);
    const handle = '@' + model.handle;
    const meta = [model.name, n(model.posts, 'post'), rangeOf(model)].filter(Boolean).join(' · ');
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${esc(`Topic map of ${handle}: ${meta}`)}" font-family="${esc(FONT)}">`);
    out.push(`<rect width="${S}" height="${S}" fill="${T.bg}"/>`);
    const titleFs = Math.round(24 * u);
    const handleFs = Math.round(54 * u);
    const metaFs = Math.round(22 * u);
    const titleY = margin + Math.round(titleFs * 0.75);
    const handleY = titleY + Math.round(handleFs * 1.05);
    const metaY = handleY + Math.round(metaFs * 1.6);
    out.push(`<text x="${margin}" y="${titleY}" font-size="${titleFs}" font-weight="700" fill="${inkRamp(T)[0]}">Topic map</text>`);
    out.push(`<text x="${margin}" y="${handleY}" font-size="${handleFs}" font-weight="800" fill="${T.text}">${esc(trunc(handle, 32))}</text>`);
    out.push(`<text x="${margin}" y="${metaY}" font-size="${metaFs}" fill="${T.muted}">${esc(trunc(meta, 80))}</text>`);
    const brand = 'X Feed Analyzer';
    const brandFs = Math.round(40 * u);
    const bm = measure(brand, brandFs, 800);
    const brandY = S - margin - bm.desc;
    out.push(`<text x="${S - margin}" y="${brandY.toFixed(1)}" font-size="${brandFs}" font-weight="800" fill="${T.text}" text-anchor="end">${esc(brand)}</text>`);
    const words = model.words.slice(0, maxWords);
    if (!words.length) return message(out, S, T, 'Not enough words.');
    const top = metaY + Math.round(metaFs * 0.25) + margin;
    const box = { x: margin, y: top, w: S - 2 * margin, h: brandY - bm.asc - brandFs - top };
    const placed = fill(words, box, { minFs: 14 * u, maxFs: 82 * u, spiral: 'rect' });
    out.push(...wordTags(placed, T, { tip: (p) => wordTip(p, model.mode) }));
    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Term cloud: one big cloud from every post that mentions the term.
  // model: { term, words, mode, nPosts, nAuthors, totalPosts, from, to }
  // ---------------------------------------------------------------------------

  function renderTermCloud(model, { theme = 'light', size = 1080, title = '', maxWords = 60, note = '' } = {}) {
    const term = model.term || '';
    const titleText = title || (term ? `What goes with “${term}”` : 'Term cloud');
    const subtitle = term
      ? `${model.nPosts.toLocaleString()} of ${n(model.totalPosts, 'post')} by ${n(model.nAuthors, 'author')} mention it · ${MODES[model.mode] || MODES.distinctive} · ${rangeOf(model)}`
      : 'Type a term or phrase to see what is said alongside it.';
    const f = frame({ theme, size, title: titleText, subtitle, note });
    const { out, T, S, pad } = f;
    if (!term) return message(out, S, T, 'Type a term or phrase above.');
    if (!model.nPosts) return message(out, S, T, `No post mentions “${term}” in the current filter.`);
    const words = model.words.slice(0, maxWords);
    if (!words.length) return message(out, S, T, model.mode === 'distinctive' ? 'Nothing distinctive yet: too few posts. Try “frequent words”.' : 'Not enough words.');
    const box = { x: pad, y: f.top + 6, w: S - 2 * pad, h: f.bottom - f.top - 12 };
    const placed = fit(words, box, { minFs: 13, maxFs: 82 });
    out.push(...wordTags(placed, T, { tip: (p) => wordTip(p, model.mode) }));
    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Co-mentions: a bar table. Bar = share of the anchor's posts that also mention the keyword,
  // tick = the keyword's share of all posts, numbers printed on every row.
  // model: from XPCWords.comentions()
  // ---------------------------------------------------------------------------

  function renderComentions(model, { theme = 'light', size = 1080, title = '', note = '' } = {}) {
    const a = model.anchor;
    const term = a.label || '';
    const titleText = title || (term ? `What comes up with “${term}”` : 'Co-mentions');
    const subtitle = term
      ? `${a.posts.toLocaleString()} of ${n(model.nPosts, 'post')} by ${n(a.authors, 'author')} mention it · ${rangeOf(model)}` + (model.auto ? ' · no keywords given, so its most distinctive words are shown' : '')
      : 'Type a term or phrase, then list keywords to count alongside it.';
    const f = frame({ theme, size, title: titleText, subtitle, note });
    const { out, T, S, pad } = f;
    if (!term) return message(out, S, T, 'Type a term or phrase above.');
    if (!a.valid) return message(out, S, T, 'The term is not a valid pattern.');
    if (!a.posts) return message(out, S, T, `No post mentions “${term}” in the current filter.`);
    if (!model.rows.length) return message(out, S, T, 'Add keywords, one per line, to count alongside the term.');

    const ramp = inkRamp(T);
    const barFill = ramp[Math.floor(ramp.length / 2)];
    // Legend
    const legY = f.top + 6;
    out.push(`<rect x="${pad}" y="${legY}" width="22" height="10" rx="2" fill="${barFill}"/>`);
    out.push(`<text x="${pad + 28}" y="${legY + 9}" font-size="12" fill="${T.muted}">share of posts mentioning “${esc(trunc(term, 30))}” that also mention the keyword</text>`);
    const legX2 = pad + 28 + 12 * 0.55 * (48 + Math.min(30, term.length)) + 30;
    out.push(`<rect x="${legX2.toFixed(1)}" y="${legY - 2}" width="3" height="14" fill="${T.text}"/>`);
    out.push(`<text x="${(legX2 + 10).toFixed(1)}" y="${legY + 9}" font-size="12" fill="${T.muted}">share of all posts</text>`);

    const rows = model.rows.slice(0, 40);
    const R = rows.length;
    const y0 = legY + 30;
    // Few rows grow taller (up to 100px) so a short list still fills the square.
    const rowH = Math.min(100, (f.bottom - y0) / R);
    const fs = Math.max(10, Math.min(22, rowH * 0.3));
    const barH = Math.max(6, Math.min(36, rowH * 0.42));
    const labelW = Math.round(S * 0.24);
    const numW = Math.round(fs * 0.55 * 30);
    const x0 = pad + labelW;
    const barW = S - pad - numW - x0;
    const maxShare = Math.max(0.01, ...rows.map((r) => Math.max(r.share, r.allShare)));
    const scale = barW / maxShare;

    // Axis: 0 and max share
    out.push(`<line x1="${x0}" y1="${y0 - 6}" x2="${x0}" y2="${(y0 + rowH * R).toFixed(1)}" stroke="${T.line}"/>`);
    out.push(`<text x="${x0 + barW}" y="${y0 - 8}" font-size="11" fill="${T.muted}" text-anchor="end">${esc(pct(maxShare))}</text>`);

    for (let i = 0; i < R; i++) {
      const r = rows[i];
      const y = y0 + rowH * i;
      const cy = y + rowH / 2;
      out.push(`<g class="row" data-pattern="${esc(r.pattern)}" data-regex="${r.isRegex ? 1 : 0}">`);
      const tip = `${r.label}: ${r.posts} of ${a.posts} posts mentioning ${term} (${pct(r.share)}), ${r.mentions} mentions · ${r.allPosts} of ${model.nPosts} posts overall (${pct(r.allShare)})` + (r.lift !== null ? ` · ${r.lift.toFixed(1)}× baseline` : '');
      out.push(`<title>${esc(tip)}</title>`);
      if (i % 2) out.push(`<rect x="${pad}" y="${y.toFixed(1)}" width="${S - 2 * pad}" height="${rowH.toFixed(1)}" fill="${T.zero}"/>`);
      out.push(`<text x="${x0 - 12}" y="${(cy + fs * 0.36).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${T.text}" text-anchor="end"><title>${esc(r.pattern)}</title>${esc(trunc(r.label, Math.floor((labelW - 16) / (fs * 0.55))))}</text>`);
      if (r.share > 0) out.push(`<rect x="${x0}" y="${(cy - barH / 2).toFixed(1)}" width="${Math.max(1, r.share * scale).toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${barFill}"/>`);
      out.push(`<rect x="${(x0 + r.allShare * scale - 1.5).toFixed(1)}" y="${(cy - barH / 2 - 3).toFixed(1)}" width="3" height="${(barH + 6).toFixed(1)}" fill="${T.text}"/>`);
      const nums = r.allPosts === 0
        ? '0 posts · matches nowhere'
        : `${pct(r.share)} · ${n(r.posts, 'post')} · ${n(r.mentions, 'mention')}`;
      out.push(`<text x="${x0 + barW + 12}" y="${(cy + fs * 0.36).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${r.allPosts === 0 ? T.muted : T.text}" font-variant-numeric="tabular-nums">${esc(nums)}</text>`);
      if (r.lift !== null && r.allPosts > 0) {
        out.push(`<text x="${S - pad}" y="${(cy + fs * 0.36).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${T.text}" text-anchor="end" font-variant-numeric="tabular-nums">${esc(r.lift >= 10 ? Math.round(r.lift) + '×' : r.lift.toFixed(1) + '×')}</text>`);
      }
      out.push(`<rect class="hit" x="${pad}" y="${y.toFixed(1)}" width="${S - 2 * pad}" height="${rowH.toFixed(1)}" fill="transparent" pointer-events="all"/>`);
      out.push('</g>');
    }
    out.push(`<text x="${S - pad}" y="${y0 - 8}" font-size="11" fill="${T.muted}" text-anchor="end">× baseline</text>`);
    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  const csv = (lines) => root.XPCMatrix.csvText(lines);

  function authorsCsv(model) {
    const lines = [['name', 'handle', 'posts', 'rank', 'word', 'mentions', 'posts_with_word', 'mentions_elsewhere', 'keyness']];
    for (const a of model.authors) {
      a.words.forEach((w, i) => lines.push([a.name, a.handle, a.posts, i + 1, w.term, w.count, w.posts, w.rest, a.mode === 'distinctive' ? w.weight.toFixed(2) : '']));
    }
    return csv(lines);
  }

  function termCsv(model) {
    const lines = [['rank', 'word', 'mentions', 'posts_with_word', 'mentions_elsewhere', 'keyness']];
    model.words.forEach((w, i) => lines.push([i + 1, w.term, w.count, w.posts, w.rest, model.mode === 'distinctive' ? w.weight.toFixed(2) : '']));
    return csv(lines);
  }

  function comentionsCsv(model) {
    const lines = [['keyword', 'pattern', 'posts_with_both', 'share_of_anchor_posts', 'mentions_in_anchor_posts', 'posts_overall', 'share_overall', 'lift']];
    for (const r of model.rows) {
      lines.push([r.label, r.pattern, r.posts, (r.share * 100).toFixed(1) + '%', r.mentions, r.allPosts, (r.allShare * 100).toFixed(1) + '%', r.lift === null ? '' : r.lift.toFixed(2)]);
    }
    return csv(lines);
  }

  root.XPCClouds = { MODES, layout, fit, measure, frame, message, renderAuthorClouds, renderMiniCloud, renderAccountCloud, renderTermCloud, renderComentions, authorsCsv, termCsv, comentionsCsv };
})(typeof self !== 'undefined' ? self : this);
