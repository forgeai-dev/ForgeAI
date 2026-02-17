import { useEffect, useState } from 'react';
import { Wrench, Play, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Server, Plus, Trash2, Plug, Unplug } from 'lucide-react';

interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  dangerous?: boolean;
  parameters: ToolParam[];
}

interface ExecuteResult {
  success: boolean;
  result?: string;
  error?: string;
  duration?: number;
}

interface MCPServer {
  name: string;
  url: string;
  transport: string;
  enabled: boolean;
  connected?: boolean;
}

interface MCPTool {
  name: string;
  description?: string;
  server?: string;
}

type ToolsTab = 'builtin' | 'mcp';

export function ToolsPage() {
  const [tab, setTab] = useState<ToolsTab>('builtin');
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [mcpResources, setMcpResources] = useState<Array<{ name: string; uri: string; description?: string }>>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', transport: 'http' });
  const [connecting, setConnecting] = useState<string | null>(null);

  const loadMCP = async () => {
    setMcpLoading(true);
    try {
      const [s, t, r] = await Promise.all([
        fetch('/api/mcp/servers').then(r => r.json()),
        fetch('/api/mcp/tools').then(r => r.json()),
        fetch('/api/mcp/resources').then(r => r.json()),
      ]);
      setMcpServers((s as { servers: MCPServer[] }).servers ?? []);
      setMcpTools((t as { tools: MCPTool[] }).tools ?? []);
      setMcpResources((r as { resources: Array<{ name: string; uri: string; description?: string }> }).resources ?? []);
    } catch { /* ignore */ }
    setMcpLoading(false);
  };

  const addMCPServer = async () => {
    if (!newServer.name || !newServer.url) return;
    await fetch('/api/mcp/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newServer) });
    setNewServer({ name: '', url: '', transport: 'http' });
    setShowAddServer(false);
    loadMCP();
  };

  const connectMCP = async (name: string) => {
    setConnecting(name);
    await fetch(`/api/mcp/servers/${encodeURIComponent(name)}/connect`, { method: 'POST' });
    setConnecting(null);
    loadMCP();
  };

  const removeMCP = async (name: string) => {
    await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadMCP();
  };

  useEffect(() => {
    fetch('/api/tools')
      .then(r => r.json())
      .then((data: { tools: ToolInfo[] }) => setTools(data.tools))
      .catch(() => {})
      .finally(() => setLoading(false));
    loadMCP();
  }, []);

  const toggleExpand = (name: string) => {
    setExpanded(expanded === name ? null : name);
    setResult(null);
    setParamValues({});
  };

  const executeTool = async (toolName: string) => {
    setExecuting(toolName);
    setResult(null);
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(paramValues)) {
        if (v.trim()) {
          try { params[k] = JSON.parse(v); } catch { params[k] = v; }
        }
      }
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, params }),
      });
      const data = await res.json();
      setResult(data as ExecuteResult);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setExecuting(null);
    }
  };

  const categoryColors: Record<string, string> = {
    browser: 'bg-blue-500/20 text-blue-400',
    file: 'bg-amber-500/20 text-amber-400',
    scheduler: 'bg-purple-500/20 text-purple-400',
    code: 'bg-emerald-500/20 text-emerald-400',
    knowledge: 'bg-cyan-500/20 text-cyan-400',
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forge-500/20 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-forge-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Tools</h1>
            <p className="text-sm text-zinc-500">{tools.length} built-in + {mcpTools.length} MCP tools</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(['builtin', 'mcp'] as ToolsTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === t
                  ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              {t === 'builtin' ? <Wrench className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />}
              {t === 'builtin' ? `Built-in (${tools.length})` : `MCP Servers (${mcpServers.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* MCP Servers Tab */}
      {tab === 'mcp' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-forge-400" />
              MCP Servers
            </h2>
            <button
              onClick={() => setShowAddServer(!showAddServer)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar Server
            </button>
          </div>

          {showAddServer && (
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Nome</label>
                  <input
                    type="text" value={newServer.name} onChange={e => setNewServer(s => ({ ...s, name: e.target.value }))}
                    placeholder="meu-server" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">URL</label>
                  <input
                    type="text" value={newServer.url} onChange={e => setNewServer(s => ({ ...s, url: e.target.value }))}
                    placeholder="http://localhost:3001" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Transport</label>
                  <select
                    title="Transport type"
                    value={newServer.transport} onChange={e => setNewServer(s => ({ ...s, transport: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                  >
                    <option value="http">HTTP</option>
                    <option value="sse">SSE</option>
                    <option value="stdio">stdio</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addMCPServer} disabled={!newServer.name || !newServer.url}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  Adicionar
                </button>
                <button onClick={() => setShowAddServer(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {mcpLoading ? (
            <div className="flex items-center gap-2 text-zinc-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
          ) : mcpServers.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhum MCP server configurado</p>
              <p className="text-xs text-zinc-600 mt-1">Clique "Adicionar Server" para conectar um tool server externo</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mcpServers.map(s => (
                <div key={s.name} className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${s.connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    <div>
                      <p className="text-sm font-medium text-white">{s.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{s.url} ({s.transport})</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => connectMCP(s.name)} disabled={connecting === s.name}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-emerald-400 transition-colors">
                      {connecting === s.name ? <Loader2 className="w-3 h-3 animate-spin" /> : s.connected ? <Unplug className="w-3 h-3" /> : <Plug className="w-3 h-3" />}
                      {s.connected ? 'Reconectar' : 'Conectar'}
                    </button>
                    <button onClick={() => removeMCP(s.name)} title="Remover server"
                      className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mcpTools.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-zinc-400 mb-2">Tools disponíveis ({mcpTools.length})</h3>
              <div className="grid grid-cols-2 gap-2">
                {mcpTools.map(t => (
                  <div key={t.name} className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2">
                    <p className="text-xs font-mono text-forge-400">{t.name}</p>
                    {t.description && <p className="text-[10px] text-zinc-500 truncate">{t.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {mcpResources.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-zinc-400 mb-2">Resources ({mcpResources.length})</h3>
              <div className="space-y-1">
                {mcpResources.map(r => (
                  <div key={r.uri} className="text-xs text-zinc-400 bg-zinc-900/50 rounded px-3 py-1.5 flex items-center justify-between">
                    <span className="font-mono">{r.name}</span>
                    <span className="text-zinc-600 truncate ml-2">{r.uri}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Built-in Tools Tab */}
      {tab === 'builtin' && loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading tools...
        </div>
      ) : tab === 'builtin' ? (
        <div className="space-y-3">
          {tools.map(tool => (
            <div key={tool.name} className="border border-zinc-800 rounded-xl bg-zinc-950/50 overflow-hidden">
              <button
                onClick={() => toggleExpand(tool.name)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[tool.category] ?? 'bg-zinc-700 text-zinc-300'}`}>
                    {tool.category}
                  </span>
                  <span className="font-mono text-sm text-white">{tool.name}</span>
                  {tool.dangerous && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 uppercase">dangerous</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 max-w-xs truncate hidden sm:block">{tool.description}</span>
                  {expanded === tool.name ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                </div>
              </button>

              {expanded === tool.name && (
                <div className="border-t border-zinc-800 px-5 py-4 space-y-4">
                  <p className="text-sm text-zinc-400">{tool.description}</p>

                  {tool.parameters.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Parameters</h3>
                      {tool.parameters.map(param => (
                        <div key={param.name} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-forge-400">{param.name}</span>
                            <span className="text-[10px] text-zinc-600">{param.type}</span>
                            {param.required && <span className="text-[10px] text-red-400">required</span>}
                          </div>
                          <input
                            type="text"
                            placeholder={param.description}
                            value={paramValues[param.name] ?? ''}
                            onChange={e => setParamValues(prev => ({ ...prev, [param.name]: e.target.value }))}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-forge-500"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => executeTool(tool.name)}
                      disabled={executing === tool.name}
                      className="flex items-center gap-2 px-4 py-2 bg-forge-600 hover:bg-forge-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {executing === tool.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      Execute
                    </button>
                  </div>

                  {result && (
                    <div className={`rounded-lg p-4 text-sm ${result.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {result.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                        <span className={result.success ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                          {result.success ? 'Success' : 'Error'}
                        </span>
                        {result.duration && <span className="text-zinc-500 text-xs">{result.duration}ms</span>}
                      </div>
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap max-h-64 overflow-auto">
                        {result.result ?? result.error}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
