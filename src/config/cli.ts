export type CliOptions = { workItemId?: number; help: boolean };

function workItemId(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error('O Work Item deve ser um ID numérico positivo');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('O Work Item deve ser um ID numérico positivo');
  return id;
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--work-item' || argument === '--work-item-id' || argument === '-w') {
      options.workItemId = workItemId(args[++index]);
      continue;
    }
    if (argument.startsWith('--work-item=')) {
      options.workItemId = workItemId(argument.slice('--work-item='.length));
      continue;
    }
    if (/^\d+$/.test(argument) && options.workItemId === undefined) {
      options.workItemId = workItemId(argument);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${argument}`);
  }
  return options;
}

export const CLI_USAGE = `Uso:
  npm run review
  npm run review -- --work-item 115528
  npm run review -- 115528

Opções:
  -w, --work-item <id>  Revisa um Work Item específico, ignorando coluna, estado e tipo
  -h, --help            Exibe esta ajuda`;
