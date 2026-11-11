import type { Config } from '../config/env.js';
import type { GitArtifact, WorkItem } from '../types.js';
import { AzureDevOpsClient } from './client.js';

const escapeWiql = (value: string) => value.replaceAll("'", "''");
const encode = encodeURIComponent;

export type BoardReference = { id: string; name: string };
type FieldReference = { name: string; referenceName: string };

export function resolveBoard(boards: BoardReference[], configured: string): BoardReference {
  const normalized = configured.trim().toLocaleLowerCase('pt-BR');
  const match = boards.find((board) => board.id.toLocaleLowerCase('pt-BR') === normalized)
    ?? boards.find((board) => board.name.trim().toLocaleLowerCase('pt-BR') === normalized);
  if (match) return match;
  const available = boards.length
    ? boards.map((board) => `${board.name} (${board.id})`).join(', ')
    : 'nenhum board retornado para o time';
  throw new Error(`Board "${configured}" não encontrado. Boards disponíveis: ${available}`);
}

export function buildWiql(config: Pick<Config, 'project' | 'state' | 'workItemTypes' | 'areaPath'>): string {
  const clauses = [
    `[System.TeamProject] = '${escapeWiql(config.project)}'`,
    `[System.State] = '${escapeWiql(config.state)}'`,
  ];
  if (config.workItemTypes !== '*') {
    const values = config.workItemTypes.map((type) => `'${escapeWiql(type)}'`).join(', ');
    clauses.push(`[System.WorkItemType] IN (${values})`);
  }
  if (config.areaPath) clauses.push(`[System.AreaPath] UNDER '${escapeWiql(config.areaPath)}'`);
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;
}

export function parseGitRelations(item: WorkItem): GitArtifact[] {
  const artifacts: GitArtifact[] = [];
  for (const relation of item.relations ?? []) {
    if (relation.rel !== 'ArtifactLink') continue;
    let uri = relation.url;
    try { uri = decodeURIComponent(uri); } catch { /* retain original */ }
    const match = uri.match(/^vstfs:\/\/\/Git\/(PullRequestId|Commit)\/(.+)$/i);
    if (!match) continue;
    const kind = match[1]!;
    const parts = match[2]!.split('/');
    if (parts.length !== 3) continue;
    const projectId = parts[0]!;
    const repositoryId = parts[1]!;
    const id = parts[2]!;
    if (kind.toLowerCase() === 'pullrequestid' && /^\d+$/.test(id)) {
      artifacts.push({ kind: 'pr', projectId, repositoryId, id });
    } else if (kind.toLowerCase() === 'commit' && /^[a-f0-9]{40}$/i.test(id)) {
      artifacts.push({ kind: 'commit', projectId, repositoryId, id: id.toLowerCase() });
    }
  }
  return [...new Map(artifacts.map((artifact) => [`${artifact.kind}:${artifact.repositoryId}:${artifact.id}`, artifact])).values()];
}

export function discoverColumnField(items: WorkItem[], column: string, configured?: string): string {
  if (configured) return configured;
  const candidates = new Set<string>();
  for (const item of items) {
    for (const [field, value] of Object.entries(item.fields)) {
      if (/^WEF_.+_Kanban\.Column$/i.test(field) && value === column) candidates.add(field);
    }
  }
  if (candidates.size === 1) return [...candidates][0]!;
  if (candidates.size > 1) throw new Error(`Mais de um campo de coluna corresponde a "${column}"; configure AZDO_BOARD_COLUMN_FIELD`);
  throw new Error(`Não foi possível descobrir o campo da coluna "${column}"; configure AZDO_BOARD_COLUMN_FIELD`);
}

export function resolveFieldReference(fields: FieldReference[], configured: string): string {
  const normalized = configured.trim().toLocaleLowerCase('pt-BR');
  const field = fields.find((entry) => entry.referenceName.toLocaleLowerCase('pt-BR') === normalized)
    ?? fields.find((entry) => entry.name.trim().toLocaleLowerCase('pt-BR') === normalized);
  if (!field) throw new Error(`Campo de repositório "${configured}" não encontrado no processo do Azure DevOps`);
  return field.referenceName;
}

export class WorkItemService {
  constructor(private readonly client: AzureDevOpsClient, private readonly config: Config) {}

  async find(): Promise<{ items: WorkItem[]; columnField: string; repositoryField?: string }> {
    const boardListPath = `/${encode(this.config.team)}/_apis/work/boards?api-version=7.1`;
    const boardList = await this.client.request<{ value?: BoardReference[] }>(boardListPath);
    const resolvedBoard = resolveBoard(boardList.value ?? [], this.config.board);
    const boardDetails = await this.client.request<{
      fields?: { columnField?: { referenceName?: string } };
    }>(`/${encode(this.config.team)}/_apis/work/boards/${encode(resolvedBoard.id)}?api-version=7.1`);
    const boardColumnField = boardDetails.fields?.columnField?.referenceName?.trim() || undefined;
    const configuredColumnField = this.config.columnField ?? boardColumnField;
    let repositoryField: string | undefined;
    if (this.config.filterByRepositoryField) {
      const fieldList = await this.client.request<{ value?: FieldReference[] }>('/_apis/wit/fields?api-version=7.1');
      repositoryField = resolveFieldReference(fieldList.value ?? [], this.config.repositoryField);
    }
    if (this.config.workItemId !== undefined) {
      const item = await this.client.request<WorkItem>(
        `/_apis/wit/workitems/${this.config.workItemId}?%24expand=relations&api-version=7.1`,
      );
      const columnField = configuredColumnField
        ?? Object.keys(item.fields).find((field) => /^WEF_.+_Kanban\.Column$/i.test(field))
        ?? '';
      return { items: [item], columnField, repositoryField };
    }
    const boardPath = `/${encode(this.config.team)}/_apis/work/boards/${encode(resolvedBoard.id)}/columns?api-version=7.1`;
    const columns = await this.client.request<{ value?: Array<{ name: string }> }>(boardPath);
    if (!columns.value?.some((entry) => entry.name === this.config.column)) {
      const available = columns.value?.map((entry) => entry.name).join(', ') || 'nenhuma coluna retornada';
      throw new Error(`Coluna "${this.config.column}" não encontrada no board "${resolvedBoard.name}" da equipe "${this.config.team}". Colunas disponíveis: ${available}`);
    }

    const query = await this.client.request<{ workItems?: Array<{ id: number }> }>('/_apis/wit/wiql?api-version=7.1', {
      method: 'POST', body: { query: buildWiql(this.config) },
    });
    const ids = (query.workItems ?? []).map(({ id }) => id);
    const candidates: WorkItem[] = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      if (!batch.length) continue;
      const response = await this.client.request<{ value?: WorkItem[] }>('/_apis/wit/workitemsbatch?api-version=7.1', {
        method: 'POST', body: { ids: batch, $expand: 'Relations' },
      });
      candidates.push(...(response.value ?? []));
    }
    if (!candidates.length) return { items: [], columnField: configuredColumnField ?? '', repositoryField };
    const columnField = discoverColumnField(candidates, this.config.column, configuredColumnField);
    return { items: candidates.filter((item) => item.fields[columnField] === this.config.column), columnField, repositoryField };
  }
}
