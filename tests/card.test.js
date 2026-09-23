import assert from 'node:assert/strict';
import { parseEtymology, partOfSpeech, splitArticle } from '../lib/card.js';

Deno.test('splitArticle takes a leading article off nouns only', () => {
  assert.deepEqual(splitArticle('ο ξεναγός'), { article: 'ο', lemma: 'ξεναγός' });
  assert.deepEqual(splitArticle('το οινόπνευμα'), { article: 'το', lemma: 'οινόπνευμα' });
  assert.deepEqual(splitArticle('ο δημόσιος υπάλληλος'), { article: 'ο', lemma: 'δημόσιος υπάλληλος' });
  assert.deepEqual(splitArticle('κρύβω'), { article: '', lemma: 'κρύβω' });
  assert.deepEqual(splitArticle('οικογένεια'), { article: '', lemma: 'οικογένεια' });
});

Deno.test('partOfSpeech reads gender from the article and verbs from the past form', () => {
  assert.equal(partOfSpeech({ basic: 'ο ξεναγός', past: '' }), 'Noun · masculine');
  assert.equal(partOfSpeech({ basic: 'η αυλή', past: '' }), 'Noun · feminine');
  assert.equal(partOfSpeech({ basic: 'το παυσίπονο', past: '' }), 'Noun · neuter');
  assert.equal(partOfSpeech({ basic: 'τα ψώνια', past: '' }), 'Noun · plural');
  assert.equal(partOfSpeech({ basic: 'κρύβω', past: 'έκρυψα' }), 'Verb');
  assert.equal(partOfSpeech({ basic: 'βαρύς', past: '' }), '');
});

const p = (gr, en, note = '') => ({ gr, en, note });

Deno.test('parseEtymology splits "A (x) + B (y)" into pieces', () => {
  assert.deepEqual(parseEtymology('εν (in) + ήμερα (day)'), { parts: [p('εν', 'in'), p('ήμερα', 'day')], result: null });
});

Deno.test('parseEtymology keeps what the pieces lead to after the arrow', () => {
  assert.deepEqual(parseEtymology('εκ (out) + οδός (road/way) → έξοδα (expenses)'), {
    parts: [p('εκ', 'out'), p('οδός', 'road/way')],
    result: p('έξοδα', 'expenses'),
  });
  assert.deepEqual(parseEtymology('ἄσβεστος (unquenched) → lime'), { parts: [p('ἄσβεστος', 'unquenched')], result: p('', 'lime') });
  assert.deepEqual(parseEtymology('λέγω (to say) → λόγος'), { parts: [p('λέγω', 'to say')], result: p('λόγος', '') });
});

Deno.test('parseEtymology takes a single source and notes "Ancient Greek"', () => {
  assert.deepEqual(parseEtymology('Ancient Greek κρύπτω (to hide/conceal)'), { parts: [p('κρύπτω', 'to hide/conceal', 'Ancient Greek')], result: null });
  assert.deepEqual(parseEtymology('μύρον (perfume/ointment)'), { parts: [p('μύρον', 'perfume/ointment')], result: null });
});

Deno.test('parseEtymology leaves free text as plain text', () => {
  assert.equal(parseEtymology('from Italian, via Venetian'), null);
  assert.equal(parseEtymology('a (x) + b'), null);
  assert.equal(parseEtymology('a (x) → b → c'), null);
  assert.equal(parseEtymology(''), null);
  assert.equal(parseEtymology(undefined), null);
});
