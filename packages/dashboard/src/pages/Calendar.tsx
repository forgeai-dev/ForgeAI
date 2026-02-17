import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Plus, Loader2, Key, CheckCircle, Clock, MapPin, Users, Trash2, Zap, ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  htmlLink: string;
  creator: string;
  attendees: Array<{ email: string; displayName?: string; responseStatus: string }>;
}

type CalTab = 'events' | 'create' | 'config';

export function CalendarPage() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CalTab>('events');

  // Events
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [viewDays, setViewDays] = useState(7);

  // Create
  const [newEvent, setNewEvent] = useState({ summary: '', description: '', location: '', start: '', end: '', allDay: false });
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<'success' | 'error' | null>(null);

  // Quick add
  const [quickText, setQuickText] = useState('');

  // Config
  const [accessToken, setAccessToken] = useState('');
  const [configuring, setConfiguring] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/calendar/status').then(r => r.json()) as { configured: boolean };
      setConfigured(res.configured);
      if (res.configured) setTab('events');
      else setTab('config');
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!configured) return;
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/integrations/calendar/upcoming?days=${viewDays}`).then(r => r.json()) as { events: CalendarEvent[] };
      setEvents(res.events ?? []);
    } catch { /* ignore */ }
    setEventsLoading(false);
  }, [configured, viewDays]);

  useEffect(() => { checkStatus(); }, [checkStatus]);
  useEffect(() => { if (configured && tab === 'events') loadEvents(); }, [configured, tab, loadEvents]);

  const handleConfigure = async () => {
    if (!accessToken.trim()) return;
    setConfiguring(true);
    try {
      await fetch('/api/integrations/calendar/configure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: accessToken.trim() }),
      });
      setConfigured(true);
      setTab('events');
      setAccessToken('');
    } catch { /* ignore */ }
    setConfiguring(false);
  };

  const handleCreate = async () => {
    if (!newEvent.summary || !newEvent.start || !newEvent.end) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch('/api/integrations/calendar/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent),
      }).then(r => r.json()) as { event?: CalendarEvent };
      if (res.event) {
        setCreateResult('success');
        setNewEvent({ summary: '', description: '', location: '', start: '', end: '', allDay: false });
        setTimeout(() => setCreateResult(null), 3000);
      } else setCreateResult('error');
    } catch { setCreateResult('error'); }
    setCreating(false);
  };

  const handleQuickAdd = async () => {
    if (!quickText.trim()) return;
    await fetch('/api/integrations/calendar/quickadd', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: quickText }),
    });
    setQuickText('');
    loadEvents();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/integrations/calendar/events/${id}`, { method: 'DELETE' });
    setEvents(prev => prev.filter(e => e.id !== id));
    if (selectedEvent?.id === id) setSelectedEvent(null);
  };

  const formatTime = (iso: string, allDay: boolean) => {
    if (allDay) return 'Dia inteiro';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch { return iso; }
  };

  if (loading) {
    return <div className="p-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-forge-400" /></div>;
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-blue-400" /> Calendar
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {configured ? `${events.length} eventos nos próximos ${viewDays} dias` : 'Configure o Google Calendar'}
          </p>
        </div>
        {configured && (
          <div className="flex items-center gap-2">
            {(['events', 'create', 'config'] as CalTab[]).map(t => (
              <button key={t} onClick={() => { setTab(t); setSelectedEvent(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === t ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30' : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}>
                {t === 'events' && <CalendarDays className="w-3.5 h-3.5" />}
                {t === 'create' && <Plus className="w-3.5 h-3.5" />}
                {t === 'config' && <Key className="w-3.5 h-3.5" />}
                {t === 'events' ? 'Eventos' : t === 'create' ? 'Criar' : 'Config'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Config */}
      {tab === 'config' && (
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-400" /> Configurar Google Calendar
          </h2>
          <p className="text-sm text-zinc-400">
            Use um OAuth2 Access Token do Google com scopes calendar.readonly + calendar.events.
          </p>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Access Token</label>
            <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)}
              placeholder="ya29.a0..." className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
          </div>
          <button onClick={handleConfigure} disabled={configuring || !accessToken.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              configuring ? 'bg-forge-500/50 text-white cursor-wait' : accessToken.trim() ? 'bg-forge-500 hover:bg-forge-600 text-white' : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            }`}>
            {configuring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Conectar
          </button>
          {configured && <div className="flex items-center gap-2 text-emerald-400 text-sm"><CheckCircle className="w-4 h-4" /> Calendar conectado</div>}
        </div>
      )}

      {/* Events */}
      {tab === 'events' && configured && (
        <div className="space-y-4">
          {/* Quick add + range */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input type="text" value={quickText} onChange={e => setQuickText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleQuickAdd()}
                placeholder="Quick add: 'Reunião amanhã 14h' ou 'Dentista sexta 10:00'"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setViewDays(Math.max(1, viewDays - 7))} title="Menos dias" className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs text-zinc-500 w-16 text-center">{viewDays}d</span>
              <button onClick={() => setViewDays(viewDays + 7)} title="Mais dias" className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex gap-4">
            {/* Event list */}
            <div className="w-80 shrink-0 space-y-1 max-h-[600px] overflow-y-auto">
              {eventsLoading && <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-zinc-500" /></div>}
              {!eventsLoading && events.length === 0 && (
                <div className="text-center py-8 text-zinc-500 text-sm">Nenhum evento</div>
              )}
              {events.map(ev => (
                <button key={ev.id} onClick={() => setSelectedEvent(ev)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all border ${
                    selectedEvent?.id === ev.id ? 'bg-blue-500/10 border-blue-500/30' : 'bg-zinc-900/50 border-transparent hover:bg-zinc-800/50'
                  }`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Clock className="w-3 h-3 text-blue-400 shrink-0" />
                    <span className="text-[10px] text-zinc-500">{formatDate(ev.start)} · {formatTime(ev.start, ev.allDay)}</span>
                  </div>
                  <p className="text-sm text-zinc-200 font-medium truncate">{ev.summary}</p>
                  {ev.location && <p className="text-[10px] text-zinc-600 truncate mt-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{ev.location}</p>}
                </button>
              ))}
            </div>

            {/* Event detail */}
            <div className="flex-1 min-w-0">
              {selectedEvent ? (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selectedEvent.summary}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(selectedEvent.start)} {formatTime(selectedEvent.start, selectedEvent.allDay)} — {formatTime(selectedEvent.end, selectedEvent.allDay)}</span>
                    </div>
                  </div>
                  {selectedEvent.location && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400"><MapPin className="w-4 h-4 text-blue-400" /> {selectedEvent.location}</div>
                  )}
                  {selectedEvent.description && (
                    <div className="border-t border-zinc-800 pt-3">
                      <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans">{selectedEvent.description}</pre>
                    </div>
                  )}
                  {selectedEvent.attendees.length > 0 && (
                    <div className="border-t border-zinc-800 pt-3">
                      <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> {selectedEvent.attendees.length} participante(s)</p>
                      {selectedEvent.attendees.map(a => (
                        <div key={a.email} className="text-xs text-zinc-400 flex items-center gap-2 py-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${a.responseStatus === 'accepted' ? 'bg-emerald-400' : a.responseStatus === 'declined' ? 'bg-red-400' : 'bg-zinc-600'}`} />
                          {a.displayName || a.email}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    {selectedEvent.htmlLink && (
                      <a href={selectedEvent.htmlLink} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300">Abrir no Google Calendar ↗</a>
                    )}
                    <button onClick={() => handleDelete(selectedEvent.id)} title="Deletar evento"
                      className="ml-auto p-1.5 rounded text-zinc-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Selecione um evento</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create */}
      {tab === 'create' && configured && (
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-6 space-y-4 max-w-2xl">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Plus className="w-5 h-5 text-blue-400" /> Criar Evento</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Título</label>
              <input type="text" value={newEvent.summary} onChange={e => setNewEvent(s => ({ ...s, summary: e.target.value }))}
                placeholder="Reunião de equipe" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Início</label>
                <input type="datetime-local" value={newEvent.start} onChange={e => setNewEvent(s => ({ ...s, start: e.target.value }))}
                  title="Data/hora de início"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Fim</label>
                <input type="datetime-local" value={newEvent.end} onChange={e => setNewEvent(s => ({ ...s, end: e.target.value }))}
                  title="Data/hora de fim"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Local</label>
              <input type="text" value={newEvent.location} onChange={e => setNewEvent(s => ({ ...s, location: e.target.value }))}
                placeholder="Sala 3 / Google Meet" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Descrição</label>
              <textarea value={newEvent.description} onChange={e => setNewEvent(s => ({ ...s, description: e.target.value }))}
                placeholder="Detalhes do evento..." rows={3}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 resize-y" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCreate} disabled={creating || !newEvent.summary || !newEvent.start || !newEvent.end}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                creating ? 'bg-blue-500/50 text-white cursor-wait' : (newEvent.summary && newEvent.start && newEvent.end) ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
            </button>
            {createResult === 'success' && <span className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Criado!</span>}
            {createResult === 'error' && <span className="text-sm text-red-400">Erro ao criar</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
