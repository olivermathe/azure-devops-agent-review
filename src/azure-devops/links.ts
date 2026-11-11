import type { Config } from '../config/env.js';
import type { ReviewTarget } from '../types.js';

export function pullRequestUrl(config: Pick<Config, 'org' | 'project'>, target: ReviewTarget): string | undefined {
  if (target.kind !== 'pr') return undefined;
  return `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_git/${encodeURIComponent(target.repository.name)}/pullrequest/${target.id}`;
}

export function pullRequestLineUrl(
  config: Pick<Config, 'org' | 'project'>,
  target: ReviewTarget,
  location: { file: string; line: number; endLine?: number },
): string | undefined {
  const base = pullRequestUrl(config, target);
  if (!base) return undefined;
  const path = location.file.startsWith('/') ? location.file : `/${location.file}`;
  const params = new URLSearchParams({
    path,
    line: String(location.line),
    lineEnd: String((location.endLine ?? location.line) + 1),
    lineStartColumn: '1',
    lineEndColumn: '1',
    lineStyle: 'plain',
    _a: 'files',
  });
  return `${base}?${params.toString()}`;
}
