// test/shim.js — minimal stand-in for the chrome.* extension APIs so content.js and
// viewer.html can be exercised on a plain web page (see test/fixture.html).
// Not loaded by the real extension.
(() => {
  if (window.chrome && window.chrome.storage) return;
  const listeners = [];
  const KEY = 'xpc-shim-storage';
  const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const writeAll = (obj) => localStorage.setItem(KEY, JSON.stringify(obj));

  const storage = {
    local: {
      get(defaults, cb) {
        const all = readAll();
        const out = {};
        if (typeof defaults === 'string') out[defaults] = all[defaults];
        else if (Array.isArray(defaults)) defaults.forEach((k) => { out[k] = all[k]; });
        else for (const k of Object.keys(defaults || {})) out[k] = k in all ? all[k] : defaults[k];
        setTimeout(() => cb && cb(out), 0);
      },
      set(obj, cb) {
        const all = readAll();
        const changes = {};
        for (const k of Object.keys(obj)) { changes[k] = { oldValue: all[k], newValue: obj[k] }; all[k] = obj[k]; }
        writeAll(all);
        setTimeout(() => { listeners.forEach((fn) => fn(changes, 'local')); cb && cb(); }, 0);
      },
    },
    onChanged: { addListener(fn) { listeners.push(fn); } },
  };

  const runtime = {
    id: 'shim',
    lastError: undefined,
    getURL: (p) => p,
    onMessage: { addListener() {} },
    sendMessage(message, cb) {
      const respond = (r) => setTimeout(() => cb && cb(r), 0);
      const db = window.XPCDB;
      if (!db) { respond({ ok: false, error: 'db.js not loaded' }); return; }
      switch (message && message.type) {
        case 'upsert':
          db.upsertMany(message.posts || []).then((r) => { window.__shimLastUpsert = r; respond({ ok: true, ...r }); });
          break;
        case 'count':
          db.count().then((total) => respond({ ok: true, total }));
          break;
        case 'openViewer':
          window.open('../viewer.html' + (message.hash ? '#' + String(message.hash).replace(/[^a-z]/gi, '') : ''), '_blank');
          respond({ ok: true });
          break;
        default:
          respond({ ok: true });
      }
    },
  };

  window.chrome = Object.assign(window.chrome || {}, { storage, runtime });
})();
