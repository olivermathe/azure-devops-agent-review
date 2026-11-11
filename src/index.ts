import { AzureDevOpsClient } from './azure-devops/client.js';
import { GitRelationsService } from './azure-devops/git-relations.js';
import { WorkItemService } from './azure-devops/work-items.js';
import { loadDotEnv, readConfig } from './config/env.js';
import { CLI_USAGE, parseCliArgs } from './config/cli.js';
import { GitService } from './git/git.service.js';
import { logger } from './logger.js';
import { MarkdownService } from './reports/markdown.service.js';
import { ReviewOrchestrator } from './review/review-orchestrator.js';
import { ReviewStore } from './review/review-store.js';
import { TeamsService } from './teams/teams.service.js';
import { createReviewCliService } from './review-cli/review-cli.service.js';

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(CLI_USAGE);
    return;
  }
  await loadDotEnv();
  const config = { ...readConfig(), workItemId: cli.workItemId };
  const client = new AzureDevOpsClient(config);
  const orchestrator = new ReviewOrchestrator(
    config,
    new WorkItemService(client, config),
    new GitRelationsService(client),
    new GitService(config, client.authHeader),
    createReviewCliService(config),
    new MarkdownService(config),
    new ReviewStore(config.stateFile),
    logger,
    config.teamsEnabled ? new TeamsService(config) : undefined,
  );
  await orchestrator.run();
}

main().catch((error) => {
  logger.error('Execução interrompida', { error: (error as Error).message });
  process.exitCode = 1;
});
