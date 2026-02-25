import { useEffect, useState } from 'react';
import { Activity, Shield, Cpu, Clock, Zap, Lock, Radio, Eye, Bot, DollarSign, MessageSquare, BarChart3, PlayCircle, Signal, AlertTriangle, ChevronDown, ChevronUp, Thermometer, Brain, Wrench, Container, Terminal, CheckCircle, XCircle, Mail, KeyRound, ShieldAlert, ShieldCheck, FileWarning, Globe } from 'lucide-react';
import { api, type HealthData, type InfoData, type ProviderInfo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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

// ─── Event Info Mapper ─────────────────────────────────
type LucideIcon = typeof Shield;

interface EventInfo {
  label: string;
  description: string;
  icon: LucideIcon;
}

const EVENT_MAP: Record<string, EventInfo> = {
  'auth.login': { label: 'Login Attempt', description: 'Someone tried to log in to the system', icon: KeyRound },
  'auth.login_success': { label: 'Login Successful', description: 'Admin authenticated successfully', icon: KeyRound },
  'auth.pin_verified': { label: 'PIN Verified', description: 'Access PIN was verified correctly', icon: Lock },
  'auth.pin_failed': { label: 'PIN Verification Failed', description: 'Incorrect PIN entered — possible unauthorized access', icon: Lock },
  'auth.pin_changed': { label: 'PIN Changed', description: 'Admin PIN was changed', icon: Lock },
  'auth.2fa_verified': { label: '2FA Verified', description: 'Two-factor authentication code accepted', icon: Shield },
  'auth.2fa_failed': { label: '2FA Verification Failed', description: 'Invalid 2FA code entered — check if your authenticator is synced', icon: ShieldAlert },
  'auth.access_token_failed': { label: 'Invalid Access Token', description: 'A request with an invalid or expired token was blocked', icon: KeyRound },
  'auth.token_refresh': { label: 'Token Refreshed', description: 'Session token was automatically renewed', icon: KeyRound },
  'auth.session_expired': { label: 'Session Expired', description: 'A session timed out and was invalidated', icon: Clock },
  'auth.email_otp_sent': { label: 'Email OTP Sent', description: 'Verification code sent to admin email (external access)', icon: Mail },
  'auth.email_otp_verified': { label: 'Email OTP Verified', description: 'Email verification code accepted', icon: Mail },
  'auth.email_otp_failed': { label: 'Email OTP Failed', description: 'Invalid or expired email verification code', icon: Mail },
  'security.integrity_check': { label: 'Integrity Check', description: 'System performed a security integrity verification', icon: ShieldCheck },
  'security.rate_limited': { label: 'Rate Limited', description: 'Too many requests — rate limiter activated', icon: Zap },
  'security.ip_blocked': { label: 'IP Blocked', description: 'Request from blocked IP address was rejected', icon: Globe },
  'security.prompt_injection': { label: 'Prompt Injection Blocked', description: 'Detected and blocked a prompt injection attempt', icon: Eye },
  'security.input_sanitized': { label: 'Input Sanitized', description: 'Malicious input was cleaned before processing', icon: FileWarning },
  'tool.execute': { label: 'Tool Executed', description: 'Agent executed a tool action', icon: Wrench },
  'tool.blocked': { label: 'Tool Blocked', description: 'A blocked tool was attempted — action denied', icon: Wrench },
  'tool.dangerous_call': { label: 'Dangerous Tool Call', description: 'Agent called a potentially dangerous tool', icon: AlertTriangle },
  'config.update': { label: 'Config Updated', description: 'System configuration was changed', icon: Terminal },
  'smtp.configured': { label: 'SMTP Configured', description: 'Email server settings were updated', icon: Mail },
  '2fa.init': { label: '2FA Setup Initiated', description: 'Two-factor authentication setup started', icon: Shield },
  '2fa.verify': { label: '2FA Setup Verified', description: 'Two-factor authentication setup completed', icon: Shield },
  'vault.access': { label: 'Vault Accessed', description: 'Encrypted vault was read or written to', icon: Lock },
};

function getEventInfo(action: string): EventInfo {
  if (EVENT_MAP[action]) return EVENT_MAP[action];

  // Fallback: generate label from action name
  const label = action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const category = action.split('.')[0];
  const iconMap: Record<string, LucideIcon> = {
    auth: KeyRound, security: ShieldAlert, tool: Wrench,
    config: Terminal, smtp: Mail, '2fa': Shield, vault: Lock,
  };

  return {
    label,
    description: `Event: ${action}`,
    icon: iconMap[category] || Shield,
  };
}

// ─── Relative Time Formatter ──────────────────────────
function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function OverviewPage() {
  const { t } = useI18n();
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
          <div className="text-red-400 text-lg font-semibold mb-2">{t('overview.gatewayOffline')}</div>
          <p className="text-zinc-400 text-sm">{error}</p>
          <p className="text-zinc-500 text-xs mt-2">{t('overview.gatewayHint')} <code className="text-forge-400">forge start</code></p>
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
        <h1 className="text-2xl font-bold text-white">{t('overview.title')}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t('overview.subtitle')}</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          title={t('overview.status')}
          value={health?.status === 'healthy' ? t('overview.healthy') : t('overview.unknown')}
          icon={<Activity className="w-5 h-5" />}
          status={health?.status === 'healthy' ? 'healthy' : 'warning'}
          subtitle={`v${health?.version ?? '—'}`}
        />
        <StatusCard
          title={t('overview.uptime')}
          value={health ? formatUptime(health.uptime) : '—'}
          icon={<Clock className="w-5 h-5" />}
          status="healthy"
        />
        <div onClick={() => setSecurityExpanded(!securityExpanded)} className="cursor-pointer">
          <StatusCard
            title={t('overview.securityModules')}
            value={`${securityModules}/9`}
            icon={<Shield className="w-5 h-5" />}
            status={securityModules >= 7 ? 'healthy' : 'warning'}
            subtitle={securityExpanded ? `▲ ${t('overview.clickClose')}` : `▼ ${t('overview.clickDetails')}`}
          />
        </div>
        <StatusCard
          title={t('overview.llmProviders')}
          value={providers.filter(p => p.configured).length}
          icon={<Cpu className="w-5 h-5" />}
          status={providers.some(p => p.configured) ? 'healthy' : 'error'}
          subtitle={providers.filter(p => p.configured).map(p => p.name).join(', ') || t('overview.noneConfigured')}
        />
      </div>

      {/* Security Details (expandable) */}
      {securityExpanded && securitySummary && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-forge-400" /> {t('overview.securityDetails')}
            </h2>
            <button onClick={() => setSecurityExpanded(false)} title={t('overview.close')} className="text-zinc-500 hover:text-zinc-300">
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {securitySummary.modules.map(m => (
              <div key={m.key} className={`rounded-lg border p-3 ${m.active ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/30'}`}>
                <p className="text-xs font-medium text-white">{m.name}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{m.description}</p>
                <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full ${m.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
                  {m.active ? t('overview.active') : t('overview.inactive')}
                </span>
              </div>
            ))}
          </div>

          {/* Recent Security Events — Enhanced */}
          {securitySummary.events.length > 0 && (
            <div className="border-t border-zinc-800 pt-3">
              <h3 className="text-xs font-semibold text-zinc-400 mb-2">{t('overview.recentEvents')}</h3>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                {securitySummary.events.map(ev => {
                  const info = getEventInfo(ev.action);
                  const EventIcon = info.icon;
                  const riskColors: Record<string, string> = {
                    low: 'bg-zinc-700 text-zinc-400',
                    medium: 'bg-amber-500/15 text-amber-400',
                    high: 'bg-orange-500/15 text-orange-400',
                    critical: 'bg-red-500/15 text-red-400',
                  };
                  const riskBorder: Record<string, string> = {
                    low: 'border-zinc-800',
                    medium: 'border-amber-500/10',
                    high: 'border-orange-500/10',
                    critical: 'border-red-500/15',
                  };
                  return (
                    <div key={ev.id} className={`flex items-start gap-2.5 text-xs px-3 py-2.5 rounded-lg border bg-zinc-900/60 ${riskBorder[ev.riskLevel] || 'border-zinc-800'}`}>
                      <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${ev.success ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        <EventIcon className="w-3 h-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-200 font-medium truncate">{info.label}</span>
                          {ev.success
                            ? <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                            : <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                          }
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${riskColors[ev.riskLevel] || riskColors.low}`}>
                            {ev.riskLevel}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{info.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-[10px] text-zinc-500">{formatRelativeTime(ev.timestamp)}</span>
                        {ev.ipAddress && <p className="text-[10px] text-zinc-600 font-mono">{ev.ipAddress}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {securitySummary.events.length === 0 && (
            <div className="border-t border-zinc-800 pt-4 pb-2 text-center">
              <ShieldCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              <p className="text-xs text-emerald-400 font-medium">All clear</p>
              <p className="text-[10px] text-zinc-600">{t('overview.noSecurityEvents')}</p>
            </div>
          )}
        </div>
      )}

      {/* Security Alerts Banner */}
      {securitySummary && (securitySummary.counts.promptGuardBlocks > 0 || securitySummary.counts.rateLimitTriggered > 0 || securitySummary.counts.sandboxViolations > 0 || securitySummary.counts.authFailures > 0 || securitySummary.counts.toolBlocked > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-400 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" /> {t('overview.securityAlerts')}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {securitySummary.counts.promptGuardBlocks > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Eye className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.promptGuardBlocks} {t('overview.promptGuardBlocks')}</span>
              </div>
            )}
            {securitySummary.counts.rateLimitTriggered > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Zap className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.rateLimitTriggered} {t('overview.rateLimits')}</span>
              </div>
            )}
            {securitySummary.counts.sandboxViolations > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2">
                <Container className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.sandboxViolations} {t('overview.sandboxViolations')}</span>
              </div>
            )}
            {securitySummary.counts.authFailures > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.authFailures} {t('overview.authFailures')}</span>
              </div>
            )}
            {securitySummary.counts.toolBlocked > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                <Wrench className="w-3.5 h-3.5" />
                <span>{securitySummary.counts.toolBlocked} {t('overview.toolsBlocked')}</span>
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
              {t('overview.autopilot')}
            </h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              autopilot.running ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-700 text-zinc-500'
            }`}>
              {autopilot.running ? t('overview.running') : t('overview.stopped')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">{autopilot.taskCount}</p>
              <p className="text-[10px] text-zinc-500">{t('overview.tasks')}</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{autopilot.intervalMinutes}min</p>
              <p className="text-[10px] text-zinc-500">{t('overview.interval')}</p>
            </div>
            <div>
              <p className="text-lg font-bold text-zinc-400">{autopilot.lastCheck ? new Date(autopilot.lastCheck).toLocaleTimeString() : '—'}</p>
              <p className="text-[10px] text-zinc-500">{t('overview.lastCheck')}</p>
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
                <p className="text-[10px] text-zinc-600">+{autopilot.tasks.length - 5} {t('overview.more')}</p>
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
              {otelStatus.enabled ? t('overview.enabled') : t('overview.disabled')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">{otelStatus.spansCollected}</p>
              <p className="text-[10px] text-zinc-500">{t('overview.spans')}</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{otelStatus.metricsCollected}</p>
              <p className="text-[10px] text-zinc-500">{t('overview.metrics')}</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{Object.keys(otelStatus.counters ?? {}).length}</p>
              <p className="text-[10px] text-zinc-500">{t('overview.counters')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Agent Activity — only show when at least one LLM provider is configured */}
      {agentStats && providers.some(p => p.configured) && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Bot className="w-5 h-5 text-forge-400" />
            {t('overview.activeAgent')}
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
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">{t('overview.online')}</span>
            </div>

            {/* Agent details grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-forge-500/10">
              <div className="flex items-center gap-2 text-xs">
                <Brain className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-zinc-500">{t('overview.thinking')}</span>
                <span className={`font-medium ${
                  agentStats.agent.thinkingLevel === 'off' ? 'text-zinc-400' :
                  agentStats.agent.thinkingLevel === 'low' ? 'text-blue-400' :
                  agentStats.agent.thinkingLevel === 'medium' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {agentStats.agent.thinkingLevel === 'off' ? t('overview.thinkingOff') :
                   agentStats.agent.thinkingLevel === 'low' ? t('overview.thinkingLow') :
                   agentStats.agent.thinkingLevel === 'medium' ? t('overview.thinkingMedium') : t('overview.thinkingDeep')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                <span className="text-zinc-500">{t('overview.temp')}</span>
                <span className="text-zinc-200 font-mono">{agentStats.agent.temperature ?? 0.7}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-zinc-500">{t('overview.tools')}</span>
                <span className="text-zinc-200">{agentStats.toolCount ?? 0} {t('overview.toolsEnabled')}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Container className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-zinc-500">{t('overview.sandbox')}</span>
                <span className={`font-medium ${agentStats.sandboxStatus === 'available' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {agentStats.sandboxStatus === 'available' ? 'Docker ✓' : t('overview.sandboxUnavailable')}
                </span>
              </div>
            </div>

            {/* Tools list (collapsible) */}
            {agentStats.tools && agentStats.tools.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {agentStats.tools.map(tool => (
                  <span key={tool} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Agent stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <MessageSquare className="w-3 h-3" /> {t('overview.activeSessions')}
              </div>
              <p className="text-xl font-bold text-white">{agentStats.activeSessions}</p>
              <p className="text-[10px] text-zinc-500">{agentStats.totalSessions} {t('overview.totalSaved')}</p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <DollarSign className="w-3 h-3" /> {t('overview.totalCost')}
              </div>
              <p className="text-xl font-bold text-emerald-400">
                ${agentStats.usage.totalCost < 0.01 ? agentStats.usage.totalCost.toFixed(6) : agentStats.usage.totalCost.toFixed(4)}
              </p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <BarChart3 className="w-3 h-3" /> {t('overview.tokensUsed')}
              </div>
              <p className="text-xl font-bold text-white">
                {agentStats.usage.totalTokens >= 1000 ? `${(agentStats.usage.totalTokens / 1000).toFixed(1)}k` : agentStats.usage.totalTokens}
              </p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-medium mb-1">
                <Zap className="w-3 h-3" /> {t('overview.requests')}
              </div>
              <p className="text-xl font-bold text-white">{agentStats.usage.totalRequests}</p>
            </div>
          </div>

          {/* Per-provider breakdown */}
          {Object.keys(agentStats.usage.byProvider).length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-zinc-400 mb-3">{t('overview.byProvider')}</h4>
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
                <h4 className="text-xs font-semibold text-zinc-400 mb-3">{t('overview.byModel')}</h4>
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
                <h4 className="text-xs font-semibold text-zinc-400">{t('overview.costPerSession')}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-4 py-2 text-left font-medium">{t('overview.session')}</th>
                      <th className="px-4 py-2 text-right font-medium">{t('overview.msgs')}</th>
                      <th className="px-4 py-2 text-right font-medium">{t('overview.reqs')}</th>
                      <th className="px-4 py-2 text-right font-medium">{t('overview.tokens')}</th>
                      <th className="px-4 py-2 text-right font-medium">{t('overview.cost')}</th>
                      <th className="px-4 py-2 text-right font-medium">{t('overview.lastActivity')}</th>
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
              {t('overview.securityLayer')}
            </h2>
            <button onClick={() => setSecurityExpanded(true)} title={t('overview.details')} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronDown className="w-3.5 h-3.5" /> {t('overview.details')}
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
          {t('overview.healthChecks')}
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
            {t('overview.llmProviders')}
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
                    {p.configured ? t('overview.connected') : t('overview.notConfigured')}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {t('overview.models')}: {p.models.slice(0, 3).join(', ')}{p.models.length > 3 ? ` +${p.models.length - 3}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
