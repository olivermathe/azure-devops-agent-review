import type { GitArtifact, PullRequestInfo, RepositoryInfo, ReviewTarget } from '../types.js';
import { AzureDevOpsClient } from './client.js';

const encode = encodeURIComponent;

export class GitRelationsService {
  constructor(private readonly client: AzureDevOpsClient) {}

  async resolve(artifacts: GitArtifact[]): Promise<{ targets: ReviewTarget[]; errors: string[]; skipped: string[] }> {
    const pullRequests: ReviewTarget[] = [];
    const commits: ReviewTarget[] = [];
    const commitsCoveredByPr = new Set<string>();
    const errors: string[] = [];
    const skipped: string[] = [];

    for (const artifact of artifacts.filter((entry) => entry.kind === 'pr')) {
      try {
        const pr = await this.client.request<PullRequestInfo>(
          `/_apis/git/repositories/${encode(artifact.repositoryId)}/pullrequests/${encode(artifact.id)}?api-version=7.1`,
        );
        if (pr.status?.toLowerCase() !== 'active') {
          skipped.push(`PR #${artifact.id} ignorado: status ${pr.status || 'não informado'}.`);
          continue;
        }
        const headSha = pr.lastMergeSourceCommit?.commitId;
        if (!headSha) throw new Error(`PR #${artifact.id} não contém lastMergeSourceCommit.commitId`);
        const listed = await this.client.request<{ value?: Array<{ commitId: string }> }>(
          `/_apis/git/repositories/${encode(artifact.repositoryId)}/pullRequests/${encode(artifact.id)}/commits?api-version=7.1`,
        );
        for (const commit of listed.value ?? []) commitsCoveredByPr.add(`${artifact.repositoryId}:${commit.commitId.toLowerCase()}`);
        pullRequests.push({
          ...artifact,
          repository: pr.repository,
          headSha: headSha.toLowerCase(),
          sourceRef: pr.sourceRefName,
          targetRef: pr.targetRefName,
          pullRequest: pr,
        });
      } catch (error) {
        errors.push(`PR #${artifact.id} (${artifact.repositoryId}): ${(error as Error).message}`);
      }
    }

    const repositoryCache = new Map<string, RepositoryInfo>();
    for (const artifact of artifacts.filter((entry) => entry.kind === 'commit')) {
      if (commitsCoveredByPr.has(`${artifact.repositoryId}:${artifact.id.toLowerCase()}`)) continue;
      try {
        let repository = repositoryCache.get(artifact.repositoryId);
        if (!repository) {
          repository = await this.client.request<RepositoryInfo>(
            `/_apis/git/repositories/${encode(artifact.repositoryId)}?api-version=7.1`,
          );
          repositoryCache.set(artifact.repositoryId, repository);
        }
        commits.push({ ...artifact, repository, headSha: artifact.id.toLowerCase() });
      } catch (error) {
        errors.push(`Commit ${artifact.id} (${artifact.repositoryId}): ${(error as Error).message}`);
      }
    }
    return { targets: [...pullRequests, ...commits], errors, skipped };
  }

  pullRequestWebUrl(target: ReviewTarget): string | undefined {
    if (target.kind !== 'pr') return undefined;
    const project = target.repository.project?.name;
    if (!project) return undefined;
    return `https://dev.azure.com/${encode(project)}/_git/${encode(target.repository.name)}/pullrequest/${target.id}`;
  }
}
