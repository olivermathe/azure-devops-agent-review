import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readConfig } from '../src/config/env.js';
import { countFindings, MarkdownService } from '../src/reports/markdown.service.js';
import { emptyCounts, type WorkItemResult } from '../src/types.js';

test('contabiliza severidades no Markdown', () => {
  const result = countFindings('**Severidade:** Alta\n**Severidade:** Média\n**Severidade:** Baixa');
  assert.deepEqual(result, { critical: 0, high: 1, medium: 1, low: 1, informational: 0 });
});

test('gera relatório único por Work Item e índice consolidado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-test-'));
  try {
    const config = readConfig({ AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board', AZDO_COLUMN: 'Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat', REPORTS_DIR: dir });
    const service = new MarkdownService(config);
    const result: WorkItemResult = { item: { id: 10, fields: { 'System.Title': 'Título', 'System.State': 'Active', 'System.WorkItemType': 'Task' } }, status: 'ignored', reviews: [] };
    result.reportFile = await service.writeWorkItem(result, 'WEF_field_Kanban.Column');
    await service.writeIndex([result]);
    assert.match(await readFile(join(dir, 'workitem-10.md'), 'utf8'), /Nenhum vínculo Git oficial/);
    assert.match(await readFile(join(dir, 'index.md'), 'utf8'), /Work Items encontrados: 1/);
    assert.deepEqual(emptyCounts(), { critical: 0, high: 0, medium: 0, low: 0, informational: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
