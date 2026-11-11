import type { Config } from '../config/env.js';
import { ClaudeService } from './claude.service.js';
import { CodexService } from './codex.service.js';
import { KiroService } from '../kiro/kiro.service.js';

export interface ReviewCliService {
  readonly name: Config['reviewCli'];
  validate(): Promise<string>;
  review(prompt: string, safeWorkingDirectory: string): Promise<string>;
}

export function createReviewCliService(config: Config): ReviewCliService {
  switch (config.reviewCli) {
    case 'claude': return new ClaudeService(config);
    case 'codex': return new CodexService(config);
    case 'kiro': return new KiroService(config);
  }
}
