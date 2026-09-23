# Greek Flashcards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile flashcard page on GitHub Pages that studies the grvocab CSV in both directions and stores progress in the same GitHub repo.

**Architecture:** Static site (plain HTML/CSS/ES modules, no build) on the `main` branch of public repo `Yurieff/greek-flashcards`. The page reads `vocab.csv` and reads/writes `progress.json` (on branch `progress`) through the GitHub contents API with a per-phone fine-grained token. Pure logic lives in `lib/` and is unit-tested with Deno; `app.js` only wires the DOM. `sync.sh` publishes the Dropbox CSV; grvocab calls it.

**Tech Stack:** Vanilla JS (ES modules), CSS, Deno 2.8 test runner with `node:assert/strict` (no downloads), bash, `gh` CLI, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-23-greek-flashcards-design.md`

## Global Constraints

- No build step, no npm/jsr dependencies. Browser code is plain ES modules loaded with relative paths.
- Repo: `Yurieff/greek-flashcards`, public. Pages serves `main` branch root. Page URL: `https://yurieff.github.io/greek-flashcards/`.
- Progress: file `progress.json` on branch `progress`, format `{ "version": 1, "gr-en": {…}, "en-gr": {…} }`, keyed by `basic form`.
- Source CSV: `/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Greek/Εξετάσεις/Claude-gr/greek_vocab.csv` → copied to `vocab.csv` in the repo. Only `vocab.csv` is committed.
- Known after **3** correct answers in a row (`KNOWN_STREAK = 3`).
- Session sizes 10 / 20 / 50, default 20. A missed card is re-inserted with 3–5 cards in between.
- Save every 5 answers, at session end, on `visibilitychange` → hidden; retry every 30 s.
- Only `gf-token`, `gf-direction`, `gf-size` go into `localStorage`. All `localStorage` access is wrapped in try/catch.
- All CSV-derived text is inserted with `textContent`, never `innerHTML`.
- Run all tests with: `deno test --allow-read tests/` from the repo root.
- UI copy is English.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Unquoted comma in the last column** (real row `ο βοριάς`: `Βορέας (Boreas, god of the North Wind)`) → the row is kept and the extra field is joined back into etymology, not skipped. Pinned in Task 1.
2. **A quote in the middle of an unquoted field** (real row `οπωσδήποτε`: `→ "in whatever way ever"`) → the quote is literal and doesn't swallow the rest of the file. Pinned in Task 1.
3. **Answers made while a save is in flight** → saved by a follow-up save, never lost. Pinned in Task 4.
4. **Greek text through base64** (`btoa` throws on non-Latin-1) → progress with Greek keys round-trips via UTF-8. Pinned in Task 4.
5. **A token that can't see the repo** (GitHub answers 404, not 401) → shown as "token rejected", not a cryptic "HTTP 404". Pinned in Task 4.

---

### Task 1: Project scaffold and CSV parser

**Files:**
- Create: `.gitignore`, `.nojekyll`, `vocab.csv` (copy), `lib/csv.js`
- Test: `tests/csv.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text: string) => { words: Word[], skipped: number }` where `Word = { initial, basic, past, future, translation, additional, etymology: string, index: number }`. `index` is 0-based among kept rows, in file order (higher = newer).

- [ ] **Step 1: Scaffold files**

```bash
cd /Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Claude-code-projects/Coding-projects/greek-flashcards
mkdir -p lib tests
printf '.DS_Store\n' > .gitignore
touch .nojekyll
cp "/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Greek/Εξετάσεις/Claude-gr/greek_vocab.csv" vocab.csv
```

- [ ] **Step 2: Write the failing tests** — `tests/csv.test.js`

```js
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv.js';

const HEADER = 'initial word,basic form,past simple,future simple,translation,additional meaning,etymology\n';

Deno.test('parses a row into a Word', () => {
  const { words, skipped } = parseCsv(HEADER + 'ξεναγό,ο ξεναγός,,,tour guide,guide,ξένος (stranger) + άγω (to lead)\n');
  assert.equal(skipped, 0);
  assert.deepEqual(words, [{
    initial: 'ξεναγό', basic: 'ο ξεναγός', past: '', future: '', translation: 'tour guide',
    additional: 'guide', etymology: 'ξένος (stranger) + άγω (to lead)', index: 0,
  }]);
});

Deno.test('quoted field keeps commas and escaped quotes', () => {
  const { words } = parseCsv(HEADER + 'a,α,,,x,"alcohol, spirit","say ""hi"""\n');
  assert.equal(words[0].additional, 'alcohol, spirit');
  assert.equal(words[0].etymology, 'say "hi"');
});

Deno.test('quote in the middle of an unquoted field is literal', () => {
  const { words, skipped } = parseCsv(HEADER + 'a,α,,,definitely,x,ποτε (ever) → "in whatever way ever"\nb,β,,,two,,\n');
  assert.equal(skipped, 0);
  assert.equal(words[0].etymology, 'ποτε (ever) → "in whatever way ever"');
  assert.equal(words[1].basic, 'β');
});

Deno.test('extra fields are joined back into etymology', () => {
  const { words, skipped } = parseCsv(HEADER + 'βοριά,ο βοριάς,,,north wind,cold north wind,Βορέας (Boreas, god of the North Wind)\n');
  assert.equal(skipped, 0);
  assert.equal(words[0].etymology, 'Βορέας (Boreas, god of the North Wind)');
});

Deno.test('handles BOM, CRLF and a missing trailing newline', () => {
  const { words } = parseCsv('\uFEFF' + HEADER.replace('\n', '\r\n') + 'a,α,,,one,,\r\nb,β,,,two,,');
  assert.deepEqual(words.map((w) => [w.basic, w.translation, w.index]), [['α', 'one', 0], ['β', 'two', 1]]);
});

Deno.test('skips short rows, empty basic form, empty translation; ignores blank lines', () => {
  const { words, skipped } = parseCsv(HEADER + 'a,α,,,one\n\n,,,,x,,\nb,β,,,,,\nc,γ,,,three,,\n');
  assert.deepEqual(words.map((w) => [w.basic, w.index]), [['γ', 0]]);
  assert.equal(skipped, 3);
});

Deno.test('a repeated basic form keeps the first row', () => {
  const { words, skipped } = parseCsv(HEADER + 'a,α,,,first,,\nb,α,,,second,,\n');
  assert.deepEqual(words.map((w) => w.translation), ['first']);
  assert.equal(skipped, 1);
});

Deno.test('empty input and header-only input give no words', () => {
  assert.deepEqual(parseCsv(''), { words: [], skipped: 0 });
  assert.deepEqual(parseCsv(HEADER), { words: [], skipped: 0 });
});

Deno.test('the real vocab.csv parses cleanly', async () => {
  const text = await Deno.readTextFile(new URL('../vocab.csv', import.meta.url));
  const { words, skipped } = parseCsv(text);
  assert.equal(skipped, 0);
  assert.equal(words.length, text.split('\n').filter((l) => l.trim()).length - 1);
  assert.equal(words.find((w) => w.basic === 'ο βοριάς').etymology, 'Βορέας (Boreas, god of the North Wind)');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test --allow-read tests/csv.test.js`
Expected: FAIL — module `../lib/csv.js` not found.

- [ ] **Step 4: Implement** — `lib/csv.js`

```js
// Parser for the grvocab CSV. Lenient where the real data needs it:
// a quote only opens a quoted field at the start of a field, and extra
// fields (an unquoted comma in the last column) are joined into etymology.
const COLUMNS = 7;

function splitRecords(text) {
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (c === ',') {
      fields.push(field);
      field = '';
      atFieldStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      records.push(fields);
      fields = [];
      field = '';
      atFieldStart = true;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (field !== '' || fields.length) {
    fields.push(field);
    records.push(fields);
  }
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function parseCsv(text) {
  const [, ...rows] = splitRecords(text.replace(/^\uFEFF/, ''));
  const words = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of rows) {
    const fields = row.length > COLUMNS
      ? [...row.slice(0, COLUMNS - 1), row.slice(COLUMNS - 1).join(',')]
      : row;
    const [initial, basic, past, future, translation, additional, etymology] = fields.map((f) => f.trim());
    if (fields.length < COLUMNS || !basic || !translation || seen.has(basic)) {
      skipped++;
      continue;
    }
    seen.add(basic);
    words.push({ initial, basic, past, future, translation, additional, etymology, index: words.length });
  }
  return { words, skipped };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --allow-read tests/csv.test.js`
Expected: PASS, 9 passed.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .nojekyll vocab.csv lib/csv.js tests/csv.test.js
git commit -m "Add CSV parser and vocab copy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Study logic (card states, session picking, merge)

**Files:**
- Create: `lib/study.js`
- Test: `tests/study.test.js`

**Interfaces:**
- Consumes: `Word` from Task 1 (uses `basic`, `index`).
- Produces:
  - `KNOWN_STREAK = 3`, `DIRECTIONS = ['gr-en', 'en-gr']`
  - `emptyProgress() => { version: 1, 'gr-en': {}, 'en-gr': {} }`
  - `applyAnswer(entry | undefined, correct: boolean, now: string) => { streak, status: 'learning'|'known', lastSeen }`
  - `counts(words, dirProgress) => { known, learning, new }`
  - `pickSession(words, dirProgress, size) => Word[]` (priority order, not shuffled)
  - `shuffle(items, random = Math.random) => new array`
  - `buildSession(words, dirProgress, size, random = Math.random) => Word[]`
  - `mergeProgress(a, b) => progress` (later `lastSeen` wins; `a` wins ties; missing directions tolerated)

- [ ] **Step 1: Write the failing tests** — `tests/study.test.js`

```js
import assert from 'node:assert/strict';
import {
  applyAnswer, buildSession, counts, emptyProgress, KNOWN_STREAK, mergeProgress, pickSession,
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

Deno.test('pickSession: learning (lowest streak) → new (newest) → known (oldest seen)', () => {
  assert.deepEqual(pickSession(WORDS, PROGRESS, 10).map((w) => w.basic), ['b', 'a', 'f', 'e', 'd', 'c']);
});

Deno.test('pickSession stops at the session size', () => {
  assert.deepEqual(pickSession(WORDS, PROGRESS, 3).map((w) => w.basic), ['b', 'a', 'f']);
});

Deno.test('buildSession shuffles the picked words', () => {
  const session = buildSession(WORDS, PROGRESS, 3, () => 0);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read tests/study.test.js`
Expected: FAIL — module `../lib/study.js` not found.

- [ ] **Step 3: Implement** — `lib/study.js`

```js
// Card states and session building. A direction's progress maps
// basic form -> { streak, status: 'learning' | 'known', lastSeen }.
// A word without an entry is new.
export const KNOWN_STREAK = 3;
export const DIRECTIONS = ['gr-en', 'en-gr'];

export function emptyProgress() {
  return { version: 1, 'gr-en': {}, 'en-gr': {} };
}

export function applyAnswer(entry, correct, now) {
  const streak = correct ? (entry?.streak ?? 0) + 1 : 0;
  return { streak, status: streak >= KNOWN_STREAK ? 'known' : 'learning', lastSeen: now };
}

function statusOf(entry) {
  if (!entry) return 'new';
  return entry.status === 'known' ? 'known' : 'learning';
}

export function counts(words, dirProgress) {
  const result = { known: 0, learning: 0, new: 0 };
  for (const word of words) result[statusOf(dirProgress[word.basic])]++;
  return result;
}

export function pickSession(words, dirProgress, size) {
  const piles = { learning: [], new: [], known: [] };
  for (const word of words) piles[statusOf(dirProgress[word.basic])].push(word);
  const entry = (word) => dirProgress[word.basic];
  piles.learning.sort((a, b) => entry(a).streak - entry(b).streak);
  piles.new.sort((a, b) => b.index - a.index);
  piles.known.sort((a, b) => String(entry(a).lastSeen).localeCompare(String(entry(b).lastSeen)));
  return [...piles.learning, ...piles.new, ...piles.known].slice(0, size);
}

export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildSession(words, dirProgress, size, random = Math.random) {
  return shuffle(pickSession(words, dirProgress, size), random);
}

export function mergeProgress(a, b) {
  const merged = emptyProgress();
  for (const direction of DIRECTIONS) {
    const left = a?.[direction] ?? {};
    const right = b?.[direction] ?? {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const x = left[key];
      const y = right[key];
      merged[direction][key] = !x ? y : !y ? x : y.lastSeen > x.lastSeen ? y : x;
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read tests/study.test.js`
Expected: PASS, 9 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/study.js tests/study.test.js
git commit -m "Add card state, session picking and progress merge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Session queue

**Files:**
- Create: `lib/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `Word[]` (only `basic` is read).
- Produces: `class Session(words, random = Math.random)` with `current: Word | undefined`, `finished: boolean`, `total: number`, `cleared: number`, `answer(correct: boolean): void`, `summary() => { total, firstTry, missed }`.

- [ ] **Step 1: Write the failing tests** — `tests/session.test.js`

```js
import assert from 'node:assert/strict';
import { Session } from '../lib/session.js';

const words = (...names) => names.map((basic) => ({ basic }));
const order = (s) => s.queue.map((w) => w.basic);

Deno.test('right answers walk through the queue', () => {
  const s = new Session(words('a', 'b'));
  assert.equal(s.current.basic, 'a');
  s.answer(true);
  assert.equal(s.cleared, 1);
  s.answer(true);
  assert.equal(s.finished, true);
  assert.deepEqual(s.summary(), { total: 2, firstTry: 2, missed: 0 });
});

Deno.test('a missed card comes back with 3 to 5 cards in between', () => {
  const low = new Session(words('a', 'b', 'c', 'd', 'e', 'f', 'g'), () => 0);
  low.answer(false);
  assert.deepEqual(order(low), ['b', 'c', 'd', 'a', 'e', 'f', 'g']);
  const high = new Session(words('a', 'b', 'c', 'd', 'e', 'f', 'g'), () => 0.999);
  high.answer(false);
  assert.deepEqual(order(high), ['b', 'c', 'd', 'e', 'f', 'a', 'g']);
});

Deno.test('near the end a missed card goes to the back', () => {
  const s = new Session(words('a', 'b'), () => 0);
  s.answer(false);
  assert.deepEqual(order(s), ['b', 'a']);
});

Deno.test('the last card missed stays until answered right', () => {
  const s = new Session(words('a'));
  s.answer(false);
  assert.equal(s.finished, false);
  assert.equal(s.current.basic, 'a');
  s.answer(true);
  assert.equal(s.finished, true);
});

Deno.test('summary counts a word missed twice once', () => {
  const s = new Session(words('a', 'b'), () => 0);
  s.answer(false); // a -> [b, a]
  s.answer(true);  // b
  s.answer(false); // a -> [a]
  s.answer(true);  // a
  assert.deepEqual(s.summary(), { total: 2, firstTry: 1, missed: 1 });
});

Deno.test('an empty session is finished at once', () => {
  assert.equal(new Session([]).finished, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read tests/session.test.js`
Expected: FAIL — module `../lib/session.js` not found.

- [ ] **Step 3: Implement** — `lib/session.js`

```js
// One study round. A missed card is re-inserted a few cards later and
// must be answered right once before the round ends.
export class Session {
  constructor(words, random = Math.random) {
    this.queue = [...words];
    this.total = words.length;
    this.cleared = 0;
    this.missed = new Set();
    this.random = random;
  }

  get current() {
    return this.queue[0];
  }

  get finished() {
    return this.queue.length === 0;
  }

  answer(correct) {
    const word = this.queue.shift();
    if (correct) {
      this.cleared++;
      return;
    }
    this.missed.add(word.basic);
    const gap = 3 + Math.floor(this.random() * 3); // 3..5 cards in between
    this.queue.splice(Math.min(gap, this.queue.length), 0, word);
  }

  summary() {
    return { total: this.total, firstTry: this.total - this.missed.size, missed: this.missed.size };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read tests/session.test.js`
Expected: PASS, 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/session.js tests/session.test.js
git commit -m "Add session queue

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: GitHub client and ProgressStore

**Files:**
- Create: `lib/github.js`, `lib/store.js`
- Test: `tests/github.test.js`, `tests/store.test.js`

**Interfaces:**
- Consumes: `emptyProgress`, `applyAnswer`, `mergeProgress` from Task 2.
- Produces:
  - `github.js`: `AuthError`, `ConflictError` (both `extends Error`), `encodeBase64(text)`, `decodeBase64(base64)`, `loadVocab(token) => Promise<string>`, `loadProgress(token) => Promise<{ data, sha }>`, `saveProgress(token, data, sha) => Promise<newSha>`.
  - `store.js`: `class ProgressStore(api: { load(): Promise<{data, sha}>, save(data, sha): Promise<sha> }, onStatus = (status) => {})` with `data`, `sha`, `dirty`, `load(): Promise<void>`, `record(direction, basic, correct, now = new Date().toISOString())`, `save(): Promise<void>`. Status values: `'unsaved' | 'saving' | 'saved' | 'error' | 'auth'`.

- [ ] **Step 1: Write the failing tests** — `tests/github.test.js`

```js
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
```

- [ ] **Step 2: Write the failing tests** — `tests/store.test.js`

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test --allow-read tests/github.test.js tests/store.test.js`
Expected: FAIL — modules `../lib/github.js` and `../lib/store.js` not found.

- [ ] **Step 4: Implement** — `lib/github.js`

```js
// GitHub REST contents API: vocab.csv on main, progress.json on the progress branch.
import { emptyProgress } from './study.js';

const API = 'https://api.github.com/repos/Yurieff/greek-flashcards/contents';

export class AuthError extends Error {}
export class ConflictError extends Error {}

export function encodeBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function request(token, path, { headers = {}, ...init } = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...headers },
  });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub rate limit reached, try again later');
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Token rejected: it is wrong, expired, or lacks access to greek-flashcards.');
  }
  return res;
}

export async function loadVocab(token) {
  const res = await request(token, 'vocab.csv?ref=main', { headers: { Accept: 'application/vnd.github.raw' } });
  // vocab.csv always exists, so a 404 means the token cannot see the repo.
  if (res.status === 404) throw new AuthError('Token cannot see the greek-flashcards repo. Check its repository access.');
  if (!res.ok) throw new Error(`Could not load vocab.csv (HTTP ${res.status})`);
  return res.text();
}

export async function loadProgress(token) {
  const res = await request(token, 'progress.json?ref=progress', { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { data: emptyProgress(), sha: null };
  if (!res.ok) throw new Error(`Could not load progress (HTTP ${res.status})`);
  const body = await res.json();
  return { data: JSON.parse(decodeBase64(body.content)), sha: body.sha };
}

export async function saveProgress(token, data, sha) {
  const res = await request(token, 'progress.json', {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Progress update',
      branch: 'progress',
      content: encodeBase64(JSON.stringify(data, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) throw new ConflictError('Progress changed on another device');
  if (!res.ok) throw new Error(`Could not save progress (HTTP ${res.status})`);
  return (await res.json()).content.sha;
}
```

- [ ] **Step 5: Implement** — `lib/store.js`

```js
// Progress kept in memory and saved one request at a time. Answers made
// during a save trigger another save; a conflict merges and retries once.
import { applyAnswer, emptyProgress, mergeProgress } from './study.js';
import { AuthError, ConflictError } from './github.js';

export class ProgressStore {
  #saving = null;

  constructor(api, onStatus = () => {}) {
    this.api = api;
    this.onStatus = onStatus;
    this.data = emptyProgress();
    this.sha = null;
    this.dirty = false;
  }

  async load() {
    const { data, sha } = await this.api.load();
    this.data = mergeProgress(emptyProgress(), data);
    this.sha = sha;
  }

  record(direction, basic, correct, now = new Date().toISOString()) {
    this.data[direction][basic] = applyAnswer(this.data[direction][basic], correct, now);
    this.dirty = true;
    this.onStatus('unsaved');
  }

  save() {
    if (!this.#saving && this.dirty) {
      this.#saving = this.#flush().finally(() => { this.#saving = null; });
    }
    return this.#saving ?? Promise.resolve();
  }

  async #flush() {
    this.onStatus('saving');
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          this.sha = await this.api.save(structuredClone(this.data), this.sha);
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err;
          const remote = await this.api.load();
          this.data = mergeProgress(this.data, remote.data);
          this.sha = await this.api.save(structuredClone(this.data), remote.sha);
        }
      }
      this.onStatus('saved');
    } catch (err) {
      this.dirty = true;
      this.onStatus(err instanceof AuthError ? 'auth' : 'error');
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `deno test --allow-read tests/`
Expected: PASS, all tests (csv 9, study 9, session 6, github 8, store 7 = 39).

- [ ] **Step 7: Commit**

```bash
git add lib/github.js lib/store.js tests/github.test.js tests/store.test.js
git commit -m "Add GitHub client and progress store

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: sync.sh, publish to GitHub, live API smoke test

**Files:**
- Create: `sync.sh`
- External: GitHub repo `Yurieff/greek-flashcards`, branch `progress`, Pages site.

**Interfaces:**
- Consumes: `loadVocab`, `loadProgress`, `saveProgress`, `ConflictError` from Task 4.
- Produces: live repo + Pages URL `https://yurieff.github.io/greek-flashcards/`; `sync.sh` (no args) used by grvocab in Task 7.

- [ ] **Step 1: Write `sync.sh`**

```bash
#!/usr/bin/env bash
# Publish the grvocab CSV: copy it into this repo, commit if it changed, push.
set -euo pipefail

SRC="/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Greek/Εξετάσεις/Claude-gr/greek_vocab.csv"
cd "$(dirname "$0")"

cp "$SRC" vocab.csv
if git diff --quiet -- vocab.csv; then
  echo "vocab.csv already up to date"
else
  words=$(( $(grep -c . vocab.csv) - 1 ))
  git add vocab.csv
  git commit -q -m "Update vocab: $words words" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- vocab.csv
  echo "Committed: $words words"
fi
git push -q origin main
echo "Pushed to GitHub"
```

Then: `chmod +x sync.sh && git add sync.sh && git commit -m "Add sync script" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

- [ ] **Step 2: Create the public repo and push main**

```bash
gh repo create Yurieff/greek-flashcards --public --source=. --remote=origin --push \
  --description "Greek vocabulary flashcards"
```
Expected: repo URL printed, `main` pushed.

- [ ] **Step 3: Create the `progress` branch with an empty progress.json (no local checkout)**

```bash
blob=$(printf '{"version":1,"gr-en":{},"en-gr":{}}\n' | git hash-object -w --stdin)
tree=$(printf '100644 blob %s\tprogress.json\n' "$blob" | git mktree)
commit=$(git commit-tree "$tree" -m "Initialize progress" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>")
git push origin "$commit:refs/heads/progress"
```
Expected: `* [new branch] ... -> progress`.

- [ ] **Step 4: Enable GitHub Pages on main**

```bash
gh api -X POST repos/Yurieff/greek-flashcards/pages -f 'source[branch]=main' -f 'source[path]=/'
gh api repos/Yurieff/greek-flashcards/pages --jq .html_url
```
Expected: `https://yurieff.github.io/greek-flashcards/`

- [ ] **Step 5: Live smoke test of lib/github.js** (script in the session scratchpad, not the repo; uses the Mac's `gh` token only against api.github.com)

Write `$SCRATCH/smoke.js` (`$SCRATCH` = the session scratchpad directory):

```js
import { ConflictError, loadProgress, loadVocab, saveProgress } from 'file:///Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Claude-code-projects/Coding-projects/greek-flashcards/lib/github.js';

const token = Deno.env.get('GH_TOKEN');
const csv = await loadVocab(token);
console.log('vocab lines:', csv.split('\n').filter(Boolean).length);
const { data, sha } = await loadProgress(token);
console.log('progress sha:', sha);
data['gr-en'].__smoke__ = { streak: 0, status: 'learning', lastSeen: new Date().toISOString() };
const sha2 = await saveProgress(token, data, sha);
try { await saveProgress(token, data, sha); console.log('ERROR: stale sha accepted'); }
catch (err) { console.log('stale sha rejected:', err instanceof ConflictError); }
delete data['gr-en'].__smoke__;
await saveProgress(token, data, sha2);
console.log('restored:', JSON.stringify((await loadProgress(token)).data));
```

Run: `GH_TOKEN=$(gh auth token) deno run --allow-net=api.github.com --allow-env=GH_TOKEN "$SCRATCH/smoke.js"`
Expected: `vocab lines: 290` (or current count), a sha, `stale sha rejected: true`, `restored: {"version":1,"gr-en":{},"en-gr":{}}`.

- [ ] **Step 6: Verify sync.sh no-change path**

Run: `./sync.sh`
Expected: `vocab.csv already up to date` then `Pushed to GitHub`.

---

### Task 6: The page (HTML, CSS, app wiring)

**Files:**
- Create: `index.html`, `style.css`, `app.js`

**Interfaces:**
- Consumes: `parseCsv` (Task 1); `buildSession`, `counts` (Task 2); `Session` (Task 3); `AuthError`, `loadVocab`, `loadProgress`, `saveProgress` (Task 4); `ProgressStore` (Task 4).
- Produces: the user-facing page.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Greek Flashcards</title>
  <link rel="stylesheet" href="style.css">
  <script type="module" src="app.js"></script>
</head>
<body>
  <span id="save-badge" class="badge" hidden></span>
  <main>
    <section id="screen-loading" class="screen centered">
      <p id="loading-text" class="muted">Loading…</p>
      <button id="retry" hidden>Retry</button>
    </section>

    <section id="screen-token" class="screen" hidden>
      <h1>Greek Flashcards</h1>
      <p>Paste your GitHub token to connect this phone.</p>
      <input id="token-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…">
      <button id="token-save" class="primary">Save</button>
      <p id="token-error" class="error" hidden></p>
      <details>
        <summary>How to create a token</summary>
        <ol>
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.</li>
          <li>Name: <code>greek-flashcards</code>. Expiration: 1 year.</li>
          <li>Repository access: <b>Only select repositories</b> → <code>Yurieff/greek-flashcards</code>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
          <li>Generate token, copy it, paste it above.</li>
        </ol>
      </details>
    </section>

    <section id="screen-start" class="screen" hidden>
      <h1>Greek Flashcards</h1>
      <p class="label">Direction</p>
      <div id="direction" class="segmented">
        <button data-value="gr-en">GR → EN</button>
        <button data-value="en-gr">EN → GR</button>
      </div>
      <p class="label">Cards per round</p>
      <div id="size" class="segmented">
        <button data-value="10">10</button>
        <button data-value="20">20</button>
        <button data-value="50">50</button>
      </div>
      <dl class="counts">
        <div><dt>Known</dt><dd id="count-known">0</dd></div>
        <div><dt>Learning</dt><dd id="count-learning">0</dd></div>
        <div><dt>New</dt><dd id="count-new">0</dd></div>
      </dl>
      <button id="start" class="primary">Start</button>
      <p id="skipped-note" class="muted" hidden></p>
      <button id="change-token" class="link">Change token</button>
    </section>

    <section id="screen-study" class="screen" hidden>
      <div class="study-bar">
        <button id="quit" class="link" aria-label="End round">✕</button>
        <span id="study-progress" class="muted"></span>
      </div>
      <div id="card" class="card" role="button" tabindex="0">
        <div id="card-front"></div>
        <div id="card-back" class="back" hidden></div>
      </div>
      <p id="tap-hint" class="muted centered-text">Tap the card to see the answer</p>
      <div id="answers" class="answers" hidden>
        <button id="wrong" class="wrong">✗ Didn't know</button>
        <button id="right" class="right">✓ Knew it</button>
      </div>
    </section>

    <section id="screen-summary" class="screen centered" hidden>
      <h1>Round done</h1>
      <p id="summary-text"></p>
      <button id="again" class="primary">Another round</button>
      <button id="back">Back</button>
    </section>
  </main>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #f6f4ef;
  --surface: #ffffff;
  --text: #1d1d1f;
  --muted: #6b6b70;
  --line: #e2dfd8;
  --accent: #1f5fbf;
  --right: #1e7a46;
  --wrong: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416;
    --surface: #1f1f23;
    --text: #f2f2f4;
    --muted: #a0a0a8;
    --line: #34343a;
    --accent: #6ea0ff;
    --right: #4cc38a;
    --wrong: #ff7b72;
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-tap-highlight-color: transparent;
}
main {
  max-width: 520px;
  min-height: 100dvh;
  margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
}
.screen { flex: 1; display: flex; flex-direction: column; gap: 16px; }
.screen[hidden] { display: none; }
.centered { justify-content: center; text-align: center; }
.centered-text { text-align: center; margin: 0; }
h1 { font-size: 26px; margin: 8px 0 0; }
a { color: var(--accent); }
code { font-size: 15px; }

button {
  font: inherit;
  color: inherit;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 16px;
  min-height: 48px;
  cursor: pointer;
}
button:disabled { opacity: 0.5; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
button.link { background: none; border: none; color: var(--accent); min-height: 0; padding: 8px; align-self: center; }
input {
  font: inherit;
  width: 100%;
  padding: 12px 14px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.label { margin: 0 0 -8px; font-size: 14px; color: var(--muted); }
.segmented {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  padding: 4px;
  background: var(--line);
  border-radius: 14px;
}
.segmented button { border: none; background: transparent; border-radius: 10px; min-height: 44px; }
.segmented button[aria-pressed="true"] { background: var(--surface); font-weight: 600; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }

.counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
.counts div { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px; text-align: center; }
.counts dt { font-size: 13px; color: var(--muted); }
.counts dd { margin: 0; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }

.muted { color: var(--muted); font-size: 14px; }
.error { color: var(--wrong); margin: 0; }

.study-bar { display: flex; align-items: center; gap: 8px; min-height: 40px; }
.study-bar .link { align-self: auto; font-size: 20px; }
.card {
  flex: 1;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 0.06);
  cursor: pointer;
  user-select: none;
}
.card p { margin: 0; }
.card > div { display: flex; flex-direction: column; gap: 8px; }
.card .back { border-top: 1px solid var(--line); padding-top: 16px; }
.card .back[hidden] { display: none; }
.big { font-size: 30px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
.hint { color: var(--muted); }
.forms { font-size: 18px; }
.ety { font-size: 14px; color: var(--muted); }

.answers { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.answers[hidden] { display: none; }
.answers .wrong { color: var(--wrong); border-color: var(--wrong); font-weight: 600; }
.answers .right { color: var(--right); border-color: var(--right); font-weight: 600; }

.badge {
  position: fixed;
  top: max(10px, env(safe-area-inset-top));
  right: 12px;
  z-index: 1;
  padding: 4px 10px;
  font-size: 13px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
}
.badge.bad { color: var(--wrong); border-color: var(--wrong); }
```

- [ ] **Step 3: Write `app.js`**

```js
// UI wiring: screens, card rendering, answers and save triggers.
// All logic lives in lib/; this file only talks to the DOM.
import { parseCsv } from './lib/csv.js';
import { buildSession, counts, DIRECTIONS } from './lib/study.js';
import { Session } from './lib/session.js';
import { AuthError, loadProgress, loadVocab, saveProgress } from './lib/github.js';
import { ProgressStore } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const SAVE_EVERY = 5;
const RETRY_MS = 30_000;
const SIZES = ['10', '20', '50'];
const BADGE = { unsaved: '', saving: 'saving…', saved: 'saved ✓', error: '⚠ not saved', auth: '⚠ token rejected' };

const prefs = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
};
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const state = {
  words: [],
  skipped: 0,
  store: null,
  session: null,
  direction: oneOf(prefs.get('gf-direction', 'gr-en'), DIRECTIONS, 'gr-en'),
  size: oneOf(prefs.get('gf-size', '20'), SIZES, '20'),
  answersSinceSave: 0,
  saveStatus: 'saved',
};

function show(name) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== `screen-${name}`;
}

function setSaveStatus(status) {
  state.saveStatus = status;
  const badge = $('save-badge');
  badge.textContent = BADGE[status];
  badge.hidden = !BADGE[status];
  badge.classList.toggle('bad', status === 'error' || status === 'auth');
}

function trySave() {
  state.store?.save().catch(() => { /* the badge already shows the failure */ });
}

async function connect(token) {
  const store = new ProgressStore(
    { load: () => loadProgress(token), save: (data, sha) => saveProgress(token, data, sha) },
    setSaveStatus,
  );
  const [csv] = await Promise.all([loadVocab(token), store.load()]);
  ({ words: state.words, skipped: state.skipped } = parseCsv(csv));
  state.store = store;
}

async function boot() {
  const token = prefs.get('gf-token', null);
  if (!token) return showTokenScreen();
  $('loading-text').textContent = 'Loading…';
  $('retry').hidden = true;
  show('loading');
  try {
    await connect(token);
    showStart();
  } catch (err) {
    if (err instanceof AuthError) return showTokenScreen(err.message);
    $('loading-text').textContent = `Could not load: ${err.message}`;
    $('retry').hidden = false;
  }
}

function showTokenScreen(error = '') {
  $('token-error').textContent = error;
  $('token-error').hidden = !error;
  show('token');
}

async function saveToken() {
  const token = $('token-input').value.trim();
  if (!token) return;
  $('token-save').disabled = true;
  try {
    await connect(token);
    prefs.set('gf-token', token);
    $('token-input').value = '';
    showStart();
  } catch (err) {
    showTokenScreen(err instanceof AuthError ? err.message : `Could not connect: ${err.message}`);
  } finally {
    $('token-save').disabled = false;
  }
}

function showStart() {
  for (const [id, value] of [['direction', state.direction], ['size', state.size]]) {
    for (const button of $(id).querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
    }
  }
  const c = counts(state.words, state.store.data[state.direction]);
  $('count-known').textContent = c.known;
  $('count-learning').textContent = c.learning;
  $('count-new').textContent = c.new;
  $('start').disabled = state.words.length === 0;
  $('skipped-note').textContent = `${state.skipped} row(s) in vocab.csv could not be read and were skipped.`;
  $('skipped-note').hidden = state.skipped === 0;
  show('start');
}

function bindChoice(id) {
  $(id).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    state[id] = button.dataset.value;
    prefs.set(`gf-${id}`, button.dataset.value);
    showStart();
  });
}

function startSession() {
  const words = buildSession(state.words, state.store.data[state.direction], Number(state.size));
  if (!words.length) return;
  state.session = new Session(words);
  state.answersSinceSave = 0;
  renderCard();
  show('study');
}

function line(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function renderCard() {
  const word = state.session.current;
  const forms = [word.past, word.future].filter(Boolean).join(' · ');
  const [front, back] = state.direction === 'gr-en'
    ? [
      [line('big', word.basic)],
      [
        line('big', word.translation),
        word.additional && line('hint', word.additional),
        word.etymology && line('ety', word.etymology),
        word.initial && word.initial !== word.basic && line('ety', `seen as: ${word.initial}`),
      ],
    ]
    : [
      [line('big', word.translation), word.additional && line('hint', word.additional)],
      [line('big', word.basic), forms && line('forms', forms), word.etymology && line('ety', word.etymology)],
    ];
  $('card-front').replaceChildren(...front.filter(Boolean));
  $('card-back').replaceChildren(...back.filter(Boolean));
  $('card-back').hidden = true;
  $('answers').hidden = true;
  $('tap-hint').hidden = false;
  $('study-progress').textContent = `${state.session.cleared + 1} / ${state.session.total}`;
}

function reveal() {
  if (!$('card-back').hidden) return;
  $('card-back').hidden = false;
  $('answers').hidden = false;
  $('tap-hint').hidden = true;
}

function answer(correct) {
  const { session, store } = state;
  if (!session || session.finished) return;
  store.record(state.direction, session.current.basic, correct);
  session.answer(correct);
  state.answersSinceSave++;
  if (state.answersSinceSave >= SAVE_EVERY || state.saveStatus === 'error' || session.finished) {
    state.answersSinceSave = 0;
    trySave();
  }
  if (session.finished) showSummary();
  else renderCard();
}

function showSummary() {
  const { total, firstTry, missed } = state.session.summary();
  $('summary-text').textContent = `${firstTry}/${total} right on first try` + (missed ? `, ${missed} moved to Learning.` : '.');
  show('summary');
}

$('token-save').addEventListener('click', saveToken);
$('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveToken(); });
$('retry').addEventListener('click', boot);
bindChoice('direction');
bindChoice('size');
$('start').addEventListener('click', startSession);
$('change-token').addEventListener('click', () => { prefs.remove('gf-token'); showTokenScreen(); });
$('card').addEventListener('click', reveal);
$('card').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
});
$('right').addEventListener('click', () => answer(true));
$('wrong').addEventListener('click', () => answer(false));
$('quit').addEventListener('click', () => { trySave(); showStart(); });
$('again').addEventListener('click', startSession);
$('back').addEventListener('click', showStart);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.store?.dirty) trySave();
});
setInterval(() => {
  if (state.store?.dirty && state.saveStatus !== 'auth') trySave();
}, RETRY_MS);

boot();
```

- [ ] **Step 4: Static checks**

Run: `deno lint app.js lib/ && deno test --allow-read tests/`
Expected: no lint errors; all 39 tests pass.

Run: `python3 -m http.server 8765 >/dev/null 2>&1 & srv=$!; for f in index.html style.css app.js lib/csv.js lib/study.js lib/session.js lib/github.js lib/store.js; do printf '%s %s\n' "$(curl -s --retry 5 --retry-connrefused --retry-delay 1 -o /dev/null -w '%{http_code}' localhost:8765/$f)" "$f"; done; kill $srv`
Expected: `200` for every file (confirms relative module paths resolve).

- [ ] **Step 5: Commit and push**

```bash
git add index.html style.css app.js
git commit -m "Add flashcard page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 6: Verify the live site serves**

Run: `curl -sf --retry 12 --retry-delay 10 --retry-all-errors https://yurieff.github.io/greek-flashcards/ | grep -o '<title>.*</title>'`
Expected: `<title>Greek Flashcards</title>` (curl retries for up to ~2 min while Pages deploys).

---

### Task 7: grvocab integration and phone check

**Files:**
- Modify: `/Users/nikitayuriev/.claude/skills/grvocab/SKILL.md` (outside the repo; not committed)

**Interfaces:**
- Consumes: `sync.sh` from Task 5.
- Produces: grvocab publishes new words automatically.

- [ ] **Step 1: Add the publish step to SKILL.md**

In `## Steps`, replace step 6 with:

```markdown
6. Publish to the flashcards site: run `bash "/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Claude-code-projects/Coding-projects/greek-flashcards/sync.sh"`. It copies the CSV into the flashcards repo, commits if it changed, and pushes. If it fails (e.g. offline), the CSV is still saved — say so; running the script later publishes it.
7. Reply with a one-line summary: how many words added, how many skipped as duplicates, the file path, whether the flashcards were updated (the script's last line), and any words you were uncertain about.
```

And in `## Conventions`, extend the quoting rule to:

```markdown
- No quoting unless a field contains a comma — then wrap that field in `"..."`. This applies to **every** column, including etymology (e.g. `"Βορέας (Boreas, god of the North Wind)"`).
```

- [ ] **Step 2: Master Nikita creates the phone token** (manual)

At github.com/settings/personal-access-tokens/new: name `greek-flashcards`, expiration 1 year, **Only select repositories** → `Yurieff/greek-flashcards`, Repository permissions → **Contents: Read and write**. Generate and copy.

- [ ] **Step 3: Phone check** (manual, Master Nikita)

1. Open `https://yurieff.github.io/greek-flashcards/` → token screen. Paste the token → start screen shows counts (Known 0 · Learning 0 · New 289).
2. GR → EN, 10 cards: tap card → back appears; answer 5 cards → badge shows "saving…" then "saved ✓".
3. On the Mac: `gh api 'repos/Yurieff/greek-flashcards/commits?sha=progress&per_page=1' --jq '.[0].commit.message'` → `Progress update`.
4. Open the same URL in a second browser (or another phone), paste the token → the counts include the 5 answers.
5. Switch to EN → GR: counts are separate (all New).
6. A missed card reappears 3–5 cards later; the summary shows first-try results.

- [ ] **Step 4: End-to-end sync check**

Next time grvocab adds words: the reply ends with `Pushed to GitHub`; reloading the page shows the higher New count.

---

## Changes after this plan

This plan records the original build (Tasks 1–7, completed 2026-09-23). Later changes were small, test-first updates made without a separate plan. The spec is updated for each one and is the current reference.

| Commit | Change |
|---|---|
| `8dd986c` | Final-review fixes: a failed save stays shown until a save succeeds; the token check probes write access (`checkWriteAccess`); "Change token" keeps the old token until a new one connects (Cancel button, unsaved answers carried over via `ProgressStore.absorb`); a token rejected while saving leads to the token screen. |
| `485c66c` | `vocab.csv` republished after quoting the etymology of `ο βοριάς` in the source CSV. |
| `349ef92` | New words drawn randomly (not newest-first); start screen previews the round with 🔀 Regenerate (avoids the shown words); summary has a single "Next round" button. `pickSession`/`buildSession` take `{ random, avoid }`. |
| `919d8f6` | Tapping Known / Learning / New opens a read-only word list (`wordsWithStatus`, Greek alphabetical order, streaks for Learning words). |

Tests now: `deno test --allow-read tests/` → 47 passing.

