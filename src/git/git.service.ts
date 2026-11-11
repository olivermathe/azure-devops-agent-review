import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Config } from '../config/env.js';
import type { ReviewTarget } from '../types.js';

const exec = promisify(execFile);

export type PreparedDiff = {
  baseSha: string;
  headSha: string;
  patch: string;
  stats: string;
  files: string[];
};

export function sanitizeAzureRemoteUrl(remote: string): string {
  let url: URL;
  try { url = new URL(remote); } catch { throw new Error('URL remota do repositório é inválida'); }
  const allowedHost = url.hostname === 'dev.azure.com' || url.hostname === 'visualstudio.com' || url.hostname.endsWith('.visualstudio.com');
  if (url.protocol !== 'https:' || !allowedHost) {
    throw new Error(`Host de repositório não permitido: ${url.hostname || '<desconhecido>'}`);
  }
  if (url.password) throw new Error('URL remota não pode conter senha');
  // Azure DevOps frequentemente inclui a organização como username na remoteUrl.
  // Ela não é usada para autenticação; o PAT segue somente no header do processo Git.
  url.username = '';
  return url.toString();
}

export function sanitizeAzureSshUrl(remote: string): string {
  const scpStyle = /^git@ssh\.dev\.azure\.com:v3\/([^/\0\r\n]+)\/([^/\0\r\n]+)\/([^/\0\r\n]+)$/;
  const urlStyle = /^ssh:\/\/git@ssh\.dev\.azure\.com\/v3\/([^/\0\r\n]+)\/([^/\0\r\n]+)\/([^/\0\r\n]+)$/;
  if (!scpStyle.test(remote) && !urlStyle.test(remote)) {
    throw new Error('URL SSH remota do Azure DevOps é inválida ou não permitida');
  }
  return remote;
}

export class GitService {
  constructor(private readonly config: Config, private readonly authorization: string) {}

  private async git(args: string[], cwd?: string): Promise<string> {
    const authentication = this.config.gitCloneProtocol === 'https'
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.extraheader',
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: ${this.authorization}`,
        }
      : {
          GIT_CONFIG_COUNT: '0',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
        };
    const result = await exec('git', args, {
      cwd,
      timeout: this.config.timeoutMs,
      maxBuffer: Math.max(this.config.maxDiffBytes * 2, 16 * 1024 * 1024),
      env: {
        ...process.env,
        ...authentication,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return result.stdout.trimEnd();
  }

  async clone(target: ReviewTarget, destination: string): Promise<void> {
    if (this.config.gitCloneProtocol === 'ssh' && !target.repository.sshUrl) {
      throw new Error(`Repositório ${target.repository.name} não forneceu sshUrl pela API do Azure DevOps`);
    }
    const remote = this.config.gitCloneProtocol === 'ssh'
      ? sanitizeAzureSshUrl(target.repository.sshUrl!)
      : sanitizeAzureRemoteUrl(target.repository.remoteUrl);
    await this.git(['clone', '--quiet', '--no-checkout', '--', remote, destination]);
  }

  async prepare(target: ReviewTarget, repositoryPath: string): Promise<PreparedDiff> {
    let baseSha: string;
    if (target.kind === 'pr') {
      if (!target.targetRef) throw new Error(`PR #${target.id} sem branch de destino`);
      await this.git(['fetch', '--quiet', '--no-tags', 'origin', `${target.targetRef}:refs/remotes/origin/review-base`], repositoryPath);
      await this.git(['fetch', '--quiet', '--no-tags', 'origin', target.headSha], repositoryPath);
      baseSha = await this.git(['merge-base', target.headSha, 'refs/remotes/origin/review-base'], repositoryPath);
    } else {
      await this.git(['fetch', '--quiet', '--no-tags', 'origin', target.headSha], repositoryPath);
      const parentLine = await this.git(['rev-list', '--parents', '-n', '1', target.headSha], repositoryPath);
      const parents = parentLine.split(/\s+/).slice(1);
      if (!parents.length) {
        const emptyTree = await this.git(['hash-object', '-t', 'tree', '/dev/null'], repositoryPath);
        baseSha = emptyTree;
      } else {
        baseSha = parents[0]!;
      }
    }
    await this.git(['checkout', '--quiet', '--detach', target.headSha], repositoryPath);
    const filesText = await this.git(['diff', '--name-only', '-z', baseSha, target.headSha], repositoryPath);
    const files = filesText ? filesText.split('\0').filter(Boolean) : [];
    const stats = await this.git(['diff', '--stat', baseSha, target.headSha], repositoryPath);
    const patch = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--unified=5', baseSha, target.headSha], repositoryPath);
    if (Buffer.byteLength(patch, 'utf8') > this.config.maxDiffBytes) {
      throw new Error(`Diff excede MAX_DIFF_BYTES (${this.config.maxDiffBytes}); aumente o limite conscientemente`);
    }
    return { baseSha, headSha: target.headSha, patch, stats, files };
  }

  async readChangedFile(repositoryPath: string, relativePath: string, maxBytes = 256_000): Promise<string | undefined> {
    if (relativePath.includes('\0')) return undefined;
    const root = await import('node:path').then(({ resolve }) => resolve(repositoryPath));
    const absolute = await import('node:path').then(({ resolve }) => resolve(repositoryPath, relativePath));
    if (absolute !== root && !absolute.startsWith(`${root}/`)) return undefined;
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > maxBytes) return undefined;
      const data = await readFile(absolute);
      if (data.includes(0)) return undefined;
      return data.toString('utf8');
    } catch {
      return undefined;
    }
  }
}
