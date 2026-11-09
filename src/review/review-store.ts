import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ArtifactReview, ReviewTarget } from '../types.js';

type StoredReview = { reviewedAt: string; review: ArtifactReview };
type State = { version: 1; reviews: Record<string, StoredReview> };

export function reviewKey(workItemId: number, target: ReviewTarget, rulesVersion: string): string {
  return [workItemId, target.repository.id, target.kind, target.id, target.headSha, rulesVersion].join(':');
}

export class ReviewStore {
  private state: State = { version: 1, reviews: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as State;
      if (parsed.version === 1 && parsed.reviews && typeof parsed.reviews === 'object') this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Estado de revisão inválido: ${(error as Error).message}`);
    }
  }

  get(key: string): ArtifactReview | undefined {
    return this.state.reviews[key]?.review;
  }

  set(key: string, review: ArtifactReview): void {
    this.state.reviews[key] = { reviewedAt: new Date().toISOString(), review };
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }
}
