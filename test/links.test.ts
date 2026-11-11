import assert from 'node:assert/strict';
import test from 'node:test';
import { pullRequestLineUrl } from '../src/azure-devops/links.js';
import type { ReviewTarget } from '../src/types.js';

const target: ReviewTarget = {
  kind: 'pr', projectId: 'p', repositoryId: 'r', id: '123', headSha: 'a'.repeat(40),
  repository: { id: 'r', name: 'repo com espaço', remoteUrl: 'https://dev.azure.com/org/p/_git/repo' },
};

test('gera link do Azure DevOps para o arquivo e intervalo exatos no PR', () => {
  const url = pullRequestLineUrl({ org: 'Minha Org', project: 'Projeto' }, target, { file: 'src/a b.ts', line: 42, endLine: 45 });
  assert.equal(
    url,
    'https://dev.azure.com/Minha%20Org/Projeto/_git/repo%20com%20espa%C3%A7o/pullrequest/123?path=%2Fsrc%2Fa+b.ts&line=42&lineEnd=46&lineStartColumn=1&lineEndColumn=1&lineStyle=plain&_a=files',
  );
});

test('não cria deep link de linha para commits isolados', () => {
  assert.equal(pullRequestLineUrl({ org: 'Org', project: 'P' }, { ...target, kind: 'commit' }, { file: 'a.ts', line: 1 }), undefined);
});
