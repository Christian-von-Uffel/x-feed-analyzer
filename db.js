// db.js — shared IndexedDB helper for X Feed Analyzer.
// Loaded by the background service worker (importScripts) and by viewer.html (<script>).
// Everything is stored in the extension's own origin. Nothing is sent anywhere.
(function (root) {
  'use strict';

  const DB_NAME = 'x-post-catalogue';
  const DB_VERSION = 1;
  const STORE = 'posts';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('handle', 'handle', { unique: false });
          store.createIndex('time', 'time', { unique: false });
          store.createIndex('firstSeen', 'firstSeen', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB open blocked')); };
    });
    return dbPromise;
  }

  const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });

  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Fields the content script never sends but the store maintains.
  const BOOKKEEPING = new Set(['firstSeen', 'lastSeen', 'seenCount', 'context']);

  // Union two handle lists, case-insensitively, keeping the first spelling seen.
  function unionHandles(a, b) {
    const out = [];
    const seen = new Set();
    for (const h of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
      if (typeof h !== 'string' || !h) continue;
      const k = h.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    return out;
  }

  // Merge a freshly scraped (or imported) post into the stored record.
  // A stub (from a post's /retweets page) only knows the post's id, author and reposters: it
  // adds to the reposter list and never overwrites what a real sighting recorded.
  function merge(existing, incoming, now) {
    if (!existing) {
      return {
        ...incoming,
        firstSeen: incoming.firstSeen || now,
        lastSeen: incoming.lastSeen || now,
        seenCount: incoming.seenCount || 1,
      };
    }
    const out = { ...existing };
    for (const key of Object.keys(incoming)) {
      const value = incoming[key];
      if (value === null || value === undefined) continue;
      if (BOOKKEEPING.has(key)) continue;
      if (key === 'reposters') {
        out.reposters = unionHandles(existing.reposters, value);
        continue;
      }
      if (incoming.stub && key !== 'stub') continue;
      if (key === 'stub') {
        if (existing.stub || value) out.stub = Boolean(existing.stub && value);
        continue;
      }
      if (key === 'text') {
        // Prefer the longest text we have ever seen: an expanded post beats a truncated timeline preview.
        if (typeof value === 'string' && value.length >= (existing.text || '').length) out.text = value;
        continue;
      }
      if (key === 'truncated') {
        out.truncated = Boolean(existing.truncated && value);
        continue;
      }
      // A reply target read from the "Replying to" line beats one inferred from a post page.
      if ((key === 'replyTo' || key === 'isReply' || key === 'replyInferred') && incoming.replyInferred && existing.isReply && !existing.replyInferred) continue;
      out[key] = value;
    }
    if (existing.stub && !incoming.stub) out.stub = false;
    out.firstSeen = Math.min(existing.firstSeen || now, incoming.firstSeen || now);
    out.lastSeen = Math.max(existing.lastSeen || 0, incoming.lastSeen || now);
    out.seenCount = (existing.seenCount || 1) + (incoming.seenCount || 1);
    out.context = existing.context || incoming.context || null;
    return out;
  }

  async function count() {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    return request(tx.objectStore(STORE).count());
  }

  async function getAll() {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    return request(tx.objectStore(STORE).getAll());
  }

  async function get(id) {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    return request(tx.objectStore(STORE).get(String(id)));
  }

  // Upsert a batch. Returns { inserted, updated, total }.
  async function upsertMany(posts) {
    const db = await open();
    const now = Date.now();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let inserted = 0;
    let updated = 0;
    for (const post of posts || []) {
      if (!post || !post.id) continue;
      const id = String(post.id);
      const existing = await request(store.get(id));
      if (existing) updated++; else inserted++;
      store.put(merge(existing, { ...post, id }, now));
    }
    await txDone(tx);
    const total = await count();
    return { inserted, updated, total };
  }

  async function remove(ids) {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids || []) store.delete(String(id));
    await txDone(tx);
    return count();
  }

  async function clear() {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
    return 0;
  }

  root.XPCDB = { open, count, getAll, get, upsertMany, remove, clear, merge };
})(typeof self !== 'undefined' ? self : this);
