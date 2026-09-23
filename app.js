// UI wiring: screens, card rendering, answers and save triggers.
// All logic lives in lib/; this file only talks to the DOM.
import { parseCsv } from './lib/csv.js';
import { buildSession, counts, DIRECTIONS } from './lib/study.js';
import { Session } from './lib/session.js';
import { AuthError, checkWriteAccess, loadProgress, loadVocab, saveProgress } from './lib/github.js';
import { ProgressStore } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const SAVE_EVERY = 5;
const RETRY_MS = 30_000;
const SIZES = ['10', '20', '50'];
const BADGE = { unsaved: '', saving: 'saving…', saved: 'saved ✓', error: '⚠ not saved', auth: '⚠ token rejected' };

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
  const [csv] = await Promise.all([loadVocab(token), store.load(), checkWriteAccess(token)]);
  ({ words: state.words, skipped: state.skipped } = parseCsv(csv));
  state.store = store;
  state.saveStatus = store.status;
  $('save-badge').hidden = true;
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

function showStart() {
  if (state.saveStatus === 'auth') {
    return showTokenScreen('Progress could not be saved: the token was rejected. Paste a new token — your answers from this session are kept.');
  }
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
$('change-token').addEventListener('click', () => showTokenScreen());
$('token-cancel').addEventListener('click', showStart);
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
