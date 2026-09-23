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
