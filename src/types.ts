export type WorkItem = {
  id: number;
  url?: string;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
};

export type WorkItemRelation = {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
};

export type GitArtifact = {
  kind: 'pr' | 'commit';
  projectId: string;
  repositoryId: string;
  id: string;
};

export type RepositoryInfo = {
  id: string;
  name: string;
  remoteUrl: string;
  webUrl?: string;
  project?: { id: string; name: string };
};

export type PullRequestInfo = {
  pullRequestId: number;
  title: string;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit?: { commitId: string };
  repository: RepositoryInfo;
  url?: string;
  isDraft?: boolean;
  status?: string;
};

export type ReviewTarget = GitArtifact & {
  repository: RepositoryInfo;
  headSha: string;
  sourceRef?: string;
  targetRef?: string;
  pullRequest?: PullRequestInfo;
};

export type FindingCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
};

export type ArtifactReview = {
  target: ReviewTarget;
  status: 'reviewed' | 'cached' | 'dry-run' | 'empty' | 'error';
  markdown?: string;
  files?: string[];
  stats?: string;
  error?: string;
  counts: FindingCounts;
};

export type WorkItemResult = {
  item: WorkItem;
  status: 'reviewed' | 'ignored' | 'dry-run' | 'error';
  reviews: ArtifactReview[];
  error?: string;
  note?: string;
  reportFile?: string;
};

export const emptyCounts = (): FindingCounts => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  informational: 0,
});
