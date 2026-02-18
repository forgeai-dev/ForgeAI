import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Search, Upload, Trash2, Loader2, Settings2, FileText, BarChart3, RefreshCw, Save, Zap } from 'lucide-react';

interface RAGDocument {
  id: string;
  metadata: Record<string, unknown>;
  chunks: number;
  createdAt: number;
}

interface RAGStats {
  documents: number;
  chunks: number;
  vocabSize: number;
  avgChunkSize: number;
}

interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  similarityThreshold: number;
  embeddingProvider: 'tfidf' | 'openai';
  embeddingModel: string;
  persist: boolean;
}

interface SearchResult {
  documentId: string;
  chunk: string;
  score: number;
  metadata: Record<string, unknown>;
}

export function RAGPage() {
  const [stats, setStats] = useState<RAGStats>({ documents: 0, chunks: 0, vocabSize: 0, avgChunkSize: 0 });
  const [config, setConfig] = useState<RAGConfig | null>(null);
  const [documents, setDocuments] = useState<RAGDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Ingest
  const [ingestText, setIngestText] = useState('');
  const [ingestId, setIngestId] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Config editing
  const [editConfig, setEditConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<Partial<RAGConfig>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  // Tab
  const [tab, setTab] = useState<'docs' | 'search' | 'ingest' | 'config'>('docs');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, docsRes, configRes] = await Promise.all([
        fetch('/api/rag/stats').then(r => r.json()),
        fetch('/api/rag/documents').then(r => r.json()),
        fetch('/api/rag/config').then(r => r.json()),
      ]);
      setStats((statsRes as { stats: RAGStats }).stats ?? { documents: 0, chunks: 0, vocabSize: 0, avgChunkSize: 0 });
      setDocuments((docsRes as { documents: RAGDocument[] }).documents ?? []);
      const cfg = (configRes as { config: RAGConfig }).config;
      setConfig(cfg ?? null);
      setConfigDraft(cfg ?? {});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 10 }),
      }).then(r => r.json());
      setSearchResults((res as { results: SearchResult[] }).results ?? []);
    } catch { /* ignore */ }
    setSearching(false);
  };

  const handleIngestText = async () => {
    if (!ingestText.trim()) return;
    setIngesting(true);
    try {
      await fetch('/api/rag/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ingestId || undefined, content: ingestText }),
      });
      setIngestText('');
      setIngestId('');
      loadData();
    } catch { /* ignore */ }
    setIngesting(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await fetch('/api/rag/upload', { method: 'POST', body: formData });
      loadData();
    } catch { /* ignore */ }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/rag/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setDocuments(prev => prev.filter(d => d.id !== id));
    loadData();
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/rag/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configDraft),
      }).then(r => r.json());
      setConfig((res as { config: RAGConfig }).config ?? config);
      setEditConfig(false);
    } catch { /* ignore */ }
    setSavingConfig(false);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading RAG Engine...
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-7 h-7 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">RAG Engine</h1>
            <p className="text-sm text-zinc-400">Retrieval-Augmented Generation — knowledge base for your agents</p>
          </div>
        </div>
        <button onClick={loadData} title="Refresh" className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Documents', value: stats.documents, icon: FileText, color: 'text-blue-400' },
          { label: 'Chunks', value: stats.chunks, icon: Database, color: 'text-purple-400' },
          { label: 'Vocabulary', value: stats.vocabSize.toLocaleString(), icon: BarChart3, color: 'text-green-400' },
          { label: 'Avg Chunk', value: `${stats.avgChunkSize} chars`, icon: Zap, color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-zinc-500 uppercase tracking-wide">{s.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
        {(['docs', 'search', 'ingest', 'config'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {t === 'docs' ? 'Documents' : t === 'search' ? 'Search' : t === 'ingest' ? 'Upload / Ingest' : 'Settings'}
          </button>
        ))}
      </div>

      {/* Documents Tab */}
      {tab === 'docs' && (
        <div className="space-y-3">
          {documents.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No documents ingested yet.</p>
              <p className="text-sm mt-1">Upload files or paste text in the "Upload / Ingest" tab.</p>
            </div>
          ) : (
            documents.map(doc => (
              <div key={doc.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <span className="font-medium text-white truncate">{String(doc.metadata.title || doc.id)}</span>
                    <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">{doc.chunks} chunks</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 flex gap-3">
                    <span>ID: {doc.id}</span>
                    {doc.metadata.size ? <span>{Math.round(Number(doc.metadata.size) / 1024)} KB</span> : null}
                    <span>{new Date(doc.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <button onClick={() => handleDelete(doc.id)} title="Delete document" className="p-2 text-zinc-500 hover:text-red-400 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Search Tab */}
      {tab === 'search' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search your knowledge base..."
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center gap-2"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-3">
              {searchResults.map((r, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-blue-400">{(r.metadata.title as string) || r.documentId}</span>
                    <span className="text-xs font-mono bg-zinc-800 text-green-400 px-2 py-0.5 rounded">
                      score: {r.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{r.chunk}</p>
                </div>
              ))}
            </div>
          )}

          {searchResults.length === 0 && searchQuery && !searching && (
            <p className="text-center text-zinc-500 py-8">No results found. Try a different query.</p>
          )}
        </div>
      )}

      {/* Ingest Tab */}
      {tab === 'ingest' && (
        <div className="space-y-6">
          {/* File Upload */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-purple-400" /> Upload File
            </h3>
            <p className="text-sm text-zinc-400 mb-4">
              Supports: TXT, MD, CSV, JSON, XML, YAML, HTML, PDF, and source code files (JS, TS, PY, etc.)
            </p>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.html,.htm,.pdf,.js,.ts,.py,.java,.c,.cpp,.css,.sql,.sh,.log,.ini,.toml,.cfg"
                className="flex-1 text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-600 file:text-white hover:file:bg-purple-500 file:cursor-pointer"
              />
              {uploading && <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />}
            </div>
          </div>

          {/* Text Ingest */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" /> Paste Text
            </h3>
            <input
              type="text"
              value={ingestId}
              onChange={e => setIngestId(e.target.value)}
              placeholder="Document ID (optional, auto-generated)"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mb-3 text-sm"
            />
            <textarea
              value={ingestText}
              onChange={e => setIngestText(e.target.value)}
              placeholder="Paste your text content here..."
              rows={8}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-y text-sm font-mono"
            />
            <div className="flex justify-between items-center mt-3">
              <span className="text-xs text-zinc-500">{ingestText.length.toLocaleString()} characters</span>
              <button
                onClick={handleIngestText}
                disabled={ingesting || !ingestText.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center gap-2"
              >
                {ingesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                Ingest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Tab */}
      {tab === 'config' && config && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-zinc-400" /> RAG Configuration
            </h3>
            {!editConfig ? (
              <button onClick={() => { setEditConfig(true); setConfigDraft({ ...config }); }} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition">
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditConfig(false)} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition">
                  Cancel
                </button>
                <button onClick={handleSaveConfig} disabled={savingConfig} className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition flex items-center gap-1">
                  {savingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Embedding Provider */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Embedding Provider</label>
              {editConfig ? (
                <select
                  value={configDraft.embeddingProvider ?? config.embeddingProvider}
                  onChange={e => setConfigDraft(p => ({ ...p, embeddingProvider: e.target.value as 'tfidf' | 'openai' }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                >
                  <option value="tfidf">TF-IDF (local, no API key needed)</option>
                  <option value="openai">OpenAI Embeddings (requires API key)</option>
                </select>
              ) : (
                <p className="text-white mt-1 font-medium">{config.embeddingProvider === 'openai' ? 'OpenAI Embeddings' : 'TF-IDF (local)'}</p>
              )}
            </div>

            {/* Embedding Model */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Embedding Model</label>
              {editConfig ? (
                <input
                  type="text"
                  value={configDraft.embeddingModel ?? config.embeddingModel}
                  onChange={e => setConfigDraft(p => ({ ...p, embeddingModel: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
              ) : (
                <p className="text-white mt-1 font-medium font-mono text-sm">{config.embeddingModel}</p>
              )}
            </div>

            {/* Chunk Size */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Chunk Size (words)</label>
              {editConfig ? (
                <input
                  type="number"
                  value={configDraft.chunkSize ?? config.chunkSize}
                  onChange={e => setConfigDraft(p => ({ ...p, chunkSize: Number(e.target.value) }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
              ) : (
                <p className="text-white mt-1 font-medium">{config.chunkSize}</p>
              )}
            </div>

            {/* Chunk Overlap */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Chunk Overlap (words)</label>
              {editConfig ? (
                <input
                  type="number"
                  value={configDraft.chunkOverlap ?? config.chunkOverlap}
                  onChange={e => setConfigDraft(p => ({ ...p, chunkOverlap: Number(e.target.value) }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
              ) : (
                <p className="text-white mt-1 font-medium">{config.chunkOverlap}</p>
              )}
            </div>

            {/* Max Results */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Max Results</label>
              {editConfig ? (
                <input
                  type="number"
                  value={configDraft.maxResults ?? config.maxResults}
                  onChange={e => setConfigDraft(p => ({ ...p, maxResults: Number(e.target.value) }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
              ) : (
                <p className="text-white mt-1 font-medium">{config.maxResults}</p>
              )}
            </div>

            {/* Similarity Threshold */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Similarity Threshold</label>
              {editConfig ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={configDraft.similarityThreshold ?? config.similarityThreshold}
                  onChange={e => setConfigDraft(p => ({ ...p, similarityThreshold: Number(e.target.value) }))}
                  className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
              ) : (
                <p className="text-white mt-1 font-medium">{config.similarityThreshold}</p>
              )}
            </div>

            {/* Persist */}
            <div className="col-span-2">
              <label className="text-xs text-zinc-500 uppercase tracking-wide">Persistence</label>
              {editConfig ? (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configDraft.persist ?? config.persist}
                    onChange={e => setConfigDraft(p => ({ ...p, persist: e.target.checked }))}
                    className="rounded border-zinc-600"
                  />
                  <span className="text-sm text-white">Save documents to disk (survive restarts)</span>
                </label>
              ) : (
                <p className="text-white mt-1 font-medium">{config.persist ? 'Enabled (documents saved to disk)' : 'Disabled (in-memory only)'}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
