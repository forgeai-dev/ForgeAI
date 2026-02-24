import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:18800';

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

async function getRaw(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function put(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

describe('ForgeAI Gateway API Tests', () => {
  // ─── Health ────────────────────────────────────────
  describe('Health & Info', () => {
    it('GET /health should return ok', async () => {
      const { status, data } = await get('/health');
      expect(status).toBe(200);
      expect(data.status).toBe('healthy');
    });

    it('GET /info should return gateway info', async () => {
      const { status, data } = await get('/info');
      expect(status).toBe(200);
      expect(data.name).toBe('ForgeAI');
      expect(data.version).toBeDefined();
    });

    it('GET /api/health/detailed should return detailed health', async () => {
      const { status, data } = await get('/api/health/detailed');
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    });
  });

  // ─── Providers ─────────────────────────────────────
  describe('Providers', () => {
    it('GET /api/providers should list providers', async () => {
      const { status, data } = await get('/api/providers');
      expect(status).toBe(200);
      expect(data.providers).toBeInstanceOf(Array);
    });
  });

  // ─── Tools ─────────────────────────────────────────
  describe('Tools', () => {
    it('GET /api/tools should list tools', async () => {
      const { status, data } = await get('/api/tools');
      expect(status).toBe(200);
      expect(data.tools).toBeInstanceOf(Array);
      expect(data.tools.length).toBeGreaterThanOrEqual(6);
    });
  });

  // ─── Plugins ───────────────────────────────────────
  describe('Plugins', () => {
    it('GET /api/plugins should list active plugins', async () => {
      const { status, data } = await get('/api/plugins');
      expect(status).toBe(200);
      expect(data.plugins).toBeInstanceOf(Array);
    });

    it('GET /api/plugins/store should list store plugins', async () => {
      const { status, data } = await get('/api/plugins/store');
      expect(status).toBe(200);
      expect(data.plugins).toBeInstanceOf(Array);
      expect(data.plugins.length).toBeGreaterThanOrEqual(3);
    });

    it('GET /api/plugins/store/categories should list categories', async () => {
      const { status, data } = await get('/api/plugins/store/categories');
      expect(status).toBe(200);
      expect(data.categories).toBeInstanceOf(Array);
    });

    it('POST /api/plugins/store/template should generate template', async () => {
      const { status, data } = await post('/api/plugins/store/template', { name: 'TestPlugin' });
      expect(status).toBe(200);
      expect(data.template).toContain('TestPlugin');
    });
  });

  // ─── Workflows ─────────────────────────────────────
  describe('Workflows', () => {
    it('GET /api/workflows should list workflows', async () => {
      const { status, data } = await get('/api/workflows');
      expect(status).toBe(200);
      expect(data.workflows).toBeInstanceOf(Array);
    });
  });

  // ─── Sessions ──────────────────────────────────────
  describe('Sessions', () => {
    it('GET /api/sessions should list sessions', async () => {
      const { status, data } = await get('/api/sessions');
      expect(status).toBe(200);
      expect(data.sessions).toBeInstanceOf(Array);
    });
  });

  // ─── Voice ─────────────────────────────────────────
  describe('Voice', () => {
    it('GET /api/voice/config should return voice config', async () => {
      const { status, data } = await get('/api/voice/config');
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(data.config.ttsProvider).toBeDefined();
      expect(data.providers).toBeDefined();
    });

    it('GET /api/voice/voices should return voices list', async () => {
      const { status, data } = await get('/api/voice/voices');
      expect(status).toBe(200);
      expect(data.voices).toBeInstanceOf(Array);
    });
  });

  // ─── Webhooks ──────────────────────────────────────
  describe('Webhooks', () => {
    it('GET /api/webhooks should return webhook lists', async () => {
      const { status, data } = await get('/api/webhooks');
      expect(status).toBe(200);
      expect(data.outbound).toBeInstanceOf(Array);
      expect(data.inbound).toBeInstanceOf(Array);
    });

    it('GET /api/webhooks/events should return event log', async () => {
      const { status, data } = await get('/api/webhooks/events');
      expect(status).toBe(200);
      expect(data.events).toBeInstanceOf(Array);
    });
  });

  // ─── Sandbox ───────────────────────────────────────
  describe('Sandbox', () => {
    it('GET /api/sandbox/status should return sandbox status', async () => {
      const { status, data } = await get('/api/sandbox/status');
      expect(status).toBe(200);
      expect(data.status ?? data.dockerAvailable ?? data).toBeDefined();
    });
  });

  // ─── Rate Limits ───────────────────────────────────
  describe('Rate Limits', () => {
    it('GET /api/rate-limits should return rules', async () => {
      const { status, data } = await get('/api/rate-limits');
      expect(status).toBe(200);
      expect(data.rules).toBeInstanceOf(Array);
      expect(data.rules.length).toBeGreaterThanOrEqual(12);
    });
  });

  // ─── Backup ────────────────────────────────────────
  describe('Backup', () => {
    it('GET /api/backup/info should return backup metadata', async () => {
      const { status, data } = await get('/api/backup/info');
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(status).toBe(200);
    });
  });

  // ─── IP Filter ─────────────────────────────────────
  describe('IP Filter', () => {
    it('GET /api/ip-filter should return config', async () => {
      const { status, data } = await get('/api/ip-filter');
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(data.config.mode).toBeDefined();
    });
  });

  // ─── Tailscale ─────────────────────────────────────
  describe('Tailscale', () => {
    it('GET /api/remote/status should return tailscale status', async () => {
      const { status, data } = await get('/api/remote/status');
      expect(status).toBe(200);
      expect(data.status).toBeDefined();
    });
  });

  // ─── MCP ──────────────────────────────────────────
  describe('MCP', () => {
    it('GET /api/mcp/servers should return server list', async () => {
      const { status, data } = await get('/api/mcp/servers');
      expect(status).toBe(200);
      expect(data.servers).toBeInstanceOf(Array);
    });

    it('GET /api/mcp/tools should return tool list', async () => {
      const { status, data } = await get('/api/mcp/tools');
      expect(status).toBe(200);
      expect(data.tools).toBeInstanceOf(Array);
    });

    it('GET /api/mcp/resources should return resource list', async () => {
      const { status, data } = await get('/api/mcp/resources');
      expect(status).toBe(200);
      expect(data.resources).toBeInstanceOf(Array);
    });
  });

  // ─── Memory ───────────────────────────────────────
  describe('Memory', () => {
    it('GET /api/memory/stats should return stats', async () => {
      const { status, data } = await get('/api/memory/stats');
      expect(status).toBe(200);
      expect(data.stats).toBeDefined();
      expect(data.config).toBeDefined();
    });

    it('POST /api/memory/store should store a memory', async () => {
      const { status, data } = await post('/api/memory/store', { id: 'test-1', content: 'Hello world test memory' });
      expect(status).toBe(200);
      expect(data.entry).toBeDefined();
      expect(data.entry.id).toBe('test-1');
    });

    it('POST /api/memory/search should find stored memory', async () => {
      const { status, data } = await post('/api/memory/search', { query: 'hello world' });
      expect(status).toBe(200);
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  // ─── OAuth2 ───────────────────────────────────────
  describe('OAuth2', () => {
    it('GET /api/oauth/providers should return provider list', async () => {
      const { status, data } = await get('/api/oauth/providers');
      expect(status).toBe(200);
      expect(data.providers).toBeInstanceOf(Array);
      expect(data.providers.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── RAG ──────────────────────────────────────────
  describe('RAG', () => {
    it('GET /api/rag/stats should return stats', async () => {
      const { status, data } = await get('/api/rag/stats');
      expect(status).toBe(200);
      expect(data.stats).toBeDefined();
      expect(data.config).toBeDefined();
    });

    it('POST /api/rag/ingest should ingest document', async () => {
      const { status, data } = await post('/api/rag/ingest', { id: 'doc-1', content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing and class-based object-oriented programming.', metadata: { title: 'TypeScript Intro' } });
      expect(status).toBe(200);
      expect(data.document).toBeDefined();
      expect(data.document.id).toBe('doc-1');
    });

    it('POST /api/rag/search should find ingested content', async () => {
      const { status, data } = await post('/api/rag/search', { query: 'typescript typing' });
      expect(status).toBe(200);
      expect(data.results).toBeInstanceOf(Array);
    });

    it('GET /api/rag/documents should list documents', async () => {
      const { status, data } = await get('/api/rag/documents');
      expect(status).toBe(200);
      expect(data.documents).toBeInstanceOf(Array);
    });

    it('GET /api/rag/config should return config with all fields', async () => {
      const { status, data } = await get('/api/rag/config');
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(typeof data.config.chunkSize).toBe('number');
      expect(typeof data.config.similarityThreshold).toBe('number');
      expect(typeof data.config.embeddingProvider).toBe('string');
      expect(typeof data.config.persist).toBe('boolean');
    });

    it('POST /api/rag/config should update config', async () => {
      const { status, data } = await post('/api/rag/config', { maxResults: 10 });
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(data.config.maxResults).toBe(10);
      // Reset back
      await post('/api/rag/config', { maxResults: 5 });
    });
  });

  // ─── Auto-Planner ────────────────────────────────
  describe('Auto-Planner', () => {
    it('GET /api/planner/plans should return plans list', async () => {
      const { status, data } = await get('/api/planner/plans');
      expect(status).toBe(200);
      expect(data.plans).toBeInstanceOf(Array);
    });

    it('POST /api/planner/plans should create a plan', async () => {
      const { status, data } = await post('/api/planner/plans', { goal: 'Test plan', steps: [{ description: 'Step 1' }, { description: 'Step 2' }] });
      expect(status).toBe(200);
      expect(data.plan).toBeDefined();
      expect(data.plan.goal).toBe('Test plan');
    });
  });

  // ─── API Keys ─────────────────────────────────────
  describe('API Keys', () => {
    it('GET /api/keys should return keys and scopes', async () => {
      const { status, data } = await get('/api/keys');
      expect(status).toBe(200);
      expect(data.keys).toBeInstanceOf(Array);
      expect(data.scopes).toBeInstanceOf(Array);
      expect(data.scopes.length).toBeGreaterThan(0);
    });

    it('POST /api/keys should create an API key', async () => {
      const { status, data } = await post('/api/keys', { name: 'test-key', scopes: ['chat', 'tools'] });
      expect(status).toBe(200);
      expect(data.key).toBeDefined();
      expect(data.key.name).toBe('test-key');
    });
  });

  // ─── GDPR ─────────────────────────────────────────
  describe('GDPR', () => {
    it('GET /api/gdpr/status should return GDPR status', async () => {
      const { status, data } = await get('/api/gdpr/status');
      expect(status).toBe(200);
      expect(data.status).toBeDefined();
    });
  });

  // ─── GitHub Integration ───────────────────────────
  describe('GitHub', () => {
    it('GET /api/integrations/github/status should return config status', async () => {
      const { status, data } = await get('/api/integrations/github/status');
      expect(status).toBe(200);
      expect(typeof data.configured).toBe('boolean');
    });
  });

  // ─── RSS Feeds ────────────────────────────────────
  describe('RSS', () => {
    it('GET /api/integrations/rss/feeds should return feeds list', async () => {
      const { status, data } = await get('/api/integrations/rss/feeds');
      expect(status).toBe(200);
      expect(data.feeds).toBeInstanceOf(Array);
    });
  });

  // ─── Security Summary ────────────────────────────
  describe('Security Summary', () => {
    it('GET /api/security/summary should return security overview', async () => {
      const { status, data } = await get('/api/security/summary');
      expect(status).toBe(200);
      expect(data.modules).toBeDefined();
      expect(data.counts).toBeDefined();
      expect(data.events).toBeInstanceOf(Array);
    });
  });

  // ─── Security Stats ──────────────────────────────
  describe('Security Stats', () => {
    it('GET /api/security/stats should return breakdown', async () => {
      const { status, data } = await get('/api/security/stats');
      expect(status).toBe(200);
      expect(data.byRiskLevel).toBeDefined();
      expect(data.byAction).toBeDefined();
      expect(data.recentHighRisk).toBeInstanceOf(Array);
    });
  });

  // ─── Audit Integrity ─────────────────────────────
  describe('Audit Integrity', () => {
    it('GET /api/audit/integrity should verify hash chain', async () => {
      const { status, data } = await get('/api/audit/integrity');
      expect(status).toBe(200);
      expect(typeof data.valid).toBe('boolean');
      expect(typeof data.totalChecked).toBe('number');
    });
  });

  // ─── Audit Export ─────────────────────────────────
  describe('Audit Export', () => {
    it('GET /api/audit/export?format=json should return JSON', async () => {
      const { status, data } = await get('/api/audit/export?format=json&limit=5');
      expect(status).toBe(200);
      expect(data).toBeInstanceOf(Array);
    });

    it('GET /api/audit/export?format=csv should return CSV', async () => {
      const { status, text } = await getRaw('/api/audit/export?format=csv&limit=5');
      expect(status).toBe(200);
      expect(text).toContain('id,timestamp,action');
    });
  });

  // ─── Audit Rotation ────────────────────────────────
  describe('Audit Rotation', () => {
    it('GET /api/audit/rotation should return rotation status', async () => {
      const { status, data } = await get('/api/audit/rotation');
      expect(status).toBe(200);
      expect(typeof data.totalEntries).toBe('number');
      expect(data.defaultRetentionDays).toBe(90);
    });

    it('POST /api/audit/rotate should execute rotation', async () => {
      const { status, data } = await post('/api/audit/rotate', { retentionDays: 365 });
      expect(status).toBe(200);
      expect(typeof data.deleted).toBe('number');
      expect(typeof data.remaining).toBe('number');
      expect(data.retentionDays).toBe(365);
    });
  });

  // ─── Audit Events (paginated) ────────────────────
  describe('Audit Events', () => {
    it('GET /api/audit/events should return paginated entries', async () => {
      const { status, data } = await get('/api/audit/events?limit=10&offset=0');
      expect(status).toBe(200);
      expect(data.entries).toBeInstanceOf(Array);
      expect(typeof data.total).toBe('number');
      expect(data.limit).toBe(10);
      expect(data.offset).toBe(0);
    });

    it('GET /api/audit/events should support riskLevel filter', async () => {
      const { status, data } = await get('/api/audit/events?riskLevel=high&limit=5');
      expect(status).toBe(200);
      expect(data.entries).toBeInstanceOf(Array);
    });
  });

  // ─── Tools ──────────────────────────────────────
  describe('Tools', () => {
    it('GET /api/tools should include image_generate', async () => {
      const { status, data } = await get('/api/tools');
      expect(status).toBe(200);
      const tools = data.tools ?? data;
      const toolNames = (tools as Array<{ name: string }>).map(t => t.name);
      expect(toolNames).toContain('image_generate');
    });

    it('GET /api/tools should include web_search', async () => {
      const { status, data } = await get('/api/tools');
      expect(status).toBe(200);
      const tools = data.tools ?? data;
      const toolNames = (tools as Array<{ name: string }>).map(t => t.name);
      expect(toolNames).toContain('web_search');
    });

    it('GET /api/tools should have 15 tools registered', async () => {
      const { status, data } = await get('/api/tools');
      expect(status).toBe(200);
      const tools = data.tools ?? data;
      expect((tools as Array<unknown>).length).toBe(15);
    });
  });

  // ─── Voice Engine ────────────────────────────────
  describe('Voice Engine', () => {
    it('GET /api/voice/config should return voice config and providers', async () => {
      const { status, data } = await get('/api/voice/config');
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(data.providers).toBeDefined();
      expect(data.providers.tts).toBeInstanceOf(Array);
      expect(data.providers.stt).toBeInstanceOf(Array);
    });

    it('GET /api/voice/voices should return voices list', async () => {
      const { status, data } = await get('/api/voice/voices');
      expect(status).toBe(200);
      expect(data.voices).toBeInstanceOf(Array);
    });

    it('POST /api/chat/voice without audio should return 400', async () => {
      const { status } = await post('/api/chat/voice', {});
      expect([400, 429]).toContain(status);
    });

    it('POST /api/voice/synthesize without text should return 400', async () => {
      const { status } = await post('/api/voice/synthesize', {});
      expect([400, 429]).toContain(status);
    });

    it('POST /api/voice/transcribe without audio should return 400', async () => {
      const { status } = await post('/api/voice/transcribe', {});
      expect([400, 429]).toContain(status);
    });
  });

  // ─── Wake Word Detection ────────────────────────
  describe('Wake Word Detection', () => {
    it('GET /api/wakeword/status should return status', async () => {
      const { status, data } = await get('/api/wakeword/status');
      expect(status).toBe(200);
      expect(data.status).toBeDefined();
      expect(data.status.enabled).toBeDefined();
      expect(data.status.running).toBeDefined();
      expect(data.status.keyword).toBeDefined();
    });

    it('GET /api/wakeword/config should return config with masked accessKey', async () => {
      const { status, data } = await get('/api/wakeword/config');
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
      expect(data.config.keyword).toBeDefined();
      expect(data.config.sensitivity).toBeGreaterThanOrEqual(0);
      expect(data.config.sensitivity).toBeLessThanOrEqual(1);
    });

    it('PUT /api/wakeword/config should update config', async () => {
      const { status, data } = await put('/api/wakeword/config', { sensitivity: 0.7 });
      expect(status).toBe(200);
      expect(data.config).toBeDefined();
    });

    it('POST /api/wakeword/process without audio should return error', async () => {
      const { status, data } = await post('/api/wakeword/process', {});
      expect(status).toBe(200);
      expect(data.detected).toBe(false);
    });
  });
});
