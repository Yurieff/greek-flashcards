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
