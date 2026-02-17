import { useState, useEffect } from 'react';
import { Webhook, Plus, Loader2, ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle } from 'lucide-react';

interface OutboundWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

interface InboundWebhook {
  id: string;
  name: string;
  path: string;
  handler: string;
  active: boolean;
  createdAt: string;
}

interface WebhookEvent {
  id: string;
  type: string;
  url?: string;
  status?: number;
  success: boolean;
  timestamp: string;
  duration?: number;
}

type WebhookTab = 'outbound' | 'inbound' | 'events';

export function WebhooksPage() {
  const [tab, setTab] = useState<WebhookTab>('outbound');
  const [outbound, setOutbound] = useState<OutboundWebhook[]>([]);
  const [inbound, setInbound] = useState<InboundWebhook[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newOutbound, setNewOutbound] = useState({ name: '', url: '', events: '' });
  const [newInbound, setNewInbound] = useState({ name: '', path: '', handler: '' });

  const loadData = async () => {
    try {
      const [wh, ev] = await Promise.all([
        fetch('/api/webhooks').then(r => r.json()),
        fetch('/api/webhooks/events').then(r => r.json()),
      ]);
      setOutbound((wh as { outbound: OutboundWebhook[] }).outbound ?? []);
      setInbound((wh as { inbound: InboundWebhook[] }).inbound ?? []);
      setEvents((ev as { events: WebhookEvent[] }).events ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const addOutbound = async () => {
    if (!newOutbound.name || !newOutbound.url || !newOutbound.events) return;
    await fetch('/api/webhooks/outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newOutbound.name, url: newOutbound.url, events: newOutbound.events.split(',').map(e => e.trim()) }),
    });
    setNewOutbound({ name: '', url: '', events: '' });
    setShowAdd(false);
    loadData();
  };

  const addInbound = async () => {
    if (!newInbound.name || !newInbound.path || !newInbound.handler) return;
    await fetch('/api/webhooks/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newInbound),
    });
    setNewInbound({ name: '', path: '', handler: '' });
    setShowAdd(false);
    loadData();
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-forge-400" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Webhook className="w-6 h-6 text-cyan-400" />
            Webhooks
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {outbound.length} outbound, {inbound.length} inbound
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['outbound', 'inbound', 'events'] as WebhookTab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setShowAdd(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === t
                  ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              {t === 'outbound' && <ArrowUpRight className="w-3.5 h-3.5" />}
              {t === 'inbound' && <ArrowDownLeft className="w-3.5 h-3.5" />}
              {t === 'events' && <Clock className="w-3.5 h-3.5" />}
              {t === 'outbound' ? `Outbound (${outbound.length})` : t === 'inbound' ? `Inbound (${inbound.length})` : `Events (${events.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Outbound Tab */}
      {tab === 'outbound' && (
        <div className="space-y-3">
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white transition-colors">
            <Plus className="w-3.5 h-3.5" /> Novo Outbound
          </button>

          {showAdd && (
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input type="text" value={newOutbound.name} onChange={e => setNewOutbound(s => ({ ...s, name: e.target.value }))}
                  placeholder="Nome" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
                <input type="text" value={newOutbound.url} onChange={e => setNewOutbound(s => ({ ...s, url: e.target.value }))}
                  placeholder="https://..." className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
                <input type="text" value={newOutbound.events} onChange={e => setNewOutbound(s => ({ ...s, events: e.target.value }))}
                  placeholder="message.created, tool.executed" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
              <button onClick={addOutbound} disabled={!newOutbound.name || !newOutbound.url}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white disabled:opacity-50 transition-colors">
                Criar
              </button>
            </div>
          )}

          {outbound.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <ArrowUpRight className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhum webhook outbound</p>
            </div>
          ) : (
            outbound.map(wh => (
              <div key={wh.id} className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{wh.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">{wh.url}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${wh.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
                    {wh.active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {wh.events.map(ev => (
                    <span key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{ev}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Inbound Tab */}
      {tab === 'inbound' && (
        <div className="space-y-3">
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white transition-colors">
            <Plus className="w-3.5 h-3.5" /> Novo Inbound
          </button>

          {showAdd && (
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input type="text" value={newInbound.name} onChange={e => setNewInbound(s => ({ ...s, name: e.target.value }))}
                  placeholder="Nome" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
                <input type="text" value={newInbound.path} onChange={e => setNewInbound(s => ({ ...s, path: e.target.value }))}
                  placeholder="/meu-webhook" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
                <input type="text" value={newInbound.handler} onChange={e => setNewInbound(s => ({ ...s, handler: e.target.value }))}
                  placeholder="handler-name" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
              <button onClick={addInbound} disabled={!newInbound.name || !newInbound.path}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white disabled:opacity-50 transition-colors">
                Criar
              </button>
            </div>
          )}

          {inbound.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <ArrowDownLeft className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhum webhook inbound</p>
            </div>
          ) : (
            inbound.map(wh => (
              <div key={wh.id} className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{wh.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">/api/webhooks/receive/{wh.path}</p>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">{wh.handler}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Events Tab */}
      {tab === 'events' && (
        <div className="space-y-1">
          {events.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhum evento registrado</p>
            </div>
          ) : (
            events.map(ev => (
              <div key={ev.id} className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  {ev.success ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="text-zinc-300 font-mono">{ev.type}</span>
                  {ev.url && <span className="text-zinc-600 truncate max-w-xs">{ev.url}</span>}
                </div>
                <div className="flex items-center gap-3 text-zinc-600">
                  {ev.status && <span>{ev.status}</span>}
                  {ev.duration && <span>{ev.duration}ms</span>}
                  <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default WebhooksPage;
