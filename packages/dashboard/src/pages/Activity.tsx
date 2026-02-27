import { useState, useEffect, useCallback } from 'react';
import { Activity, Shield, AlertTriangle, Monitor, Server, Laptop, RefreshCw, Filter } from 'lucide-react';
import { api } from '@/lib/api';

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  toolName: string;
  target: string;
  command?: string;
  summary: string;
  riskLevel: string;
  success: boolean;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
}

interface ActivityStats {
  totalToday: number;
  hostToday: number;
  blockedToday: number;
  errorToday: number;
}

const RISK_STYLES: Record<string, string> = {
  low: 'bg-zinc-700/50 text-zinc-400',
  medium: 'bg-amber-500/10 text-amber-400',
  high: 'bg-red-500/10 text-red-400',
  critical: 'bg-red-600/20 text-red-300 animate-pulse',
};

const TARGET_ICONS: Record<string, typeof Server> = {
  server: Server,
  host: Monitor,
  companion: Laptop,
};

const TARGET_LABELS: Record<string, string> = {
  server: 'Container',
  host: 'Host',
  companion: 'Companion',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ActivityPage() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ target?: string; riskLevel?: string }>({});
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [actRes, statsRes] = await Promise.all([
        api.getActivity({ ...filter, limit: 100 }),
        api.getActivityStats(),
      ]);
      setActivities(actRes.activities);
      setStats(statsRes.stats);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-forge-400" />
            Activity Monitor
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Real-time view of everything the agent does</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              autoRefresh
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : undefined} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Today" value={stats.totalToday} icon={Activity} color="text-zinc-300" />
          <StatCard label="Host Commands" value={stats.hostToday} icon={Monitor} color="text-amber-400" />
          <StatCard label="Blocked" value={stats.blockedToday} icon={Shield} color="text-red-400" />
          <StatCard label="Errors" value={stats.errorToday} icon={AlertTriangle} color="text-red-400" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-zinc-500" />
        <span className="text-xs text-zinc-500">Filter:</span>
        {['all', 'host', 'server', 'companion'].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(f => ({ ...f, target: t === 'all' ? undefined : t }))}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              (t === 'all' && !filter.target) || filter.target === t
                ? 'bg-forge-500/15 text-forge-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'all' ? 'All' : TARGET_LABELS[t] || t}
          </button>
        ))}
        <div className="w-px h-4 bg-zinc-700 mx-1" />
        {['all', 'high', 'critical'].map((r) => (
          <button
            key={r}
            onClick={() => setFilter(f => ({ ...f, riskLevel: r === 'all' ? undefined : r }))}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              (r === 'all' && !filter.riskLevel) || filter.riskLevel === r
                ? 'bg-forge-500/15 text-forge-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {r === 'all' ? 'All Risk' : r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {/* Activity Feed */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="bg-zinc-800/30 px-5 py-3 flex items-center gap-4 text-xs text-zinc-400 border-b border-zinc-800">
          <span className="w-20">Time</span>
          <span className="w-20">Target</span>
          <span className="w-20">Risk</span>
          <span className="flex-1">Activity</span>
          <span className="w-20 text-right">Duration</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-zinc-500 animate-spin" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">No activity recorded yet</p>
            <p className="text-xs text-zinc-600 mt-1">Activities will appear here when the agent executes tools</p>
          </div>
        ) : (
          activities.map((entry) => {
            const TargetIcon = TARGET_ICONS[entry.target] || Server;
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-4 px-5 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${
                  entry.type === 'blocked' ? 'bg-red-500/5' :
                  entry.type === 'host_cmd' ? 'bg-amber-500/5' : ''
                }`}
              >
                <span className="w-20 text-xs text-zinc-500 font-mono flex-shrink-0 pt-0.5">
                  {timeAgo(entry.timestamp)}
                </span>
                <span className="w-20 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    entry.target === 'host' ? 'bg-amber-500/10 text-amber-400' :
                    entry.target === 'companion' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-zinc-700/50 text-zinc-400'
                  }`}>
                    <TargetIcon className="w-3 h-3" />
                    {TARGET_LABELS[entry.target] || entry.target}
                  </span>
                </span>
                <span className="w-20 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${RISK_STYLES[entry.riskLevel] || RISK_STYLES.low}`}>
                    {entry.riskLevel === 'high' || entry.riskLevel === 'critical' ? <AlertTriangle className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                    {entry.riskLevel}
                  </span>
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs break-words ${entry.success ? 'text-zinc-300' : 'text-red-400'}`}>
                    {entry.summary}
                  </p>
                  {entry.command && entry.command !== entry.summary && (
                    <p className="text-[10px] text-zinc-600 font-mono mt-0.5 truncate" title={entry.command}>
                      $ {entry.command}
                    </p>
                  )}
                </div>
                <span className="w-20 text-right text-[10px] text-zinc-600 flex-shrink-0 pt-0.5">
                  {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '—'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Activity; color: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
