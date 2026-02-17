import { useState, useEffect } from 'react';
import { Brain, Search, Trash2, Loader2, Database, Sparkles, BarChart3 } from 'lucide-react';

interface MemoryEntry {
  id: string;
  content: string;
  score?: number;
  importance?: number;
}

interface MemoryStats {
  totalEntries?: number;
  totalTokens?: number;
  avgImportance?: number;
}

export function MemoryPage() {
  const [stats, setStats] = useState<MemoryStats>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/memory/stats').then(r => r.json());
      setStats((res as { stats: MemoryStats }).stats ?? {});
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 20 }),
      }).then(r => r.json());
      setResults((res as { results: MemoryEntry[] }).results ?? []);
    } catch { /* ignore */ }
    setSearching(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    setResults(prev => prev.filter(r => r.id !== id));
    loadStats();
  };

  const handleConsolidate = async () => {
    await fetch('/api/memory/consolidate', { method: 'POST' });
    loadStats();
  };

  useEffect(() => { loadStats(); }, []);

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-purple-400" />
          Agent Memory
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Memória de longo prazo do agente — busque, visualize e gerencie entradas.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-center">
          <Database className="w-4 h-4 text-purple-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-white">{stats.totalEntries ?? 0}</p>
          <p className="text-[10px] text-zinc-500">Memórias</p>
        </div>
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-center">
          <BarChart3 className="w-4 h-4 text-purple-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-white">{stats.totalTokens ?? 0}</p>
          <p className="text-[10px] text-zinc-500">Tokens armazenados</p>
        </div>
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-center">
          <Sparkles className="w-4 h-4 text-purple-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-white">{stats.avgImportance ? (stats.avgImportance * 100).toFixed(0) + '%' : '—'}</p>
          <p className="text-[10px] text-zinc-500">Importância média</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar na memória do agente (ex: preferências do usuário, projetos, tech stack...)"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
        </button>
        <button
          onClick={handleConsolidate}
          title="Consolidar memórias (merge duplicatas)"
          className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-400">{results.length} resultado(s)</h3>
          {results.map(entry => (
            <div key={entry.id} className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">{entry.content}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-600">
                    <span className="font-mono">{entry.id.slice(0, 12)}...</span>
                    {entry.score !== undefined && <span>Score: {entry.score.toFixed(3)}</span>}
                    {entry.importance !== undefined && <span>Importância: {(entry.importance * 100).toFixed(0)}%</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  title="Deletar memória"
                  className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !loading && !searching && (
        <div className="text-center py-8 text-zinc-500">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p className="text-sm">Busque algo para ver memórias do agente</p>
        </div>
      )}
    </div>
  );
}

export default MemoryPage;
