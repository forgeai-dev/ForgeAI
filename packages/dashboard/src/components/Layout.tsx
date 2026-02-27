import { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Wrench, BarChart3, Shield, Settings, Flame, Store, Radio, Users, Brain, Mail, Database, Key, Webhook, CalendarDays, AudioLines, Layers, Video, Activity, Menu, X, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const navItems = [
  { to: '/', i18nKey: 'nav.overview', icon: LayoutDashboard },
  { to: '/chat', i18nKey: 'nav.chat', icon: MessageSquare },
  { to: '/tools', i18nKey: 'nav.tools', icon: Wrench },
  { to: '/usage', i18nKey: 'nav.usage', icon: BarChart3 },
  { to: '/plugins', i18nKey: 'nav.plugins', icon: Store },
  { to: '/channels', i18nKey: 'nav.channels', icon: Radio },
  { to: '/agents', i18nKey: 'nav.agents', icon: Users },
  { to: '/workspace', i18nKey: 'nav.workspace', icon: Brain },
  { to: '/gmail', i18nKey: 'nav.gmail', icon: Mail },
  { to: '/memory', i18nKey: 'nav.memory', icon: Database },
  { to: '/rag', i18nKey: 'nav.rag', icon: Database },
  { to: '/api-keys', i18nKey: 'nav.apiKeys', icon: Key },
  { to: '/webhooks', i18nKey: 'nav.webhooks', icon: Webhook },
  { to: '/calendar', i18nKey: 'nav.calendar', icon: CalendarDays },
  { to: '/voice', i18nKey: 'nav.voice', icon: AudioLines },
  { to: '/canvas', i18nKey: 'nav.canvas', icon: Layers },
  { to: '/recordings', i18nKey: 'nav.recordings', icon: Video },
  { to: '/activity', i18nKey: 'nav.activity', icon: Activity },
  { to: '/audit', i18nKey: 'nav.audit', icon: Shield },
  { to: '/settings', i18nKey: 'nav.settings', icon: Settings },
];

export function Layout() {
  const { t } = useI18n();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Close mobile drawer on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed(prev => !prev), []);

  const sidebarContent = (isMobile: boolean) => (
    <>
      {/* Logo */}
      <div className={cn(
        'flex items-center border-b border-zinc-800 flex-shrink-0',
        collapsed && !isMobile ? 'justify-center px-2 py-4' : 'gap-3 px-4 py-4'
      )}>
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-forge-500 to-forge-700 flex items-center justify-center flex-shrink-0">
          <Flame className="w-5 h-5 text-white" />
        </div>
        {(!collapsed || isMobile) && (
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white tracking-tight leading-tight">ForgeAI</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Dashboard</p>
          </div>
        )}
        {/* Mobile close button */}
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-1 text-zinc-400 hover:text-white" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav — scrollable */}
      <nav className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5',
        collapsed && !isMobile ? 'px-1.5' : 'px-2'
      )}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={collapsed && !isMobile ? t(item.i18nKey) : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center rounded-lg text-sm font-medium transition-colors',
                collapsed && !isMobile
                  ? 'justify-center px-2 py-2'
                  : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-forge-500/10 text-forge-400'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              )
            }
          >
            <item.icon className="w-4 h-4 flex-shrink-0" />
            {(!collapsed || isMobile) && (
              <span className="truncate">{t(item.i18nKey)}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn(
        'border-t border-zinc-800 flex-shrink-0',
        collapsed && !isMobile ? 'px-2 py-2' : 'px-3 py-2.5'
      )}>
        {/* Collapse toggle (desktop only) */}
        {!isMobile && (
          <button
            onClick={toggleCollapsed}
            className="flex items-center gap-2 w-full px-1 py-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4 mx-auto" /> : (
              <>
                <ChevronsLeft className="w-4 h-4" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        )}
        <div className={cn('flex items-center gap-2 mt-1', collapsed && !isMobile && 'justify-center')}>
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-slow flex-shrink-0" />
          {(!collapsed || isMobile) && (
            <span className="text-xs text-zinc-500 truncate">{t('nav.gatewayConnected')}</span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] h-full bg-zinc-950 border-r border-zinc-800 flex flex-col shadow-2xl animate-slide-in">
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className={cn(
        'hidden md:flex flex-col flex-shrink-0 border-r border-zinc-800 bg-zinc-950 transition-all duration-200',
        collapsed ? 'w-16' : 'w-56 lg:w-60'
      )}>
        {sidebarContent(false)}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-zinc-900 md:ml-0">
        <Outlet />
      </main>
    </div>
  );
}
