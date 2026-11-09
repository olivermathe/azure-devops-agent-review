import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverColumnField, parseGitRelations, resolveBoard, resolveFieldReference } from '../src/azure-devops/work-items.js';
import type { WorkItem } from '../src/types.js';

const item = (relations: WorkItem['relations'] = []): WorkItem => ({
  id: 42,
  fields: { 'System.Title': 'Teste', 'WEF_abc_Kanban.Column': 'Code Review' },
  relations,
});

test('descobre o campo board-specific da coluna', () => {
  assert.equal(discoverColumnField([item()], 'Code Review'), 'WEF_abc_Kanban.Column');
});

test('resolve board por nome sem diferenciar maiúsculas ou por ID', () => {
  const boards = [{ id: 'board-guid', name: 'Stories' }];
  assert.equal(resolveBoard(boards, 'stories').id, 'board-guid');
  assert.equal(resolveBoard(boards, 'BOARD-GUID').name, 'Stories');
});

test('informa os boards disponíveis quando a configuração é inválida', () => {
  assert.throws(
    () => resolveBoard([{ id: '1', name: 'Stories' }, { id: '2', name: 'Features' }], 'Meu Time'),
    /Boards disponíveis: Stories \(1\), Features \(2\)/,
  );
});

test('resolve o campo de repositório por nome exibido ou reference name', () => {
  const fields = [{ name: 'URL Repository', referenceName: 'Custom.URLRepository' }];
  assert.equal(resolveFieldReference(fields, 'url repository'), 'Custom.URLRepository');
  assert.equal(resolveFieldReference(fields, 'custom.urlrepository'), 'Custom.URLRepository');
});

test('interpreta, valida e deduplica relações oficiais de PR e commit', () => {
  const sha = 'a'.repeat(40);
  const relations = [
    { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/project/repo/123' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/project/repo/' + sha },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/project/repo/' + sha },
    { rel: 'Related', url: 'vstfs:///Git/PullRequestId/project/repo/999' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/project/repo/not-a-sha' },
  ];
  assert.deepEqual(parseGitRelations(item(relations)), [
    { kind: 'pr', projectId: 'project', repositoryId: 'repo', id: '123' },
    { kind: 'commit', projectId: 'project', repositoryId: 'repo', id: sha },
  ]);
});
