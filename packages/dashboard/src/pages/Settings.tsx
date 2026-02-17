import { useState, useEffect, useCallback } from 'react';
import { Key, Database, Shield, Cpu, Save, Check, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';
import { api, type ProviderInfo } from '@/lib/api';

const PROVIDER_META: Record<string, { display: string; placeholder: string; models: string }> = {
  anthropic: { display: 'Anthropic (Claude)', placeholder: 'sk-ant-api03-...', models: 'Claude Sonnet 4, Haiku 3.5' },
  openai: { display: 'OpenAI (GPT)', placeholder: 'sk-...', models: 'GPT-4o, o1, o3-mini' },
  google: { display: 'Google Gemini', placeholder: 'AIza...', models: 'Gemini 2.5 Pro/Flash, 2.0, 1.5' },
  moonshot: { display: 'Kimi (Moonshot)', placeholder: 'sk-...', models: 'Kimi K2.5, K2, moonshot-v1-128k' },
  deepseek: { display: 'DeepSeek', placeholder: 'sk-...', models: 'DeepSeek Chat, Coder, Reasoner' },
  groq: { display: 'Groq', placeholder: 'gsk_...', models: 'Llama 3.3 70B, Mixtral 8x7B' },
  mistral: { display: 'Mistral AI', placeholder: 'sk-...', models: 'Mistral Large, Codestral, Pixtral' },
  xai: { display: 'xAI (Grok)', placeholder: 'xai-...', models: 'Grok-3, Grok-2' },
};

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'moonshot', 'deepseek', 'groq', 'mistral', 'xai'];

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadProviders = useCallback(() => {
    api.getProviders().then(r => setProviders(r.providers)).catch(() => {});
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleSave = async (name: string) => {
    const key = keys[name];
    if (!key || key.trim().length === 0) return;

    setSaving(s => ({ ...s, [name]: true }));
    setErrors(e => ({ ...e, [name]: '' }));
    try {
      const res = await api.post<{ success?: boolean; error?: string }>(`/api/providers/${name}/key`, { apiKey: key.trim() });
      if (res.error) {
        setErrors(e => ({ ...e, [name]: res.error! }));
        setTimeout(() => setErrors(e => ({ ...e, [name]: '' })), 5000);
      } else {
        setSaved(s => ({ ...s, [name]: true }));
        setKeys(k => ({ ...k, [name]: '' }));
        setTimeout(() => setSaved(s => ({ ...s, [name]: false })), 2000);
        loadProviders();
      }
    } catch (err) {
      setErrors(e => ({ ...e, [name]: err instanceof Error ? err.message : 'Failed to save' }));
      setTimeout(() => setErrors(e => ({ ...e, [name]: '' })), 5000);
    } finally {
      setSaving(s => ({ ...s, [name]: false }));
    }
  };

  const handleRemove = async (name: string) => {
    if (deleting[name]) return;
    if (!confirm(`Remove API key for ${PROVIDER_META[name]?.display ?? name}?`)) return;
    setDeleting(s => ({ ...s, [name]: true }));
    try {
      await api.del(`/api/providers/${name}/key`);
      loadProviders();
    } catch {
      // error
    } finally {
      setDeleting(s => ({ ...s, [name]: false }));
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Gateway and security configuration</p>
      </div>

      {/* LLM Providers */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-forge-400" />
            LLM Providers
          </h2>
          <span className="text-xs text-zinc-500">
            {providers.filter(p => p.configured).length}/{PROVIDER_ORDER.length} connected
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {PROVIDER_ORDER.map(name => {
            const meta = PROVIDER_META[name];
            const info = providers.find(p => p.name === name);
            const isConfigured = info?.configured ?? false;
            const isSaving = saving[name] ?? false;
            const isSaved = saved[name] ?? false;
            const isVisible = showKey[name] ?? false;

            return (
              <div key={name} className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">{meta.display}</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.models}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    isConfigured
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {isConfigured ? 'Connected' : 'Not set'}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">API Key</label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        placeholder={isConfigured ? '••••••••••••' : meta.placeholder}
                        value={keys[name] ?? ''}
                        onChange={e => setKeys(k => ({ ...k, [name]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSave(name)}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                      <button
                        aria-label={isVisible ? 'Hide key' : 'Show key'}
                        onClick={() => setShowKey(s => ({ ...s, [name]: !isVisible }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      >
                        {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      aria-label={`Save ${meta.display} API key`}
                      onClick={() => handleSave(name)}
                      disabled={isSaving || !(keys[name]?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${
                        isSaved
                          ? 'bg-emerald-500'
                          : isSaving
                            ? 'bg-forge-500/50 cursor-wait'
                            : keys[name]?.trim()
                              ? 'bg-forge-500 hover:bg-forge-600'
                              : 'bg-zinc-700 cursor-not-allowed opacity-50'
                      }`}
                    >
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button
                        aria-label={`Remove ${meta.display} API key`}
                        onClick={() => handleRemove(name)}
                        disabled={deleting[name]}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all"
                      >
                        {deleting[name] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {errors[name] && (
                    <p className="text-[11px] text-red-400 mt-1.5 font-medium">{errors[name]}</p>
                  )}
                  <p className="text-[10px] text-zinc-500 mt-1">Stored encrypted in Vault (AES-256-GCM)</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Security Settings */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-forge-400" />
          Security
        </h2>
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {[
            { label: 'Rate Limiting', desc: '60 requests per minute per IP', enabled: true },
            { label: 'Prompt Injection Guard', desc: 'Block score ≥ 0.7', enabled: true },
            { label: 'Input Sanitizer', desc: 'XSS, SQL injection, shell commands', enabled: true },
            { label: 'Audit Logging', desc: 'All events to MySQL', enabled: true },
            { label: 'Two-Factor Auth', desc: 'TOTP for critical operations', enabled: true },
            { label: 'Session Sandboxing', desc: 'Isolate all sessions by default', enabled: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-white font-medium">{item.label}</p>
                <p className="text-xs text-zinc-500">{item.desc}</p>
              </div>
              <div className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${
                item.enabled ? 'bg-forge-500' : 'bg-zinc-700'
              }`}>
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                  item.enabled ? 'right-1' : 'left-1'
                }`} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Database */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-forge-400" />
          Database
        </h2>
        <div className="rounded-xl border border-zinc-800 p-5 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Engine</span>
            <span className="text-white">MySQL 8</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Host</span>
            <span className="text-white font-mono text-xs">127.0.0.1:3306</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Database</span>
            <span className="text-white font-mono text-xs">forgeai</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Tables</span>
            <span className="text-white">10</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Encryption</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <Key className="w-3 h-3" /> AES-256-GCM
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
