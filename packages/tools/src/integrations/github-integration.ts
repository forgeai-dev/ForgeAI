import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:GitHub');

export interface GitHubConfig {
  token: string;
  owner?: string;
  repo?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  author: string;
  createdAt: string;
  url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  branch: string;
  mergeable: boolean;
  createdAt: string;
  url: string;
}

export interface GitHubSearchResult {
  totalCount: number;
  items: Array<{ path: string; repository: string; url: string; textMatches?: string[] }>;
}

export class GitHubIntegration {
  private config: GitHubConfig | null = null;
  private baseUrl = 'https://api.github.com';

  constructor() {
    logger.info('GitHub integration initialized');
  }

  configure(config: GitHubConfig): void {
    this.config = config;
    logger.info('GitHub configured', { owner: config.owner, repo: config.repo });
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.token;
  }

  async listIssues(owner?: string, repo?: string, state: 'open' | 'closed' | 'all' = 'open', limit = 10): Promise<GitHubIssue[]> {
    const o = owner ?? this.config?.owner;
    const r = repo ?? this.config?.repo;
    if (!o || !r) return [];

    const data = await this.request<Array<Record<string, unknown>>>(`/repos/${o}/${r}/issues?state=${state}&per_page=${limit}`);
    if (!data) return [];

    return data.filter((i: Record<string, unknown>) => !i.pull_request).map((i: Record<string, unknown>) => ({
      number: i.number as number,
      title: i.title as string,
      body: ((i.body as string) ?? '').slice(0, 500),
      state: i.state as string,
      labels: ((i.labels as Array<{ name: string }>) ?? []).map(l => l.name),
      author: (i.user as Record<string, unknown>)?.login as string ?? 'unknown',
      createdAt: i.created_at as string,
      url: i.html_url as string,
    }));
  }

  async listPRs(owner?: string, repo?: string, state: 'open' | 'closed' | 'all' = 'open', limit = 10): Promise<GitHubPR[]> {
    const o = owner ?? this.config?.owner;
    const r = repo ?? this.config?.repo;
    if (!o || !r) return [];

    const data = await this.request<Array<Record<string, unknown>>>(`/repos/${o}/${r}/pulls?state=${state}&per_page=${limit}`);
    if (!data) return [];

    return data.map((p: Record<string, unknown>) => ({
      number: p.number as number,
      title: p.title as string,
      body: ((p.body as string) ?? '').slice(0, 500),
      state: p.state as string,
      author: (p.user as Record<string, unknown>)?.login as string ?? 'unknown',
      branch: (p.head as Record<string, unknown>)?.ref as string ?? '',
      mergeable: (p.mergeable as boolean) ?? false,
      createdAt: p.created_at as string,
      url: p.html_url as string,
    }));
  }

  async searchCode(query: string, owner?: string, repo?: string): Promise<GitHubSearchResult> {
    const o = owner ?? this.config?.owner;
    const r = repo ?? this.config?.repo;
    const q = r && o ? `${query}+repo:${o}/${r}` : query;

    const data = await this.request<Record<string, unknown>>(`/search/code?q=${encodeURIComponent(q)}&per_page=10`);
    if (!data) return { totalCount: 0, items: [] };

    return {
      totalCount: data.total_count as number,
      items: ((data.items as Array<Record<string, unknown>>) ?? []).map(i => ({
        path: i.path as string,
        repository: (i.repository as Record<string, unknown>)?.full_name as string ?? '',
        url: i.html_url as string,
      })),
    };
  }

  async createIssue(title: string, body: string, labels: string[] = [], owner?: string, repo?: string): Promise<GitHubIssue | null> {
    const o = owner ?? this.config?.owner;
    const r = repo ?? this.config?.repo;
    if (!o || !r) return null;

    const data = await this.request<Record<string, unknown>>(`/repos/${o}/${r}/issues`, 'POST', { title, body, labels });
    if (!data) return null;

    return {
      number: data.number as number,
      title: data.title as string,
      body: ((data.body as string) ?? '').slice(0, 500),
      state: data.state as string,
      labels: ((data.labels as Array<{ name: string }>) ?? []).map(l => l.name),
      author: (data.user as Record<string, unknown>)?.login as string ?? 'unknown',
      createdAt: data.created_at as string,
      url: data.html_url as string,
    };
  }

  async getRepoInfo(owner?: string, repo?: string): Promise<Record<string, unknown> | null> {
    const o = owner ?? this.config?.owner;
    const r = repo ?? this.config?.repo;
    if (!o || !r) return null;

    const data = await this.request<Record<string, unknown>>(`/repos/${o}/${r}`);
    if (!data) return null;

    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      language: data.language,
      defaultBranch: data.default_branch,
      url: data.html_url,
    };
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
    if (!this.config?.token) return null;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        logger.warn('GitHub API error', { path, status: res.status });
        return null;
      }

      return await res.json() as T;
    } catch (err) {
      logger.error('GitHub request failed', { path, error: String(err) });
      return null;
    }
  }
}

export function createGitHubIntegration(): GitHubIntegration {
  return new GitHubIntegration();
}
