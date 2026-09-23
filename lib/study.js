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

export function statusOf(entry) {
  if (!entry) return 'new';
  return entry.status === 'known' ? 'known' : 'learning';
}

export function counts(words, dirProgress) {
  const result = { known: 0, learning: 0, new: 0 };
  for (const word of words) result[statusOf(dirProgress[word.basic])]++;
  return result;
}

export function wordsWithStatus(words, dirProgress, status) {
  return words
    .filter((word) => statusOf(dirProgress[word.basic]) === status)
    .sort((a, b) => a.basic.localeCompare(b.basic, 'el'));
}

// Learning words first (lowest streak), then new words in random order, then
// known words (least recently seen). Words in `avoid` (the previous draw) go
// to the back of their pile, so they are used only when nothing else fits.
export function pickSession(words, dirProgress, size, { random = Math.random, avoid = new Set() } = {}) {
  const piles = { learning: [], new: [], known: [] };
  for (const word of words) piles[statusOf(dirProgress[word.basic])].push(word);
  const entry = (word) => dirProgress[word.basic];
  piles.learning.sort((a, b) => entry(a).streak - entry(b).streak);
  piles.new = shuffle(piles.new, random);
  piles.known.sort((a, b) => String(entry(a).lastSeen).localeCompare(String(entry(b).lastSeen)));
  const avoidLast = (pile) => [...pile.filter((w) => !avoid.has(w.basic)), ...pile.filter((w) => avoid.has(w.basic))];
  return [...avoidLast(piles.learning), ...avoidLast(piles.new), ...avoidLast(piles.known)].slice(0, size);
}

export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildSession(words, dirProgress, size, { random = Math.random, avoid } = {}) {
  return shuffle(pickSession(words, dirProgress, size, { random, avoid }), random);
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
