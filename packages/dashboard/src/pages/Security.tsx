import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, ShieldBan, ShieldCheck, AlertTriangle, Ban, RefreshCw, Plus, X, Globe, Zap, Eye, MapPin } from 'lucide-react';
import { api, type SecurityDashboardData, type SecurityThreat, type BlockedIP, type SecurityAlert, type GeoIPData } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Country code → flag emoji
function countryFlag(code: string): string {
  if (!code || code.length !== 2 || code === '??' || code === 'LO') return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

type Tab = 'overview' | 'threats' | 'blocked' | 'alerts';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function SecurityPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<SecurityDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Block IP form
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockIp, setBlockIp] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Geolocation data
  const [geoData, setGeoData] = useState<Record<string, GeoIPData>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api.getSecurityDashboard();
      setData(result);
      setError(null);

      // Fetch geolocation for all unique IPs
      const allIPs = new Set<string>();
      result.overview.topOffenders.forEach(o => allIPs.add(o.ip));
      result.threats.forEach(t => allIPs.add(t.ip));
      result.blockedIPs.forEach(b => allIPs.add(b.ip));
      const ipsToFetch = [...allIPs].filter(ip => !geoData[ip]);
      if (ipsToFetch.length > 0) {
        try {
          const { results } = await api.getGeoIPBatch(ipsToFetch);
          setGeoData(prev => ({ ...prev, ...results }));
        } catch { /* geo is best-effort */ }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleBlock = async () => {
    if (!blockIp.trim()) return;
    setActionLoading(true);
    try {
      await api.blockIP(blockIp.trim(), blockReason.trim() || 'Manual block');
      setToast(t('security.blockSuccess'));
      setShowBlockForm(false);
      setBlockIp('');
      setBlockReason('');
      await fetchData();
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnblock = async (ip: string) => {
    setActionLoading(true);
    try {
      await api.unblockIP(ip);
      setToast(t('security.unblockSuccess'));
      await fetchData();
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: t('security.overview'), icon: <Eye className="w-4 h-4" /> },
    { key: 'threats', label: t('security.threats'), icon: <ShieldAlert className="w-4 h-4" /> },
    { key: 'blocked', label: t('security.blockedIPs'), icon: <ShieldBan className="w-4 h-4" /> },
    { key: 'alerts', label: t('security.alerts'), icon: <AlertTriangle className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-forge-400" />
            {t('security.title')}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">{t('security.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBlockForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {t('security.blockIP')}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {loading ? t('security.refreshing') : t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 shadow-xl animate-slide-in">
          {toast}
        </div>
      )}

      {/* Block IP Modal */}
      {showBlockForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBlockForm(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Ban className="w-5 h-5 text-red-400" /> {t('security.blockIP')}
              </h3>
              <button onClick={() => setShowBlockForm(false)} className="text-zinc-400 hover:text-white" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">{t('security.ipAddress')}</label>
                <input
                  value={blockIp}
                  onChange={e => setBlockIp(e.target.value)}
                  placeholder={t('security.ipPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-forge-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">{t('security.reason')}</label>
                <input
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder={t('security.reasonPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-forge-500"
                />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                <Ban className="w-4 h-4 text-red-400" />
                <span className="text-xs text-zinc-400">{t('security.permanent')} — {t('security.manualUnblockOnly') || 'manual unblock only'}</span>
              </div>
              <button
                onClick={handleBlock}
                disabled={!blockIp.trim() || actionLoading}
                className="w-full mt-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium text-sm transition-colors"
              >
                {actionLoading ? '...' : t('security.blockIP')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-1">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
              tab === key
                ? 'bg-zinc-700 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            )}
          >
            {icon} {label}
            {key === 'blocked' && data && data.blockedIPs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold">
                {data.blockedIPs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {!data && !error ? (
        <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> {t('common.loading')}
        </div>
      ) : data && (
        <>
          {tab === 'overview' && <OverviewTab data={data} geoData={geoData} t={t} />}
          {tab === 'threats' && <ThreatsTab threats={data.threats} geoData={geoData} t={t} />}
          {tab === 'blocked' && <BlockedTab blocked={data.blockedIPs} geoData={geoData} onUnblock={handleUnblock} actionLoading={actionLoading} t={t} />}
          {tab === 'alerts' && <AlertsTab alerts={data.recentAlerts} t={t} />}
        </>
      )}
    </div>
  );
}

/* ─── Overview Tab ──────────────────────────────────── */
function OverviewTab({ data, geoData, t }: { data: SecurityDashboardData; geoData: Record<string, GeoIPData>; t: (k: string) => string }) {
  const stats = [
    { label: t('security.totalThreats'), value: data.overview.totalThreats, icon: <Zap className="w-5 h-5" />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: t('security.blockedCount'), value: data.overview.blockedIPs, icon: <ShieldBan className="w-5 h-5" />, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: t('security.recentAlerts'), value: data.recentAlerts.length, icon: <AlertTriangle className="w-5 h-5" />, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    {
      label: t('security.filterConfig'),
      value: data.ipFilterConfig.enabled ? t('security.filterEnabled') : t('security.filterDisabled'),
      icon: <ShieldCheck className="w-5 h-5" />,
      color: data.ipFilterConfig.enabled ? 'text-emerald-400' : 'text-zinc-400',
      bg: data.ipFilterConfig.enabled ? 'bg-emerald-500/10' : 'bg-zinc-500/10',
      isText: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', s.bg, s.color)}>{s.icon}</div>
              <div>
                <p className="text-xs text-zinc-400">{s.label}</p>
                <p className={cn('text-xl font-bold', s.color)}>
                  {s.isText ? <span className="text-sm">{s.value}</span> : s.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Top Offenders + Recent Alerts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Offenders */}
        <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-700/50 flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">{t('security.topOffenders')}</h3>
          </div>
          {data.overview.topOffenders.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">{t('security.noThreats')}</div>
          ) : (
            <div className="divide-y divide-zinc-700/30">
              {data.overview.topOffenders.map((o, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                  <span className="text-xs text-zinc-500 w-6 text-right font-mono">#{i + 1}</span>
                  <span className="text-sm text-white font-mono flex-1">{o.ip}</span>
                  {geoData[o.ip] && (
                    <span className="text-xs text-zinc-400 flex items-center gap-1">
                      <span>{countryFlag(geoData[o.ip].countryCode)}</span>
                      <span className="truncate max-w-28">{geoData[o.ip].city || geoData[o.ip].country}</span>
                    </span>
                  )}
                  <span className="text-xs text-zinc-400 truncate max-w-32">{o.reason}</span>
                  <span className="text-sm font-bold text-amber-400">{o.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Alerts */}
        <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-700/50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">{t('security.recentAlerts')}</h3>
          </div>
          {data.recentAlerts.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">{t('security.noAlerts')}</div>
          ) : (
            <div className="divide-y divide-zinc-700/30 max-h-80 overflow-y-auto">
              {data.recentAlerts.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-800/30 transition-colors">
                  <span className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    a.riskLevel === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                  )} />
                  <span className="text-xs text-zinc-300 font-medium truncate flex-1">{a.action}</span>
                  <span className="text-xs text-zinc-500 font-mono">{a.ipAddress || '—'}</span>
                  <span className="text-[10px] text-zinc-500">{new Date(a.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Threats Tab ────────────────────────────────────── */
function ThreatsTab({ threats, geoData, t }: { threats: SecurityThreat[]; geoData: Record<string, GeoIPData>; t: (k: string) => string }) {
  if (threats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <ShieldCheck className="w-12 h-12 mb-3 text-emerald-500/30" />
        <p className="text-sm">{t('security.noThreats')}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
      <div className="bg-zinc-800/50 px-5 py-3 flex items-center gap-4 text-xs text-zinc-400 border-b border-zinc-700/50 font-medium">
        <span className="w-40">{t('security.ipAddress')}</span>
        <span className="w-32"><MapPin className="w-3 h-3 inline mr-1" />Location</span>
        <span className="w-16 text-center">{t('security.hits')}</span>
        <span className="flex-1">{t('security.reason')}</span>
        <span className="w-24">{t('security.firstSeen')}</span>
        <span className="w-24">{t('security.lastSeen')}</span>
        <span className="w-20 text-center">{t('security.status')}</span>
      </div>
      <div className="divide-y divide-zinc-700/30 max-h-[600px] overflow-y-auto">
        {threats.map((threat, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/20 transition-colors">
            <span className="w-40 text-sm text-white font-mono truncate">{threat.ip}</span>
            <span className="w-32 text-xs text-zinc-400 truncate flex items-center gap-1">
              {geoData[threat.ip] ? (
                <><span>{countryFlag(geoData[threat.ip].countryCode)}</span> {geoData[threat.ip].city || geoData[threat.ip].country}</>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </span>
            <span className="w-16 text-center">
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold',
                threat.count >= 100 ? 'bg-red-500/15 text-red-400' :
                threat.count >= 50 ? 'bg-amber-500/15 text-amber-400' :
                'bg-zinc-700/50 text-zinc-300'
              )}>{threat.count}</span>
            </span>
            <span className="flex-1 text-xs text-zinc-400 truncate">{threat.reason}</span>
            <span className="w-24 text-xs text-zinc-500">{timeAgo(threat.firstSeen)}</span>
            <span className="w-24 text-xs text-zinc-500">{timeAgo(threat.lastSeen)}</span>
            <span className="w-20 text-center">
              {threat.blocked ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-medium">
                  <Ban className="w-3 h-3" /> {t('security.blocked')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400 text-[10px] font-medium">
                  <Eye className="w-3 h-3" /> {t('security.tracking')}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Blocked IPs Tab ───────────────────────────────── */
function BlockedTab({ blocked, geoData, onUnblock, actionLoading, t }: { blocked: BlockedIP[]; geoData: Record<string, GeoIPData>; onUnblock: (ip: string) => void; actionLoading: boolean; t: (k: string) => string }) {
  if (blocked.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <ShieldCheck className="w-12 h-12 mb-3 text-emerald-500/30" />
        <p className="text-sm">{t('security.noBlocked')}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
      <div className="bg-zinc-800/50 px-5 py-3 flex items-center gap-4 text-xs text-zinc-400 border-b border-zinc-700/50 font-medium">
        <span className="w-40">{t('security.ipAddress')}</span>
        <span className="w-32"><MapPin className="w-3 h-3 inline mr-1" />Location</span>
        <span className="w-20 text-center">{t('security.hits')}</span>
        <span className="flex-1">{t('security.reason')}</span>
        <span className="w-20 text-center">Type</span>
        <span className="w-24 text-center">{t('security.status')}</span>
        <span className="w-20 text-right">{t('common.actions')}</span>
      </div>
      <div className="divide-y divide-zinc-700/30">
        {blocked.map((ip, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/20 transition-colors">
            <span className="w-40 text-sm text-white font-mono truncate">{ip.ip}</span>
            <span className="w-32 text-xs text-zinc-400 truncate flex items-center gap-1">
              {geoData[ip.ip] ? (
                <><span>{countryFlag(geoData[ip.ip].countryCode)}</span> {geoData[ip.ip].city || geoData[ip.ip].country}</>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </span>
            <span className="w-20 text-center text-xs text-zinc-300 font-bold">{ip.threatCount}</span>
            <span className="flex-1 text-xs text-zinc-400 truncate">{ip.reason}</span>
            <span className="w-20 text-center">
              <span className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full',
                ip.autoBlocked ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-700/50 text-zinc-300'
              )}>
                {ip.autoBlocked ? t('security.auto') : t('security.manual')}
              </span>
            </span>
            <span className="w-24 text-center">
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                <Ban className="w-3 h-3" /> {t('security.permanent')}
              </span>
            </span>
            <span className="w-20 text-right">
              <button
                onClick={() => onUnblock(ip.ip)}
                disabled={actionLoading}
                className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-medium transition-colors disabled:opacity-50"
              >
                {t('security.unblock')}
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Alerts Tab ─────────────────────────────────────── */
function AlertsTab({ alerts, t }: { alerts: SecurityAlert[]; t: (k: string) => string }) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <ShieldCheck className="w-12 h-12 mb-3 text-emerald-500/30" />
        <p className="text-sm">{t('security.noAlerts')}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
      <div className="bg-zinc-800/50 px-5 py-3 flex items-center gap-4 text-xs text-zinc-400 border-b border-zinc-700/50 font-medium">
        <span className="w-8"></span>
        <span className="w-48">{t('security.action')}</span>
        <span className="w-36">{t('security.ipAddress')}</span>
        <span className="flex-1">Details</span>
        <span className="w-20 text-center">{t('activity.risk')}</span>
        <span className="w-36 text-right">{t('common.time')}</span>
      </div>
      <div className="divide-y divide-zinc-700/30 max-h-[600px] overflow-y-auto">
        {alerts.map((alert, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/20 transition-colors">
            <span className="w-8">
              {alert.riskLevel === 'critical' ? (
                <ShieldAlert className="w-4 h-4 text-red-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
            </span>
            <span className="w-48 text-xs text-zinc-300 font-medium truncate">{alert.action}</span>
            <span className="w-36 text-xs text-zinc-400 font-mono">{alert.ipAddress || '—'}</span>
            <span className="flex-1 text-xs text-zinc-500 truncate">
              {alert.details ? Object.entries(alert.details).map(([k, v]) => `${k}: ${v}`).join(', ') : '—'}
            </span>
            <span className="w-20 text-center">
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full',
                alert.riskLevel === 'critical' ? 'bg-red-500/10 text-red-400' :
                alert.riskLevel === 'high' ? 'bg-amber-500/10 text-amber-400' :
                'bg-zinc-700/50 text-zinc-400'
              )}>
                {alert.riskLevel}
              </span>
            </span>
            <span className="w-36 text-right text-[10px] text-zinc-500 font-mono">
              {new Date(alert.timestamp).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
