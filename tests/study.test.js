import assert from 'node:assert/strict';
import {
  applyAnswer, buildSession, counts, emptyProgress, KNOWN_STREAK, mergeProgress, pickSession, statusOf, wordsWithStatus,
} from '../lib/study.js';

const T = '2026-09-23T10:00:00.000Z';
const word = (basic, index) => ({ basic, index, initial: basic, past: '', future: '', translation: basic, additional: '', etymology: '' });
const WORDS = ['a', 'b', 'c', 'd', 'e', 'f'].map(word);
const PROGRESS = {
  a: { streak: 2, status: 'learning', lastSeen: T },
  b: { streak: 0, status: 'learning', lastSeen: T },
  c: { streak: 3, status: 'known', lastSeen: '2026-09-20T00:00:00.000Z' },
  d: { streak: 4, status: 'known', lastSeen: '2026-09-01T00:00:00.000Z' },
}; // e and f are new

Deno.test('a new word answered right becomes learning with streak 1', () => {
  assert.deepEqual(applyAnswer(undefined, true, T), { streak: 1, status: 'learning', lastSeen: T });
});

Deno.test('two right in a row is still learning, three makes it known', () => {
  assert.equal(KNOWN_STREAK, 3);
  const two = applyAnswer(applyAnswer(undefined, true, T), true, T);
  assert.equal(two.status, 'learning');
  assert.deepEqual(applyAnswer(two, true, T), { streak: 3, status: 'known', lastSeen: T });
});

Deno.test('a miss resets the streak and sends a known word back to learning', () => {
  assert.deepEqual(applyAnswer({ streak: 5, status: 'known', lastSeen: 'old' }, false, T), { streak: 0, status: 'learning', lastSeen: T });
  assert.deepEqual(applyAnswer(undefined, false, T), { streak: 0, status: 'learning', lastSeen: T });
});

Deno.test('counts ignore progress for words no longer in the CSV', () => {
  const extra = { ...PROGRESS, gone: { streak: 3, status: 'known', lastSeen: T } };
  assert.deepEqual(counts(WORDS, extra), { known: 2, learning: 2, new: 2 });
});

// random() → 0.999 leaves a Fisher-Yates shuffle in file order (e, f); newest-first would give (f, e).
const KEEP_ORDER = () => 0.999;
const basics = (words) => words.map((w) => w.basic);

Deno.test('pickSession: learning (lowest streak) → new (random) → known (oldest seen)', () => {
  assert.deepEqual(basics(pickSession(WORDS, PROGRESS, 10, { random: KEEP_ORDER })), ['b', 'a', 'e', 'f', 'd', 'c']);
  assert.deepEqual(basics(pickSession(WORDS, PROGRESS, 10, { random: () => 0 })), ['b', 'a', 'f', 'e', 'd', 'c']);
});

Deno.test('pickSession stops at the session size', () => {
  assert.deepEqual(basics(pickSession(WORDS, PROGRESS, 3, { random: KEEP_ORDER })), ['b', 'a', 'e']);
});

Deno.test('pickSession moves avoided words to the back of each pile', () => {
  const avoid = new Set(['b', 'e', 'd']);
  assert.deepEqual(basics(pickSession(WORDS, PROGRESS, 10, { random: KEEP_ORDER, avoid })), ['a', 'b', 'f', 'e', 'c', 'd']);
});

Deno.test('pickSession keeps learning words that fit even when avoided', () => {
  const avoid = new Set(['a', 'b', 'e']);
  assert.deepEqual(basics(pickSession(WORDS, PROGRESS, 3, { random: KEEP_ORDER, avoid })), ['b', 'a', 'f']);
});

Deno.test('buildSession shuffles the picked words', () => {
  const session = buildSession(WORDS, PROGRESS, 3, { random: () => 0 });
  assert.deepEqual(session.map((w) => w.basic).sort(), ['a', 'b', 'f']);
  assert.notDeepEqual(session.map((w) => w.basic), ['b', 'a', 'f']);
});

Deno.test('mergeProgress keeps the later answer per word and direction', () => {
  const a = { version: 1, 'gr-en': {
    x: { streak: 1, status: 'learning', lastSeen: '2026-09-23T10:00:00Z' },
    y: { streak: 1, status: 'learning', lastSeen: '2026-09-23T09:00:00Z' },
  }, 'en-gr': {} };
  const b = { version: 1, 'gr-en': {
    y: { streak: 2, status: 'learning', lastSeen: '2026-09-23T11:00:00Z' },
    z: { streak: 1, status: 'learning', lastSeen: T },
  }, 'en-gr': { q: { streak: 3, status: 'known', lastSeen: T } } };
  const merged = mergeProgress(a, b);
  assert.equal(merged['gr-en'].x, a['gr-en'].x);
  assert.equal(merged['gr-en'].y, b['gr-en'].y);
  assert.equal(merged['gr-en'].z, b['gr-en'].z);
  assert.equal(merged['en-gr'].q, b['en-gr'].q);
});

Deno.test('mergeProgress: first argument wins ties, missing directions are fine', () => {
  const mine = { streak: 1, status: 'learning', lastSeen: T };
  const theirs = { streak: 0, status: 'learning', lastSeen: T };
  assert.equal(mergeProgress({ 'gr-en': { x: mine } }, { 'gr-en': { x: theirs } })['gr-en'].x, mine);
  assert.deepEqual(mergeProgress(emptyProgress(), {}), emptyProgress());
});

Deno.test('wordsWithStatus lists one pile, ignoring progress for removed words', () => {
  const extra = { ...PROGRESS, gone: { streak: 3, status: 'known', lastSeen: T } };
  assert.deepEqual(basics(wordsWithStatus(WORDS, extra, 'known')), ['c', 'd']);
  assert.deepEqual(basics(wordsWithStatus(WORDS, extra, 'learning')), ['a', 'b']);
  assert.deepEqual(basics(wordsWithStatus(WORDS, extra, 'new')), ['e', 'f']);
});

Deno.test('wordsWithStatus sorts in Greek alphabetical order, accents included', () => {
  const greek = ['γάτα', 'άνθρωπος', 'βάρκα', 'αγορά'].map(word);
  assert.deepEqual(basics(wordsWithStatus(greek, {}, 'new')), ['αγορά', 'άνθρωπος', 'βάρκα', 'γάτα']);
});

Deno.test('statusOf: no entry is new, known stays known, anything else is learning', () => {
  assert.equal(statusOf(undefined), 'new');
  assert.equal(statusOf(PROGRESS.c), 'known');
  assert.equal(statusOf(PROGRESS.a), 'learning');
});
