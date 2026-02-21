import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Wrench, BarChart3, Shield, Settings, Flame, Store, Radio, Users, Brain, Mail, Database, Key, Webhook, CalendarDays, AudioLines, Layers, Video } from 'lucide-react';
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
  { to: '/audit', i18nKey: 'nav.audit', icon: Shield },
  { to: '/settings', i18nKey: 'nav.settings', icon: Settings },
];

export function Layout() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-zinc-800">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-forge-500 to-forge-700 flex items-center justify-center">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">ForgeAI</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Dashboard</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-forge-500/10 text-forge-400'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {t(item.i18nKey)}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-slow" />
            <span className="text-xs text-zinc-500">{t('nav.gatewayConnected')}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-zinc-900">
        <Outlet />
      </main>
    </div>
  );
}
