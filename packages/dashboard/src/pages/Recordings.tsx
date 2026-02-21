import { useState, useEffect, useCallback, useRef } from 'react';
import { Video, Play, Pause, Square, Trash2, Clock, Wrench, MessageSquare, Brain, ChevronRight, RotateCcw, Search, Circle, Loader2 } from 'lucide-react';

interface RecordingEvent {
  offset: number;
  category: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface RecordingStats {
  messageCount: number;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: number;
  thinkingSteps: number;
  totalTokens: number;
  toolsUsed: string[];
  iterations: number;
}

interface RecordingSummary {
  id: string;
  sessionId: string;
  title: string;
  channelType?: string;
  duration: number;
  eventCount: number;
  stats: RecordingStats;
  startedAt: string;
  completedAt?: string;
  status: string;
}

interface FullRecording extends RecordingSummary {
  events: RecordingEvent[];
}

const API_BASE = '';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

const EVENT_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  message: { icon: MessageSquare, color: 'text-blue-400' },
  step: { icon: Brain, color: 'text-purple-400' },
  progress: { icon: Loader2, color: 'text-zinc-500' },
  tool: { icon: Wrench, color: 'text-amber-400' },
  system: { icon: Circle, color: 'text-zinc-600' },
};

function EventCard({ event, isActive }: { event: RecordingEvent; isActive: boolean }) {
  const meta = EVENT_ICONS[event.category] || EVENT_ICONS.system;
  const Icon = meta.icon;

  let label = '';
  let detail = '';

  if (event.category === 'message') {
    label = event.type === 'user' ? 'User Message' : 'Assistant Response';
    detail = (event.data.content as string || '').substring(0, 120);
  } else if (event.category === 'step') {
    if (event.type === 'thinking') {
      label = 'Thinking';
      detail = (event.data.message as string || '').substring(0, 120);
    } else if (event.type === 'tool_call') {
      label = `Tool Call: ${event.data.tool || 'unknown'}`;
      detail = event.data.args ? JSON.stringify(event.data.args).substring(0, 100) : '';
    } else if (event.type === 'tool_result') {
      const success = event.data.success as boolean;
      label = `Tool Result: ${event.data.tool || 'unknown'}`;
      detail = `${success ? '✓' : '✗'} ${(event.data.result as string || '').substring(0, 100)}`;
    } else {
      label = event.type;
      detail = event.data.message as string || '';
    }
  } else if (event.category === 'progress') {
    const p = event.data;
    label = `Iteration ${p.iteration || '?'}/${p.maxIterations || '?'}`;
    detail = (p.status as string) || '';
  } else if (event.category === 'tool') {
    label = event.type === 'call' ? `Call: ${event.data.tool}` : `Result: ${event.data.tool}`;
    detail = event.type === 'result' ? `${event.data.success ? '✓' : '✗'} ${formatDuration(event.data.duration as number || 0)}` : '';
  } else {
    label = event.type;
    detail = JSON.stringify(event.data).substring(0, 100);
  }

  return (
    <div className={`flex gap-3 px-3 py-2 rounded-lg transition-colors ${isActive ? 'bg-forge-500/10 border border-forge-500/30' : 'hover:bg-zinc-800/50'}`}>
      <div className="flex flex-col items-center gap-0.5 pt-0.5">
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        <span className="text-[9px] text-zinc-600 font-mono">{formatDuration(event.offset)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-zinc-200">{label}</div>
        {detail && <div className="text-[11px] text-zinc-500 truncate mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

function TimelinePlayer({ recording }: { recording: FullRecording }) {
  const [playing, setPlaying] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsRef = useRef<HTMLDivElement>(null);

  const totalDuration = recording.duration || 1;

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setCurrentOffset(prev => {
          const next = prev + 100;
          if (next >= totalDuration) {
            setPlaying(false);
            return totalDuration;
          }
          return next;
        });
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, totalDuration]);

  useEffect(() => {
    let idx = -1;
    for (let i = 0; i < recording.events.length; i++) {
      if (recording.events[i].offset <= currentOffset) idx = i;
      else break;
    }
    setActiveIdx(idx);

    if (idx >= 0 && eventsRef.current) {
      const el = eventsRef.current.children[idx] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentOffset, recording.events]);

  const reset = () => { setPlaying(false); setCurrentOffset(0); setActiveIdx(-1); };
  const progress = (currentOffset / totalDuration) * 100;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} className="p-2 rounded-lg bg-forge-500 hover:bg-forge-600 text-white transition-colors">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button onClick={reset} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Progress bar */}
        <div className="flex-1 relative group cursor-pointer" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setCurrentOffset(Math.floor(pct * totalDuration));
        }}>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-forge-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <span className="text-xs text-zinc-500 font-mono w-24 text-right">
          {formatDuration(currentOffset)} / {formatDuration(totalDuration)}
        </span>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-[11px] text-zinc-500">
        <span><MessageSquare className="w-3 h-3 inline mr-1" />{recording.stats.messageCount} msgs</span>
        <span><Wrench className="w-3 h-3 inline mr-1" />{recording.stats.toolCalls} tools ({recording.stats.toolSuccesses}✓ {recording.stats.toolFailures}✗)</span>
        <span><Brain className="w-3 h-3 inline mr-1" />{recording.stats.thinkingSteps} thoughts</span>
        <span><Clock className="w-3 h-3 inline mr-1" />{recording.stats.iterations} iterations</span>
        {recording.stats.toolsUsed.length > 0 && (
          <span className="text-zinc-600">Tools: {recording.stats.toolsUsed.join(', ')}</span>
        )}
      </div>

      {/* Events timeline */}
      <div ref={eventsRef} className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
        {recording.events.map((event, idx) => (
          <EventCard key={idx} event={event} isActive={idx === activeIdx} />
        ))}
      </div>
    </div>
  );
}

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [selected, setSelected] = useState<FullRecording | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadRecordings = useCallback(async () => {
    try {
      const data = await api<{ recordings: RecordingSummary[] }>('/api/recordings');
      setRecordings(data.recordings || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  const loadFull = async (id: string) => {
    setLoading(true);
    try {
      const data = await api<{ recording: FullRecording }>(`/api/recordings/${id}`);
      setSelected(data.recording);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/recordings/${id}`, { method: 'DELETE' });
      setRecordings(prev => prev.filter(r => r.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch { /* ignore */ }
  };

  const filtered = recordings.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.sessionId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20">
            <Video className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Session Recordings</h1>
            <p className="text-sm text-zinc-500">{recordings.length} recording{recordings.length !== 1 ? 's' : ''} — Debug, audit, and replay agent sessions step-by-step</p>
          </div>
        </div>
      </div>

      {/* Search */}
      {recordings.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recordings..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      )}

      {/* Selected recording player */}
      {selected && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-zinc-800/60 border-b border-zinc-700/50">
            <div className="flex items-center gap-2 min-w-0">
              <Video className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span className="text-sm font-medium text-zinc-200 truncate">{selected.title}</span>
              <span className="text-[10px] text-zinc-500">{selected.eventCount} events</span>
              <span className="text-[10px] text-zinc-600">{formatDuration(selected.duration)}</span>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Close
            </button>
          </div>
          <div className="p-5">
            <TimelinePlayer recording={selected} />
          </div>
        </div>
      )}

      {/* Recordings list */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map(rec => (
            <div
              key={rec.id}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors cursor-pointer ${
                selected?.id === rec.id
                  ? 'bg-cyan-500/5 border-cyan-500/30'
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
              }`}
              onClick={() => loadFull(rec.id)}
            >
              <div className={`p-1.5 rounded-lg ${rec.status === 'recording' ? 'bg-red-500/20' : 'bg-zinc-800'}`}>
                {rec.status === 'recording' ? (
                  <Circle className="w-4 h-4 text-red-400 animate-pulse" />
                ) : (
                  <Video className="w-4 h-4 text-zinc-500" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200 truncate">{rec.title}</div>
                <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                  <span>{formatTime(rec.startedAt)}</span>
                  <span>·</span>
                  <span>{formatDuration(rec.duration)}</span>
                  <span>·</span>
                  <span>{rec.eventCount} events</span>
                  {rec.channelType && <><span>·</span><span>{rec.channelType}</span></>}
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span>{rec.stats.toolCalls} tools</span>
                <span>{rec.stats.messageCount} msgs</span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(rec.id); }}
                  className="p-1.5 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete recording"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-4 h-4 text-zinc-700" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Video className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">
            {search ? 'No recordings match your search' : 'No recordings yet. Start recording a session from the Chat page or via the API.'}
          </p>
          <p className="text-zinc-600 text-xs mt-2">
            POST /api/recordings/start with {'{'} sessionId: "..." {'}'}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
        </div>
      )}
    </div>
  );
}

export default RecordingsPage;
