# Greek Flashcards — Design

Date: 2026-09-23

## Goal

A mobile-friendly flashcard web page for Master Nikita's Greek vocabulary, reachable online from any phone. Words come from the CSV maintained by the `grvocab` skill; new words appear on the page automatically after grvocab runs. Study progress lives online (not on the phone), so any phone continues where the last one left off.

## Decisions (agreed in brainstorming)

- Study mode: "know / don't know" piles, not full spaced repetition.
- Both directions (GR→EN and EN→GR), chosen per session, progress tracked separately per direction.
- A word becomes **Known after 3 correct answers in a row**.
- The EN side shows the additional meaning as a hint.
- Hosting: GitHub only. Public repo `Yurieff/greek-flashcards`, served by GitHub Pages; progress stored in the same repo on a separate branch.
- Access: a fine-grained personal access token scoped to this single repo, permission Contents: Read and write, pasted once per phone.

## Source data

`/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Greek/Εξετάσεις/Claude-gr/greek_vocab.csv`, UTF-8, header:

```
initial word,basic form,past simple,future simple,translation,additional meaning,etymology
```

Fields are quoted with `"..."` only when they contain a comma. Rows are appended over time, so row order = age (last row = newest). `basic form` is unique (grvocab dedupes on it) and is the word's identity key everywhere in this app.

## Repository layout

```
main branch (served by GitHub Pages)
  index.html          page shell, three screens: token, start, study (+ summary)
  style.css           mobile-first styles, light/dark
  app.js              UI wiring, screen switching, event handlers
  lib/csv.js          parseCsv(text) -> { words, skipped }
  lib/study.js        card state transitions, session building, merge
  lib/session.js      in-session card queue (re-inserting missed cards)
  lib/github.js       GitHub API calls: read vocab, read/write progress
  lib/store.js        ProgressStore: in-memory progress + save/merge/retry
  vocab.csv           copy of greek_vocab.csv
  sync.sh             copy CSV into repo, commit + push if changed
  tests/*.test.js     deno tests for everything in lib/
  .nojekyll           serve files as-is (skip Jekyll build)
  docs/superpowers/   spec and plan

progress branch (not served)
  progress.json
```

Plain HTML/CSS/ES modules, no build step, no dependencies.

## Units

### lib/csv.js
- `parseCsv(text)` → `{ words: Word[], skipped: number }`.
- Handles quoted fields with commas, escaped quotes (`""`), CRLF/LF, BOM, trailing newline.
- `Word = { initial, basic, past, future, translation, additional, etymology, index }`; `index` = row position (higher = newer).
- A quote opens a quoted field only at the start of a field; elsewhere it is a literal character (real data has `→ "in whatever way ever"` in an unquoted etymology).
- Rows with **more** than 7 fields: the extra fields are joined back into `etymology` with `,` (real data has an unquoted comma in the last column: `Βορέας (Boreas, god of the North Wind)`).
- Rows with fewer than 7 fields, an empty `basic form` or an empty `translation` are skipped and counted.
- A repeated `basic form` keeps the first row; later duplicates are skipped and counted.

### lib/study.js
Card state per word per direction: `{ streak: number, status: "learning" | "known", lastSeen: ISO string }`. A word with no entry is **New**.

- `applyAnswer(state | undefined, correct, now)` → new state:
  - correct: `streak + 1`; status `known` if streak ≥ 3, otherwise `learning`.
  - wrong: `streak = 0`, status `learning`.
  - `lastSeen = now` in both cases.
  - A new word answered correctly becomes `learning` with streak 1 (it needs 3 in a row to be known).
- `buildSession(words, progressForDirection, size, { avoid })` → array of words:
  1. all Learning words (lowest streak first), then
  2. New words in random order, then
  3. Known words, oldest `lastSeen` first,
  taken in that order until `size` is reached, then shuffled. Words in `avoid` (the previous draw) are moved to the back of their pile, so a regenerated set differs wherever possible; Learning words that fit in the round stay.
- `wordsWithStatus(words, progressForDirection, status)` → the words of one pile, sorted with Greek `localeCompare`.
- `counts(words, progressForDirection)` → `{ known, learning, new }`. Progress entries for words no longer in the CSV are ignored (kept in the file, not counted).
- `mergeProgress(a, b)` → for every direction and word, keep the entry with the later `lastSeen`.

### Session queue (lib/session.js)
- Correct answer: card leaves the queue.
- Wrong answer: card is re-inserted 3–5 positions later (or at the end if fewer remain) and must be answered correctly once before the session ends.
- Every answer calls `applyAnswer` (via `ProgressStore.record`) and updates in-memory progress.
- End: summary "X/N right on first try, M moved to Learning", button "Next round" → start screen with a fresh preview that avoids the words just studied.

### lib/store.js
`ProgressStore` holds progress in memory, records answers, and saves through injected `load`/`save` functions (so it is unit-testable without the network). It runs one save at a time, loops while new answers arrived during a save, and on conflict reloads, merges (local wins ties) and retries once.

### lib/github.js
Uses the GitHub REST contents API with the stored token (`Authorization: Bearer <token>`).
- `loadVocab()` → GET `/repos/Yurieff/greek-flashcards/contents/vocab.csv?ref=main` with `Accept: application/vnd.github.raw` — always fresh, no Pages cache lag.
- `loadProgress()` → GET `progress.json` on `ref=progress` → `{ data, sha }`. 404 → empty progress, sha null. The `progress` branch is created once during setup with an empty `progress.json`.
- `saveProgress(data, sha)` → PUT with base64 (UTF-8 safe) content, message `Progress update`, branch `progress`. On 409/422 (sha conflict): reload, `mergeProgress`, retry once more.
- 401/403 → "token invalid or expired" error.

## progress.json format

```json
{
  "version": 1,
  "gr-en": { "ο ξεναγός": { "streak": 2, "status": "learning", "lastSeen": "2026-09-23T14:05:00Z" } },
  "en-gr": { }
}
```

## Screens

1. **Token screen** (only when no token stored): input field, "Save" button, short instructions for creating the fine-grained token. Token is validated by loading vocab; stored in `localStorage` only on success.
2. **Start screen**: direction toggle (GR→EN / EN→GR), session size (10 / 20 / 50, default 20), counts for the selected direction, a "This round" preview listing each card's front (Greek for GR→EN, English for EN→GR) with "🔀 Regenerate" (new set avoiding the shown words) and "Start" (studies exactly the previewed words); changing direction or size redraws the preview, small note if CSV rows were skipped, "Change token" link. Last direction/size remembered in `localStorage`.
3. **Study screen**: progress indicator (e.g. 7/20), the card; tapping it reveals the back below the front (front stays visible), then "✗ Didn't know" / "✓ Knew it". Save-status badge.
4. **Summary screen** (see Session queue).
5. **Word list screen**: tapping the Known / Learning / New tile on the start screen lists those words for the selected direction, in Greek alphabetical order: basic form and translation, plus the streak (e.g. 2/3) for Learning words. "‹ Back" returns to the start screen without redrawing the preview. Read-only.

### Card content

| Direction | Front | Back |
|---|---|---|
| GR→EN | basic form | translation (large), additional meaning, etymology, "seen as: initial word" |
| EN→GR | translation + additional meaning as a hint | basic form (large), past / future simple for verbs, etymology |

Empty fields are not rendered.

## Saving

- Save after every 5 answers, at session end, and on `visibilitychange` → hidden.
- Only one save in flight at a time; answers made meanwhile are included in the next save.
- Badge: "saved" / "saving…" / "⚠ not saved" (retries every 30 s and on next answer).
- Nothing except the token and UI preferences is stored on the phone. Unsaved answers live in memory only; if the page is closed while offline, those answers are lost (accepted trade-off).

## Sync (Mac side)

`sync.sh`:
1. Copy `greek_vocab.csv` from Dropbox to `vocab.csv` in the repo.
2. If `git diff` shows no change → print "Already up to date" and exit.
3. Otherwise commit `Update vocab: N words` (N = data rows) on `main` and `git push`.

The `grvocab` SKILL.md gets a final step: run `sync.sh` after appending rows, and report whether it pushed.

## Error handling summary

| Situation | Behavior |
|---|---|
| No token | Token screen |
| Token rejected (401/403) | Message + token screen |
| Network down at page load | Error message with "Retry" button (no cached data by design) |
| Network down mid-session | Keep studying; badge "⚠ not saved"; retry |
| Save conflict (another phone) | Reload, merge by latest `lastSeen`, retry |
| Malformed CSV row | Skipped, count shown on start screen |

## Testing

- `deno test --allow-read tests/` covers `lib/csv.js` (quoting, commas, CRLF, BOM, bad rows, duplicates, the real `vocab.csv` parses with 0 skipped), `lib/study.js` (state transitions incl. 3-in-a-row rule, session ordering/priority and size, counts, merge), `lib/session.js`, `lib/store.js` (fake API: conflicts, answers during a save, errors) and the UTF-8 base64 helpers in `lib/github.js`.
- `lib/github.js` network calls are smoke-tested against the live repo from the Mac; the UI is verified manually: run locally with `python3 -m http.server`, then on the phone against the live GitHub Pages URL (load, answer, check `progress.json` commit on the `progress` branch, open on a second browser and confirm progress carries over).

## Out of scope

- Full spaced repetition with due dates.
- Audio / pronunciation.
- Editing words in the app (the CSV stays the single source of truth).
- Filtering by word type or date added.
