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
    await service.writeHtml([result]);
    assert.match(await readFile(join(dir, 'workitem-10.md'), 'utf8'), /Nenhum vínculo Git oficial/);
    assert.match(await readFile(join(dir, 'index.md'), 'utf8'), /Work Items encontrados: 1/);
    assert.match(await readFile(join(dir, 'report.html'), 'utf8'), /Relatório consolidado/);
    assert.deepEqual(emptyCounts(), { critical: 0, high: 0, medium: 0, low: 0, informational: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gera HTML único com um card e checkbox persistente por achado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'html-test-'));
  try {
    const config = readConfig({ AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board', AZDO_COLUMN: 'Review', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat', REPORTS_DIR: dir });
    const analysis = {
      summary: 'Resumo seguro <script>',
      findings: [{ category: 'confirmed' as const, severity: 'high' as const, title: 'Erro de validação', locations: [{ file: 'src/example.ts', line: 10 }], problem: 'Problema', impact: 'Impacto', correction: 'Correção' }],
    };
    const result: WorkItemResult = {
      item: { id: 10, fields: { 'System.Title': 'Título' } }, status: 'reviewed',
      reviews: [{
        target: { kind: 'pr', projectId: 'p', repositoryId: 'r', id: '20', headSha: 'a'.repeat(40), repository: { id: 'r', name: 'repo', remoteUrl: 'https://dev.azure.com/org/p/_git/repo' } },
        status: 'reviewed', analysis, counts: { critical: 0, high: 1, medium: 0, low: 0, informational: 0 },
      }],
    };
    await new MarkdownService(config).writeHtml([result]);
    const output = await readFile(join(dir, 'report.html'), 'utf8');
    assert.match(output, /class="finding"/);
    assert.match(output, /type="checkbox"/);
    assert.match(output, /localStorage/);
    assert.match(output, /pullrequest\/20\?path=%2Fsrc%2Fexample\.ts&amp;line=10/);
    assert.match(output, /Resumo seguro &lt;script&gt;/);
    assert.doesNotMatch(output, /Resumo seguro <script>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
