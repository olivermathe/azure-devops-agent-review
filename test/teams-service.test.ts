import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig, redactedConfig } from '../src/config/env.js';
import { buildNoWorkItemsPayload, buildTeamsPayload, buildTeamsPayloads, parseReviewFindings, TeamsService } from '../src/teams/teams.service.js';
import type { WorkItemResult } from '../src/types.js';

const config = readConfig({
  AZDO_ORG: 'Org', AZDO_PROJECT: 'Projeto', AZDO_TEAM: 'Time', AZDO_BOARD: 'Board',
  AZDO_COLUMN: 'Staff', AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat',
  DRY_RUN: 'false', TEAMS_NOTIFICATION_ENABLED: 'true', TEAMS_WEBHOOK_URL: 'https://example.webhook.office.com/secret',
});

const result: WorkItemResult = {
  item: { id: 10, fields: { 'System.Title': 'Corrigir processamento' } },
  status: 'reviewed',
  reviews: [{
    target: {
      kind: 'pr', projectId: 'p', repositoryId: 'r', id: '20', headSha: 'a'.repeat(40),
      targetRef: 'refs/heads/main', repository: { id: 'r', name: 'repo', remoteUrl: 'https://dev.azure.com/org/p/_git/repo' },
    },
    status: 'reviewed', markdown: `## 2. Achados confirmados

### 2.1 Falha de validação
- **Severidade:** Alta
- **Arquivo:** \`src/modules/example/example.service.ts\`, \`src/other/helper.ts\`
- **Linha:** 42
- **Problema:** A entrada não é validada e pode produzir dados inválidos.
- **Impacto:** Registros incorretos podem chegar ao banco.
- **Correção sugerida:** Validar a entrada antes da persistência.

## 3. Riscos a validar

### 3.1 Concorrência
- **Severidade:** Média
- **Arquivo:** \`src/worker/worker.ts\`
- **Problema:** O comportamento concorrente precisa ser confirmado.
- **Impacto:** Pode ocorrer duplicidade.
- **Correção sugerida:** Validar com teste concorrente.`,
    counts: { critical: 0, high: 1, medium: 0, low: 0, informational: 0 },
  }],
};

test('extrai achados e reduz caminhos ao nome do arquivo', () => {
  const findings = parseReviewFindings(result.reviews[0]?.markdown ?? '');
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0]?.files, ['example.service.ts', 'helper.ts']);
  assert.equal(findings[0]?.category, 'finding');
  assert.equal(findings[1]?.category, 'risk');
});

test('encapsula o resultado em um Adaptive Card válido para o webhook do Workflows', () => {
  const payload = buildTeamsPayload(config, result) as {
    type: string;
    attachments: Array<{ contentType: string; content: { type: string; version: string; body: unknown[] } }>;
  };
  assert.equal(payload.type, 'message');
  assert.equal(payload.attachments[0]?.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(payload.attachments[0]?.content.type, 'AdaptiveCard');
  assert.equal(payload.attachments[0]?.content.version, '1.2');
  assert.ok(payload.attachments[0]?.content.body.length);
  assert.equal((payload.attachments[0]?.content as unknown as { msteams: { width: string } }).msteams.width, 'Full');
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /\*\*Título:/);
  assert.doesNotMatch(serialized, /\*\*Status:/);
  assert.doesNotMatch(serialized, /\*\*Achados:/);
  assert.doesNotMatch(serialized, /\*\*Observação:/);
  assert.doesNotMatch(serialized, /src\/modules\/example/);
  assert.match(serialized, /example\.service\.ts/);
  const card = payload.attachments[0]?.content as unknown as {
    body: Array<{ items?: Array<{ type?: string; id?: string; title?: string }> }>;
    actions?: Array<{ type?: string }>;
  };
  const toggles = card.body.flatMap((block) => block.items ?? []).filter((item) => item.type === 'Input.Toggle');
  assert.deepEqual(toggles.map((toggle) => toggle.id), ['finding-reviewed-1', 'finding-reviewed-2']);
  assert.ok(toggles.every((toggle) => toggle.title === 'Revisado'));
  assert.equal(card.actions?.some((action) => action.type === 'Action.Submit'), false);
});

test('envia o Adaptive Card bruto quando a ação do fluxo consome o body inteiro', () => {
  const payload = buildTeamsPayload({ ...config, teamsPayloadFormat: 'adaptive-card' }, result) as {
    type: string; version: string; body: unknown[];
  };
  assert.equal(payload.type, 'AdaptiveCard');
  assert.equal(payload.version, '1.2');
  assert.ok(payload.body.length);
});

test('monta o card do Teams diretamente do resultado JSON estruturado', () => {
  const structured: WorkItemResult = {
    ...result,
    reviews: [{
      ...result.reviews[0]!,
      markdown: undefined,
      analysis: {
        summary: 'Resumo',
        findings: [{
          category: 'confirmed', severity: 'critical', title: 'Falha estrutural',
          locations: [{ file: 'src/deep/structured.service.ts', line: 15 }], problem: 'Problema', impact: 'Impacto', correction: 'Correção',
        }],
      },
    }],
  };
  const payload = buildTeamsPayload(config, structured);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Falha estrutural/);
  assert.match(serialized, /structured\.service\.ts/);
  assert.doesNotMatch(serialized, /src\/deep/);
  assert.match(serialized, /Crítica/);
  assert.ok(serialized.includes('pullrequest/20?path=%2Fsrc%2Fdeep%2Fstructured.service.ts&line=15'));
});

test('não quebra com análise antiga do cache e usa o Markdown como fallback', () => {
  const legacyCache: WorkItemResult = {
    ...result,
    reviews: [{
      ...result.reviews[0]!,
      analysis: {
        summary: 'Formato antigo',
        findings: [{ files: ['src/old.ts'], line: '10' }],
      } as never,
    }],
  };
  assert.doesNotThrow(() => buildTeamsPayload(config, legacyCache));
  assert.match(JSON.stringify(buildTeamsPayload(config, legacyCache)), /Falha de validação/);
});

test('divide relatórios grandes em payloads menores que o limite do Teams', () => {
  const largeReview = {
    ...result.reviews[0]!,
    markdown: Array.from({ length: 35 }, (_, index) => `### 2.${index + 1} Achado extenso ${index + 1}
- **Severidade:** Média
- **Arquivo:** \`src/muito/longo/example-${index}.service.ts\`
- **Problema:** ${'Problema detalhado '.repeat(80)}
- **Impacto:** ${'Impacto relevante '.repeat(50)}
- **Correção sugerida:** ${'Correção objetiva '.repeat(60)}`).join('\n\n'),
  };
  const payloads = buildTeamsPayloads(config, { ...result, reviews: [largeReview] });
  assert.ok(payloads.length > 1);
  for (const payload of payloads) {
    assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 28 * 1024);
  }
  assert.match(JSON.stringify(payloads[1]), /continuação 2/);
});

test('não envia em dry-run e nunca expõe webhook na configuração redigida', () => {
  const dryRunService = new TeamsService({ ...config, dryRun: true });
  assert.equal(dryRunService.shouldNotify(result), false);
  assert.equal(dryRunService.shouldNotifyNoWorkItems(), false);
  const redacted = redactedConfig(config);
  assert.equal(redacted.teamsWebhookUrl, '<redacted>');
  assert.equal(JSON.stringify(redacted).includes('secret'), false);
});

test('cria card e habilita aviso quando nenhum Work Item é encontrado', () => {
  assert.equal(new TeamsService(config).shouldNotifyNoWorkItems(), true);
  const payload = buildNoWorkItemsPayload({ ...config, teamsPayloadFormat: 'adaptive-card' }) as {
    type: string; body: Array<{ text?: string }>;
  };
  assert.equal(payload.type, 'AdaptiveCard');
  assert.match(payload.body.map((block) => block.text).join(' '), /Nenhuma tarefa foi encontrada/);
  assert.match(payload.body.map((block) => block.text).join(' '), /Staff/);
});

test('exige webhook HTTPS quando notificações estão habilitadas', () => {
  assert.throws(() => readConfig({
    AZDO_ORG: 'Org', AZDO_PROJECT: 'P', AZDO_TEAM: 'T', AZDO_BOARD: 'B', AZDO_COLUMN: 'C',
    AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat',
    TEAMS_NOTIFICATION_ENABLED: 'true', TEAMS_WEBHOOK_URL: 'http://example.com/hook',
  }), /deve usar HTTPS/);
});

test('valida o formato de payload do Teams', () => {
  assert.throws(() => readConfig({
    AZDO_ORG: 'Org', AZDO_PROJECT: 'P', AZDO_TEAM: 'T', AZDO_BOARD: 'B', AZDO_COLUMN: 'C',
    AZDO_STATE: 'Active', AZDO_WORK_ITEM_TYPE: '*', AZDO_PAT: 'pat', TEAMS_PAYLOAD_FORMAT: 'invalido',
  }), /TEAMS_PAYLOAD_FORMAT/);
});
