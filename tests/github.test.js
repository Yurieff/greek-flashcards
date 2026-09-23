import assert from 'node:assert/strict';
import {
  AuthError, ConflictError, decodeBase64, encodeBase64, loadProgress, loadVocab, saveProgress,
} from '../lib/github.js';

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

Deno.test('base64 round-trips Greek text as UTF-8', () => {
  assert.equal(encodeBase64('ά'), 'zqw=');
  const text = JSON.stringify({ 'ο ξεναγός': { streak: 1 } });
  assert.equal(decodeBase64(encodeBase64(text)), text);
  assert.equal(decodeBase64('zq\nw='), 'ά'); // GitHub wraps base64 with newlines
});

Deno.test('loadVocab returns the raw CSV text', () => withFetch(
  () => new Response('header\nrow\n'),
  async (calls) => {
    assert.equal(await loadVocab('tok'), 'header\nrow\n');
    assert.match(calls[0].url, /\/repos\/Yurieff\/greek-flashcards\/contents\/vocab\.csv\?ref=main$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw');
  },
));

Deno.test('loadVocab: 404 means the token cannot see the repo', () => withFetch(
  () => new Response('Not Found', { status: 404 }),
  () => assert.rejects(loadVocab('tok'), AuthError),
));

Deno.test('401 is an AuthError, but a rate-limit 403 is not', async () => {
  await withFetch(() => new Response('', { status: 401 }), () => assert.rejects(loadVocab('tok'), AuthError));
  await withFetch(
    () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    () => assert.rejects(loadVocab('tok'), (err) => !(err instanceof AuthError) && /rate limit/.test(err.message)),
  );
});

Deno.test('loadProgress decodes the file and returns its sha', () => withFetch(
  () => Response.json({ sha: 'abc', content: encodeBase64('{"version":1,"gr-en":{"α":{"streak":1}},"en-gr":{}}') }),
  async (calls) => {
    const { data, sha } = await loadProgress('tok');
    assert.equal(sha, 'abc');
    assert.equal(data['gr-en']['α'].streak, 1);
    assert.match(calls[0].url, /progress\.json\?ref=progress$/);
  },
));

Deno.test('loadProgress: missing file means empty progress', () => withFetch(
  () => new Response('', { status: 404 }),
  async () => assert.deepEqual(await loadProgress('tok'), { data: { version: 1, 'gr-en': {}, 'en-gr': {} }, sha: null }),
));

Deno.test('saveProgress PUTs to the progress branch with the sha', () => withFetch(
  () => Response.json({ content: { sha: 'new' } }),
  async (calls) => {
    const data = { version: 1, 'gr-en': { 'ο ξεναγός': { streak: 1 } }, 'en-gr': {} };
    assert.equal(await saveProgress('tok', data, 'old'), 'new');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(calls[0].init.method, 'PUT');
    assert.equal(body.branch, 'progress');
    assert.equal(body.sha, 'old');
    assert.deepEqual(JSON.parse(decodeBase64(body.content)), data);
  },
));

Deno.test('saveProgress: 409 is a ConflictError', () => withFetch(
  () => new Response('', { status: 409 }),
  () => assert.rejects(saveProgress('tok', {}, 'old'), ConflictError),
));
