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
  sshUrl?: string;
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

export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export type ReviewFinding = {
  category: 'confirmed' | 'risk';
  title: string;
  severity: ReviewSeverity;
  locations: Array<{ file: string; line: number; endLine?: number }>;
  problem: string;
  impact: string;
  correction: string;
};

export type ReviewAnalysis = {
  summary: string;
  findings: ReviewFinding[];
};

export type ArtifactReview = {
  target: ReviewTarget;
  status: 'reviewed' | 'cached' | 'dry-run' | 'empty' | 'error';
  markdown?: string;
  analysis?: ReviewAnalysis;
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
