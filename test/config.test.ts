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
});

test('aceita uma lista de branches destino ou todas', () => {
  assert.deepEqual(parsePrTargetBranches('main, release,refs/heads/develop,main'), ['main', 'release', 'develop']);
  assert.equal(parsePrTargetBranches('*'), '*');
  assert.throws(() => parsePrTargetBranches('main,*'), /não pode combinar/);
});
