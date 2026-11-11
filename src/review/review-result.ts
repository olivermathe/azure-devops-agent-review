import type { FindingCounts, ReviewAnalysis, ReviewFinding, ReviewSeverity } from '../types.js';
import { emptyCounts } from '../types.js';

const severities = new Set<ReviewSeverity>(['critical', 'high', 'medium', 'low', 'informational']);
const categories = new Set<ReviewFinding['category']>(['confirmed', 'risk']);

function requiredString(value: unknown, field: string, maxLength = 20_000): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Campo JSON inválido ou vazio: ${field}`);
  return value.trim().slice(0, maxLength);
}

function positiveLine(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${field} deve ser um inteiro positivo`);
  return Number(value);
}

function jsonText(output: string): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) return fenced.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A CLI não retornou um objeto JSON');
  return trimmed.slice(start, end + 1);
}

export function parseReviewAnalysis(output: string): ReviewAnalysis {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText(output)); } catch (error) {
    throw new Error(`Resposta JSON inválida da CLI: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Resposta da CLI deve ser um objeto JSON');
  const source = parsed as Record<string, unknown>;
  if (!Array.isArray(source.findings)) throw new Error('Campo JSON inválido: findings deve ser uma lista');
  if (source.findings.length > 200) throw new Error('Resposta da CLI excedeu o limite de 200 achados');
  const findings = source.findings.map((entry, index): ReviewFinding => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Achado ${index + 1} deve ser um objeto`);
    const finding = entry as Record<string, unknown>;
    const category = requiredString(finding.category, `findings[${index}].category`) as ReviewFinding['category'];
    const severity = requiredString(finding.severity, `findings[${index}].severity`) as ReviewSeverity;
    if (!categories.has(category)) throw new Error(`Categoria inválida no achado ${index + 1}: ${category}`);
    if (!severities.has(severity)) throw new Error(`Severidade inválida no achado ${index + 1}: ${severity}`);
    if (!Array.isArray(finding.locations) || !finding.locations.length) throw new Error(`Achado ${index + 1} deve informar ao menos uma localização`);
    const locations = finding.locations.map((entry, locationIndex) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Localização ${locationIndex + 1} do achado ${index + 1} deve ser um objeto`);
      const location = entry as Record<string, unknown>;
      const line = positiveLine(location.line, `findings[${index}].locations[${locationIndex}].line`);
      const endLine = location.endLine === undefined ? undefined : positiveLine(location.endLine, `findings[${index}].locations[${locationIndex}].endLine`);
      if (endLine !== undefined && endLine < line) throw new Error(`endLine não pode ser menor que line no achado ${index + 1}`);
      return { file: requiredString(location.file, `findings[${index}].locations[${locationIndex}].file`, 1_000), line, endLine };
    });
    return {
      category,
      severity,
      locations,
      title: requiredString(finding.title, `findings[${index}].title`, 500),
      problem: requiredString(finding.problem, `findings[${index}].problem`),
      impact: requiredString(finding.impact, `findings[${index}].impact`),
      correction: requiredString(finding.correction, `findings[${index}].correction`),
    };
  });
  return { summary: requiredString(source.summary, 'summary'), findings };
}

export function isReviewAnalysis(value: unknown): value is ReviewAnalysis {
  try {
    parseReviewAnalysis(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const severityLabels: Record<ReviewSeverity, string> = {
  critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa', informational: 'Informativa',
};

export function countAnalysisFindings(analysis: ReviewAnalysis): FindingCounts {
  const counts = emptyCounts();
  for (const finding of analysis.findings) counts[finding.severity] += 1;
  return counts;
}

function findingMarkdown(finding: ReviewFinding, number: string, locationUrl?: (location: ReviewFinding['locations'][number]) => string | undefined): string[] {
  const locations = finding.locations.map((location) => {
    const label = `\`${location.file.replaceAll('`', '')}:${location.line}${location.endLine ? `-${location.endLine}` : ''}\``;
    const url = locationUrl?.(location);
    return url ? `[${label}](${url})` : label;
  }).join(', ');
  return [
    `### ${number} ${finding.title}`,
    '',
    `- **Severidade:** ${severityLabels[finding.severity]}`,
    `- **Localização:** ${locations}`,
    `- **Problema:** ${finding.problem}`,
    `- **Impacto:** ${finding.impact}`,
    `- **Correção sugerida:** ${finding.correction}`,
    '',
  ];
}

export function renderReviewMarkdown(
  analysis: ReviewAnalysis,
  locationUrl?: (location: ReviewFinding['locations'][number]) => string | undefined,
): string {
  const confirmed = analysis.findings.filter((finding) => finding.category === 'confirmed');
  const risks = analysis.findings.filter((finding) => finding.category === 'risk');
  const lines = ['## 1. Resumo executivo', '', analysis.summary, '', '## 2. Achados confirmados', ''];
  if (!confirmed.length) lines.push('Nenhum achado confirmado.', '');
  confirmed.forEach((finding, index) => lines.push(...findingMarkdown(finding, `2.${index + 1}`, locationUrl)));
  lines.push('## 3. Riscos a validar', '');
  if (!risks.length) lines.push('Nenhum risco adicional a validar.', '');
  risks.forEach((finding, index) => lines.push(...findingMarkdown(finding, `3.${index + 1}`, locationUrl)));
  return lines.join('\n').trim();
}
