import { useState, useEffect, useCallback } from 'react';
import { Key, Database, Shield, Cpu, Save, Check, Loader2, Eye, EyeOff, Trash2, Image, AudioLines } from 'lucide-react';
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
  local: { display: 'Local LLM (Ollama)', placeholder: 'http://localhost:11434', models: 'Llama 3.1, Mistral, CodeLlama, Phi-3, Qwen, DeepSeek' },
};

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'moonshot', 'deepseek', 'groq', 'mistral', 'xai', 'local'];

interface ServiceInfo {
  name: string;
  display: string;
  type: 'key' | 'url' | 'toggle';
  configured: boolean;
  value?: boolean;
}

const SERVICE_META: Record<string, { placeholder: string; desc: string }> = {
  leonardo: { placeholder: 'Enter Leonardo AI API key...', desc: 'Leonardo Phoenix model for image generation' },
  elevenlabs: { placeholder: 'Enter ElevenLabs API key...', desc: 'High-quality TTS voices' },
  'stable-diffusion': { placeholder: 'http://127.0.0.1:7860', desc: 'AUTOMATIC1111 WebUI URL (with --api flag)' },
  'security-webhook': { placeholder: 'https://hooks.slack.com/...', desc: 'POST security alerts to this URL (Slack, Discord, custom)' },
};

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Service keys state (Leonardo, ElevenLabs, SD URL, Voice)
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [svcKeys, setSvcKeys] = useState<Record<string, string>>({});
  const [svcSaving, setSvcSaving] = useState<Record<string, boolean>>({});
  const [svcSaved, setSvcSaved] = useState<Record<string, boolean>>({});
  const [svcShowKey, setSvcShowKey] = useState<Record<string, boolean>>({});
  const [svcDeleting, setSvcDeleting] = useState<Record<string, boolean>>({});
  const [svcErrors, setSvcErrors] = useState<Record<string, string>>({});

  const loadProviders = useCallback(() => {
    api.getProviders().then(r => setProviders(r.providers)).catch(() => {});
  }, []);

  const loadServices = useCallback(() => {
    fetch('/api/services').then(r => r.json()).then((d: { services: ServiceInfo[] }) => setServices(d.services ?? [])).catch(() => {});
  }, []);

  useEffect(() => { loadProviders(); loadServices(); }, [loadProviders, loadServices]);

  const handleSvcSave = async (name: string) => {
    const val = svcKeys[name];
    if (!val || val.trim().length === 0) return;
    setSvcSaving(s => ({ ...s, [name]: true }));
    setSvcErrors(e => ({ ...e, [name]: '' }));
    try {
      const res = await fetch(`/api/services/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val.trim() }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) {
        setSvcErrors(e => ({ ...e, [name]: data.error! }));
        setTimeout(() => setSvcErrors(e => ({ ...e, [name]: '' })), 5000);
      } else {
        setSvcSaved(s => ({ ...s, [name]: true }));
        setSvcKeys(k => ({ ...k, [name]: '' }));
        setTimeout(() => setSvcSaved(s => ({ ...s, [name]: false })), 2000);
        loadServices();
      }
    } catch (err) {
      setSvcErrors(e => ({ ...e, [name]: err instanceof Error ? err.message : 'Failed' }));
    } finally {
      setSvcSaving(s => ({ ...s, [name]: false }));
    }
  };

  const handleSvcRemove = async (name: string) => {
    if (svcDeleting[name]) return;
    if (!confirm(`Remove configuration for ${SERVICE_META[name]?.desc ?? name}?`)) return;
    setSvcDeleting(s => ({ ...s, [name]: true }));
    try {
      await fetch(`/api/services/${name}`, { method: 'DELETE' });
      loadServices();
    } catch { /* ignore */ }
    setSvcDeleting(s => ({ ...s, [name]: false }));
  };

  const handleVoiceToggle = async () => {
    const current = services.find(s => s.name === 'voice-enabled');
    const newVal = !(current?.configured ?? false);
    await fetch('/api/services/voice-enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    });
    loadServices();
  };

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
                  <label className="text-xs text-zinc-400 mb-1 block">{name === 'local' ? 'Server URL' : 'API Key'}</label>
                  <div className="flex gap-2">
                    {name === 'local' ? (
                      <input
                        type="text"
                        placeholder={isConfigured ? 'Configured' : meta.placeholder}
                        value={keys[name] ?? ''}
                        onChange={e => setKeys(k => ({ ...k, [name]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSave(name)}
                        className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                    ) : (
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
                    )}
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

        {/* Security Webhook URL */}
        {(() => {
          const svc = services.find(s => s.name === 'security-webhook');
          const meta = SERVICE_META['security-webhook'];
          const isConfigured = svc?.configured ?? false;
          const isSaving = svcSaving['security-webhook'] ?? false;
          const isSaved = svcSaved['security-webhook'] ?? false;
          return (
            <div className="rounded-xl border border-zinc-800 p-5 space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-white">Webhook Alerts</span>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                  {isConfigured ? 'Active' : 'Not set'}
                </span>
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Webhook URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={isConfigured ? 'Configured' : meta.placeholder}
                    value={svcKeys['security-webhook'] ?? ''}
                    onChange={e => setSvcKeys(k => ({ ...k, 'security-webhook': e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleSvcSave('security-webhook')}
                    className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                  />
                  <button aria-label="Save webhook URL" onClick={() => handleSvcSave('security-webhook')} disabled={isSaving || !(svcKeys['security-webhook']?.trim())}
                    className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['security-webhook']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                    {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                  {isConfigured && (
                    <button aria-label="Remove webhook URL" onClick={() => handleSvcRemove('security-webhook')} disabled={svcDeleting['security-webhook']}
                      className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                      {svcDeleting['security-webhook'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                {svcErrors['security-webhook'] && <p className="text-xs text-red-400 mt-1">{svcErrors['security-webhook']}</p>}
                <p className="text-[10px] text-zinc-500 mt-1">Receives JSON POST for every security alert (rate limit, injection, integrity failure)</p>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Image Generation */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Image className="w-5 h-5 text-forge-400" />
            Image Generation
          </h2>
          <span className="text-xs text-zinc-500">
            {[providers.find(p => p.name === 'openai')?.configured, services.find(s => s.name === 'leonardo')?.configured, services.find(s => s.name === 'stable-diffusion')?.configured].filter(Boolean).length}/3 connected
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {/* DALL-E 3 — uses OpenAI key */}
          <div className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-white">DALL-E 3 (OpenAI)</span>
                <p className="text-[11px] text-zinc-500 mt-0.5">Uses your OpenAI API key configured above</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                providers.find(p => p.name === 'openai')?.configured
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-zinc-700 text-zinc-400'
              }`}>
                {providers.find(p => p.name === 'openai')?.configured ? 'Connected' : 'Not set'}
              </span>
            </div>
          </div>

          {/* Leonardo AI */}
          {(() => {
            const svc = services.find(s => s.name === 'leonardo');
            const meta = SERVICE_META['leonardo'];
            const isConfigured = svc?.configured ?? false;
            const isSaving = svcSaving['leonardo'] ?? false;
            const isSaved = svcSaved['leonardo'] ?? false;
            const isVisible = svcShowKey['leonardo'] ?? false;
            return (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">Leonardo AI</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
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
                        value={svcKeys['leonardo'] ?? ''}
                        onChange={e => setSvcKeys(k => ({ ...k, leonardo: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSvcSave('leonardo')}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                      <button aria-label="Toggle visibility" onClick={() => setSvcShowKey(s => ({ ...s, leonardo: !isVisible }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                        {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button aria-label="Save Leonardo key" onClick={() => handleSvcSave('leonardo')} disabled={isSaving || !(svcKeys['leonardo']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['leonardo']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button aria-label="Remove Leonardo key" onClick={() => handleSvcRemove('leonardo')} disabled={svcDeleting['leonardo']}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                        {svcDeleting['leonardo'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {svcErrors['leonardo'] && <p className="text-xs text-red-400 mt-1">{svcErrors['leonardo']}</p>}
                </div>
              </div>
            );
          })()}

          {/* Stable Diffusion URL */}
          {(() => {
            const svc = services.find(s => s.name === 'stable-diffusion');
            const meta = SERVICE_META['stable-diffusion'];
            const isConfigured = svc?.configured ?? false;
            const isSaving = svcSaving['stable-diffusion'] ?? false;
            const isSaved = svcSaved['stable-diffusion'] ?? false;
            return (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">Stable Diffusion (Local)</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                    {isConfigured ? 'Connected' : 'Not set'}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">WebUI URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={isConfigured ? 'Configured' : meta.placeholder}
                      value={svcKeys['stable-diffusion'] ?? ''}
                      onChange={e => setSvcKeys(k => ({ ...k, 'stable-diffusion': e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleSvcSave('stable-diffusion')}
                      className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                    />
                    <button aria-label="Save SD URL" onClick={() => handleSvcSave('stable-diffusion')} disabled={isSaving || !(svcKeys['stable-diffusion']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['stable-diffusion']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button aria-label="Remove SD URL" onClick={() => handleSvcRemove('stable-diffusion')} disabled={svcDeleting['stable-diffusion']}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                        {svcDeleting['stable-diffusion'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {svcErrors['stable-diffusion'] && <p className="text-xs text-red-400 mt-1">{svcErrors['stable-diffusion']}</p>}
                </div>
              </div>
            );
          })()}
        </div>
        <p className="text-[10px] text-zinc-500">The <code className="text-zinc-400">image_generate</code> tool is available in the Tools page for testing</p>
      </section>

      {/* Voice Engine */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AudioLines className="w-5 h-5 text-forge-400" />
            Voice Engine
          </h2>
          <div className="flex items-center gap-3">
            <button
              aria-label="Toggle voice engine"
              onClick={handleVoiceToggle}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                services.find(s => s.name === 'voice-enabled')?.configured ? 'bg-forge-500' : 'bg-zinc-700'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-all ${
                services.find(s => s.name === 'voice-enabled')?.configured ? 'right-1' : 'left-1'
              }`} />
            </button>
            <span className={`text-xs font-medium ${services.find(s => s.name === 'voice-enabled')?.configured ? 'text-forge-400' : 'text-zinc-500'}`}>
              {services.find(s => s.name === 'voice-enabled')?.configured ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {/* ElevenLabs */}
          {(() => {
            const svc = services.find(s => s.name === 'elevenlabs');
            const meta = SERVICE_META['elevenlabs'];
            const isConfigured = svc?.configured ?? false;
            const isSaving = svcSaving['elevenlabs'] ?? false;
            const isSaved = svcSaved['elevenlabs'] ?? false;
            const isVisible = svcShowKey['elevenlabs'] ?? false;
            return (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">ElevenLabs</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
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
                        value={svcKeys['elevenlabs'] ?? ''}
                        onChange={e => setSvcKeys(k => ({ ...k, elevenlabs: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSvcSave('elevenlabs')}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                      <button aria-label="Toggle visibility" onClick={() => setSvcShowKey(s => ({ ...s, elevenlabs: !isVisible }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                        {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button aria-label="Save ElevenLabs key" onClick={() => handleSvcSave('elevenlabs')} disabled={isSaving || !(svcKeys['elevenlabs']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['elevenlabs']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button aria-label="Remove ElevenLabs key" onClick={() => handleSvcRemove('elevenlabs')} disabled={svcDeleting['elevenlabs']}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                        {svcDeleting['elevenlabs'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {svcErrors['elevenlabs'] && <p className="text-xs text-red-400 mt-1">{svcErrors['elevenlabs']}</p>}
                </div>
              </div>
            );
          })()}

          {/* Voice config link */}
          <div className="flex items-center justify-between p-5">
            <div>
              <span className="font-medium text-white">Voice Settings</span>
              <p className="text-[11px] text-zinc-500 mt-0.5">TTS provider, STT provider, voice selection, speed</p>
            </div>
            <a href="/voice" className="text-xs px-3 py-1.5 rounded-lg bg-forge-500/20 text-forge-400 hover:bg-forge-500/30 transition-colors">
              Configure →
            </a>
          </div>
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
