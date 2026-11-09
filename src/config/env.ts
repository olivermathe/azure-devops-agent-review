import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type Config = {
  org: string;
  project: string;
  team: string;
  board: string;
  column: string;
  state: string;
  workItemTypes: '*' | string[];
  filterByRepositoryField: boolean;
  repositoryField: string;
  prTargetBranches: '*' | string[];
  customPromptFile?: string;
  teamsEnabled: boolean;
  teamsWebhookUrl?: string;
  teamsPayloadFormat: 'workflow-envelope' | 'adaptive-card';
  teamsNotifyOnSuccess: boolean;
  teamsNotifyOnError: boolean;
  columnField?: string;
  areaPath?: string;
  pat: string;
  kiroApiKey?: string;
  dryRun: boolean;
  force: boolean;
  reportsDir: string;
  stateFile: string;
  timeoutMs: number;
  maxDiffBytes: number;
};

export async function loadDotEnv(path = '.env'): Promise<void> {
  try {
    const data = await readFile(path, 'utf8');
    for (const line of data.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1]!;
      let value = match[2]!;
      if (value.startsWith('#') || process.env[key] !== undefined) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${key}`);
  return value;
}

function boolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${key} deve ser true ou false`);
}

function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  if (!env[key]?.trim()) return fallback;
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} deve ser um inteiro positivo`);
  return value;
}

function teamsPayloadFormat(env: NodeJS.ProcessEnv): 'workflow-envelope' | 'adaptive-card' {
  const value = env.TEAMS_PAYLOAD_FORMAT?.trim() || 'workflow-envelope';
  if (value === 'workflow-envelope' || value === 'adaptive-card') return value;
  throw new Error('TEAMS_PAYLOAD_FORMAT deve ser workflow-envelope ou adaptive-card');
}

export function parseWorkItemTypes(raw: string): '*' | string[] {
  const value = raw.trim();
  if (value === '*') return '*';
  const types = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (!types.length) throw new Error('AZDO_WORK_ITEM_TYPE deve ser * ou uma lista separada por vírgulas');
  if (types.includes('*')) throw new Error('AZDO_WORK_ITEM_TYPE não pode combinar * com tipos específicos');
  return types;
}

export function parsePrTargetBranches(raw: string): '*' | string[] {
  const value = raw.trim();
  if (value === '*') return '*';
  const branches = [...new Set(value.split(',')
    .map((branch) => branch.trim().replace(/^refs\/heads\//, ''))
    .filter(Boolean))];
  if (!branches.length) throw new Error('AZDO_PR_TARGET_BRANCHES deve ser * ou uma lista separada por vírgulas');
  if (branches.includes('*')) throw new Error('AZDO_PR_TARGET_BRANCHES não pode combinar * com branches específicas');
  return branches;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dryRun = boolean(env, 'DRY_RUN', true);
  const reportsDir = resolve(env.REPORTS_DIR?.trim() || 'reports');
  const teamsEnabled = boolean(env, 'TEAMS_NOTIFICATION_ENABLED', false);
  const teamsWebhookUrl = env.TEAMS_WEBHOOK_URL?.trim() || undefined;
  if (teamsEnabled && !teamsWebhookUrl) throw new Error('TEAMS_WEBHOOK_URL é obrigatória quando TEAMS_NOTIFICATION_ENABLED=true');
  if (teamsWebhookUrl) {
    let url: URL;
    try { url = new URL(teamsWebhookUrl); } catch { throw new Error('TEAMS_WEBHOOK_URL é inválida'); }
    if (url.protocol !== 'https:') throw new Error('TEAMS_WEBHOOK_URL deve usar HTTPS');
  }
  return {
    org: required(env, 'AZDO_ORG'),
    project: required(env, 'AZDO_PROJECT'),
    team: required(env, 'AZDO_TEAM'),
    board: required(env, 'AZDO_BOARD'),
    column: required(env, 'AZDO_COLUMN'),
    state: required(env, 'AZDO_STATE'),
    workItemTypes: parseWorkItemTypes(required(env, 'AZDO_WORK_ITEM_TYPE')),
    filterByRepositoryField: boolean(env, 'AZDO_FILTER_BY_REPOSITORY_FIELD', false),
    repositoryField: env.AZDO_REPOSITORY_FIELD?.trim() || 'URL Repository',
    prTargetBranches: parsePrTargetBranches(env.AZDO_PR_TARGET_BRANCHES?.trim() || '*'),
    customPromptFile: env.KIRO_CUSTOM_PROMPT_FILE?.trim() ? resolve(env.KIRO_CUSTOM_PROMPT_FILE.trim()) : undefined,
    teamsEnabled,
    teamsWebhookUrl,
    teamsPayloadFormat: teamsPayloadFormat(env),
    teamsNotifyOnSuccess: boolean(env, 'TEAMS_NOTIFY_ON_SUCCESS', true),
    teamsNotifyOnError: boolean(env, 'TEAMS_NOTIFY_ON_ERROR', true),
    columnField: env.AZDO_BOARD_COLUMN_FIELD?.trim() || undefined,
    areaPath: env.AZDO_AREA_PATH?.trim() || undefined,
    pat: required(env, 'AZDO_PAT'),
    kiroApiKey: env.KIRO_API_KEY?.trim() || undefined,
    dryRun,
    force: boolean(env, 'FORCE_REVIEW', false),
    reportsDir,
    stateFile: resolve(env.REVIEW_STATE_FILE?.trim() || '.review-state.json'),
    timeoutMs: positiveInteger(env, 'EXTERNAL_TIMEOUT_MS', 10 * 60 * 1000),
    maxDiffBytes: positiveInteger(env, 'MAX_DIFF_BYTES', 2 * 1024 * 1024),
  };
}

export function redactedConfig(config: Config): Record<string, unknown> {
  const { pat: _pat, kiroApiKey: _key, teamsWebhookUrl: _webhook, ...safe } = config;
  return {
    ...safe,
    pat: '<redacted>',
    kiroApiKey: config.kiroApiKey ? '<redacted>' : undefined,
    teamsWebhookUrl: config.teamsWebhookUrl ? '<redacted>' : undefined,
  };
}
