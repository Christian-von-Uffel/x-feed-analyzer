// network.js — interaction network for X Feed Analyzer: who quotes, replies to, reposts and
// mentions whom. Pure functions: build a model from posts, lay it out, render it to an SVG
// string. As with matrix.js and clouds.js, the SVG shown on the page is the one exported.
// Loaded by viewer.html after clouds.js (it reuses the shared image frame and colour themes).
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  const fmtDay = (t) => (t === null ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  const lower = (h) => String(h || '').toLowerCase();
  const plural = (v, word) => `${v.toLocaleString()} ${word}${v === 1 ? '' : 's'}`;
  const themes = () => root.XPCMatrix.THEMES;

  // Edge types, in drawing order. Colours are the first three categorical slots of the palette,
  // validated for colour-vision deficiency across every pair in both themes; mentions, the
  // weakest tie, take a neutral grey. Each type also has its own dash pattern, so colour is
  // never the only cue, and the legend always names them.
  const TYPES = [
    { key: 'quote', label: 'quotes', past: 'quoted', verb: 'quotes', dash: '', light: '#2a78d6', dark: '#3987e5' },
    { key: 'reply', label: 'replies', past: 'replied to', verb: 'replies to', dash: '7 4', light: '#eb6834', dark: '#d95926' },
    { key: 'repost', label: 'reposts', past: 'reposted', verb: 'reposts', dash: '2 4', light: '#1baf7a', dark: '#199e70' },
    { key: 'mention', label: 'mentions', past: 'mentioned', verb: 'mentions', dash: '1 5', light: '#8b98a5', dark: '#71767b' },
  ];
  const TYPE_INDEX = {};
  TYPES.forEach((t, i) => { TYPE_INDEX[t.key] = i; });
  const typeOf = (key) => TYPES[TYPE_INDEX[key]] || TYPES[0];
  const colorOf = (key, theme) => typeOf(key)[theme === 'dark' ? 'dark' : 'light'];
  const ACCENT = '#1d9bf0';

  // ---------------------------------------------------------------------------
  // Model
  // ---------------------------------------------------------------------------

  // The directed interactions one post carries: [{ from, to, type }].
  // `types` is a Set of type keys to include. Self-interactions are dropped. A handle named in
  // the reply line or quoted is not counted again as a mention.
  function edgesOf(post, types) {
    const out = [];
    const a = post && post.handle;
    if (!a) return out;
    const add = (from, to, type) => { if (from && to && lower(from) !== lower(to)) out.push({ from, to, type }); };
    if (types.has('quote') && post.quotedHandle) add(a, post.quotedHandle, 'quote');
    if (types.has('reply') && Array.isArray(post.replyTo)) for (const h of post.replyTo) add(a, h, 'reply');
    if (types.has('repost')) {
      // The timeline's "X reposted" line names one reposter; the post's /retweets page lists them all.
      const seen = new Set();
      const reposters = [...(post.isRepost && post.repostedBy ? [post.repostedBy] : []), ...(Array.isArray(post.reposters) ? post.reposters : [])];
      for (const h of reposters) if (h && !seen.has(lower(h))) { seen.add(lower(h)); add(h, a, 'repost'); }
    }
    if (types.has('mention') && Array.isArray(post.mentions)) {
      const skip = new Set([...(Array.isArray(post.replyTo) ? post.replyTo : []), post.quotedHandle || ''].map(lower));
      for (const h of post.mentions) if (!skip.has(lower(h))) add(a, h, 'mention');
    }
    return out;
  }

  const zero = () => ({ quote: 0, reply: 0, repost: 0, mention: 0 });
  const byRank = (a, b) => b.received - a.received || b.sent - a.sent || b.posts - a.posts || lower(a.handle).localeCompare(lower(b.handle));

  // posts:     already filtered (dates, types, ...), not by author
  // types:     interaction types to count (array or Set of keys); default all, and empty means none
  // minWeight: least posts behind a connection for it to be drawn
  // maxNodes:  how many accounts to draw, by interactions received then sent
  // focus:     a handle; when set, only that account and its neighbours are drawn (an ego network)
  function build({ posts, types, minWeight = 1, maxNodes = 60, focus = null }) {
    const T = new Set(types === null || types === undefined ? TYPES.map((t) => t.key) : types);
    const nodes = new Map(); // lower-case handle -> node
    const edges = new Map(); // "from|to|type" -> edge
    const node = (handle, name) => {
      const k = lower(handle);
      let n = nodes.get(k);
      if (!n) { n = { handle, name: null, posts: 0, in: zero(), out: zero(), received: 0, sent: 0 }; nodes.set(k, n); }
      if (name && !n.name) n.name = name;
      return n;
    };

    let nPosts = 0;
    let nInteractions = 0;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const post of posts || []) {
      if (!post || !post.handle) continue;
      nPosts++;
      const t = post.time ? new Date(post.time).getTime() : NaN;
      if (!Number.isNaN(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      node(post.handle, post.name).posts++;
      if (post.quotedHandle && post.quotedName) node(post.quotedHandle, post.quotedName);
      for (const e of edgesOf(post, T)) {
        const from = node(e.from, null);
        const to = node(e.to, null);
        from.out[e.type]++; from.sent++;
        to.in[e.type]++; to.received++;
        nInteractions++;
        const key = `${lower(e.from)}|${lower(e.to)}|${e.type}`;
        let ed = edges.get(key);
        if (!ed) { ed = { from, to, type: e.type, count: 0, ids: [] }; edges.set(key, ed); }
        ed.count++;
        ed.ids.push(post.id);
      }
    }

    const allEdges = Array.from(edges.values()).sort((a, b) => b.count - a.count || byRank(a.to, b.to) || byRank(a.from, b.from) || TYPE_INDEX[a.type] - TYPE_INDEX[b.type]);
    const ranked = Array.from(nodes.values()).filter((n) => n.received + n.sent > 0).sort(byRank);

    // Choose what to draw.
    const min = Math.max(1, Number(minWeight) || 1);
    const cap = Math.max(2, Number(maxNodes) || 60);
    let drawnEdges = allEdges.filter((e) => e.count >= min);
    const focusNode = focus ? nodes.get(lower(focus)) || null : null;
    if (focusNode) {
      const touching = drawnEdges.filter((e) => e.from === focusNode || e.to === focusNode);
      const weight = new Map();
      for (const e of touching) {
        const other = e.from === focusNode ? e.to : e.from;
        weight.set(other, (weight.get(other) || 0) + e.count);
      }
      const neighbours = Array.from(weight.keys()).sort((a, b) => weight.get(b) - weight.get(a) || byRank(a, b)).slice(0, cap - 1);
      const keep = new Set([focusNode, ...neighbours]);
      drawnEdges = drawnEdges.filter((e) => keep.has(e.from) && keep.has(e.to));
    } else if (focus) {
      drawnEdges = []; // asked to focus on an account that has no interactions here
    } else {
      let kept = new Set();
      for (const e of drawnEdges) { kept.add(e.from); kept.add(e.to); }
      if (kept.size > cap) {
        // Peel the least connected accounts away one at a time until the cap is met, so what is
        // drawn is the densely connected core rather than a top-N list with few links between them.
        const rankOf = new Map(ranked.map((n, i) => [n, i]));
        kept = new Set(Array.from(kept).sort((a, b) => rankOf.get(a) - rankOf.get(b)).slice(0, Math.max(cap * 5, 300)));
        let live = drawnEdges.filter((e) => kept.has(e.from) && kept.has(e.to));
        const w = new Map();
        for (const n of kept) w.set(n, 0);
        for (const e of live) { w.set(e.from, w.get(e.from) + e.count); w.set(e.to, w.get(e.to) + e.count); }
        while (kept.size > cap) {
          let victim = null;
          for (const n of kept) {
            if (!victim || w.get(n) < w.get(victim) || (w.get(n) === w.get(victim) && rankOf.get(n) > rankOf.get(victim))) victim = n;
          }
          kept.delete(victim);
          for (const e of live) {
            if (e.from === victim && kept.has(e.to)) w.set(e.to, w.get(e.to) - e.count);
            else if (e.to === victim && kept.has(e.from)) w.set(e.from, w.get(e.from) - e.count);
          }
          live = live.filter((e) => e.from !== victim && e.to !== victim);
        }
      }
      drawnEdges = drawnEdges.filter((e) => kept.has(e.from) && kept.has(e.to));
    }
    const drawnSet = new Set();
    for (const e of drawnEdges) { drawnSet.add(e.from); drawnSet.add(e.to); }
    if (focusNode) drawnSet.add(focusNode);
    const drawn = Array.from(drawnSet).sort(byRank);
    const index = new Map(drawn.map((n, i) => [n, i]));

    const outNode = (n) => ({ handle: n.handle, name: n.name, posts: n.posts, in: { ...n.in }, out: { ...n.out }, received: n.received, sent: n.sent, captured: n.posts > 0 });
    return {
      nodes: drawn.map((n) => ({ ...outNode(n), x: 0, y: 0, r: 0 })),
      edges: drawnEdges.map((e) => ({ from: index.get(e.from), to: index.get(e.to), fromHandle: e.from.handle, toHandle: e.to.handle, type: e.type, count: e.count, ids: e.ids.slice() })),
      allEdges: allEdges.map((e) => ({ fromHandle: e.from.handle, toHandle: e.to.handle, type: e.type, count: e.count, ids: e.ids.slice() })),
      ranking: ranked.map((n) => ({ ...outNode(n), drawn: drawnSet.has(n) })),
      types: TYPES.map((t) => t.key).filter((k) => T.has(k)),
      minWeight: min,
      maxNodes: cap,
      focus: focusNode ? focusNode.handle : (focus ? String(focus) : null),
      focusMissing: Boolean(focus && !focusNode),
      nPosts, nInteractions, nAccounts: ranked.length,
      from: Number.isFinite(tMin) ? tMin : null,
      to: Number.isFinite(tMax) ? tMax : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Layout: a force simulation (Fruchterman–Reingold with collision and a little gravity), run
  // per connected component. The largest component fills the canvas; smaller islands are packed
  // into a strip beneath it, so a few stray pairs cannot squeeze the main cluster into a corner.
  // Deterministic: no randomness, so an export is reproducible. Sets x, y and r on every node.
  // ---------------------------------------------------------------------------

  // Simulate `nodes` (with local x, y in [0, W] × [0, H]) joined by `springs` [{ i, j, w }].
  function simulate(nodes, springs, W, H, iterations) {
    const N = nodes.length;
    if (N === 1) { nodes[0].x = W / 2; nodes[0].y = H / 2; return; }
    // Start on a golden-angle spiral, the most interacted-with account at the centre.
    const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].received - nodes[a].received || a - b);
    order.forEach((idx, i) => {
      const ang = i * 2.399963229728653;
      const rad = Math.sqrt((i + 0.5) / N) * Math.min(W, H) * 0.42;
      nodes[idx].x = W / 2 + rad * Math.cos(ang);
      nodes[idx].y = H / 2 + rad * Math.sin(ang);
    });
    const k = Math.sqrt((W * H) / N) * 0.7;
    const dx = new Float64Array(N);
    const dy = new Float64Array(N);
    let temp = Math.max(W, H) / 8;
    for (let it = 0; it < iterations; it++) {
      dx.fill(0); dy.fill(0);
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          let ddx = a.x - b.x;
          let ddy = a.y - b.y;
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 < 0.01) { ddx = 0.1 * ((i % 3) - 1 || 1); ddy = 0.1 * ((j % 3) - 1 || 1); d2 = ddx * ddx + ddy * ddy; }
          const d = Math.sqrt(d2);
          const gap = a.r + b.r + 10;
          let f = (k * k) / d;
          if (d < gap) f += (gap - d) * 3;
          const fx = (ddx / d) * f;
          const fy = (ddy / d) * f;
          dx[i] += fx; dy[i] += fy;
          dx[j] -= fx; dy[j] -= fy;
        }
      }
      for (const s of springs) {
        const a = nodes[s.i];
        const b = nodes[s.j];
        const ddx = b.x - a.x;
        const ddy = b.y - a.y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        const reach = Math.max(0, d - a.r - b.r);
        const f = ((reach * reach) / k) * s.w;
        const fx = (ddx / d) * f;
        const fy = (ddy / d) * f;
        dx[s.i] += fx; dy[s.i] += fy;
        dx[s.j] -= fx; dy[s.j] -= fy;
      }
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        dx[i] += (W / 2 - n.x) * 0.03; // gravity keeps the arrangement together
        dy[i] += (H / 2 - n.y) * 0.03;
        const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
        const step = Math.min(len, temp);
        n.x = Math.max(n.r, Math.min(W - n.r, n.x + (dx[i] / len) * step));
        n.y = Math.max(n.r, Math.min(H - n.r, n.y + (dy[i] / len) * step));
      }
      temp = Math.max(0.5, temp * 0.975);
    }
    // Springs on well-connected accounts can overpower the collision term; separate any circles
    // that still overlap so every account (and its label anchor) stays visible.
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let ddx = b.x - a.x;
          let ddy = b.y - a.y;
          let d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < 0.01) { ddx = 1; ddy = 0.5 * ((i % 2) || -1); d = Math.sqrt(ddx * ddx + ddy * ddy); }
          const gap = a.r + b.r + 8;
          if (d >= gap) continue;
          const push = (gap - d) / 2;
          a.x -= (ddx / d) * push; a.y -= (ddy / d) * push;
          b.x += (ddx / d) * push; b.y += (ddy / d) * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // Move an arrangement into `box`, scaling it up to fill the space (never past `maxScale`) and
  // leaving `labelRoom` on the right for the labels.
  function fit(nodes, box, labelRoom, maxScale) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const room = Math.max(0, box.width - labelRoom);
    const s = Math.min(maxScale, room / Math.max(1, x1 - x0), box.height / Math.max(1, y1 - y0));
    const offX = box.x + (room - (x1 - x0) * s) / 2;
    const offY = box.y + (box.height - (y1 - y0) * s) / 2;
    for (const n of nodes) {
      n.x = Math.round((offX + (n.x - x0) * s) * 10) / 10;
      n.y = Math.round((offY + (n.y - y0) * s) * 10) / 10;
    }
  }

  function components(model) {
    const N = model.nodes.length;
    const parent = Array.from({ length: N }, (_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const e of model.edges) { const a = find(e.from); const b = find(e.to); if (a !== b) parent[a] = b; }
    const groups = new Map();
    for (let i = 0; i < N; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    return Array.from(groups.values()).sort((a, b) => b.length - a.length || a[0] - b[0]);
  }

  function layout(model, { x = 0, y = 0, width = 900, height = 700, iterations = 350 } = {}) {
    const nodes = model.nodes;
    const N = nodes.length;
    if (!N) return model;
    const box = { x, y, width: Math.max(50, width), height: Math.max(50, height) };

    const maxIn = Math.max(1, ...nodes.map((n) => n.received));
    const rMax = Math.min(30, Math.max(12, 240 / Math.sqrt(N)));
    const rMin = Math.min(7, rMax);
    for (const n of nodes) n.r = Math.round((rMin + (rMax - rMin) * Math.sqrt(n.received / maxIn)) * 10) / 10;

    const springWeight = (count) => 1 + 0.35 * Math.log2(Math.max(1, count));
    const run = (members, W, H, into, labelRoom) => {
      const local = new Map(members.map((idx, i) => [idx, i]));
      const group = members.map((idx) => nodes[idx]);
      const springs = [];
      for (const e of model.edges) if (local.has(e.from) && local.has(e.to)) springs.push({ i: local.get(e.from), j: local.get(e.to), w: springWeight(e.count) });
      simulate(group, springs, W, H, iterations);
      fit(group, into, labelRoom, 1.6);
    };

    const comps = components(model);
    if (comps.length === 1) {
      run(comps[0], box.width, box.height, box, 90);
      return model;
    }

    // Islands: one small box each, packed into rows along the bottom of the canvas.
    const GAP = 14;
    const islands = comps.slice(1).map((c) => { const side = 56 + 44 * Math.sqrt(c.length); return { c, w: side + 80, h: side }; });
    const rows = [];
    let row = { items: [], w: 0, h: 0 };
    for (const b of islands) {
      if (row.items.length && row.w + b.w > box.width) { rows.push(row); row = { items: [], w: 0, h: 0 }; }
      row.items.push(b);
      row.w += b.w + GAP;
      row.h = Math.max(row.h, b.h);
    }
    rows.push(row);
    let stripH = rows.reduce((s, r) => s + r.h, 0) + GAP * (rows.length - 1);
    const scale = Math.min(1, (box.height * 0.4) / stripH);
    stripH *= scale;

    run(comps[0], box.width, box.height - stripH - GAP, { x: box.x, y: box.y, width: box.width, height: box.height - stripH - GAP }, 90);
    let yy = box.y + box.height - stripH;
    for (const r of rows) {
      let xx = box.x;
      for (const b of r.items) {
        run(b.c, b.w, b.h, { x: xx, y: yy, width: b.w * scale, height: b.h * scale }, 70 * scale);
        xx += (b.w + GAP) * scale;
      }
      yy += (r.h + GAP) * scale;
    }
    return model;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Geometry of the square image: where the graph may be drawn, below the title and above the legend.
  function plotBox(size) {
    const S = size;
    const pad = Math.round(S * 0.045);
    const top = pad + 30 + 26 + 22;
    const bottom = S - pad - 44;
    const legend = 48;
    return { x: pad, y: top, width: S - 2 * pad, height: bottom - legend - top, legendY: bottom - 14 };
  }

  const ARROW = 8;
  // Compact drawings (the pane beside the posts) scale labels, lines and arrowheads up by this much.
  const COMPACT_SCALE = 2.1;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // A curved path from node a to node b, starting and ending on the circles' edges. Reciprocal
  // edges bend to opposite sides, and each type bends a little more so parallel ones stay apart.
  function edgePath(a, b, type, arrow = ARROW) {
    const ti = TYPE_INDEX[type] || 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const bend = d * (0.12 + 0.07 * ti);
    const mx = (a.x + b.x) / 2 - (dy / d) * bend;
    const my = (a.y + b.y) / 2 + (dx / d) * bend;
    const towards = (p, q, dist) => {
      const vx = q.x - p.x;
      const vy = q.y - p.y;
      const L = Math.sqrt(vx * vx + vy * vy) || 1;
      return { x: p.x + (vx / L) * dist, y: p.y + (vy / L) * dist };
    };
    const m = { x: mx, y: my };
    const s = towards(a, m, a.r + 1);
    const e = towards(b, m, b.r + arrow);
    const f = (v) => v.toFixed(1);
    return `M${f(s.x)} ${f(s.y)} Q${f(mx)} ${f(my)} ${f(e.x)} ${f(e.y)}`;
  }

  const edgeWidth = (count, maxCount) => Math.round((1.2 + 3.8 * Math.sqrt(Math.max(0, count - 1) / Math.max(1, maxCount - 1))) * 10) / 10;

  function edgeTitle(e) {
    const t = typeOf(e.type);
    return `@${e.fromHandle} ${t.verb} @${e.toHandle}: ${plural(e.count, 'post')}`;
  }

  function nodeTitle(n) {
    const parts = [];
    for (const t of TYPES) if (n.in[t.key]) parts.push(`${t.past} ${plural(n.in[t.key], 'time')}`);
    const recv = parts.length ? parts.join(', ') : 'never interacted with';
    return `${n.name ? n.name + ' ' : ''}@${n.handle}\n${recv}\nsent ${n.sent} · ${n.captured ? plural(n.posts, 'post') + ' in your catalogue' : 'no posts of theirs captured'}`;
  }

  // Returns an SVG string. `size` is both width and height (1:1). The model must have been laid
  // out in plotBox(size) first. Node and edge elements carry data attributes so the page can
  // make them interactive; the exported file simply carries them along. `compact` draws only the
  // plot box, without title, legend or note, with labels, lines and arrowheads scaled up so the
  // map still reads when shown small (the pane beside the posts); exports never use it.
  function renderSvg(model, { theme = 'light', size = 1080, title = '', note = '', compact = false } = {}) {
    const focus = model.focus;
    const titleText = title || (focus ? `@${focus} network map` : 'Account network map');
    const range = model.from !== null && model.from !== undefined ? `${fmtDay(model.from)} – ${fmtDay(model.to)}` : 'no dates';
    const bits = [`${plural(model.nInteractions, 'interaction')} between ${plural(model.nAccounts, 'account')}`, `${plural(model.nPosts, 'post')}`, range];
    if (model.minWeight > 1) bits.push(`connections with ${model.minWeight}+ posts`);
    const subtitle = bits.join(' · ');
    const box = plotBox(size);
    const k = compact ? COMPACT_SCALE : 1;
    const arrow = ARROW * k;
    let out;
    let T;
    let S;
    let pad;
    if (compact) {
      T = root.XPCMatrix.THEMES[theme] || root.XPCMatrix.THEMES.light;
      S = size;
      pad = 0;
      out = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" width="${box.width}" height="${box.height}" role="img" aria-label="${esc(titleText)}: ${esc(subtitle)}" font-family="${esc(FONT)}">`,
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${T.bg}"/>`,
      ];
    } else {
      const f = root.XPCClouds.frame({ theme, size, title: titleText, subtitle, note });
      out = f.out; T = f.T; S = f.S; pad = f.pad;
    }

    if (!model.nodes.length) {
      if (compact) {
        const lines = model.focusMissing ? [`@${focus} has no interactions here.`, 'Open their posts or replies on X with capture on.'] : ['No interactions among these posts.', 'Turn on more types or lower “min posts”.'];
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        lines.forEach((line, i) => out.push(`<text x="${cx}" y="${cy + (i - 0.5) * 22 * k}" font-size="${13 * k}" fill="${T.muted}" text-anchor="middle">${esc(line)}</text>`));
        out.push('</svg>');
        return out.join('\n');
      }
      const why = model.focusMissing ? `@${focus} has no interactions in these posts.` : 'No interactions among these posts. Turn on more interaction types, lower “min posts”, or scroll past more posts on X.';
      return root.XPCClouds.message(out, S, T, why);
    }

    const dark = theme === 'dark';
    const nodeFill = dark ? '#8b98a5' : '#536471';
    const maxCount = Math.max(1, ...model.edges.map((e) => e.count));
    const top10 = new Set(model.nodes.slice().sort((a, b) => b.received - a.received).slice(0, 10).map((n) => n.handle));

    out.push('<defs>');
    for (const t of TYPES) {
      out.push(`<marker id="nw-arrow-${t.key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${arrow}" markerHeight="${arrow}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${colorOf(t.key, theme)}"/></marker>`);
    }
    out.push(`<clipPath id="nw-clip"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/></clipPath>`);
    out.push('</defs>');
    out.push(`<g class="canvas" clip-path="url(#nw-clip)"><g class="pan">`);

    out.push('<g class="edges">');
    for (const e of model.edges) {
      const a = model.nodes[e.from];
      const b = model.nodes[e.to];
      const t = typeOf(e.type);
      const col = colorOf(e.type, theme);
      const d = edgePath(a, b, e.type, arrow);
      const w = Math.round(edgeWidth(e.count, maxCount) * k * 10) / 10;
      out.push(`<g class="edge" data-i="${e.from}" data-j="${e.to}" data-type="${t.key}" data-from="${esc(e.fromHandle)}" data-to="${esc(e.toHandle)}">`
        + `<title>${esc(edgeTitle(e))}</title>`
        + `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="${12 * k}"/>`
        + `<path class="line" d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''} stroke-linecap="round" opacity="0.75" marker-end="url(#nw-arrow-${t.key})"/>`
        + '</g>');
    }
    out.push('</g>');

    out.push('<g class="nodes">');
    model.nodes.forEach((n, i) => {
      const isFocus = focus && lower(n.handle) === lower(focus);
      const fs = Math.round(Math.max(11, Math.min(16, Math.round(n.r * 0.75))) * k);
      const fw = top10.has(n.handle) || isFocus ? 700 : 500;
      const stroke = isFocus ? ACCENT : (n.captured ? T.bg : nodeFill);
      const sw = (isFocus ? 3.5 : 2) * k;
      out.push(`<g class="node${isFocus ? ' focus' : ''}" data-i="${i}" data-handle="${esc(n.handle)}" transform="translate(${n.x} ${n.y})">`
        + `<title>${esc(nodeTitle(n))}</title>`
        + `<circle r="${n.r}" fill="${n.captured ? nodeFill : T.bg}" stroke="${stroke}" stroke-width="${sw}"/>`
        + `<text x="${(n.r + 5 * k).toFixed(1)}" y="${(fs * 0.35).toFixed(1)}" font-size="${fs}" font-weight="${fw}" fill="${T.text}" stroke="${T.bg}" stroke-width="${3 * k}" paint-order="stroke" stroke-linejoin="round">${esc(trunc('@' + n.handle, 20))}</text>`
        + '</g>');
    });
    out.push('</g>');
    out.push('</g></g>');
    if (compact) {
      out.push('</svg>');
      return out.join('\n');
    }

    // Legend: one sample per interaction type shown, then the node key.
    let lx = pad;
    const ly = box.legendY;
    for (const key of model.types) {
      const t = typeOf(key);
      const n = model.allEdges.filter((e) => e.type === key).reduce((s, e) => s + e.count, 0);
      const label = `${t.label} ${n.toLocaleString()}`;
      out.push(`<line x1="${lx}" y1="${ly - 4}" x2="${lx + 34}" y2="${ly - 4}" stroke="${colorOf(key, theme)}" stroke-width="3"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''} stroke-linecap="round" marker-end="url(#nw-arrow-${key})"/>`);
      out.push(`<text x="${lx + 48}" y="${ly}" font-size="13" fill="${T.text}">${esc(label)}</text>`);
      lx += 48 + label.length * 7.2 + 26;
    }
    out.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${nodeFill}"/>`);
    out.push(`<text x="${lx + 18}" y="${ly}" font-size="13" fill="${T.text}">in your catalogue</text>`);
    lx += 18 + 17 * 7.2 + 20;
    out.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${T.bg}" stroke="${nodeFill}" stroke-width="2"/>`);
    out.push(`<text x="${lx + 18}" y="${ly}" font-size="13" fill="${T.text}">only referenced</text>`);
    lx += 18 + 15 * 7.2 + 20;
    out.push(`<text x="${lx}" y="${ly}" font-size="13" fill="${T.muted}">size = interactions received</text>`);

    out.push('</svg>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  // One row per account with any interaction, most interacted-with first.
  function accountsCsv(model) {
    const head = ['name', 'handle', 'posts', 'received', 'quoted', 'replied_to', 'reposted', 'mentioned', 'sent', 'quotes_sent', 'replies_sent', 'reposts_sent', 'mentions_sent', 'in_catalogue', 'drawn'];
    const rows = [head];
    for (const n of model.ranking) {
      rows.push([n.name || '', n.handle, n.posts, n.received, n.in.quote, n.in.reply, n.in.repost, n.in.mention, n.sent, n.out.quote, n.out.reply, n.out.repost, n.out.mention, n.captured ? 1 : 0, n.drawn ? 1 : 0]);
    }
    return root.XPCMatrix.csvText(rows);
  }

  // One row per directed connection and type, heaviest first (every connection, drawn or not).
  function edgesCsv(model) {
    const rows = [['from', 'to', 'type', 'posts']];
    for (const e of model.allEdges) rows.push([e.fromHandle, e.toHandle, e.type, e.count]);
    return root.XPCMatrix.csvText(rows);
  }

  root.XPCNetwork = { TYPES, ARROW, COMPACT_SCALE, typeOf, colorOf, edgesOf, build, layout, plotBox, edgePath, renderSvg, nodeTitle, edgeTitle, accountsCsv, edgesCsv };
})(typeof self !== 'undefined' ? self : this);
