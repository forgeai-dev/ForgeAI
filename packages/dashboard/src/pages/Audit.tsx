import { Shield, AlertTriangle, Info } from 'lucide-react';

export function AuditPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-sm text-zinc-400 mt-1">Security events and activity trail</p>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="bg-zinc-800/30 px-5 py-3 flex items-center gap-4 text-xs text-zinc-400 border-b border-zinc-800">
          <span className="w-40">Timestamp</span>
          <span className="w-36">Action</span>
          <span className="w-20">Risk</span>
          <span className="flex-1">Details</span>
          <span className="w-16 text-right">Status</span>
        </div>

        {/* Placeholder events */}
        {[
          { time: 'Now', action: 'gateway.start', risk: 'low', detail: 'Gateway started successfully', success: true },
          { time: '-2s', action: 'vault.init', risk: 'low', detail: 'Vault initialized with AES-256-GCM', success: true },
          { time: '-3s', action: 'migration.run', risk: 'low', detail: '001_initial_schema applied', success: true },
          { time: '-5s', action: 'prompt_injection.detected', risk: 'high', detail: 'Score: 0.90 — "Ignore all previous instructions..."', success: false },
          { time: '-10s', action: 'rate_limit.check', risk: 'low', detail: 'IP 127.0.0.1 — 45/60 remaining', success: true },
        ].map((event, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
            <span className="w-40 text-xs text-zinc-500 font-mono">{event.time}</span>
            <span className="w-36 text-xs text-zinc-300 font-medium">{event.action}</span>
            <span className="w-20">
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                event.risk === 'high' ? 'bg-red-500/10 text-red-400' :
                event.risk === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                'bg-zinc-700/50 text-zinc-400'
              }`}>
                {event.risk === 'high' ? <AlertTriangle className="w-3 h-3" /> :
                 event.risk === 'medium' ? <Info className="w-3 h-3" /> :
                 <Shield className="w-3 h-3" />}
                {event.risk}
              </span>
            </span>
            <span className="flex-1 text-xs text-zinc-400 truncate">{event.detail}</span>
            <span className="w-16 text-right">
              <span className={`text-[10px] font-medium ${event.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {event.success ? 'OK' : 'BLOCKED'}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="text-center py-4">
        <p className="text-xs text-zinc-500">
          Audit log will show real-time events from MySQL when the gateway processes requests.
          <br />
          Events include: auth, rate limiting, prompt injection, vault access, and more.
        </p>
      </div>
    </div>
  );
}
