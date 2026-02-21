import { useState, useEffect, useCallback } from 'react';
import { Layers, Plus, Trash2, Search, Code2, BarChart3, FileText, Image, GitBranch, Globe, X } from 'lucide-react';
import { ArtifactRenderer } from '../components/ArtifactRenderer';

interface Artifact {
  id: string;
  sessionId: string;
  messageId?: string;
  type: string;
  title: string;
  content: string;
  language?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const TYPE_OPTIONS = [
  { value: 'html', label: 'HTML', icon: Globe, placeholder: '<div class="p-4">\n  <h1 class="text-2xl font-bold text-white">Hello ForgeCanvas</h1>\n  <p class="text-zinc-400 mt-2">This is a live HTML artifact.</p>\n</div>' },
  { value: 'react', label: 'React', icon: Code2, placeholder: 'function App() {\n  const [count, setCount] = React.useState(0);\n  return (\n    <div className="p-4">\n      <h1 className="text-2xl font-bold text-white">Counter: {count}</h1>\n      <button\n        onClick={() => setCount(c => c + 1)}\n        className="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white font-medium transition-colors"\n      >\n        Increment\n      </button>\n    </div>\n  );\n}' },
  { value: 'svg', label: 'SVG', icon: Image, placeholder: '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="100" cy="100" r="80" fill="#a78bfa" opacity="0.3" />\n  <circle cx="100" cy="100" r="50" fill="#8b5cf6" opacity="0.5" />\n  <circle cx="100" cy="100" r="20" fill="#7c3aed" />\n</svg>' },
  { value: 'mermaid', label: 'Mermaid', icon: GitBranch, placeholder: 'graph TD\n    A[User Message] --> B[Security Layers]\n    B --> C[Agent Runtime]\n    C --> D[LLM Provider]\n    D --> E[Tool Execution]\n    E --> F[Response]' },
  { value: 'chart', label: 'Chart', icon: BarChart3, placeholder: '' },
  { value: 'markdown', label: 'Markdown', icon: FileText, placeholder: '# ForgeCanvas\n\n## Features\n\n- **Live rendering** of HTML, React, SVG, Mermaid, Charts\n- **Sandboxed iframe** execution\n- **Bidirectional** agent ↔ artifact communication\n\n> Built for ForgeAI — the self-hosted AI platform.' },
  { value: 'code', label: 'Code', icon: Code2, placeholder: 'async function fetchArtifacts() {\n  const res = await fetch("/api/artifacts");\n  const { artifacts } = await res.json();\n  return artifacts;\n}' },
];

const API_BASE = '';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export function CanvasPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState('html');
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createLanguage, setCreateLanguage] = useState('typescript');
  const [creating, setCreating] = useState(false);

  const loadArtifacts = useCallback(async () => {
    try {
      const data = await api<{ artifacts: Artifact[] }>('/api/artifacts');
      setArtifacts(data.artifacts || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  // Listen for WebSocket artifact events
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'artifact') {
            loadArtifacts();
          }
        } catch { /* ignore */ }
      };
    } catch { /* ignore */ }

    return () => { ws?.close(); };
  }, [loadArtifacts]);

  const handleCreate = async () => {
    if (!createTitle.trim() || !createContent.trim()) return;
    setCreating(true);
    try {
      await api('/api/artifacts', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'canvas-' + Date.now(),
          type: createType,
          title: createTitle,
          content: createContent,
          language: createType === 'code' ? createLanguage : undefined,
        }),
      });
      setCreateTitle('');
      setCreateContent('');
      setShowCreate(false);
      loadArtifacts();
    } catch { /* ignore */ }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/artifacts/${id}`, { method: 'DELETE' });
      setArtifacts(prev => prev.filter(a => a.id !== id));
    } catch { /* ignore */ }
  };

  const handleInteraction = async (id: string, action: string, data?: Record<string, unknown>) => {
    try {
      await api(`/api/artifacts/${id}/interact`, {
        method: 'POST',
        body: JSON.stringify({ action, data }),
      });
    } catch { /* ignore */ }
  };

  const filtered = artifacts.filter(a =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.type.includes(search.toLowerCase())
  );

  const selectedTypeOption = TYPE_OPTIONS.find(t => t.value === createType);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/20">
            <Layers className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">ForgeCanvas</h1>
            <p className="text-sm text-zinc-500">{artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''} — Live visual artifacts rendered in sandboxed iframes</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm font-medium transition-colors"
        >
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Cancel' : 'New Artifact'}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Plus className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-200">Create Artifact</span>
          </div>

          {/* Type selector */}
          <div className="flex gap-2 flex-wrap">
            {TYPE_OPTIONS.map(opt => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    setCreateType(opt.value);
                    if (opt.placeholder && !createContent) setCreateContent(opt.placeholder);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    createType === opt.value
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Title */}
          <input
            type="text"
            value={createTitle}
            onChange={e => setCreateTitle(e.target.value)}
            placeholder="Artifact title..."
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />

          {/* Language (for code type) */}
          {createType === 'code' && (
            <select
              value={createLanguage}
              onChange={e => setCreateLanguage(e.target.value)}
              title="Programming language"
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-violet-500"
            >
              {['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'css', 'html', 'sql', 'bash', 'json', 'yaml'].map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}

          {/* Content */}
          <textarea
            value={createContent}
            onChange={e => setCreateContent(e.target.value)}
            placeholder={selectedTypeOption?.placeholder || 'Artifact content...'}
            rows={12}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 resize-y"
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !createTitle.trim() || !createContent.trim()}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {artifacts.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search artifacts..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />
        </div>
      )}

      {/* Artifacts Grid */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map(artifact => (
            <ArtifactRenderer
              key={artifact.id}
              artifact={artifact}
              onDelete={handleDelete}
              onInteraction={handleInteraction}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Layers className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">
            {search ? 'No artifacts match your search' : 'No artifacts yet. Create one or ask the agent to generate a visual artifact.'}
          </p>
          {!search && !showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 px-4 py-2 bg-violet-600/20 hover:bg-violet-600/30 rounded-lg text-violet-400 text-sm font-medium transition-colors"
            >
              Create your first artifact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CanvasPage;
