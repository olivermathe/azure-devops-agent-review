import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig, redactedConfig } from '../src/config/env.js';
import { buildTeamsPayload, parseReviewFindings, TeamsService } from '../src/teams/teams.service.js';
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
});

test('envia o Adaptive Card bruto quando a ação do fluxo consome o body inteiro', () => {
  const payload = buildTeamsPayload({ ...config, teamsPayloadFormat: 'adaptive-card' }, result) as {
    type: string; version: string; body: unknown[];
  };
  assert.equal(payload.type, 'AdaptiveCard');
  assert.equal(payload.version, '1.2');
  assert.ok(payload.body.length);
});

test('não envia em dry-run e nunca expõe webhook na configuração redigida', () => {
  assert.equal(new TeamsService({ ...config, dryRun: true }).shouldNotify(result), false);
  const redacted = redactedConfig(config);
  assert.equal(redacted.teamsWebhookUrl, '<redacted>');
  assert.equal(JSON.stringify(redacted).includes('secret'), false);
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
