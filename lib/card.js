// What a card shows beyond the raw CSV fields: the article split off a noun,
// a word-type label, and the etymology broken into pieces when it follows
// the usual "A (meaning) + B (meaning) → C (meaning)" shape.
const ARTICLES = { 'ο': 'Noun · masculine', 'η': 'Noun · feminine', 'το': 'Noun · neuter', 'οι': 'Noun · plural', 'τα': 'Noun · plural' };
const PIECE = /^(\S.*?)\s*\(([^()]+)\)$/;

export function splitArticle(basic) {
  const space = basic.indexOf(' ');
  const first = basic.slice(0, space);
  if (space > 0 && first in ARTICLES) return { article: first, lemma: basic.slice(space + 1) };
  return { article: '', lemma: basic };
}

// '' when the type can't be told from the data (adjectives, adverbs, phrases).
export function partOfSpeech(word) {
  const { article } = splitArticle(word.basic);
  if (article) return ARTICLES[article];
  return word.past ? 'Verb' : '';
}

const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
const ANCIENT = 'Ancient Greek ';

// "βαρύς (heavy)" → { gr, en, note }; "Ancient Greek " moves into `note`.
function piece(text) {
  const match = PIECE.exec(text.trim());
  if (!match) return null;
  const ancient = match[1].startsWith(ANCIENT);
  const gr = ancient ? match[1].slice(ANCIENT.length) : match[1];
  return gr ? { gr, en: match[2].trim(), note: ancient ? 'Ancient Greek' : '' } : null;
}

// What the pieces lead to may also be bare text: "→ lime", "→ έξοδα".
function result(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (PIECE.test(trimmed)) return piece(trimmed);
  return GREEK.test(trimmed) ? { gr: trimmed, en: '', note: '' } : { gr: '', en: trimmed, note: '' };
}

// null means "show the text as it is".
export function parseEtymology(text) {
  const halves = (text ?? '').split(' → ');
  if (halves.length > 2) return null;
  const parts = halves[0].split(' + ').map(piece);
  if (parts.some((p) => !p)) return null;
  const end = halves.length === 2 ? result(halves[1]) : null;
  if (halves.length === 2 && !end) return null;
  return { parts, result: end };
}
