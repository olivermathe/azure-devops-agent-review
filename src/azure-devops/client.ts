import type { Config } from '../config/env.js';

export class AzureDevOpsClient {
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(private readonly config: Config) {
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}`;
    this.authorization = `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`;
  }

  get authHeader(): string {
    return this.authorization;
  }

  webUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const init: RequestInit = {
        method: options.method ?? 'GET',
        signal: controller.signal,
        headers: {
          Authorization: this.authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      const response = await fetch(path.startsWith('https://') ? path : `${this.baseUrl}${path}`, init);
      if (!response.ok) {
        const requestId = response.headers.get('x-vss-e2eid');
        throw new Error(`Azure DevOps HTTP ${response.status}${requestId ? ` (${requestId})` : ''}: ${(await response.text()).slice(0, 300)}`);
      }
      return await response.json() as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new Error(`Timeout ao acessar Azure DevOps após ${this.config.timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
