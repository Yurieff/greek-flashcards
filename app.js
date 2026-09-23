// UI wiring: screens, card rendering, answers and save triggers.
// All logic lives in lib/; this file only talks to the DOM.
import { parseCsv } from './lib/csv.js';
import { buildSession, counts, DIRECTIONS, KNOWN_STREAK, statusOf, wordsWithStatus } from './lib/study.js';
import { parseEtymology, partOfSpeech, splitArticle } from './lib/card.js';
import { Session } from './lib/session.js';
import { AuthError, checkWriteAccess, loadProgress, loadVocab, saveProgress } from './lib/github.js';
import { ProgressStore } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const SAVE_EVERY = 5;
const RETRY_MS = 30_000;
const SIZES = ['10', '20', '50'];
const BADGE = { unsaved: '', saving: 'Saving…', saved: 'Synced', error: 'Not saved', auth: 'Token rejected' };
const RING = 2 * Math.PI * 44; // circumference of the summary ring (r = 44)

const prefs = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
};
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const state = {
  words: [],
  skipped: 0,
  store: null,
  session: null,
  direction: oneOf(prefs.get('gf-direction', 'gr-en'), DIRECTIONS, 'gr-en'),
  size: oneOf(prefs.get('gf-size', '20'), SIZES, '20'),
  preview: [],
  roundWords: [],
  roundStatus: new Map(), // basic -> status when the round started
  answersSinceSave: 0,
  saveStatus: 'saved',
};

function show(name) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== `screen-${name}`;
  // The save pill sits in the shown screen's header; screens without one let it float.
  const home = $(`badge-home-${name}`);
  if (home) home.append($('save-badge'));
  else document.body.prepend($('save-badge'));
}

function setSaveStatus(status) {
  state.saveStatus = status;
  const badge = $('save-badge');
  badge.textContent = BADGE[status];
  badge.hidden = !BADGE[status];
  badge.classList.toggle('good', status === 'saved');
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
  const [csv] = await Promise.all([loadVocab(token), store.load(), checkWriteAccess(token)]);
  ({ words: state.words, skipped: state.skipped } = parseCsv(csv));
  state.store = store;
  setSaveStatus(store.status);
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
  $('token-cancel').hidden = !state.store || state.saveStatus === 'auth';
  show('token');
}

async function saveToken() {
  const token = $('token-input').value.trim();
  if (!token) return;
  $('token-save').disabled = true;
  const previous = state.store;
  try {
    await connect(token);
    prefs.set('gf-token', token);
    if (previous?.dirty) {
      state.store.absorb(previous.data);
      trySave();
    }
    $('token-input').value = '';
    showStart();
  } catch (err) {
    showTokenScreen(err instanceof AuthError ? err.message : `Could not connect: ${err.message}`);
  } finally {
    $('token-save').disabled = false;
  }
}

// `avoid`: words of the previous draw, pushed to the back when drawing the preview.
function showStart(avoid = new Set()) {
  if (state.saveStatus === 'auth') {
    return showTokenScreen('Progress could not be saved: the token was rejected. Paste a new token — your answers from this session are kept.');
  }
  for (const [id, value] of [['direction', state.direction], ['size', state.size]]) {
    for (const button of $(id).querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
    }
  }
  const c = counts(state.words, state.store.data[state.direction]);
  const total = state.words.length;
  $('count-total').textContent = total;
  for (const status of ['known', 'learning', 'new']) {
    $(`count-${status}`).textContent = c[status];
    $(`bar-${status}`).hidden = c[status] === 0;
  }
  for (const status of ['known', 'learning']) $(`bar-${status}`).style.width = `${total ? (100 * c[status]) / total : 0}%`;
  drawPreview(avoid);
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

function drawPreview(avoid = new Set()) {
  state.preview = buildSession(state.words, state.store.data[state.direction], Number(state.size), { avoid });
  const dirProgress = state.store.data[state.direction];
  const front = (word) => (state.direction === 'gr-en' ? word.basic : word.translation);
  $('preview').replaceChildren(...state.preview.map((word) => {
    const li = document.createElement('li');
    li.textContent = front(word);
    if (state.direction === 'gr-en') li.lang = 'el';
    li.classList.toggle('learning', statusOf(dirProgress[word.basic]) === 'learning');
    return li;
  }));
  const n = state.preview.length;
  $('start-count').textContent = `${n} card${n === 1 ? '' : 's'}`;
  $('start').disabled = state.preview.length === 0;
  $('regenerate').disabled = state.preview.length === 0;
}

const basicsOf = (words) => new Set(words.map((word) => word.basic));

function startSession() {
  if (!state.preview.length) return;
  state.session = new Session(state.preview);
  state.roundWords = state.preview;
  const dirProgress = state.store.data[state.direction];
  state.roundStatus = new Map(state.preview.map((word) => [word.basic, statusOf(dirProgress[word.basic])]));
  state.answersSinceSave = 0;
  renderCard();
  show('study');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const line = (className, text) => el('p', className, text);

function headword(word) {
  const { article, lemma } = splitArticle(word.basic);
  const p = el('p', 'headword');
  p.lang = 'el';
  if (article) p.append(el('span', 'article', article));
  p.append(el('span', 'lemma', lemma));
  return p;
}

function gloss(word) {
  const block = el('div', 'gloss-block');
  block.append(line('gloss', word.translation));
  if (word.additional) block.append(line('also', `also: ${word.additional}`));
  return block;
}

function forms(word) {
  if (!word.past && !word.future) return null;
  const grid = el('div', 'forms');
  for (const [label, value] of [['Past', word.past], ['Future', word.future]]) {
    if (!value) continue;
    const cell = el('div', 'form');
    const text = el('span', 'form-value', value);
    text.lang = 'el';
    cell.append(el('span', 'form-label', label), text);
    grid.append(cell);
  }
  return grid;
}

function pieceNode({ gr, en, note }) {
  const box = el('div', 'piece');
  if (note) box.append(el('span', 'piece-note', note));
  if (gr) {
    const g = el('span', 'piece-gr', gr);
    g.lang = 'el';
    box.append(g);
  }
  if (en) box.append(el('span', 'piece-en', en));
  return box;
}

function origin(word) {
  if (!word.etymology) return null;
  const block = el('div', 'origin');
  block.append(el('span', 'section-label', 'Origin'));
  const parsed = parseEtymology(word.etymology);
  if (!parsed) {
    block.append(line('ety-text', word.etymology));
    return block;
  }
  const row = el('div', 'pieces');
  parsed.parts.forEach((part, i) => {
    if (i) row.append(el('span', 'joiner', '+'));
    row.append(pieceNode(part));
  });
  if (parsed.result) row.append(el('span', 'joiner', '→'), pieceNode(parsed.result));
  block.append(row);
  return block;
}

function seenAs(word) {
  const seen = word.initial?.toLocaleLowerCase('el');
  if (!seen || seen === word.basic.toLocaleLowerCase('el') || seen === splitArticle(word.basic).lemma.toLocaleLowerCase('el')) return null;
  const p = line('seen', 'Seen in the text as ');
  const form = el('span', '', word.initial);
  form.lang = 'el';
  p.append(form);
  return p;
}

const STATUS_TAG = { known: 'Known', learning: 'Learning', new: 'New' };

function renderCard() {
  const word = state.session.current;
  const grEn = state.direction === 'gr-en';
  const front = grEn ? [headword(word)] : [gloss(word)];
  const back = grEn
    ? [forms(word), el('div', 'rule'), gloss(word), origin(word), seenAs(word)]
    : [headword(word), forms(word), origin(word), seenAs(word)];
  const status = state.roundStatus.get(word.basic) ?? 'new';
  $('card-pos').textContent = partOfSpeech(word);
  $('card-status').textContent = STATUS_TAG[status];
  $('card-status').className = `status-tag ${status}`;
  $('card-front').replaceChildren(...front);
  $('card-back').replaceChildren(...back.filter(Boolean));
  $('card-back').hidden = true;
  $('card').classList.remove('revealed');
  $('answers').hidden = true;
  $('show-answer').hidden = false;
  const { cleared, total } = state.session;
  $('study-progress').textContent = `${cleared + 1} / ${total}`;
  $('study-bar-fill').style.width = `${(100 * cleared) / total}%`;
}

function reveal() {
  if (!$('card-back').hidden) return;
  $('card-back').hidden = false;
  $('card').classList.add('revealed');
  $('answers').hidden = false;
  $('show-answer').hidden = true;
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

const STATUS_LABEL = { known: 'Known', learning: 'Learning', new: 'New' };

function showList(status) {
  const dirProgress = state.store.data[state.direction];
  const words = wordsWithStatus(state.words, dirProgress, status);
  const direction = state.direction === 'gr-en' ? 'GR → EN' : 'EN → GR';
  $('list-title').textContent = `${STATUS_LABEL[status]} · ${direction} · ${words.length}`;
  $('word-list').replaceChildren(...words.map((word) => {
    const li = document.createElement('li');
    const gr = line('gr', word.basic);
    gr.lang = 'el';
    li.append(gr, line('en', word.translation));
    if (status === 'learning') li.append(line('streak', `${dirProgress[word.basic].streak}/${KNOWN_STREAK}`));
    return li;
  }));
  $('list-empty').hidden = words.length > 0;
  show('list');
  window.scrollTo(0, 0);
}

function missedWords() {
  return state.roundWords.filter((word) => state.session.missed.has(word.basic));
}

function showSummary() {
  const { total, firstTry, missed } = state.session.summary();
  const dirProgress = state.store.data[state.direction];
  const nowKnown = state.roundWords.filter((word) =>
    state.roundStatus.get(word.basic) !== 'known' && statusOf(dirProgress[word.basic]) === 'known').length;
  // "Well done!" for a good round, "Keep going!" otherwise.
  $('summary-title').textContent = firstTry >= 0.7 * total ? 'Μπράβο!' : 'Συνέχισε!';
  $('summary-score').textContent = firstTry;
  $('summary-total').textContent = `of ${total}`;
  $('ring-arc').style.strokeDasharray = `${total ? (RING * firstTry) / total : 0} ${RING}`;
  $('summary-known').textContent = `+${nowKnown}`;
  $('summary-missed').textContent = missed;
  $('missed-list').replaceChildren(...missedWords().map((word) => {
    const li = document.createElement('li');
    const gr = line('gr', word.basic);
    gr.lang = 'el';
    li.append(gr, line('en', word.translation));
    return li;
  }));
  $('missed-block').hidden = missed === 0;
  $('drill').textContent = `Drill the ${missed} missed word${missed === 1 ? '' : 's'}`;
  $('drill').hidden = missed === 0;
  show('summary');
}

function drillMissed() {
  state.preview = missedWords();
  startSession();
}

$('token-save').addEventListener('click', saveToken);
$('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveToken(); });
$('retry').addEventListener('click', boot);
bindChoice('direction');
bindChoice('size');
$('counts').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-status]');
  if (button) showList(button.dataset.status);
});
$('list-back').addEventListener('click', () => show('start'));
$('regenerate').addEventListener('click', () => drawPreview(basicsOf(state.preview)));
$('start').addEventListener('click', startSession);
$('change-token').addEventListener('click', () => showTokenScreen());
$('token-cancel').addEventListener('click', () => showStart());
$('card').addEventListener('click', reveal);
$('show-answer').addEventListener('click', reveal);
$('card').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
});
$('right').addEventListener('click', () => answer(true));
$('wrong').addEventListener('click', () => answer(false));
$('quit').addEventListener('click', () => { trySave(); showStart(basicsOf(state.roundWords)); });
$('next').addEventListener('click', () => showStart(basicsOf(state.roundWords)));
$('drill').addEventListener('click', drillMissed);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.store?.dirty) trySave();
});
setInterval(() => {
  if (state.store?.dirty && state.saveStatus !== 'auth') trySave();
}, RETRY_MS);

boot();
