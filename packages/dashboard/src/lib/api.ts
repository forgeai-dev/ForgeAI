const BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface HealthData {
  status: string;
  uptime: number;
  version: string;
  checks: Array<{ name: string; status: string; message?: string }>;
}

export interface InfoData {
  name: string;
  version: string;
  uptime: number;
  security: Record<string, boolean>;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  configured: boolean;
  models: string[];
}

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'status';
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  message: string;
  timestamp: string;
}

export interface ChatResponse {
  id: string;
  content: string;
  thinking?: string;
  model: string;
  provider: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  blocked: boolean;
  blockReason?: string;
  duration: number;
  sessionId: string;
  steps?: AgentStep[];
  toolIterations?: number;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  provider?: string;
  duration?: number;
  tokens?: number;
  blocked?: boolean;
  blockReason?: string;
  steps?: AgentStep[];
  senderName?: string;
  timestamp: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  channelType?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export interface StoredSession {
  id: string;
  title: string;
  channelType?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: StoredMessage[];
}

export interface AgentInfo {
  id: string;
  name: string;
  model: string;
  provider: string;
  sessionCount: number;
  totalTokens: number;
  isDefault: boolean;
  createdAt: string;
}

export interface PairingCode {
  code: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  usedBy: string[];
  role: 'user' | 'admin';
  label?: string;
  channel?: string;
}

export interface WorkspacePromptFile {
  filename: string;
  label: string;
  content: string;
  active: boolean;
  chars: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  labels: string[];
  isUnread: boolean;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
  getHealth: () => request<HealthData>('/health'),
  getInfo: () => request<InfoData>('/info'),
  getProviders: () => request<{ providers: ProviderInfo[]; routes: unknown[] }>('/api/providers'),
  sendMessage: (message: string, sessionId?: string, image?: { data: string; mimeType: string; filename: string }, agentId?: string, model?: string, provider?: string) =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId, image, agentId, model, provider }),
    }),
  getHistory: (sessionId: string) =>
    request<{ sessionId: string; messages: StoredMessage[] }>(
      `/api/chat/history/${sessionId}`
    ),
  clearHistory: (sessionId: string) =>
    request<{ success: boolean }>(`/api/chat/history/${sessionId}`, { method: 'DELETE' }),
  getSessions: () =>
    request<{ sessions: SessionSummary[] }>('/api/chat/sessions'),
  getSession: (sessionId: string) =>
    request<{ session: StoredSession | null }>(`/api/chat/sessions/${sessionId}`),
  deleteSession: (sessionId: string) =>
    request<{ success: boolean }>(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' }),
  deleteAllSessions: () =>
    request<{ success: boolean; deleted: number }>('/api/chat/sessions', { method: 'DELETE' }),
  stopSession: (sessionId: string) =>
    request<{ success: boolean; sessionId: string }>('/api/chat/stop', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  // Multi-agent
  getAgents: () => request<{ agents: AgentInfo[]; bindings: unknown[] }>('/api/agents'),
  addAgent: (agent: { id: string; name: string; model?: string; provider?: string; persona?: string }) =>
    request<{ success: boolean; agent: AgentInfo }>('/api/agents', { method: 'POST', body: JSON.stringify(agent) }),
  removeAgent: (id: string) => request<{ success: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  updateAgent: (id: string, updates: { model?: string; provider?: string; name?: string; persona?: string }) =>
    request<{ success: boolean; agent: AgentInfo }>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  // Pairing
  generatePairingCode: (opts?: { expiresInHours?: number; maxUses?: number; role?: string; label?: string }) =>
    request<PairingCode>('/api/pairing/generate', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  getPairingCodes: () => request<{ codes: PairingCode[] }>('/api/pairing/codes'),
  revokePairingCode: (code: string) => request<{ revoked: boolean }>(`/api/pairing/codes/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  getPairingStats: () => request<{ total: number; active: number; expired: number; totalRedeemed: number }>('/api/pairing/stats'),
  // Gmail
  getGmailStatus: () => request<{ configured: boolean }>('/api/integrations/gmail/status'),
  configureGmail: (accessToken: string) =>
    request<{ configured: boolean }>('/api/integrations/gmail/configure', { method: 'POST', body: JSON.stringify({ accessToken }) }),
  getGmailMessages: (opts?: { maxResults?: number; query?: string }) => {
    const params = new URLSearchParams();
    if (opts?.maxResults) params.set('maxResults', String(opts.maxResults));
    if (opts?.query) params.set('query', opts.query);
    const qs = params.toString();
    return request<{ messages: GmailMessage[] }>(`/api/integrations/gmail/messages${qs ? `?${qs}` : ''}`);
  },
  getGmailMessage: (id: string) => request<{ message: GmailMessage }>(`/api/integrations/gmail/messages/${id}`),
  sendGmail: (to: string, subject: string, body: string) =>
    request<{ sent: boolean; id?: string }>('/api/integrations/gmail/send', { method: 'POST', body: JSON.stringify({ to, subject, body }) }),
  searchGmail: (q: string, maxResults?: number) => {
    const params = new URLSearchParams({ q });
    if (maxResults) params.set('maxResults', String(maxResults));
    return request<{ messages: GmailMessage[] }>(`/api/integrations/gmail/search?${params}`);
  },
  getGmailLabels: () => request<{ labels: Array<{ id: string; name: string; type: string; messagesTotal: number }> }>('/api/integrations/gmail/labels'),
  getGmailUnread: () => request<{ unreadCount: number }>('/api/integrations/gmail/unread'),
  markGmailRead: (id: string) => request<{ success: boolean }>(`/api/integrations/gmail/messages/${id}/read`, { method: 'POST' }),
  // Active sessions (progress recovery)
  getActiveSessions: () =>
    request<{ active: Array<{ agentId: string; sessionId: string; status: string; iteration: number; maxIterations: number; currentTool?: string; steps: AgentStep[]; startedAt: number }> }>('/api/chat/active'),
  // Activity Monitoring
  getActivity: (opts?: { type?: string; target?: string; riskLevel?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.target) params.set('target', opts.target);
    if (opts?.riskLevel) params.set('riskLevel', opts.riskLevel);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ activities: Array<{
      id: number; timestamp: string; type: string; toolName: string; target: string;
      command?: string; summary: string; riskLevel: string; success: boolean;
      durationMs?: number; sessionId?: string; userId?: string;
    }> }>(`/api/activity${qs ? `?${qs}` : ''}`);
  },
  getActivityStats: () =>
    request<{ stats: { totalToday: number; hostToday: number; blockedToday: number; errorToday: number } }>('/api/activity/stats'),
  // Workspace Prompts
  getWorkspacePrompts: () => request<{ files: WorkspacePromptFile[] }>('/api/workspace/prompts'),
  getWorkspacePrompt: (filename: string) => request<{ filename: string; content: string }>(`/api/workspace/prompts/${encodeURIComponent(filename)}`),
  saveWorkspacePrompt: (filename: string, content: string) =>
    request<{ saved: boolean; filename: string; chars: number }>(`/api/workspace/prompts/${encodeURIComponent(filename)}`, {
      method: 'PUT', body: JSON.stringify({ content }),
    }),
};
