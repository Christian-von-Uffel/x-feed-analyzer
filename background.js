// background.js — service worker for X Feed Analyzer.
// Receives scraped posts from the content script and stores them in IndexedDB.
// No network access is used anywhere in this extension.
importScripts('db.js');

const DEFAULT_SETTINGS = {
  capture: true,
  filter: { enabled: false, pattern: '', mode: 'highlight', field: 'text', matchCase: false, wholeWord: false, regex: true, multiline: false, dotAll: false, unicode: false },
};

function formatBadge(n) {
  if (!n) return '';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

async function updateBadge() {
  try {
    const n = await XPCDB.count();
    await chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
    await chrome.action.setBadgeText({ text: formatBadge(n) });
  } catch (e) {
    // Badge is cosmetic; ignore failures.
  }
}

async function ensureDefaults() {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(current);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults();
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);

// Broadcast to other extension pages (viewer, popup). Rejects when nobody listens; that's fine.
function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {
    // no receivers
  }
}

const MESSAGE_TYPES = new Set(['upsert', 'count', 'openViewer', 'badge']);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages and content scripts, and only messages it knows.
  if (sender.id !== chrome.runtime.id || !message || !MESSAGE_TYPES.has(message.type)) return false;
  (async () => {
    switch (message && message.type) {
      case 'upsert': {
        const result = await XPCDB.upsertMany(Array.isArray(message.posts) ? message.posts : []);
        updateBadge();
        if (result.inserted || result.updated) broadcast({ type: 'catalogueUpdated', ...result });
        return { ok: true, ...result };
      }
      case 'count':
        return { ok: true, total: await XPCDB.count() };
      case 'openViewer': {
        const hash = typeof message.hash === 'string' ? message.hash.replace(/[^a-z]/gi, '') : '';
        await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') + (hash ? '#' + hash : '') });
        return { ok: true };
      }
      case 'badge':
        await updateBadge();
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown message type' };
    }
  })().then(sendResponse, (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async response
});

updateBadge();
