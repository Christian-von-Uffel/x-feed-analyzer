// matrix.js — author × keyword comparison matrix for X Feed Analyzer.
// Pure functions: build a model from posts, render it to an SVG string.
// The same SVG is shown on the page and written to the SVG / PNG exports, so
// what you see is exactly what you download. Loaded by viewer.html after search.js.
(function (root) {
  'use strict';

  // One-hue sequential ramp (blue, steps 100 -> 700). Light mode: light = little,
  // dark = a lot. Dark mode flips the anchor so "little" recedes into the dark
  // surface and "a lot" comes forward. Every cell also prints its number, so colour
  // is never the only channel.
  const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
    '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

  const THEMES = {
    light: { bg: '#ffffff', text: '#0f1419', muted: '#536471', line: '#e6ecf0', zero: '#f2f4f5', ramp: RAMP },
    dark: { bg: '#000000', text: '#e7e9ea', muted: '#8b98a5', line: '#2f3336', zero: '#16181c', ramp: RAMP.slice().reverse() },
  };

  const METRICS = {
    posts: { label: 'posts that mention it', short: 'posts' },
    mentions: { label: 'total mentions', short: 'mentions' },
    rate: { label: 'mentions per 100 posts', short: 'per 100 posts' },
  };

  const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const SILENCE_MIN = 3; // expected hit-posts at the overall rate before a zero counts as silent
  const SILENT_EXTRA = 5; // rows kept beyond maxRows for authors whose silence is the finding

  // ---------------------------------------------------------------------------
  // Keywords
  // ---------------------------------------------------------------------------

  // One keyword per line. An optional label goes before " :: ", e.g.
  //   AI :: \b(?:ai|llm)s?\b
  function parseKeywords(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const sep = line.indexOf(' :: ');
      if (sep > 0) out.push({ label: line.slice(0, sep).trim(), pattern: line.slice(sep + 4).trim() });
      else out.push({ label: line, pattern: line });
    }
    return out;
  }

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

  // ---------------------------------------------------------------------------
  // Model
  // ---------------------------------------------------------------------------

  // posts:    already filtered (author, dates, replies, ...) but NOT by pattern
  // keywords: [{ label, pattern }]
  // options:  search options (matchCase, wholeWord, regex, ...) applied to every keyword
  // metric:   'posts' | 'mentions' | 'rate'
  // maxRows:  how many authors to keep (sorted by total, densest first)
  // minPosts: drop authors with fewer captured posts than this
  function build({ posts, keywords, options, metric = 'posts', maxRows = 12, minPosts = 1 }) {
    const errors = [];
    const cols = [];
    for (const k of keywords || []) {
      const r = root.XPCSearch.compile({ ...(options || {}), pattern: k.pattern });
      if (r.error || !r.regexG) { errors.push(`${k.label}: ${r.error || 'empty pattern'}`); continue; }
      cols.push({ label: k.label, pattern: k.pattern, regexG: r.regexG, total: 0 });
    }
    const K = cols.length;

    const authors = new Map();
    let nPosts = 0;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const post of posts || []) {
      nPosts++;
      const t = post.time ? new Date(post.time).getTime() : NaN;
      if (!Number.isNaN(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      let a = authors.get(post.handle);
      if (!a) {
        a = { handle: post.handle, name: post.name || post.handle, posts: 0, hitPosts: new Array(K).fill(0), mentions: new Array(K).fill(0) };
        authors.set(post.handle, a);
      }
      a.posts++;
      const text = post.text || '';
      for (let c = 0; c < K; c++) {
        const n = countMatches(cols[c].regexG, text);
        if (n) { a.hitPosts[c]++; a.mentions[c] += n; }
      }
    }

    const valueOf = (a, c) => {
      if (metric === 'mentions') return a.mentions[c];
      if (metric === 'rate') return a.posts ? (a.mentions[c] / a.posts) * 100 : 0;
      return a.hitPosts[c];
    };

    // Silence: a zero that the author's volume and the keyword's overall rate would not predict.
    // The rate is measured over every author in `posts`, not only the rows shown, and a cell is
    // silent when the author's posts at that rate would give SILENCE_MIN or more hit-posts. An
    // author silent on every keyword is kept for that alone: the absence is the finding.
    let allPosts = 0;
    const colHits = new Array(K).fill(0);
    for (const a of authors.values()) { allPosts += a.posts; for (let c = 0; c < K; c++) colHits[c] += a.hitPosts[c]; }
    const rate = colHits.map((h) => (allPosts ? h / allPosts : 0));

    let rows = Array.from(authors.values()).filter((a) => a.posts >= Math.max(1, minPosts));
    for (const a of rows) {
      a.values = cols.map((_, c) => valueOf(a, c));
      a.total = a.values.reduce((s, v) => s + v, 0);
      a.anyHit = a.hitPosts.some((n) => n > 0);
      a.expected = rate.map((r) => r * a.posts);
      a.silent = a.expected.map((e, c) => a.hitPosts[c] === 0 && e >= SILENCE_MIN);
    }
    // The densest authors first, capped at maxRows; then, since a silent author has a total of
    // zero and would always be cut, up to SILENT_EXTRA of the authors with a silent cell that did
    // not make the cut, the most unexpected silence first.
    const byTotal = (x, y) => y.total - x.total || y.posts - x.posts || x.handle.localeCompare(y.handle);
    const dense = rows.filter((a) => a.anyHit).sort(byTotal).slice(0, Math.max(1, maxRows));
    const shown = new Set(dense);
    const surprise = (a) => Math.max(...a.expected.filter((_, c) => a.silent[c]));
    const extra = rows.filter((a) => !shown.has(a) && a.silent.some(Boolean))
      .sort((x, y) => surprise(y) - surprise(x) || y.posts - x.posts || x.handle.localeCompare(y.handle))
      .slice(0, SILENT_EXTRA);
    rows = dense.concat(extra);

    // Column order: densest column first, measured over the rows actually shown.
    for (let c = 0; c < K; c++) cols[c].total = rows.reduce((s, a) => s + a.values[c], 0);
    const order = cols.map((_, c) => c).sort((i, j) => cols[j].total - cols[i].total || i - j);
    const outCols = order.map((c) => ({ label: cols[c].label, pattern: cols[c].pattern, total: cols[c].total, hits: colHits[c], rate: rate[c] }));
    const outRows = rows.map((a) => ({
      handle: a.handle, name: a.name, posts: a.posts, total: a.total,
      values: order.map((c) => a.values[c]),
      hitPosts: order.map((c) => a.hitPosts[c]),
      mentions: order.map((c) => a.mentions[c]),
      expected: order.map((c) => Math.round(a.expected[c] * 10) / 10),
      silent: order.map((c) => a.silent[c]),
    }));

    let max = 0;
    for (const r of outRows) for (const v of r.values) if (v > max) max = v;
    const nSilent = outRows.reduce((n, r) => n + r.silent.filter(Boolean).length, 0);

    return {
      rows: outRows, cols: outCols, metric, max, errors,
      nPosts, nAuthors: authors.size, allPosts, nSilent, silenceMin: SILENCE_MIN, silentExtra: extra.length,
      from: Number.isFinite(tMin) ? tMin : null, to: Number.isFinite(tMax) ? tMax : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);

  const fmtValue = (v, metric) => {
    if (metric === 'rate') return v >= 10 || v === 0 ? String(Math.round(v)) : v.toFixed(1);
    return String(Math.round(v));
  };

  const fmtDay = (t) => (t === null ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  // Pick whichever ink reads better on the fill. The better one is at least 4.75:1 on every ramp step.
  const inkFor = (fill) => (contrast(fill, '#000000') >= contrast(fill, '#ffffff') ? '#000000' : '#ffffff');

  function fillFor(v, max, theme) {
    if (!(v > 0) || !(max > 0)) return theme.zero;
    const idx = Math.max(0, Math.min(theme.ramp.length - 1, Math.round((v / max) * (theme.ramp.length - 1))));
    return theme.ramp[idx];
  }

  // Returns an SVG string. `size` is both width and height (1:1).
  function renderSvg(model, { theme = 'light', size = 1080, title = '' } = {}) {
    const T = THEMES[theme] || THEMES.light;
    const S = size;
    const pad = Math.round(S * 0.045);
    const rows = model.rows;
    const cols = model.cols;
    const R = rows.length;
    const C = cols.length;
    const metricLabel = (METRICS[model.metric] || METRICS.posts).label;

    const titleText = title || 'Who mentions what';
    const range = model.from !== null ? `${fmtDay(model.from)} – ${fmtDay(model.to)}` : 'no dates';
    const subtitle = `${metricLabel} · ${model.nPosts.toLocaleString()} posts by ${model.nAuthors.toLocaleString()} authors · ${range}`;
    const footer1 = 'Counts only what one person scrolled past on X, not all of X. Sorted so the densest cell is top left.';
    const footer2 = `X Feed Analyzer · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
    const nSilent = model.nSilent || 0;
    const silenceLine = `Dashed cells are unusually silent: 0 where the author’s volume at the keyword’s overall rate would predict ${model.silenceMin || SILENCE_MIN}+ posts.`;

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${esc(titleText)}: ${esc(subtitle)}" font-family="${esc(FONT)}">`);
    out.push(`<rect width="${S}" height="${S}" fill="${T.bg}"/>`);

    const titleY = pad + 30;
    out.push(`<text x="${pad}" y="${titleY}" font-size="30" font-weight="800" fill="${T.text}">${esc(titleText)}</text>`);
    out.push(`<text x="${pad}" y="${titleY + 26}" font-size="15" fill="${T.muted}">${esc(subtitle)}</text>`);

    const footerY = S - pad;
    if (nSilent) {
      out.push(`<rect x="${pad}" y="${footerY - 45}" width="18" height="10" rx="2" fill="${T.zero}" stroke="${T.muted}" stroke-width="1.5" stroke-dasharray="4 2"/>`);
      out.push(`<text x="${pad + 24}" y="${footerY - 36}" font-size="13" fill="${T.muted}">${esc(silenceLine)}</text>`);
    }
    out.push(`<text x="${pad}" y="${footerY - 18}" font-size="13" fill="${T.muted}">${esc(footer1)}</text>`);
    out.push(`<text x="${pad}" y="${footerY}" font-size="13" fill="${T.muted}">${esc(footer2)}</text>`);

    if (!R || !C) {
      out.push(`<text x="${S / 2}" y="${S / 2}" font-size="18" fill="${T.muted}" text-anchor="middle">${esc(C ? 'No author mentions any of these keywords in the current filter.' : 'Add keywords, one per line.')}</text>`);
      out.push('</svg>');
      return out.join('\n');
    }

    // Layout. Row labels on the left, column labels on top (rotated when they would not fit).
    const labelW = Math.round(S * 0.22);
    const colFs = 14;
    const gridTop0 = titleY + 26 + 24;
    const footerH = nSilent ? 62 : 44;
    const x0 = pad + labelW;
    let gridW = S - pad - x0;
    let cellW = gridW / C;
    const fits = cols.every((c) => trunc(c.label, 40).length * colFs * 0.58 <= cellW - 8);
    const headerH = fits ? 36 : 150;
    const rightExtra = fits ? 0 : Math.max(0, Math.round(headerH * 0.72 - cellW / 2));
    gridW = S - pad - rightExtra - x0;
    cellW = gridW / C;
    const y0 = gridTop0 + headerH;
    const gridH = S - pad - footerH - y0;
    const cellH = gridH / R;

    // Column headers
    for (let c = 0; c < C; c++) {
      const cx = x0 + cellW * c + cellW / 2;
      const label = trunc(cols[c].label, fits ? Math.floor((cellW - 8) / (colFs * 0.58)) : 26);
      if (fits) {
        out.push(`<text x="${cx.toFixed(1)}" y="${(y0 - 12).toFixed(1)}" font-size="${colFs}" font-weight="600" fill="${T.text}" text-anchor="middle"><title>${esc(cols[c].pattern)}</title>${esc(label)}</text>`);
      } else {
        out.push(`<text transform="translate(${cx.toFixed(1)},${(y0 - 10).toFixed(1)}) rotate(-45)" font-size="${colFs}" font-weight="600" fill="${T.text}" text-anchor="start"><title>${esc(cols[c].pattern)}</title>${esc(label)}</text>`);
      }
    }

    // Row labels
    const nameFs = Math.max(10, Math.min(16, cellH * 0.42));
    const handleFs = Math.max(9, Math.min(12, cellH * 0.3));
    const twoLines = cellH >= nameFs + handleFs + 6;
    for (let r = 0; r < R; r++) {
      const cy = y0 + cellH * r + cellH / 2;
      const maxChars = Math.floor((labelW - 16) / (nameFs * 0.55));
      const name = trunc(rows[r].name, maxChars);
      const handle = trunc('@' + rows[r].handle + ' · ' + rows[r].posts.toLocaleString() + (rows[r].posts === 1 ? ' post' : ' posts'), Math.floor((labelW - 16) / (handleFs * 0.55)));
      if (twoLines) {
        out.push(`<text x="${x0 - 12}" y="${(cy - 2).toFixed(1)}" font-size="${nameFs.toFixed(1)}" font-weight="700" fill="${T.text}" text-anchor="end">${esc(name)}</text>`);
        out.push(`<text x="${x0 - 12}" y="${(cy + handleFs + 1).toFixed(1)}" font-size="${handleFs.toFixed(1)}" fill="${T.muted}" text-anchor="end">${esc(handle)}</text>`);
      } else {
        out.push(`<text x="${x0 - 12}" y="${(cy + nameFs * 0.35).toFixed(1)}" font-size="${nameFs.toFixed(1)}" font-weight="700" fill="${T.text}" text-anchor="end">${esc(name)}</text>`);
      }
    }

    // Cells. 2px surface gap between fills; number in every cell.
    const valFs = Math.max(9, Math.min(22, cellH * 0.42, cellW * 0.28));
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const v = rows[r].values[c];
        const x = x0 + cellW * c;
        const y = y0 + cellH * r;
        const fill = fillFor(v, model.max, T);
        const ink = v > 0 ? inkFor(fill) : T.muted;
        const silent = Boolean(rows[r].silent && rows[r].silent[c]);
        const tip = `${rows[r].name} (@${rows[r].handle}) × ${cols[c].label}: ${rows[r].hitPosts[c]} of ${rows[r].posts} posts, ${rows[r].mentions[c]} mentions`
          + (silent ? ` · unusually silent: at the overall rate (${Math.round(cols[c].rate * 100)}% of posts) about ${Math.round(rows[r].expected[c])} would be expected` : '');
        out.push(`<g data-r="${r}" data-c="${c}" data-handle="${esc(rows[r].handle)}" data-pattern="${esc(cols[c].pattern)}" class="cell${silent ? ' silent' : ''}">`);
        out.push(`<title>${esc(tip)}</title>`);
        out.push(`<rect x="${(x + 1).toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${Math.max(0, cellW - 2).toFixed(1)}" height="${Math.max(0, cellH - 2).toFixed(1)}" rx="4" fill="${fill}"${silent ? ` stroke="${T.muted}" stroke-width="1.5" stroke-dasharray="5 3"` : ''}/>`);
        if (cellH >= 14 && cellW >= 18) {
          out.push(`<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2 + valFs * 0.36).toFixed(1)}" font-size="${valFs.toFixed(1)}" font-weight="${v > 0 ? 700 : 400}" fill="${ink}" text-anchor="middle" font-variant-numeric="tabular-nums">${esc(fmtValue(v, model.metric))}</text>`);
        }
        out.push('</g>');
      }
    }

    // Legend: low -> high swatches with the max printed, so the scale is explicit.
    const legW = Math.min(220, gridW * 0.5);
    const legX = S - pad - rightExtra - legW;
    const legY = pad + 8;
    const steps = T.ramp.length;
    const sw = legW / steps;
    for (let i = 0; i < steps; i++) {
      out.push(`<rect x="${(legX + sw * i).toFixed(1)}" y="${legY}" width="${Math.max(0, sw - 1).toFixed(1)}" height="10" rx="2" fill="${T.ramp[i]}"/>`);
    }
    out.push(`<text x="${legX}" y="${legY + 24}" font-size="11" fill="${T.muted}">1</text>`);
    out.push(`<text x="${legX + legW}" y="${legY + 24}" font-size="11" fill="${T.muted}" text-anchor="end">${esc(fmtValue(model.max, model.metric))} ${esc((METRICS[model.metric] || METRICS.posts).short)}</text>`);

    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  // One CSV cell, shared by every export. Text that a spreadsheet would read as a formula
  // (= + @ tab CR, or - not followed by a digit) gets a leading ' so a display name or post
  // like =HYPERLINK(...) stays text; numbers, including negative ones, are left alone.
  function csvCell(v) {
    let s = String(v === null || v === undefined ? '' : v);
    if (typeof v === 'string' && /^([=+@\t\r]|-(?!\d))/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Rows of cells to a CSV string with a BOM and CRLF line ends, so Excel reads it as UTF-8.
  const csvText = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

  function toCsv(model) {
    const rows = [['name', 'handle', 'posts', ...model.cols.map((c) => c.label), 'total']];
    for (const r of model.rows) {
      rows.push([r.name, r.handle, r.posts, ...r.values.map((v) => fmtValue(v, model.metric)), fmtValue(r.total, model.metric)]);
    }
    return csvText(rows);
  }

  // Rasterise the SVG string to a PNG blob at `scale` × its size.
  function toPng(svgString, size, scale = 2) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size * scale;
          canvas.height = size * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG encoding failed'))), 'image/png');
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise the SVG')); };
      img.src = url;
    });
  }

  root.XPCMatrix = { RAMP, THEMES, METRICS, parseKeywords, build, renderSvg, toCsv, toPng, fmtValue, csvCell, csvText };
})(typeof self !== 'undefined' ? self : this);
