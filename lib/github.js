// GitHub REST contents API: vocab.csv on main, progress.json on the progress branch.
import { emptyProgress } from './study.js';

const API = 'https://api.github.com/repos/Yurieff/greek-flashcards/contents';

export class AuthError extends Error {}
export class ConflictError extends Error {}

export function encodeBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function request(token, path, { headers = {}, ...init } = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...headers },
  });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub rate limit reached, try again later');
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Token rejected: it is wrong, expired, or lacks access to greek-flashcards.');
  }
  return res;
}

export async function loadVocab(token) {
  const res = await request(token, 'vocab.csv?ref=main', { headers: { Accept: 'application/vnd.github.raw' } });
  // vocab.csv always exists, so a 404 means the token cannot see the repo.
  if (res.status === 404) throw new AuthError('Token cannot see the greek-flashcards repo. Check its repository access.');
  if (!res.ok) throw new Error(`Could not load vocab.csv (HTTP ${res.status})`);
  return res.text();
}

export async function loadProgress(token) {
  const res = await request(token, 'progress.json?ref=progress', { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { data: emptyProgress(), sha: null };
  if (!res.ok) throw new Error(`Could not load progress (HTTP ${res.status})`);
  const body = await res.json();
  return { data: JSON.parse(decodeBase64(body.content)), sha: body.sha };
}

// The repo is public, so any token can read it. Probe write access with a PUT
// that carries an impossible sha: a token that may write gets a conflict and
// nothing is written; a read-only or wrong-repo token is refused.
export async function checkWriteAccess(token) {
  const res = await request(token, 'progress.json', {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Write check', branch: 'progress', content: encodeBase64('{}'), sha: '0'.repeat(40) }),
  });
  if (res.status === 404) throw new AuthError('Token cannot write to greek-flashcards. Give it Contents: Read and write on that repo.');
  if (res.status !== 409 && res.status !== 422) throw new Error(`Could not check token (HTTP ${res.status})`);
}

export async function saveProgress(token, data, sha) {
  const res = await request(token, 'progress.json', {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Progress update',
      branch: 'progress',
      content: encodeBase64(JSON.stringify(data, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) throw new ConflictError('Progress changed on another device');
  if (!res.ok) throw new Error(`Could not save progress (HTTP ${res.status})`);
  return (await res.json()).content.sha;
}
