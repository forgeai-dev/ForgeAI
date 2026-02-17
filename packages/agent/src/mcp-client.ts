import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:MCP');

export interface MCPServerConfig {
  name: string;
  url: string;
  apiKey?: string;
  transport: 'stdio' | 'sse' | 'http';
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  server: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  server: string;
}

export interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class MCPClient {
  private servers: Map<string, MCPServerConfig> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();
  private connected: Set<string> = new Set();

  constructor() {
    logger.info('MCP Client initialized');
  }

  addServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
    logger.info('MCP server registered', { name: config.name, transport: config.transport });
  }

  removeServer(name: string): void {
    this.servers.delete(name);
    this.connected.delete(name);
    // Remove tools/resources/prompts from this server
    for (const [key, tool] of this.tools) {
      if (tool.server === name) this.tools.delete(key);
    }
    for (const [key, resource] of this.resources) {
      if (resource.server === name) this.resources.delete(key);
    }
    for (const [key, prompt] of this.prompts) {
      if (prompt.server === name) this.prompts.delete(key);
    }
    logger.info('MCP server removed', { name });
  }

  async connect(serverName: string): Promise<{ success: boolean; error?: string }> {
    const config = this.servers.get(serverName);
    if (!config) return { success: false, error: `Server '${serverName}' not found` };
    if (!config.enabled) return { success: false, error: `Server '${serverName}' is disabled` };

    try {
      if (config.transport === 'http' || config.transport === 'sse') {
        // HTTP-based MCP server — discover capabilities
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

        // Initialize
        const initRes = await fetch(`${config.url}/mcp/initialize`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            clientInfo: { name: 'ForgeAI', version: '0.1.0' },
          }),
        });

        if (!initRes.ok) {
          return { success: false, error: `Init failed: ${initRes.status} ${initRes.statusText}` };
        }

        const initData = await initRes.json() as {
          serverInfo?: { name?: string };
          capabilities?: { tools?: unknown; resources?: unknown; prompts?: unknown };
        };
        logger.info('MCP server connected', { name: serverName, serverInfo: initData.serverInfo });

        // Discover tools
        if (initData.capabilities?.tools) {
          await this.discoverTools(config, headers);
        }

        // Discover resources
        if (initData.capabilities?.resources) {
          await this.discoverResources(config, headers);
        }

        // Discover prompts
        if (initData.capabilities?.prompts) {
          await this.discoverPrompts(config, headers);
        }
      } else {
        // stdio transport — would need child_process spawn, mark as connected for now
        logger.info('stdio MCP server registered (spawn on demand)', { name: serverName });
      }

      this.connected.add(serverName);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('MCP connection failed', { name: serverName, error });
      return { success: false, error };
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const tool = this.tools.get(toolName);
    if (!tool) return { content: [{ type: 'text', text: `Tool '${toolName}' not found` }], isError: true };

    const config = this.servers.get(tool.server);
    if (!config) return { content: [{ type: 'text', text: `Server '${tool.server}' not configured` }], isError: true };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

      const res = await fetch(`${config.url}/mcp/tools/call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: toolName, arguments: args }),
      });

      if (!res.ok) {
        return { content: [{ type: 'text', text: `Tool call failed: ${res.status}` }], isError: true };
      }

      return await res.json() as MCPCallResult;
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }

  async readResource(uri: string): Promise<MCPCallResult> {
    const resource = this.resources.get(uri);
    if (!resource) return { content: [{ type: 'text', text: `Resource '${uri}' not found` }], isError: true };

    const config = this.servers.get(resource.server);
    if (!config) return { content: [{ type: 'text', text: `Server not configured` }], isError: true };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

      const res = await fetch(`${config.url}/mcp/resources/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uri }),
      });

      if (!res.ok) {
        return { content: [{ type: 'text', text: `Resource read failed: ${res.status}` }], isError: true };
      }

      return await res.json() as MCPCallResult;
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values());
  }

  getServers(): Array<MCPServerConfig & { connected: boolean; toolCount: number }> {
    return Array.from(this.servers.values()).map(s => ({
      ...s,
      connected: this.connected.has(s.name),
      toolCount: Array.from(this.tools.values()).filter(t => t.server === s.name).length,
    }));
  }

  isConnected(name: string): boolean {
    return this.connected.has(name);
  }

  private async discoverTools(config: MCPServerConfig, headers: Record<string, string>): Promise<void> {
    try {
      const res = await fetch(`${config.url}/mcp/tools/list`, { method: 'POST', headers, body: '{}' });
      if (!res.ok) return;
      const data = await res.json() as { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
      if (data.tools) {
        for (const tool of data.tools) {
          this.tools.set(tool.name, { ...tool, server: config.name });
        }
        logger.info('MCP tools discovered', { server: config.name, count: data.tools.length });
      }
    } catch { /* ignore discovery errors */ }
  }

  private async discoverResources(config: MCPServerConfig, headers: Record<string, string>): Promise<void> {
    try {
      const res = await fetch(`${config.url}/mcp/resources/list`, { method: 'POST', headers, body: '{}' });
      if (!res.ok) return;
      const data = await res.json() as { resources?: MCPResource[] };
      if (data.resources) {
        for (const resource of data.resources) {
          this.resources.set(resource.uri, { ...resource, server: config.name });
        }
        logger.info('MCP resources discovered', { server: config.name, count: data.resources.length });
      }
    } catch { /* ignore */ }
  }

  private async discoverPrompts(config: MCPServerConfig, headers: Record<string, string>): Promise<void> {
    try {
      const res = await fetch(`${config.url}/mcp/prompts/list`, { method: 'POST', headers, body: '{}' });
      if (!res.ok) return;
      const data = await res.json() as { prompts?: MCPPrompt[] };
      if (data.prompts) {
        for (const prompt of data.prompts) {
          this.prompts.set(prompt.name, { ...prompt, server: config.name });
        }
        logger.info('MCP prompts discovered', { server: config.name, count: data.prompts.length });
      }
    } catch { /* ignore */ }
  }
}

export function createMCPClient(): MCPClient {
  return new MCPClient();
}
