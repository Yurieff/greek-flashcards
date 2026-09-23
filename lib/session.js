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
