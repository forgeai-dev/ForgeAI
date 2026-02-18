import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Wrench, BarChart3, Shield, Settings, Flame, Store, Radio, Users, Brain, Mail, Database, Key, Webhook, CalendarDays, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/tools', label: 'Tools', icon: Wrench },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
  { to: '/plugins', label: 'Plugins', icon: Store },
  { to: '/channels', label: 'Channels', icon: Radio },
  { to: '/agents', label: 'Agents', icon: Users },
  { to: '/workspace', label: 'Workspace', icon: Brain },
  { to: '/gmail', label: 'Gmail', icon: Mail },
  { to: '/memory', label: 'Memory', icon: Database },
  { to: '/rag', label: 'RAG', icon: Database },
  { to: '/api-keys', label: 'API Keys', icon: Key },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/voice', label: 'Voice', icon: AudioLines },
  { to: '/audit', label: 'Audit Log', icon: Shield },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
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
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-slow" />
            <span className="text-xs text-zinc-500">Gateway connected</span>
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
