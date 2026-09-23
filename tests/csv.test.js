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
