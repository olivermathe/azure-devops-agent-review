import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GitRelationsService } from '../src/azure-devops/git-relations.js';
import type { WorkItemService } from '../src/azure-devops/work-items.js';
import { readConfig } from '../src/config/env.js';
import type { GitService } from '../src/git/git.service.js';
import type { KiroService } from '../src/kiro/kiro.service.js';
import type { Logger } from '../src/logger.js';
import type { MarkdownService } from '../src/reports/markdown.service.js';
import { repositoryMatchesField, ReviewOrchestrator, targetBranchAllowed } from '../src/review/review-orchestrator.js';
import { ReviewStore } from '../src/review/review-store.js';

test('erro em um Work Item não interrompe o processamento dos demais', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orchestrator-test-'));
  try {
    const config = readConfig({ AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board', AZDO_COLUMN: 'Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat', REPORTS_DIR: dir, REVIEW_STATE_FILE: join(dir, 'state.json') });
    const items = [
      { id: 1, fields: { 'System.Title': 'Falha' }, relations: [{ rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/p/r/1' }] },
      { id: 2, fields: { 'System.Title': 'Sem vínculo' }, relations: [] },
    ];
    const workItems = { async find() { return { items, columnField: 'WEF_x_Kanban.Column' }; } } as unknown as WorkItemService;
    const relations = { async resolve() { return { targets: [], errors: ['repositório inacessível'], skipped: [] }; } } as unknown as GitRelationsService;
    const reports = {
      async writeWorkItem(result: { item: { id: number } }) { return `workitem-${result.item.id}.md`; },
      async writeIndex() {},
    } as unknown as MarkdownService;
    const log: Logger = { info() {}, warn() {}, error() {} };
    const orchestrator = new ReviewOrchestrator(config, workItems, relations, {} as GitService, {} as KiroService, reports, new ReviewStore(config.stateFile), log);
    const results = await orchestrator.run();
    assert.equal(results.length, 2);
    assert.equal(results[0]?.status, 'error');
    assert.equal(results[1]?.status, 'ignored');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('campo livre aceita um ou vários nomes e URLs sem confundir prefixos', () => {
  assert.equal(repositoryMatchesField('stix-accrual-notifier', 'stix-accrual-notifier'), true);
  assert.equal(repositoryMatchesField('repo-a, repo-b\nrepo-c', 'repo-b'), true);
  assert.equal(repositoryMatchesField('https://dev.azure.com/org/proj/_git/repo%2Durl', 'repo-url'), true);
  assert.equal(repositoryMatchesField('repo-with-suffix', 'repo'), false);
  assert.equal(repositoryMatchesField('', 'repo'), false);
});

test('filtra branch destino aceitando nome curto ou refs/heads', () => {
  assert.equal(targetBranchAllowed('refs/heads/main', ['main']), true);
  assert.equal(targetBranchAllowed('refs/heads/develop', ['main', 'release']), false);
  assert.equal(targetBranchAllowed(undefined, ['main']), false);
  assert.equal(targetBranchAllowed(undefined, '*'), true);
});
