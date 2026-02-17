import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Loader2, Copy, Check, ShieldAlert, Clock } from 'lucide-react';

interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  revoked: boolean;
  lastUsed?: string;
  usageCount: number;
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [newKeyExpiry, setNewKeyExpiry] = useState('90');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = async () => {
    try {
      const res = await fetch('/api/keys').then(r => r.json()) as { keys: ApiKeyInfo[]; scopes: string[] };
      setKeys(res.keys ?? []);
      setScopes(res.scopes ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName,
          scopes: newKeyScopes.length > 0 ? newKeyScopes : undefined,
          expiresInDays: Number(newKeyExpiry) || 90,
        }),
      }).then(r => r.json()) as { key: { id: string; key: string } };
      setCreatedKey(res.key?.key ?? null);
      setNewKeyName('');
      setNewKeyScopes([]);
      loadKeys();
    } catch { /* ignore */ }
  };

  const revokeKey = async (id: string) => {
    await fetch(`/api/keys/${id}/revoke`, { method: 'POST' });
    loadKeys();
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    loadKeys();
  };

  const copyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  useEffect(() => { loadKeys(); }, []);

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
            <Key className="w-6 h-6 text-amber-400" />
            API Keys
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Gerencie chaves de API para acesso externo ao ForgeAI Gateway.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreatedKey(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-forge-500 hover:bg-forge-600 text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nova Key
        </button>
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-2">
          <p className="text-sm text-amber-400 font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Copie a key agora! Ela não será mostrada novamente.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-zinc-900 rounded px-3 py-2 text-sm text-white font-mono break-all">{createdKey}</code>
            <button onClick={copyKey} className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && !createdKey && (
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Nome da Key</label>
              <input
                type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                placeholder="ex: meu-app, CI/CD, teste"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Expiração (dias)</label>
              <input
                type="number" value={newKeyExpiry} onChange={e => setNewKeyExpiry(e.target.value)}
                title="Dias até expiração"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
          </div>

          {scopes.length > 0 && (
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Scopes (vazio = todos)</label>
              <div className="flex flex-wrap gap-2">
                {scopes.map(scope => (
                  <button
                    key={scope}
                    onClick={() => toggleScope(scope)}
                    className={`px-2 py-1 rounded text-xs font-mono transition-all ${
                      newKeyScopes.includes(scope)
                        ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30'
                        : 'bg-zinc-800 text-zinc-500 border border-transparent hover:text-zinc-300'
                    }`}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={createKey} disabled={!newKeyName.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-forge-500 hover:bg-forge-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Criar Key
          </button>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-2">
        {keys.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <Key className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Nenhuma API key criada</p>
          </div>
        ) : (
          keys.map(k => (
            <div key={k.id} className={`bg-zinc-950/50 border rounded-xl px-4 py-3 flex items-center justify-between ${
              k.revoked ? 'border-red-500/20 opacity-60' : 'border-zinc-800'
            }`}>
              <div className="flex items-center gap-3 min-w-0">
                <Key className={`w-4 h-4 shrink-0 ${k.revoked ? 'text-red-400' : 'text-amber-400'}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{k.name}</span>
                    <code className="text-[10px] text-zinc-600 font-mono">{k.prefix}...</code>
                    {k.revoked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Revogada</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-600">
                    <span>{k.scopes.length > 0 ? k.scopes.join(', ') : 'all scopes'}</span>
                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {new Date(k.createdAt).toLocaleDateString()}</span>
                    <span>{k.usageCount} usos</span>
                  </div>
                </div>
              </div>
              {!k.revoked && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => revokeKey(k.id)} title="Revogar key"
                    className="px-2 py-1 rounded text-xs text-zinc-500 hover:text-amber-400 transition-colors">
                    Revogar
                  </button>
                  <button onClick={() => deleteKey(k.id)} title="Deletar key"
                    className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ApiKeysPage;
