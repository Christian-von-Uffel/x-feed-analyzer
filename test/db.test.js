// test/db.test.js — checks for the merge rule in db.js (what a fresh sighting does to a stored post).
//   node test/db.test.js
const assert = require('assert');
globalThis.self = globalThis;
require('../db.js');
const { merge } = self.XPCDB;
const now = 1000;

const stub = { id: '1', url: 'https://x.com/alice/status/1', handle: 'alice', reposters: ['bob', 'Carol'], stub: true, context: '/alice/status/1/retweets' };
const full = { id: '1', url: 'https://x.com/alice/status/1', handle: 'alice', name: 'Alice', text: 'hello', time: '2026-09-01T00:00:00.000Z', isRepost: false, repostedBy: null, context: '/home' };

// A stub on its own is stored as is.
const s1 = merge(null, stub, now);
assert.strictEqual(s1.stub, true);
assert.deepStrictEqual(s1.reposters, ['bob', 'Carol']);

// A later real sighting fills it in and clears the flag; the reposters survive.
const s2 = merge(s1, full, 2000);
assert.strictEqual(s2.stub, false);
assert.strictEqual(s2.text, 'hello');
assert.deepStrictEqual(s2.reposters, ['bob', 'Carol']);
assert.strictEqual(s2.firstSeen, now);

// A stub arriving after a real sighting only grows the reposter list (case-insensitive union), nothing else.
const s3 = merge({ ...s2, name: 'Alice Chen', handle: 'Alice' }, { ...stub, handle: 'alice', reposters: ['carol', 'dave'] }, 3000);
assert.strictEqual(s3.stub, false);
assert.strictEqual(s3.name, 'Alice Chen');
assert.strictEqual(s3.handle, 'Alice', 'a stub never overwrites the author spelling');
assert.strictEqual(s3.text, 'hello');
assert.deepStrictEqual(s3.reposters, ['bob', 'Carol', 'dave']);
assert.strictEqual(s3.seenCount, 3);

// Two stubs union.
assert.deepStrictEqual(merge(s1, { ...stub, reposters: ['erin'] }, now).reposters, ['bob', 'Carol', 'erin']);

// A full record without reposters leaves an existing list alone.
assert.deepStrictEqual(merge(s3, full, 4000).reposters, ['bob', 'Carol', 'dave']);

console.log('db.test.js ok');
