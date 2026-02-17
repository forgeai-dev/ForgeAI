import { useEffect, useState } from 'react';
import { Activity, Shield, Cpu, Clock, Zap, Lock, Radio, Eye, Bot, DollarSign, MessageSquare, BarChart3, PlayCircle, Signal, AlertTriangle, ChevronDown, ChevronUp, Thermometer, Brain, Wrench, Container, Terminal } from 'lucide-react';
import { api, type HealthData, type InfoData, type ProviderInfo } from '@/lib/api';

interface AutopilotStatus {
  enabled: boolean;
  running: boolean;
  taskCount: number;
  intervalMinutes: number;
  lastCheck: string;
  tasks: Array<{ title: string; schedule: string; lastRun?: string; lastResult?: string }>;
}
import { formatUptime } from '@/lib/utils';
import { StatusCard } from '@/components/StatusCard';

interface AgentStats {
  agent: { model: string; provider: string; thinkingLevel: string; temperature?: number; maxTokens?: number };
  tools?: string[];
  toolCount?: number;
  sandboxStatus?: string;
  activeSessions: number;
  totalSessions: number;
  usage: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
    byModel: Record<string, { requests: number; tokens: number; cost: number }>;
  };
  sessions: Array<{
    sessionId: string;
    messageCount: number;
    totalTokens: number;
    totalCost: number;
    requests: number;
    createdAt: string;
    lastActivity: string;
  }>;
}

interface SecuritySummary {
  modules: Array<{ name: string; key: string; active: boolean; description: string }>;
  counts: {
    promptGuardBlocks: number;
    rateLimitTriggered: number;
    sandboxViolations: number;
    authFailures: number;
    toolBlocked: number;
    anomalies: number;
  };
  events: Array<{
    id: string;
    action: string;
    riskLevel: string;
    success: boolean;
    timestamp: string;
    details: Record<string, unknown>;
    ipAddress?: string;
  }>;
  totalAlerts: number;
}

export function OverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [info, setInfo] = useState<InfoData | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [autopilot, setAutopilot] = useState<AutopilotStatus | null>(null);
  const [otelStatus, setOtelStatus] = useState<{ enabled: boolean; spansCollected: number; metricsCollected: number; counters: Record<string, number>; uptimeMs: number } | null>(null);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [h, i, p, s, ap, ot, sec] = await Promise.all([
        api.getHealth(),
        api.getInfo(),
        api.getProviders(),
        fetch('/api/agent/stats').then(r => r.json()).then(d => (d as { stats: AgentStats }).stats).catch(() => null),
        fetch('/api/autopilot/status').then(r => r.json()).catch(() => null),
        fetch('/api/telemetry/status').then(r => r.json()).catch(() => null),
        fetch('/api/security/summary').then(r => r.json()).catch(() => null),
      ]);
      setHealth(h);
      setInfo(i);
      setProviders(p.providers);
      setAgentStats(s as AgentStats | null);
      setAutopilot(ap as AutopilotStatus | null);
      setOtelStatus(ot as { enabled: boolean; spansCollected: number; metricsCollected: number; counters: Record<string, number>; uptimeMs: number } | null);
      setSecuritySummary(sec as SecuritySummary | null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <div className="text-red-400 text-lg font-semibold mb-2">Gateway Offline</div>
          <p className="text-zinc-400 text-sm">{error}</p>
          <p className="text-zinc-500 text-xs mt-2">Make sure the gateway is running: <code className="text-forge-400">forge start</code></p>
        </div>
      </div>
    );
  }

  const securityModules = info?.security
    ? Object.entries(info.security).filter(([, v]) => v).length
    : 0;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-sm text-zinc-400 mt-1">ForgeAI Gateway real-time monitoring</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          title="Status"
          value={health?.status === 'healthy' ? 'Healthy' : 'Unknown'}
          icon={<Activity className="w-5 h-5" />}
          status={health?.status === 'healthy' ? 'healthy' : 'warning'}
          subtitle={`v${health?.version ?? '—'}`}
        />
        <StatusCard
          title="Uptime"
          value={health ? formatUptime(health.uptime) : '—'}
          icon={<Clock className="w-5 h-5" />}
          status="healthy"
        />
        <div onClick={() => setSecurityExpanded(!securityExpanded)} className="cursor-pointer">
          <StatusCard
            title="Security Modules"
            value={`${securityModules}/7`}
            icon={<Shield className="w-5 h-5" />}
            status={securityModules === 7 ? 'healthy' : 'warning'}
            subtitle={securityExpanded ? '▲ Clique para fechar' : '▼ Clique para detalhes'}
          />
        </div>
        <StatusCard
          title="LLM Providers"
          value={providers.filter(p => p.configured).length}
          icon={<Cpu className="w-5 h-5" />}
          status={providers.some(p => p.configured) ? 'healthy' : 'error'}
          subtitle={providers.filter(p => p.configured).map(p => p.name).join(', ') || 'None configured'}
        />
      </div>

      {/* Security Details (expandable) */}
      {securityExpanded && securitySummary && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-forge-400" /> Security Modules — Detalhes
            </h2>
            <button onClick={() => setSecurityExpanded(false)} title="Fechar" className="text-zinc-500 hover:text-zinc-300">
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {securitySummary.modules.map(m => (
              <div key={m.key} className={`rounded-lg border p-3 ${m.active ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/30'}`}>
                <p className="text-xs font-medium text-white">{m.name}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{m.description}</p>
                <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full ${m.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
                  {m.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            ))}
          </div>

          {/* Recent Security Events */}
          {securitySummary.events.length > 0 && (
            <div className="border-t border-zinc-800 pt-3">
              <h3 className="text-xs font-semibold text-zinc-400 mb-2">Eventos Recentes</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {securitySummary.events.map(ev => (
                  <div key={ev.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        ev.riskLevel === 'critical' ? 'bg-red-500' : ev.riskLevel === 'high' ? 'bg-amber-500' : 'bg-zinc-500'
                      }`} />
                      <span className="text-zinc-300 font-mono">{ev.action}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {ev.ipAddress && <span className="text-zinc-600 font-mono">{ev.ipAddress}</span>}
                      <span className="text-zinc-600">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {securitySummary.events.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-2">Nenhum evento de segurança recente — tudo limpo ✓</p>
          )}
        </div>
      )}

      {/* Security Alerts Banner */}
      {securitySummary && (securitySummary.counts.promptGuardBlocks > 0 || securitySummary.counts.rateLimitTriggered > 0 || securitySummary.counts.sandboxViolations > 0 || securitySummary.counts.authFailures > 0 || securitySummary.counts.toolBlocked > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-400 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" /> Alertas de Segurança
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {securitySummary.counts.promptGuardBlocks > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Eye className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.promptGuardBlocks} prompt guard block(s)</span>
              </div>
            )}
            {securitySummary.counts.rateLimitTriggered > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Zap className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.rateLimitTriggered} rate limit(s)</span>
              </div>
            )}
            {securitySummary.counts.sandboxViolations > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2">
                <Container className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.sandboxViolations} sandbox violation(s)</span>
              </div>
            )}
            {securitySummary.counts.authFailures > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.authFailures} auth failure(s)</span>
              </div>
            )}
            {securitySummary.counts.toolBlocked > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Wrench className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.toolBlocked} tool(s) blocked</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Autopilot Status */}
      {autopilot && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <PlayCircle className={`w-4 h-4 ${autopilot.running ? 'text-blue-400' : 'text-zinc-500'}`} />
              Autopilot
            </h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              autopilot.running ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-700 text-zinc-500'
            }`}>
              {autopilot.running ? 'Rodando' : 'Parado'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">{autopilot.taskCount}</p>
              <p className="text-[10px] text-zinc-500">Tarefas</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{autopilot.intervalMinutes}min</p>
              <p className="text-[10px] text-zinc-500">Intervalo</p>
            </div>
            <div>
              <p className="text-lg font-bold text-zinc-400">{autopilot.lastCheck ? new Date(autopilot.lastCheck).toLocaleTimeString() : '—'}</p>
              <p className="text-[10px] text-zinc-500">Último check</p>
            </div>
          </div>
          {autopilot.tasks && autopilot.tasks.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1.5">
              {autopilot.tasks.slice(0, 5).map((task, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 truncate max-w-[60%]">{task.title}</span>
                  <span className="text-zinc-500 font-mono">{task.schedule}</span>
                </div>
              ))}
              {autopilot.tasks.length > 5 && (
                <p className="text-[10px] text-zinc-600">+{autopilot.tasks.length - 5} mais...</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Telemetry Status */}
      {otelStatus && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Signal className={`w-4 h-4 ${otelStatus.enabled ? 'text-emerald-400' : 'text-zinc-500'}`} />
              OpenTelemetry
            </h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              otelStatus.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'
            }`}>
              {otelStatus.enabled ? 'Ativo' : 'Desativado'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">{otelStatus.spansCollected}</p>
              <p className="text-[10px] text-zinc-500">Spans</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{otelStatus.metricsCollected}</p>
              <p className="text-[10px] text-zinc-500">Metrics</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{Object.keys(otelStatus.counters ?? {}).length}</p>
              <p className="text-[10px] text-zinc-500">Counters</p>
            </div>
          </div>
        </div>
      )}

      {/* Agent Activity */}
      {agentStats && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Bot className="w-5 h-5 text-forge-400" />
            Agente Ativo
          </h2>

          {/* Agent info banner — enhanced */}
          <div className="mb-4 rounded-xl border border-forge-500/20 bg-forge-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-forge-500/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-forge-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white capitalize">{agentStats.agent.provider}</p>
                  <p className="text-xs text-zinc-400 font-mono">{agentStats.agent.model}</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Online</span>
            </div>

            {/* Agent details grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-forge-500/10">
              <div className="flex items-center gap-2 text-xs">
                <Brain className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-zinc-500">Thinking:</span>
                <span className={`font-medium ${
                  agentStats.agent.thinkingLevel === 'off' ? 'text-zinc-400' :
                  agentStats.agent.thinkingLevel === 'low' ? 'text-blue-400' :
                  agentStats.agent.thinkingLevel === 'medium' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {agentStats.agent.thinkingLevel === 'off' ? 'Desligado' :
                   agentStats.agent.thinkingLevel === 'low' ? 'Leve' :
                   agentStats.agent.thinkingLevel === 'medium' ? 'Médio' : 'Profundo'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                <span className="text-zinc-500">Temp:</span>
                <span className="text-zinc-200 font-mono">{agentStats.agent.temperature ?? 0.7}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-zinc-500">Tools:</span>
                <span className="text-zinc-200">{agentStats.toolCount ?? 0} habilitadas</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Container className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-zinc-500">Sandbox:</span>
                <span className={`font-medium ${agentStats.sandboxStatus === 'available' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {agentStats.sandboxStatus === 'available' ? 'Docker ✓' : 'Indisponível'}
                </span>
              </div>
            </div>

            {/* Tools list (collapsible) */}
            {agentStats.tools && agentStats.tools.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {agentStats.tools.map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Agent stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <MessageSquare className="w-3 h-3" /> SESSÕES ATIVAS
              </div>
              <p className="text-xl font-bold text-white">{agentStats.activeSessions}</p>
              <p className="text-[10px] text-zinc-500">{agentStats.totalSessions} total salvas</p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <DollarSign className="w-3 h-3" /> CUSTO TOTAL
              </div>
              <p className="text-xl font-bold text-emerald-400">
                ${agentStats.usage.totalCost < 0.01 ? agentStats.usage.totalCost.toFixed(6) : agentStats.usage.totalCost.toFixed(4)}
              </p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <BarChart3 className="w-3 h-3" /> TOKENS USADOS
              </div>
              <p className="text-xl font-bold text-white">
                {agentStats.usage.totalTokens >= 1000 ? `${(agentStats.usage.totalTokens / 1000).toFixed(1)}k` : agentStats.usage.totalTokens}
              </p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <Zap className="w-3 h-3" /> REQUISIÇÕES
              </div>
              <p className="text-xl font-bold text-white">{agentStats.usage.totalRequests}</p>
            </div>
          </div>

          {/* Per-provider breakdown */}
          {Object.keys(agentStats.usage.byProvider).length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-zinc-400 mb-3">Por Provider</h4>
                <div className="space-y-2">
                  {Object.entries(agentStats.usage.byProvider).map(([provider, data]) => (
                    <div key={provider} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300 capitalize font-medium">{provider}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500">{data.requests} req</span>
                        <span className="text-zinc-400">{data.tokens >= 1000 ? `${(data.tokens/1000).toFixed(1)}k` : data.tokens} tok</span>
                        <span className="text-emerald-400">${data.cost < 0.01 ? data.cost.toFixed(6) : data.cost.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-zinc-400 mb-3">Por Modelo</h4>
                <div className="space-y-2">
                  {Object.entries(agentStats.usage.byModel).map(([model, data]) => (
                    <div key={model} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300 font-mono">{model}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500">{data.requests} req</span>
                        <span className="text-emerald-400">${data.cost < 0.01 ? data.cost.toFixed(6) : data.cost.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Per-session cost table */}
          {agentStats.sessions.length > 0 && (
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h4 className="text-xs font-semibold text-zinc-400">Custo por Sessão</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-4 py-2 text-left font-medium">Sessão</th>
                      <th className="px-4 py-2 text-right font-medium">Msgs</th>
                      <th className="px-4 py-2 text-right font-medium">Reqs</th>
                      <th className="px-4 py-2 text-right font-medium">Tokens</th>
                      <th className="px-4 py-2 text-right font-medium">Custo</th>
                      <th className="px-4 py-2 text-right font-medium">Última atividade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentStats.sessions.map(s => (
                      <tr key={s.sessionId} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-4 py-2 text-zinc-400 font-mono">{s.sessionId.slice(0, 20)}...</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{s.messageCount}</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{s.requests}</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{s.totalTokens >= 1000 ? `${(s.totalTokens/1000).toFixed(1)}k` : s.totalTokens}</td>
                        <td className="px-4 py-2 text-right text-emerald-400">${s.totalCost < 0.01 ? s.totalCost.toFixed(6) : s.totalCost.toFixed(4)}</td>
                        <td className="px-4 py-2 text-right text-zinc-500">{new Date(s.lastActivity).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security Modules Grid — now compact, details are in expandable section above */}
      {!securityExpanded && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-forge-400" />
              Security Layer
            </h2>
            <button onClick={() => setSecurityExpanded(true)} title="Expandir detalhes" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronDown className="w-3.5 h-3.5" /> Detalhes
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {info?.security && Object.entries(info.security).map(([name, active]) => {
              const icons: Record<string, typeof Shield> = {
                rbac: Lock, vault: Lock, rateLimiter: Zap,
                promptGuard: Eye, inputSanitizer: Shield,
                twoFactor: Lock, auditLog: Radio,
              };
              const Icon = icons[name] ?? Shield;
              return (
                <div key={name} className={`rounded-lg border p-3 flex items-center gap-2 ${
                  active ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/30'
                }`}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${
                    active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700/50 text-zinc-500'
                  }`}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-white capitalize leading-tight">
                      {name.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                    <p className={`text-[9px] ${active ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {active ? '✓' : '✗'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Health Checks */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-forge-400" />
          Health Checks
        </h2>
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          {health?.checks.map((check, i) => (
            <div
              key={check.name}
              className={`flex items-center justify-between px-5 py-3 ${
                i > 0 ? 'border-t border-zinc-800' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  check.status === 'pass' ? 'bg-emerald-500' : check.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                <span className="text-sm text-zinc-200">{check.name}</span>
              </div>
              <span className={`text-xs font-medium uppercase ${
                check.status === 'pass' ? 'text-emerald-400' : check.status === 'warn' ? 'text-amber-400' : 'text-red-400'
              }`}>
                {check.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Providers */}
      {providers.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-forge-400" />
            LLM Providers
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => (
              <div key={p.name} className={`rounded-lg border p-4 ${
                p.configured ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{p.displayName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {p.configured ? 'Connected' : 'Not configured'}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Models: {p.models.slice(0, 3).join(', ')}{p.models.length > 3 ? ` +${p.models.length - 3}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
