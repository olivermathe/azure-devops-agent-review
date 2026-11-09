export type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

const line = (level: string, message: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  return `[${level}] ${message}${suffix}`;
};

export const logger: Logger = {
  info: (message, details) => console.log(line('INFO', String(message), details as Record<string, unknown> | undefined)),
  warn: (message, details) => console.warn(line('WARN', String(message), details as Record<string, unknown> | undefined)),
  error: (message, details) => console.error(line('ERROR', String(message), details as Record<string, unknown> | undefined)),
};
