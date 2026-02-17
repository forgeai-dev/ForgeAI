import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface PluginEntry {
  id: string;
  manifest: {
    name: string;
    version: string;
    description: string;
    author: string;
    keywords: string[];
    permissions: string[];
    hooks: string[];
  };
  installed: boolean;
  enabled: boolean;
  category: string;
  rating?: number;
  downloads?: number;
}

export default function PluginStorePage() {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPlugins();
  }, []);

  async function loadPlugins() {
    try {
      const data = await api.get('/api/plugins/store');
      setPlugins(data.plugins ?? []);
    } catch {
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }

  async function togglePlugin(id: string, enable: boolean) {
    try {
      await api.post(`/api/plugins/store/${id}/${enable ? 'enable' : 'disable'}`);
      setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: enable } : p));
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  const filtered = filter === 'all' ? plugins : plugins.filter(p => p.category === filter);
  const categories = [...new Set(plugins.map(p => p.category))];

  const categoryColors: Record<string, string> = {
    communication: 'bg-blue-500/20 text-blue-400',
    security: 'bg-red-500/20 text-red-400',
    utility: 'bg-green-500/20 text-green-400',
    productivity: 'bg-purple-500/20 text-purple-400',
    analytics: 'bg-yellow-500/20 text-yellow-400',
    integration: 'bg-cyan-500/20 text-cyan-400',
    automation: 'bg-orange-500/20 text-orange-400',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Plugin Store</h1>
        <p className="text-zinc-400 mt-1">Browse, install, and manage plugins</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === 'all' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
        >
          All ({plugins.length})
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${filter === cat ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {cat} ({plugins.filter(p => p.category === cat).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-zinc-500">Loading plugins...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">No plugins found</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(plugin => (
            <div key={plugin.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-100">{plugin.manifest.name}</h3>
                  <span className="text-xs text-zinc-500">v{plugin.manifest.version} by {plugin.manifest.author}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${categoryColors[plugin.category] ?? 'bg-zinc-700 text-zinc-300'}`}>
                  {plugin.category}
                </span>
              </div>

              <p className="text-sm text-zinc-400 mb-3 flex-1">{plugin.manifest.description}</p>

              {/* Keywords */}
              <div className="flex flex-wrap gap-1 mb-3">
                {plugin.manifest.keywords.map(kw => (
                  <span key={kw} className="bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded text-xs">{kw}</span>
                ))}
              </div>

              {/* Permissions */}
              <div className="mb-3">
                <span className="text-xs text-zinc-500 font-medium">Permissions:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {plugin.manifest.permissions.map(perm => (
                    <span key={perm} className="bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5 rounded text-xs">{perm}</span>
                  ))}
                </div>
              </div>

              {/* Hooks */}
              <div className="mb-4">
                <span className="text-xs text-zinc-500 font-medium">Hooks:</span>
                <span className="text-xs text-zinc-400 ml-1">{plugin.manifest.hooks.join(', ')}</span>
              </div>

              {/* Stats + Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                <div className="flex gap-3 text-xs text-zinc-500">
                  {plugin.rating && <span>{'★'.repeat(Math.round(plugin.rating))} {plugin.rating}</span>}
                  {plugin.downloads && <span>{plugin.downloads.toLocaleString()} installs</span>}
                </div>

                <div className="flex gap-2">
                  {plugin.installed ? (
                    <button
                      onClick={() => togglePlugin(plugin.id, !plugin.enabled)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        plugin.enabled
                          ? 'bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-green-500/20 hover:text-green-400'
                      }`}
                    >
                      {plugin.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  ) : (
                    <button className="px-3 py-1 rounded-lg text-xs font-medium bg-orange-500/20 text-orange-400 hover:bg-orange-500/30">
                      Install
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
