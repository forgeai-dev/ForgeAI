import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface StatusCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  status?: 'healthy' | 'warning' | 'error' | 'neutral';
  subtitle?: string;
}

export function StatusCard({ title, value, icon, status = 'neutral', subtitle }: StatusCardProps) {
  const statusColors = {
    healthy: 'border-emerald-500/30 bg-emerald-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    error: 'border-red-500/30 bg-red-500/5',
    neutral: 'border-zinc-700/50 bg-zinc-800/30',
  };

  const dotColors = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    neutral: 'bg-zinc-500',
  };

  return (
    <div className={cn('rounded-xl border p-5 transition-colors', statusColors[status])}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className={cn('w-2 h-2 rounded-full', dotColors[status])} />
            <p className="text-xs text-zinc-400 uppercase tracking-wider">{title}</p>
          </div>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
        </div>
        <div className="text-zinc-500">{icon}</div>
      </div>
    </div>
  );
}
