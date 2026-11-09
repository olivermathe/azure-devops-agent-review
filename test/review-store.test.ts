import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewKey, ReviewStore } from '../src/review/review-store.js';
import { emptyCounts, type ReviewTarget } from '../src/types.js';

const target: ReviewTarget = {
  kind: 'commit', projectId: 'p', repositoryId: 'r', id: 'a'.repeat(40), headSha: 'a'.repeat(40),
  repository: { id: 'r', name: 'repo', remoteUrl: 'https://dev.azure.com/org/project/_git/repo' },
};

test('identifica revisão pela tarefa, repositório, artefato, SHA e regras', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-store-test-'));
  try {
    const path = join(dir, 'state.json');
    const key = reviewKey(7, target, 'rules-v1');
    const store = new ReviewStore(path);
    store.set(key, { target, status: 'reviewed', markdown: 'ok', counts: emptyCounts() });
    await store.save();
    const loaded = new ReviewStore(path);
    await loaded.load();
    assert.equal(loaded.get(key)?.markdown, 'ok');
    assert.equal(loaded.get(reviewKey(7, { ...target, headSha: 'b'.repeat(40) }, 'rules-v1')), undefined);
    assert.equal((await readFile(path, 'utf8')).includes('secret'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
