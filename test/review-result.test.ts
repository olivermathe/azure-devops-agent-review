import assert from 'node:assert/strict';
import test from 'node:test';
import { countAnalysisFindings, isReviewAnalysis, parseReviewAnalysis, renderReviewMarkdown } from '../src/review/review-result.js';

const valid = {
  summary: 'A alteração possui um problema confirmado.',
  findings: [{
    category: 'confirmed', title: 'Validação ausente', severity: 'high', locations: [{ file: 'src/example.ts', line: 42 }],
    problem: 'A entrada é persistida sem validação.', impact: 'Dados inválidos chegam ao banco.', correction: 'Validar antes de persistir.',
  }],
};

test('valida JSON da CLI e gera Markdown deterministicamente', () => {
  const analysis = parseReviewAnalysis(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
  assert.equal(isReviewAnalysis(analysis), true);
  assert.deepEqual(countAnalysisFindings(analysis), { critical: 0, high: 1, medium: 0, low: 0, informational: 0 });
  const markdown = renderReviewMarkdown(analysis);
  assert.match(markdown, /## 1\. Resumo executivo/);
  assert.match(markdown, /\*\*Severidade:\*\* Alta/);
  assert.match(markdown, /`src\/example\.ts:42`/);
  assert.match(renderReviewMarkdown(analysis, () => 'https://example.test/linha'), /\[\`src\/example\.ts:42\`\]\(https:\/\/example\.test\/linha\)/);
});

test('rejeita respostas fora do contrato', () => {
  assert.throws(() => parseReviewAnalysis('texto livre'), /objeto JSON/);
  assert.throws(() => parseReviewAnalysis(JSON.stringify({ ...valid, findings: [{ ...valid.findings[0], severity: 'urgent' }] })), /Severidade inválida/);
  assert.throws(() => parseReviewAnalysis(JSON.stringify({ ...valid, findings: [{ ...valid.findings[0], locations: [] }] })), /ao menos uma localização/);
  assert.throws(() => parseReviewAnalysis(JSON.stringify({ ...valid, findings: [{ ...valid.findings[0], locations: [{ file: 'a.ts', line: '42' }] }] })), /inteiro positivo/);
  assert.equal(isReviewAnalysis({ summary: 'antigo', findings: [{ files: ['a.ts'], line: '42' }] }), false);
});
