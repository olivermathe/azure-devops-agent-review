import type { Config } from '../config/env.js';
import { posix } from 'node:path';
import type { WorkItemResult } from '../types.js';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function oneLine(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export type TeamsFinding = {
  title: string;
  category: 'finding' | 'risk';
  severity: string;
  files: string[];
  line?: string;
  problem?: string;
  impact?: string;
  correction?: string;
};

function cleanMarkdown(value: string): string {
  return value
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLabel(block: string, label: string): string | undefined {
  const labels = 'Severidade|Arquivo|Linha|Problema|Impacto|Correção sugerida';
  const expression = new RegExp(
    `(?:^|\\n)\\s*-?\\s*\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*-?\\s*\\*\\*(?:${labels}):\\*\\*|$)`,
    'i',
  );
  const value = block.match(expression)?.[1];
  return value ? cleanMarkdown(value) : undefined;
}

function fileNames(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((entry) => {
    const path = entry.trim().replace(/^['"]|['"]$/g, '').replace(/\s*\([^)]*\)\s*$/, '');
    return posix.basename(path.replaceAll('\\', '/'));
  }).filter(Boolean))];
}

export function parseReviewFindings(markdown: string): TeamsFinding[] {
  const headings = [...markdown.matchAll(/^###\s+(.+)$/gm)];
  const findings: TeamsFinding[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const severity = extractLabel(block, 'Severidade');
    const files = fileNames(extractLabel(block, 'Arquivo'));
    if (!severity || !files.length) continue;
    const previous = markdown.slice(0, heading.index ?? 0);
    const section = [...previous.matchAll(/^##\s+(.+)$/gm)].at(-1)?.[1] ?? '';
    findings.push({
      title: cleanMarkdown(heading[1]!.replace(/^\d+(?:\.\d+)*\s*/, '')),
      category: /risco/i.test(section) ? 'risk' : 'finding',
      severity,
      files,
      line: extractLabel(block, 'Linha'),
      problem: extractLabel(block, 'Problema'),
      impact: extractLabel(block, 'Impacto'),
      correction: extractLabel(block, 'Correção sugerida'),
    });
  }
  return findings;
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function severityColor(severity: string): string {
  if (/crítica|crítico|alta|alto/i.test(severity)) return 'Attention';
  if (/média|médio/i.test(severity)) return 'Warning';
  if (/baixa|baixo/i.test(severity)) return 'Good';
  return 'Accent';
}

function detailBlocks(label: string, value: string | undefined, limit: number): Record<string, unknown>[] {
  const content = truncate(value, limit);
  if (!content) return [];
  return [
    { type: 'TextBlock', text: label, weight: 'Bolder', size: 'Small', spacing: 'Small' },
    { type: 'TextBlock', text: content, wrap: true, spacing: 'None' },
  ];
}

function findingContainer(finding: TeamsFinding, index: number): Record<string, unknown> {
  return {
    type: 'Container',
    separator: true,
    spacing: 'Medium',
    items: [
      {
        type: 'TextBlock',
        text: `${finding.category === 'risk' ? 'Risco' : 'Achado'} ${index + 1} · ${finding.title}`,
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'ColumnSet',
        spacing: 'Small',
        columns: [
          { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: finding.severity, color: severityColor(finding.severity), weight: 'Bolder', wrap: true }] },
          { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: finding.files.join(', '), horizontalAlignment: 'Right', isSubtle: true, wrap: true }] },
        ],
      },
      ...(finding.line ? [{ type: 'TextBlock', text: `Linha: ${truncate(finding.line, 160)}`, isSubtle: true, size: 'Small', wrap: true, spacing: 'None' }] : []),
      ...detailBlocks('Problema', finding.problem, 420),
      ...detailBlocks('Impacto', finding.impact, 280),
      ...detailBlocks('Correção', finding.correction, 320),
    ],
  };
}

export function buildTeamsPayload(config: Config, result: WorkItemResult): Record<string, unknown> {
  const itemUrl = `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_workitems/edit/${result.item.id}`;
  const body: Record<string, unknown>[] = [{
    type: 'TextBlock',
    text: `Code Review · Work Item #${result.item.id}`,
    size: 'Large',
    weight: 'Bolder',
    wrap: true,
  }];
  const actions: Record<string, unknown>[] = [{ type: 'Action.OpenUrl', title: 'Abrir Work Item', url: itemUrl }];
  let findingIndex = 0;
  for (const review of result.reviews) {
    const prUrl = review.target.kind === 'pr'
      ? `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_git/${encodeURIComponent(review.target.repository.name)}/pullrequest/${review.target.id}`
      : undefined;
    body.push({
      type: 'TextBlock',
      text: `${review.target.kind === 'pr' ? `PR #${review.target.id}` : `Commit ${review.target.id.slice(0, 12)}`} · ${review.target.repository.name} → ${review.target.targetRef?.replace(/^refs\/heads\//, '') || 'n/a'}`,
      color: 'Accent',
      weight: 'Bolder',
      wrap: true,
      separator: true,
      spacing: 'Medium',
    });
    if (prUrl) actions.push({ type: 'Action.OpenUrl', title: `Abrir PR #${review.target.id}`, url: prUrl });
    const findings = parseReviewFindings(review.markdown ?? '');
    for (const finding of findings) body.push(findingContainer(finding, findingIndex++));
    if (!findings.length && review.error) {
      body.push({ type: 'TextBlock', text: oneLine(review.error), color: 'Attention', wrap: true });
    }
  }
  if (!findingIndex && !result.error) {
    body.push({ type: 'TextBlock', text: 'Nenhum achado estruturado foi identificado.', isSubtle: true, wrap: true });
  }
  if (result.error) body.push({ type: 'TextBlock', text: oneLine(result.error), color: 'Attention', wrap: true, separator: true });
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.2',
    msteams: { width: 'Full' },
    body,
    actions: actions.slice(0, 6),
  };
  if (config.teamsPayloadFormat === 'adaptive-card') return card;
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: card,
    }],
  };
}

export function buildNoWorkItemsPayload(config: Config): Record<string, unknown> {
  const boardUrl = `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_boards/board/t/${encodeURIComponent(config.team)}/${encodeURIComponent(config.board)}`;
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.2',
    msteams: { width: 'Full' },
    body: [
      { type: 'TextBlock', text: 'Code Review', size: 'Large', weight: 'Bolder', wrap: true },
      {
        type: 'TextBlock',
        text: `Nenhuma tarefa foi encontrada na coluna ${config.column} com estado ${config.state}.`,
        wrap: true,
        spacing: 'Medium',
      },
    ],
    actions: [{ type: 'Action.OpenUrl', title: 'Abrir board', url: boardUrl }],
  };
  if (config.teamsPayloadFormat === 'adaptive-card') return card;
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: card,
    }],
  };
}

export class TeamsService {
  constructor(private readonly config: Config) {}

  shouldNotify(result: WorkItemResult): boolean {
    if (!this.config.teamsEnabled || this.config.dryRun) return false;
    if (result.status === 'error') return this.config.teamsNotifyOnError;
    if (result.status === 'reviewed') return this.config.teamsNotifyOnSuccess;
    return false;
  }

  shouldNotifyNoWorkItems(): boolean {
    return this.config.teamsEnabled && !this.config.dryRun;
  }

  async notify(result: WorkItemResult): Promise<void> {
    if (!this.shouldNotify(result)) return;
    await this.post(buildTeamsPayload(this.config, result));
  }

  async notifyNoWorkItems(): Promise<void> {
    if (!this.shouldNotifyNoWorkItems()) return;
    await this.post(buildNoWorkItemsPayload(this.config));
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const webhook = this.config.teamsWebhookUrl;
    if (!webhook) throw new Error('Webhook do Teams não configurado');
    const body = JSON.stringify(payload);
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 30_000));
      try {
        const response = await fetch(webhook, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (response.ok) return;
        const detail = (await response.text()).slice(0, 300);
        lastError = new Error(`Teams HTTP ${response.status}: ${detail}`);
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastError = (error as Error).name === 'AbortError'
          ? new Error('Timeout ao publicar no Teams')
          : error as Error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 3) await sleep(500 * 2 ** (attempt - 1));
    }
    throw lastError ?? new Error('Falha desconhecida ao publicar no Teams');
  }
}
