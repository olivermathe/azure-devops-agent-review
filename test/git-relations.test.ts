import assert from 'node:assert/strict';
import test from 'node:test';
import { GitRelationsService } from '../src/azure-devops/git-relations.js';
import type { AzureDevOpsClient } from '../src/azure-devops/client.js';
import type { GitArtifact } from '../src/types.js';

test('evita revisar novamente commit já coberto pelo PR vinculado', async () => {
  const sha = 'a'.repeat(40);
  const client = {
    async request(path: string) {
      if (path.includes('/commits?')) return { value: [{ commitId: sha }] };
      if (path.includes('/pullrequests/')) return {
        pullRequestId: 12,
        title: 'PR',
        status: 'active',
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        lastMergeSourceCommit: { commitId: 'b'.repeat(40) },
        repository: { id: 'repo', name: 'repo', remoteUrl: 'https://dev.azure.com/org/project/_git/repo' },
      };
      throw new Error(`Chamada inesperada: ${path}`);
    },
  } as unknown as AzureDevOpsClient;
  const artifacts: GitArtifact[] = [
    { kind: 'pr', projectId: 'project', repositoryId: 'repo', id: '12' },
    { kind: 'commit', projectId: 'project', repositoryId: 'repo', id: sha },
  ];
  const resolved = await new GitRelationsService(client).resolve(artifacts);
  assert.equal(resolved.targets.length, 1);
  assert.equal(resolved.targets[0]?.kind, 'pr');
  assert.deepEqual(resolved.errors, []);
  assert.deepEqual(resolved.skipped, []);
});

test('continua resolvendo outros PRs quando um vínculo falha', async () => {
  const client = {
    async request(path: string) {
      if (path.includes('/pullrequests/1?')) throw new Error('sem acesso');
      if (path.includes('/commits?')) return { value: [] };
      return {
        pullRequestId: 2, title: 'PR válido', status: 'active', sourceRefName: 'refs/heads/a', targetRefName: 'refs/heads/main',
        lastMergeSourceCommit: { commitId: 'c'.repeat(40) },
        repository: { id: 'repo', name: 'repo', remoteUrl: 'https://dev.azure.com/org/project/_git/repo' },
      };
    },
  } as unknown as AzureDevOpsClient;
  const resolved = await new GitRelationsService(client).resolve([
    { kind: 'pr', projectId: 'p', repositoryId: 'repo', id: '1' },
    { kind: 'pr', projectId: 'p', repositoryId: 'repo', id: '2' },
  ]);
  assert.equal(resolved.targets.length, 1);
  assert.equal(resolved.targets[0]?.id, '2');
  assert.match(resolved.errors[0] ?? '', /PR #1.*sem acesso/);
});

test('ignora PR abandonado antes de consultar seus commits', async () => {
  let commitCalls = 0;
  const client = {
    async request(path: string) {
      if (path.includes('/commits?')) commitCalls += 1;
      return {
        pullRequestId: 9, title: 'Antigo', status: 'abandoned',
        sourceRefName: 'refs/heads/old', targetRefName: 'refs/heads/main',
        lastMergeSourceCommit: { commitId: 'd'.repeat(40) },
        repository: { id: 'repo', name: 'repo', remoteUrl: 'https://dev.azure.com/org/project/_git/repo' },
      };
    },
  } as unknown as AzureDevOpsClient;
  const resolved = await new GitRelationsService(client).resolve([
    { kind: 'pr', projectId: 'p', repositoryId: 'repo', id: '9' },
  ]);
  assert.equal(resolved.targets.length, 0);
  assert.equal(commitCalls, 0);
  assert.match(resolved.skipped[0] ?? '', /status abandoned/);
});
