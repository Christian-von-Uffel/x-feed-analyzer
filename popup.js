// popup.js — X Feed Analyzer toolbar popup
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const DEFAULT_FILTER = { enabled: false, pattern: '', mode: 'highlight', field: 'text', matchCase: false, wholeWord: false, regex: true, multiline: false, dotAll: false, unicode: false };
  let filter = { ...DEFAULT_FILTER };

  function render(settings) {
    $('#capture').checked = settings.capture !== false;
    filter = { ...DEFAULT_FILTER, ...(settings.filter || {}) };
    $('#filter-enabled').checked = Boolean(filter.enabled);
    const code = $('#filter-pattern');
    const notes = [];
    if (filter.matchCase) notes.push('match case');
    if (filter.wholeWord) notes.push('whole word');
    if (filter.regex === false) notes.push('plain text');
    code.textContent = filter.pattern ? filter.pattern + (notes.length ? `  (${notes.join(', ')})` : '') : '(no pattern yet)';
    code.title = filter.pattern || '';
  }

  chrome.storage.local.get({ capture: true, filter: DEFAULT_FILTER }, render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get({ capture: true, filter: DEFAULT_FILTER }, render);
  });

  chrome.runtime.sendMessage({ type: 'count' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    $('#count').textContent = res.total.toLocaleString();
  });

  $('#capture').addEventListener('change', (e) => {
    chrome.storage.local.set({ capture: e.target.checked });
  });
  $('#filter-enabled').addEventListener('change', (e) => {
    chrome.storage.local.set({ filter: { ...filter, enabled: e.target.checked } });
  });
  $('#open').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
    window.close();
  });
  $('#open-network').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') + '#network' });
    window.close();
  });
})();
