import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config/env.js';
import { GitRelationsService } from '../azure-devops/git-relations.js';
import { parseGitRelations, WorkItemService } from '../azure-devops/work-items.js';
import { GitService } from '../git/git.service.js';
import { KiroService } from '../kiro/kiro.service.js';
import { buildReviewPrompt, loadCustomReviewPrompt, reviewRulesVersion } from '../kiro/review-prompt.js';
import type { Logger } from '../logger.js';
import { MarkdownService, countFindings } from '../reports/markdown.service.js';
import type { ArtifactReview, ReviewTarget, WorkItem, WorkItemResult } from '../types.js';
import { emptyCounts } from '../types.js';
import type { TeamsService } from '../teams/teams.service.js';
import { reviewKey, ReviewStore } from './review-store.js';

export function repositoryMatchesField(fieldValue: unknown, repositoryName: string): boolean {
  if (typeof fieldValue !== 'string' || !fieldValue.trim() || !repositoryName.trim()) return false;
  let value = fieldValue;
  try { value = decodeURIComponent(value); } catch { /* use the original free text */ }
  const escapedName = repositoryName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9._-])${escapedName}(?=$|[^a-z0-9._-])`, 'i').test(value);
}

export function targetBranchAllowed(targetRef: string | undefined, configured: '*' | string[]): boolean {
  if (configured === '*') return true;
  if (!targetRef) return false;
  const branch = targetRef.replace(/^refs\/heads\//, '');
  return configured.includes(branch);
}

export class ReviewOrchestrator {
  private customPrompt?: string;
  private rulesVersion = reviewRulesVersion();

  constructor(
    private readonly config: Config,
    private readonly workItems: WorkItemService,
    private readonly relations: GitRelationsService,
    private readonly git: GitService,
    private readonly kiro: KiroService,
    private readonly reports: MarkdownService,
    private readonly store: ReviewStore,
    private readonly log: Logger,
    private readonly teams?: TeamsService,
  ) {}

  async run(): Promise<WorkItemResult[]> {
    this.customPrompt = await loadCustomReviewPrompt(this.config.customPromptFile);
    this.rulesVersion = reviewRulesVersion(this.customPrompt);
    if (this.customPrompt) this.log.info('Prompt personalizado do Kiro carregado', { file: this.config.customPromptFile });
    this.log.info('Consultando Azure DevOps...');
    const { items, columnField, repositoryField } = await this.workItems.find();
    this.log.info(`${items.length} Work Item(s) encontrado(s) na coluna configurada`);
    await this.store.load();
    if (!this.config.dryRun) this.log.info(`Kiro disponível: ${await this.kiro.validate()}`);
    const results: WorkItemResult[] = [];
    for (const item of items) {
      const result = await this.processWorkItem(item, repositoryField);
      result.reportFile = await this.reports.writeWorkItem(result, columnField);
      if (this.teams?.shouldNotify(result)) {
        try {
          await this.teams.notify(result);
          this.log.info(`Resultado do Work Item #${item.id} enviado ao Teams`);
        } catch (error) {
          this.log.error(`Falha ao enviar Work Item #${item.id} ao Teams`, { error: (error as Error).message });
        }
      }
      results.push(result);
    }
    if (!this.config.dryRun) await this.store.save();
    await this.reports.writeIndex(results);
    this.log.info('Execução concluída', { reports: this.config.reportsDir });
    return results;
  }

  private async processWorkItem(item: WorkItem, repositoryField?: string): Promise<WorkItemResult> {
    this.log.info(`Analisando Work Item #${item.id}`);
    try {
      const artifacts = parseGitRelations(item);
      if (!artifacts.length) {
        this.log.warn(`Work Item #${item.id} sem vínculos Git oficiais`);
        return { item, status: 'ignored', reviews: [] };
      }
      const resolution = await this.relations.resolve(artifacts);
      let targets = resolution.targets;
      const notes: string[] = [...resolution.skipped];
      for (const skipped of resolution.skipped) this.log.warn(`Work Item #${item.id}: ${skipped}`);
      if (!targets.length) {
        const error = resolution.errors.join(' | ') || undefined;
        return {
          item,
          status: error ? 'error' : 'ignored',
          reviews: [],
          error,
          note: notes.length ? notes.join(' ') : 'Nenhum PR ativo ou commit elegível foi encontrado.',
        };
      }
      if (this.config.filterByRepositoryField) {
        if (!repositoryField) throw new Error('Filtro por repositório habilitado, mas o campo não foi resolvido');
        const configuredValue = item.fields[repositoryField];
        if (typeof configuredValue !== 'string' || !configuredValue.trim()) {
          const message = `Campo ${this.config.repositoryField} vazio; nenhum vínculo Git será revisado`;
          this.log.warn(`Work Item #${item.id}: ${message}`);
          return { item, status: resolution.errors.length ? 'error' : 'ignored', reviews: [], note: message, error: resolution.errors.join(' | ') || undefined };
        }
        const before = targets.length;
        targets = targets.filter((target) => repositoryMatchesField(configuredValue, target.repository.name));
        const removed = before - targets.length;
        notes.push(`Filtro ${this.config.repositoryField}: ${targets.length} artefato(s) mantido(s), ${removed} descartado(s).`);
        this.log.info(`Work Item #${item.id}: filtro de repositório aplicado`, { kept: targets.length, removed });
        if (!targets.length && !resolution.errors.length) {
          return { item, status: 'ignored', reviews: [], note: notes.join(' ') };
        }
      }
      if (this.config.prTargetBranches !== '*') {
        const before = targets.length;
        targets = targets.filter((target) => target.kind === 'pr' && targetBranchAllowed(target.targetRef, this.config.prTargetBranches));
        const removed = before - targets.length;
        notes.push(`Filtro de branch destino (${this.config.prTargetBranches.join(', ')}): ${targets.length} PR(s) mantido(s), ${removed} artefato(s) descartado(s).`);
        this.log.info(`Work Item #${item.id}: filtro de branch destino aplicado`, { kept: targets.length, removed, branches: this.config.prTargetBranches });
        if (!targets.length && !resolution.errors.length) {
          return { item, status: 'ignored', reviews: [], note: notes.join(' ') };
        }
      }
      const reviews: ArtifactReview[] = [];
      for (const target of targets) reviews.push(await this.processTarget(item, target));
      const artifactErrors = reviews.filter((review) => review.status === 'error').map((review) => review.error).filter(Boolean);
      const errors = [...resolution.errors, ...artifactErrors];
      const hasError = errors.length > 0;
      return {
        item,
        status: hasError ? 'error' : this.config.dryRun ? 'dry-run' : 'reviewed',
        reviews,
        error: hasError ? errors.join(' | ') : undefined,
        note: notes.length ? notes.join(' ') : undefined,
      };
    } catch (error) {
      const message = (error as Error).message;
      this.log.error(`Falha no Work Item #${item.id}`, { error: message });
      return { item, status: 'error', reviews: [], error: message };
    }
  }

  private async processTarget(item: WorkItem, target: ReviewTarget): Promise<ArtifactReview> {
    const key = reviewKey(item.id, target, this.rulesVersion);
    if (!this.config.force) {
      const cached = this.store.get(key);
      if (cached) {
        this.log.info(`Reutilizando revisão válida de ${target.kind} ${target.id}`);
        return { ...cached, status: 'cached' };
      }
    }
    if (this.config.dryRun) {
      this.log.info(`[DRY_RUN] Revisaria ${target.kind} ${target.id}`, { repository: target.repository.name, head: target.headSha });
      return { target, status: 'dry-run', counts: emptyCounts() };
    }
    const temporary = await mkdtemp(join(tmpdir(), 'azdo-kiro-review-'));
    try {
      const repositoryPath = join(temporary, 'repository');
      const safeContextPath = join(temporary, 'kiro-context');
      await mkdir(safeContextPath);
      this.log.info(`Clonando ${target.repository.name}...`);
      await this.git.clone(target, repositoryPath);
      const diff = await this.git.prepare(target, repositoryPath);
      if (!diff.patch.trim()) return { target, status: 'empty', files: [], stats: diff.stats, counts: emptyCounts() };
      const contexts: Array<{ path: string; content: string }> = [];
      let contextBytes = 0;
      for (const path of diff.files.slice(0, 100)) {
        const content = await this.git.readChangedFile(repositoryPath, path);
        if (!content || contextBytes + Buffer.byteLength(content) > this.config.maxDiffBytes) continue;
        contexts.push({ path, content });
        contextBytes += Buffer.byteLength(content);
      }
      this.log.info(`Executando Kiro para ${target.kind} ${target.id}...`);
      const markdown = await this.kiro.review(buildReviewPrompt(item, target, diff, contexts, this.customPrompt), safeContextPath);
      const review: ArtifactReview = {
        target, status: 'reviewed', markdown, files: diff.files, stats: diff.stats, counts: countFindings(markdown),
      };
      this.store.set(key, review);
      return review;
    } catch (error) {
      const message = (error as Error).message;
      this.log.error(`Falha em ${target.kind} ${target.id}`, { error: message });
      return { target, status: 'error', error: message, counts: emptyCounts() };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
