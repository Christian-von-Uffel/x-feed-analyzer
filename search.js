// search.js — shared search-option model for X Feed Analyzer.
// Loaded by viewer.html and, as a content script, on x.com before content.js.
// Options follow the editor convention (VS Code, JetBrains): Match Case, Match Whole Word,
// Use Regular Expression, plus rarely-needed regex flags kept out of the way.
(function (root) {
  'use strict';

  const DEFAULT_OPTIONS = {
    pattern: '',
    matchCase: false,   // Aa
    wholeWord: false,   // ab
    regex: true,        // .*  (off = plain text search)
    multiline: false,   // ^ and $ also match at line breaks
    dotAll: false,      // . also matches line breaks
    unicode: false,     // \p{...} classes, emoji as single characters
  };

  const OPTION_KEYS = ['matchCase', 'wholeWord', 'regex', 'multiline', 'dotAll', 'unicode'];

  const PRESETS = [
    { label: 'Em dash (—)', pattern: '—' },
    { label: 'En dash (–)', pattern: '–' },
    { label: 'Em or en dash', pattern: '[—–]' },
    { label: 'Two or more em dashes', pattern: '—[^—]*—' },
    { label: 'Smart quotes (’ “ ”)', pattern: '[’“”]' },
    { label: '"Not X, it\'s Y" framing', pattern: "\\b(?:it'?s|that'?s|this is|this isn'?t) (?:not )?(?:just |only |about )?[^.?!\\n]{2,60}?[,—–;]\\s*(?:it'?s|but)\\b" },
    { label: 'AI-associated vocabulary', pattern: '\\b(?:delve|tapestry|testament|landscape|leverage|game[- ]?changer|unlock|elevate|seamless(?:ly)?|navigate|robust|harness|multifaceted|paradigm|underscore|foster|realm|intricate|crucial|pivotal)\\b' },
    { label: 'Emoji / numbered bullet list', pattern: '(?:^|\\n)\\s*(?:✅|✔\\uFE0F?|🔥|🚀|💡|👉|➡\\uFE0F?|•|▪\\uFE0F?|◾\\uFE0F?|\\d+[.)])\\s' },
    { label: 'Ends with a question', pattern: '\\?\\s*$' },
    { label: 'Contains a link', pattern: '\\b(?:https?://|[a-z0-9-]+\\.[a-z]{2,}(?:/|\\b))' },
  ];

  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Accepts the current option shape or the legacy { flags: 'imsu', literal } shape.
  function normalize(raw) {
    raw = raw || {};
    const out = { ...DEFAULT_OPTIONS };
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
      if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key];
    }
    // Legacy flags migrate m/s/u only; case sensitivity stays off unless matchCase is set explicitly.
    if (typeof raw.flags === 'string' && raw.matchCase === undefined) {
      out.multiline = raw.flags.includes('m');
      out.dotAll = raw.flags.includes('s');
      out.unicode = raw.flags.includes('u');
    }
    if (raw.literal !== undefined && raw.regex === undefined) out.regex = !raw.literal;
    out.pattern = String(out.pattern || '');
    for (const key of OPTION_KEYS) out[key] = Boolean(out[key]);
    return out;
  }

  // Returns { regex, regexG, error, options }.
  // `regex` has no g flag (safe for .test); `regexG` is for iterating matches.
  function compile(raw) {
    const options = normalize(raw);
    if (!options.pattern) return { regex: null, regexG: null, error: null, options };

    let source = options.regex ? options.pattern : escapeRegex(options.pattern);
    let flags = '';
    if (!options.matchCase) flags += 'i';
    if (options.regex && options.multiline) flags += 'm';
    if (options.regex && options.dotAll) flags += 's';
    if (options.regex && options.unicode) flags += 'u';

    if (options.wholeWord) {
      // Editor semantics: no word character directly before or after the match.
      // Works for non-word terms too (an em dash between spaces still counts as a whole word).
      const word = flags.includes('u') ? '[\\p{L}\\p{N}_]' : '\\w';
      source = `(?<!${word})(?:${source})(?!${word})`;
    }

    try {
      return {
        regex: new RegExp(source, flags),
        regexG: new RegExp(source, flags + 'g'),
        error: null,
        options,
      };
    } catch (e) {
      return { regex: null, regexG: null, error: e.message, options };
    }
  }

  // Short human summary, e.g. "match case · whole word · plain text".
  function describe(raw) {
    const o = normalize(raw);
    const parts = [];
    if (o.matchCase) parts.push('match case');
    if (o.wholeWord) parts.push('whole word');
    if (!o.regex) parts.push('plain text');
    else {
      if (o.multiline) parts.push('multiline');
      if (o.dotAll) parts.push('dot matches newlines');
      if (o.unicode) parts.push('unicode');
    }
    return parts.join(' · ');
  }

  root.XPCSearch = { DEFAULT_OPTIONS, OPTION_KEYS, PRESETS, escapeRegex, normalize, compile, describe };
})(typeof self !== 'undefined' ? self : this);
