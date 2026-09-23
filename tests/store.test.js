import assert from 'node:assert/strict';
import { ProgressStore } from '../lib/store.js';
import { AuthError, ConflictError } from '../lib/github.js';
import { emptyProgress } from '../lib/study.js';

const T = '2026-09-23T10:00:00.000Z';

// In-memory stand-in for GitHub: rejects saves with a stale sha, like the real API.
function fakeApi() {
  const api = {
    remote: { data: emptyProgress(), sha: 's0' },
    saves: [],
    failNext: null,
    async load() { return structuredClone(api.remote); },
    async save(data, sha) {
      await Promise.resolve();
      if (api.failNext) { const err = api.failNext; api.failNext = null; throw err; }
      if (sha !== api.remote.sha) throw new ConflictError('stale');
      api.saves.push(data);
      api.remote = { data: structuredClone(data), sha: `s${api.saves.length}` };
      return api.remote.sha;
    },
  };
  return api;
}

async function loadedStore(api = fakeApi()) {
  const statuses = [];
  const store = new ProgressStore(api, (s) => statuses.push(s));
  await store.load();
  return { api, store, statuses };
}

Deno.test('load fills in a missing direction', async () => {
  const api = fakeApi();
  api.remote.data = { version: 1, 'gr-en': { α: { streak: 1, status: 'learning', lastSeen: T } } };
  const { store } = await loadedStore(api);
  assert.deepEqual(store.data['en-gr'], {});
  assert.equal(store.data['gr-en'].α.streak, 1);
});

Deno.test('record then save writes the answer to GitHub', async () => {
  const { api, store, statuses } = await loadedStore();
  store.record('gr-en', 'α', true, T);
  assert.equal(store.dirty, true);
  await store.save();
  assert.deepEqual(api.remote.data['gr-en'].α, { streak: 1, status: 'learning', lastSeen: T });
  assert.equal(store.sha, 's1');
  assert.equal(store.dirty, false);
  assert.deepEqual(statuses, ['unsaved', 'saving', 'saved']);
});

Deno.test('save without new answers does nothing', async () => {
  const { api, store } = await loadedStore();
  await store.save();
  assert.equal(api.saves.length, 0);
});

Deno.test('answers recorded during a save are saved too', async () => {
  const { api, store } = await loadedStore();
  store.record('gr-en', 'α', true, T);
  const pending = store.save();
  assert.equal(store.save(), pending); // one save at a time
  store.record('gr-en', 'β', false, T);
  await pending;
  assert.equal(api.saves.length, 2);
  assert.deepEqual(Object.keys(api.remote.data['gr-en']).sort(), ['α', 'β']);
  assert.equal(store.dirty, false);
});

Deno.test('a conflict merges the other phone\'s progress and retries', async () => {
  const { api, store } = await loadedStore();
  api.remote = { data: { version: 1, 'gr-en': { γ: { streak: 1, status: 'learning', lastSeen: T } }, 'en-gr': {} }, sha: 'other' };
  store.record('gr-en', 'α', true, T);
  await store.save();
  assert.deepEqual(Object.keys(api.remote.data['gr-en']).sort(), ['α', 'γ']);
  assert.equal(store.sha, api.remote.sha);
});

Deno.test('a failed save keeps the answers and can be retried', async () => {
  const { api, store, statuses } = await loadedStore();
  store.record('gr-en', 'α', true, T);
  api.failNext = new Error('offline');
  await assert.rejects(store.save(), /offline/);
  assert.equal(store.dirty, true);
  assert.equal(statuses.at(-1), 'error');
  await store.save();
  assert.equal(api.remote.data['gr-en'].α.streak, 1);
  assert.equal(statuses.at(-1), 'saved');
});

Deno.test('an auth failure reports the auth status', async () => {
  const { api, store, statuses } = await loadedStore();
  store.record('gr-en', 'α', true, T);
  api.failNext = new AuthError('expired');
  await assert.rejects(store.save(), AuthError);
  assert.equal(statuses.at(-1), 'auth');
});
