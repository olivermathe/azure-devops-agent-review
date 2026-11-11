import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config/env.js';
import { createReviewCliService } from '../src/review-cli/review-cli.service.js';

const base = {
  AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board',
  AZDO_COLUMN: 'Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'secret',
};

test('cria o adaptador correspondente a cada CLI configurada', () => {
  for (const name of ['kiro', 'claude', 'codex'] as const) {
    const service = createReviewCliService(readConfig({ ...base, REVIEW_CLI: name }));
    assert.equal(service.name, name);
  }
});
