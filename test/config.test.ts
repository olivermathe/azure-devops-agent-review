import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrTargetBranches, parseWorkItemTypes, readConfig } from '../src/config/env.js';
import { buildWiql } from '../src/azure-devops/work-items.js';

test('aceita um tipo de Work Item', () => {
  assert.deepEqual(parseWorkItemTypes('Task'), ['Task']);
});

test('aceita e normaliza múltiplos tipos', () => {
  assert.deepEqual(parseWorkItemTypes('Task, Bug, User Story,Task'), ['Task', 'Bug', 'User Story']);
});

test('aceita todos os tipos sem aplicar filtro WIQL', () => {
  const query = buildWiql({ project: 'Projetos', state: 'Active', workItemTypes: '*' });
  assert.doesNotMatch(query, /System\.WorkItemType/);
});

test('gera IN para múltiplos tipos', () => {
  const query = buildWiql({ project: 'Projetos', state: 'Active', workItemTypes: ['Task', 'Bug', 'User Story'] });
  assert.match(query, /\[System\.WorkItemType\] IN \('Task', 'Bug', 'User Story'\)/);
});

test('preserva nomes com espaços e valida configuração', () => {
  const config = readConfig({
    AZDO_ORG: 'Org', AZDO_PROJECT: 'Meu Projeto', AZDO_TEAM: 'Meu Time', AZDO_BOARD: 'Meu Board',
    AZDO_COLUMN: 'Code Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'secret',
  });
  assert.equal(config.team, 'Meu Time');
  assert.equal(config.board, 'Meu Board');
  assert.equal(config.dryRun, true);
  assert.equal(config.reviewCli, 'kiro');
  assert.equal(config.gitCloneProtocol, 'https');
  assert.equal(config.htmlReportEnabled, true);
});

test('permite selecionar CLI de revisão e protocolo de clone', () => {
  const base = {
    AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board',
    AZDO_COLUMN: 'Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'secret',
  };
  const config = readConfig({ ...base, REVIEW_CLI: 'claude', GIT_CLONE_PROTOCOL: 'ssh' });
  assert.equal(config.reviewCli, 'claude');
  assert.equal(config.gitCloneProtocol, 'ssh');
  assert.throws(() => readConfig({ ...base, REVIEW_CLI: 'outro' }), /kiro, claude ou codex/);
  assert.throws(() => readConfig({ ...base, GIT_CLONE_PROTOCOL: 'git' }), /https ou ssh/);
  assert.equal(readConfig({ ...base, HTML_REPORT_ENABLED: 'false' }).htmlReportEnabled, false);
});

test('aceita uma lista de branches destino ou todas', () => {
  assert.deepEqual(parsePrTargetBranches('main, release,refs/heads/develop,main'), ['main', 'release', 'develop']);
  assert.equal(parsePrTargetBranches('*'), '*');
  assert.throws(() => parsePrTargetBranches('main,*'), /não pode combinar/);
});
