import { useState, useEffect, useCallback } from 'react';
import { Key, Database, Shield, Cpu, Save, Check, Loader2, Eye, EyeOff, Trash2, Image, AudioLines, AlertTriangle, Info, Wifi, RefreshCw, Copy, Terminal, Mic, MicOff, Radio, Mail, Home, Music, ExternalLink } from 'lucide-react';
import { api, type ProviderInfo } from '@/lib/api';
import { useI18n, type Lang } from '@/lib/i18n';

const PROVIDER_META: Record<string, { display: string; placeholder: string; models: string }> = {
  openai: { display: 'OpenAI (GPT)', placeholder: 'sk-...', models: 'GPT-5.2, GPT-5, GPT-4.1, o3-pro, o4-mini' },
  anthropic: { display: 'Anthropic (Claude)', placeholder: 'sk-ant-api03-...', models: 'Opus 4.6, Sonnet 4.6, Haiku 4.5' },
  google: { display: 'Google Gemini', placeholder: 'AIza...', models: 'Gemini 2.5 Pro/Flash, 2.0 Flash' },
  moonshot: { display: 'Kimi (Moonshot)', placeholder: 'sk-...', models: 'Kimi K2.5, moonshot-v1-auto/128k' },
  deepseek: { display: 'DeepSeek', placeholder: 'sk-...', models: 'DeepSeek Chat, Coder, Reasoner' },
  groq: { display: 'Groq', placeholder: 'gsk_...', models: 'Llama 3.3 70B, Mixtral 8x7B, Gemma2' },
  mistral: { display: 'Mistral AI', placeholder: 'sk-...', models: 'Mistral Large, Small, Codestral, Pixtral' },
  xai: { display: 'xAI (Grok)', placeholder: 'xai-...', models: 'Grok-4, Grok-3, Grok-2' },
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
  'stt-tts-api': { placeholder: 'Enter API key for VPS STT/TTS...', desc: 'Whisper (STT) + Piper (TTS) on VPS - free, no OpenAI credits' },
  'whisper-api-url': { placeholder: 'http://167.86.85.73:5051', desc: 'VPS Whisper API URL (optional, has default)' },
  'piper-api-url': { placeholder: 'http://167.86.85.73:5051', desc: 'VPS Piper API URL (optional, has default)' },
  'kokoro-api-url': { placeholder: 'http://167.86.85.73:8881', desc: 'Kokoro TTS URL — high-quality, 67 voices, PT-BR support' },
  'kokoro-api-key': { placeholder: 'Enter Kokoro API key...', desc: 'Bearer token for Kokoro TTS auth (nginx proxy)' },
  'node-api-key': { placeholder: 'Enter Node Protocol API key...', desc: 'Shared secret for IoT/embedded node agents (Raspberry Pi, Jetson, BeagleBone, etc.)' },
  'picovoice-key': { placeholder: 'Enter Picovoice AccessKey...', desc: 'Wake word detection with Porcupine — say "Hey Forge" to activate hands-free' },
};

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ollamaApiKey, setOllamaApiKey] = useState('');

  // Model editor state per provider
  const [editingModels, setEditingModels] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [modelInput, setModelInput] = useState('');
  const [modelSaving, setModelSaving] = useState(false);
  const [modelCustom, setModelCustom] = useState<Record<string, boolean>>({});

  // i18n
  const { t, lang, setLang } = useI18n();

  // Service keys state (Leonardo, ElevenLabs, SD URL, Voice)
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [svcKeys, setSvcKeys] = useState<Record<string, string>>({});
  const [svcSaving, setSvcSaving] = useState<Record<string, boolean>>({});
  const [svcSaved, setSvcSaved] = useState<Record<string, boolean>>({});
  const [svcShowKey, setSvcShowKey] = useState<Record<string, boolean>>({});
  const [svcDeleting, setSvcDeleting] = useState<Record<string, boolean>>({});
  const [svcErrors, setSvcErrors] = useState<Record<string, string>>({});

  // Node Protocol state
  const [nodeGenerating, setNodeGenerating] = useState(false);

  // SMTP / Email OTP state
  const [smtpConfig, setSMTPConfig] = useState<{ configured: boolean; host: string; port: string; user: string; from: string; adminEmail: string; hasPassword: boolean; source: string }>({ configured: false, host: '', port: '587', user: '', from: '', adminEmail: '', hasPassword: false, source: 'none' });
  const [smtpFields, setSMTPFields] = useState<{ host: string; port: string; user: string; pass: string; from: string; adminEmail: string }>({ host: '', port: '587', user: '', pass: '', from: '', adminEmail: '' });
  const [smtpSaving, setSMTPSaving] = useState(false);
  const [smtpSaved, setSMTPSaved] = useState(false);
  const [smtpError, setSMTPError] = useState('');
  const [smtpTesting, setSMTPTesting] = useState(false);
  const [smtpTestResult, setSMTPTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [smtpShowPass, setSMTPShowPass] = useState(false);

  // Home Assistant state
  const [haConfig, setHAConfig] = useState<{ configured: boolean }>({ configured: false });
  const [haFields, setHAFields] = useState<{ url: string; token: string }>({ url: '', token: '' });
  const [haSaving, setHASaving] = useState(false);
  const [haSaved, setHASaved] = useState(false);
  const [haError, setHAError] = useState('');
  const [haTesting, setHATesting] = useState(false);
  const [haTestResult, setHATestResult] = useState<{ ok: boolean; message?: string; version?: string } | null>(null);
  const [haShowToken, setHAShowToken] = useState(false);

  // Spotify state
  const [spotifyConfig, setSpotifyConfig] = useState<{ configured: boolean; authenticated: boolean; redirectUri?: string }>({ configured: false, authenticated: false });
  const [spotifyFields, setSpotifyFields] = useState<{ clientId: string; clientSecret: string }>({ clientId: '', clientSecret: '' });
  const [spotifySaving, setSpotifySaving] = useState(false);
  const [spotifySaved, setSpotifySaved] = useState(false);
  const [spotifyError, setSpotifyError] = useState('');
  const [spotifyShowSecret, setSpotifyShowSecret] = useState(false);

  // Config Sync state
  const [syncRemoteUrl, setSyncRemoteUrl] = useState('');
  const [syncCode, setSyncCode] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pushing' | 'generating' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncGeneratedCode, setSyncGeneratedCode] = useState('');
  const [syncSummary, setSyncSummary] = useState<{ total: number; categories: Record<string, number> } | null>(null);

  // Wake Word state
  const [wakeWordStatus, setWakeWordStatus] = useState<{ enabled: boolean; running: boolean; keyword: string; sensitivity: number; detectionCount: number; lastDetection?: string; uptime: number } | null>(null);
  const [wakeWordStarting, setWakeWordStarting] = useState(false);
  const [wakeWordSensitivity, setWakeWordSensitivity] = useState(0.5);
  const [nodeGeneratedKey, setNodeGeneratedKey] = useState<string | null>(null);
  const [nodeConnInfo, setNodeConnInfo] = useState<{ gatewayUrl?: string; wsUrl?: string; keyPrefix?: string; example?: string } | null>(null);
  const [nodeCopied, setNodeCopied] = useState<string | null>(null);

  const loadProviders = useCallback(() => {
    api.getProviders().then(r => setProviders(r.providers)).catch(() => {});
  }, []);

  const loadServices = useCallback(() => {
    fetch('/api/services').then(r => r.json()).then((d: { services: ServiceInfo[] }) => setServices(d.services ?? [])).catch(() => {});
  }, []);

  const loadSMTPConfig = useCallback(() => {
    fetch('/api/smtp/config').then(r => r.json()).then((d: any) => {
      setSMTPConfig(d);
      setSMTPFields(f => ({
        host: f.host || d.host || '',
        port: f.port || d.port || '587',
        user: f.user || d.user || '',
        pass: f.pass || '',
        from: f.from || d.from || '',
        adminEmail: f.adminEmail || d.adminEmail || '',
      }));
    }).catch(() => {});
  }, []);

  const loadHAConfig = useCallback(() => {
    fetch('/api/integrations/homeassistant/status').then(r => r.json()).then((d: { configured: boolean }) => {
      setHAConfig(d);
    }).catch(() => {});
  }, []);

  const loadSpotifyConfig = useCallback(() => {
    fetch('/api/integrations/spotify/status').then(r => r.json()).then((d: { configured: boolean; authenticated: boolean; redirectUri?: string }) => {
      setSpotifyConfig(d);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadProviders(); loadServices(); loadSMTPConfig(); loadHAConfig(); loadSpotifyConfig(); }, [loadProviders, loadServices, loadSMTPConfig, loadHAConfig, loadSpotifyConfig]);

  // Load wake word status
  const loadWakeWordStatus = useCallback(() => {
    fetch('/api/wakeword/status').then(r => r.json()).then((d: { status: any }) => {
      if (d.status) {
        setWakeWordStatus(d.status);
        setWakeWordSensitivity(d.status.sensitivity ?? 0.5);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadWakeWordStatus();
    const interval = setInterval(loadWakeWordStatus, 5000);
    return () => clearInterval(interval);
  }, [loadWakeWordStatus]);

  // Load node connection info when node is configured
  const nodeConfigured = services.find(s => s.name === 'node-api-key')?.configured ?? false;
  useEffect(() => {
    if (nodeConfigured) {
      fetch('/api/nodes/connection-info').then(r => r.json()).then(setNodeConnInfo).catch(() => {});
    } else {
      setNodeConnInfo(null);
    }
  }, [nodeConfigured]);

  // Load Config Sync export summary
  const loadSyncSummary = useCallback(() => {
    fetch('/api/config/export-summary').then(r => r.json()).then((d: any) => {
      if (d.success) setSyncSummary({ total: d.total, categories: d.categories });
    }).catch(() => {});
  }, []);

  useEffect(() => { loadSyncSummary(); }, [loadSyncSummary]);

  const handleSyncPush = async () => {
    if (!syncRemoteUrl.trim() || !syncCode.trim()) return;
    setSyncStatus('pushing');
    setSyncMessage('');
    try {
      const resp = await fetch('/api/config/sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteUrl: syncRemoteUrl.trim(), syncCode: syncCode.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        setSyncStatus('success');
        setSyncMessage(`Pushed ${data.keysTransferred} keys successfully!`);
        setSyncCode('');
      } else {
        setSyncStatus('error');
        setSyncMessage(data.error || 'Push failed');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Network error');
    }
  };

  const handleSyncGenerate = async () => {
    setSyncStatus('generating');
    setSyncMessage('');
    setSyncGeneratedCode('');
    try {
      const resp = await fetch('/api/config/sync-init', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setSyncGeneratedCode(data.syncCode);
        setSyncStatus('idle');
        setSyncMessage(`Code expires in ${data.expiresIn}s. Enter it on the source Gateway.`);
      } else {
        setSyncStatus('error');
        setSyncMessage(data.error || 'Failed to generate code');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Network error');
    }
  };

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

  const loadModels = async (name: string) => {
    try {
      const res = await fetch(`/api/providers/${name}/models`);
      const data = await res.json() as { models: string[]; custom: boolean };
      setProviderModels(m => ({ ...m, [name]: data.models ?? [] }));
      setModelCustom(c => ({ ...c, [name]: data.custom ?? false }));
    } catch { /* ignore */ }
  };

  const handleOpenModelEditor = async (name: string) => {
    await loadModels(name);
    setModelInput('');
    setEditingModels(name);
  };

  const handleAddModel = (name: string) => {
    const val = modelInput.trim();
    if (!val) return;
    const current = providerModels[name] ?? [];
    if (current.includes(val)) { setModelInput(''); return; }
    setProviderModels(m => ({ ...m, [name]: [...current, val] }));
    setModelInput('');
  };

  const handleRemoveModel = (name: string, model: string) => {
    const current = providerModels[name] ?? [];
    setProviderModels(m => ({ ...m, [name]: current.filter(m2 => m2 !== model) }));
  };

  const handleSaveModels = async (name: string) => {
    const models = providerModels[name];
    if (!models || models.length === 0) return;
    setModelSaving(true);
    try {
      await fetch(`/api/providers/${name}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      });
      setModelCustom(c => ({ ...c, [name]: true }));
      loadProviders();
    } catch { /* ignore */ }
    setModelSaving(false);
  };

  const handleResetModels = async (name: string) => {
    setModelSaving(true);
    try {
      const res = await fetch(`/api/providers/${name}/models`, { method: 'DELETE' });
      const data = await res.json() as { models: string[] };
      setProviderModels(m => ({ ...m, [name]: data.models ?? [] }));
      setModelCustom(c => ({ ...c, [name]: false }));
      loadProviders();
    } catch { /* ignore */ }
    setModelSaving(false);
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
      const body: Record<string, string> = { apiKey: key.trim() };
      if (name === 'local' && ollamaApiKey.trim()) body.ollamaApiKey = ollamaApiKey.trim();
      const res = await api.post<{ success?: boolean; error?: string }>(`/api/providers/${name}/key`, body);
      if (res.error) {
        setErrors(e => ({ ...e, [name]: res.error! }));
        setTimeout(() => setErrors(e => ({ ...e, [name]: '' })), 5000);
      } else {
        setSaved(s => ({ ...s, [name]: true }));
        setKeys(k => ({ ...k, [name]: '' }));
        if (name === 'local') setOllamaApiKey('');
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
        <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* General */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5 text-forge-400" />
          {t('settings.general')}
        </h2>
        <div className="rounded-xl border border-zinc-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">{t('settings.language')}</p>
              <p className="text-xs text-zinc-500">{t('settings.languageDesc')}</p>
            </div>
            <select
              title="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
            >
              <option value="en">English</option>
              <option value="pt">Português (BR)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="zh">中文</option>
            </select>
          </div>
        </div>
      </section>

      {/* LLM Providers */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-forge-400" />
            {t('settings.llmProviders')}
          </h2>
          <span className="text-xs text-zinc-500">
            {providers.filter(p => p.configured).length}/{PROVIDER_ORDER.length} {t('settings.connected')}
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
                    {isConfigured ? 'Connected' : t('settings.notSet')}
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
                  <p className="text-[10px] text-zinc-500">{t('settings.storedEncrypted')}</p>
                </div>

                {/* Ollama API Key (optional, for remote servers with auth) */}
                {name === 'local' && (
                  <div className="pt-3 border-t border-zinc-800/50 space-y-2">
                    <label className="text-xs text-zinc-400 block">{t('settings.ollamaApiKey')}</label>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={showKey['local-apikey'] ? 'text' : 'password'}
                          placeholder="Bearer token for nginx/auth proxy..."
                          value={ollamaApiKey}
                          onChange={e => setOllamaApiKey(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleSave('local')}
                          className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                        />
                        <button
                          aria-label={showKey['local-apikey'] ? 'Hide key' : 'Show key'}
                          onClick={() => setShowKey(s => ({ ...s, 'local-apikey': !s['local-apikey'] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                        >
                          {showKey['local-apikey'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500">Sent as <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">Authorization: Bearer &lt;key&gt;</code> header. Use when running Ollama behind nginx or a reverse proxy with authentication.</p>
                  </div>
                )}

                {/* Anthropic OAuth Subscription Section */}
                {name === 'anthropic' && (
                  <div className="pt-3 border-t border-zinc-800/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                      <span className="text-[11px] font-medium text-purple-300">{t('settings.claudeSubscription')}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed">
                      {t('settings.claudeSubscriptionDesc')}
                    </p>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-300/90 leading-relaxed">
                        <strong>{t('settings.claudeUnavailable')}</strong> {t('settings.claudeUnavailableDesc')}{' '}
                        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                          className="underline text-amber-200 hover:text-white">console.anthropic.com</a>{' '}
                        {t('settings.claudeUnavailableEnd')}
                      </p>
                    </div>
                  </div>
                )}

                {/* Models — toggle editor */}
                <div className="pt-2 border-t border-zinc-800/50">
                  <button onClick={() => editingModels === name ? setEditingModels(null) : handleOpenModelEditor(name)}
                    className="text-[11px] text-forge-400 hover:text-forge-300 transition-colors">
                    {editingModels === name ? `▾ ${t('settings.hideModels')}` : `▸ ${t('settings.configModels')}`}{modelCustom[name] ? ` ${t('settings.custom')}` : ''}
                  </button>

                  {editingModels === name && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {(providerModels[name] ?? []).map(model => (
                          <span key={model} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-[11px] text-zinc-300 border border-zinc-700">
                            {model}
                            <button onClick={() => handleRemoveModel(name, model)} className="text-zinc-500 hover:text-red-400 ml-0.5">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text" placeholder={t('settings.addModel')}
                          value={modelInput} onChange={e => setModelInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddModel(name); } }}
                          className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-md px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-forge-500/50"
                        />
                        <button onClick={() => handleAddModel(name)} className="px-2 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-[11px] text-zinc-300">Add</button>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => handleSaveModels(name)} disabled={modelSaving}
                          className="px-2 py-1 rounded-md bg-forge-500 hover:bg-forge-600 text-[11px] text-white font-medium disabled:opacity-50">
                          {modelSaving ? t('settings.savingModels') : t('settings.saveModels')}
                        </button>
                        {modelCustom[name] && (
                          <button onClick={() => handleResetModels(name)} disabled={modelSaving}
                            className="px-2 py-1 rounded-md border border-zinc-700 hover:border-zinc-500 text-[11px] text-zinc-400 disabled:opacity-50">
                            {t('settings.resetDefaults')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
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
          {t('settings.security')}
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

          {/* RBAC Hard Enforcement toggle */}
          {(() => {
            const rbacSvc = services.find(s => s.name === 'rbac-enforce');
            const isEnforced = rbacSvc?.value ?? false;
            return (
              <div className="flex items-center justify-between p-4 border-t border-zinc-800">
                <div>
                  <p className="text-sm text-white font-medium">RBAC Hard Enforcement</p>
                  <p className="text-xs text-zinc-500">Block all anonymous requests to admin routes (403). Requires auth tokens.</p>
                </div>
                <button
                  aria-label="Toggle RBAC hard enforcement"
                  onClick={async () => {
                    await fetch('/api/services/rbac-enforce', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ value: String(!isEnforced) }),
                    });
                    loadServices();
                  }}
                  className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${
                    isEnforced ? 'bg-red-500' : 'bg-zinc-700'
                  }`}>
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                    isEnforced ? 'right-1' : 'left-1'
                  }`} />
                </button>
              </div>
            );
          })()}
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

      {/* Email OTP (SMTP) Configuration */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Mail className="w-5 h-5 text-forge-400" />
          Email OTP (External Security)
        </h2>
        <div className="rounded-xl border border-zinc-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">SMTP Email Verification</p>
              <p className="text-xs text-zinc-500">When accessing ForgeAI from the internet, an additional email verification code is required after TOTP + PIN.</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${smtpConfig.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
              {smtpConfig.configured ? `Active (${smtpConfig.source})` : 'Not configured'}
            </span>
          </div>

          {smtpConfig.configured && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-emerald-300/90 leading-relaxed">
                <strong>4-Factor Auth Active:</strong> Access Token → TOTP Code → Admin PIN → Email OTP (external only). Local access skips email verification.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">SMTP Host</label>
                <input type="text" placeholder="smtp.gmail.com" value={smtpFields.host} onChange={e => setSMTPFields(f => ({ ...f, host: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Port</label>
                <input type="text" placeholder="587" value={smtpFields.port} onChange={e => setSMTPFields(f => ({ ...f, port: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">SMTP Username (email)</label>
              <input type="email" placeholder="your-email@gmail.com" value={smtpFields.user} onChange={e => setSMTPFields(f => ({ ...f, user: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">SMTP Password {smtpConfig.hasPassword && <span className="text-emerald-400">(saved)</span>}</label>
              <div className="relative">
                <input type={smtpShowPass ? 'text' : 'password'} placeholder={smtpConfig.hasPassword ? '••••••••' : 'App Password (Gmail: 16 chars)'} value={smtpFields.pass} onChange={e => setSMTPFields(f => ({ ...f, pass: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
                <button aria-label="Toggle password" onClick={() => setSMTPShowPass(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {smtpShowPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">From (display name)</label>
              <input type="text" placeholder='ForgeAI <your-email@gmail.com>' value={smtpFields.from} onChange={e => setSMTPFields(f => ({ ...f, from: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Admin Email (receives OTP codes)</label>
              <input type="email" placeholder="admin@example.com" value={smtpFields.adminEmail} onChange={e => setSMTPFields(f => ({ ...f, adminEmail: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>
          </div>

          {smtpError && <p className="text-xs text-red-400 font-medium">{smtpError}</p>}
          {smtpTestResult && (
            <p className={`text-xs font-medium ${smtpTestResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {smtpTestResult.ok ? 'SMTP connection test passed!' : `Test failed: ${smtpTestResult.error}`}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={async () => {
              setSMTPSaving(true); setSMTPError(''); setSMTPTestResult(null);
              try {
                const res = await fetch('/api/smtp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: smtpFields.host, port: Number(smtpFields.port) || 587, user: smtpFields.user, pass: smtpFields.pass || undefined, from: smtpFields.from || undefined, adminEmail: smtpFields.adminEmail || undefined }) });
                const data = await res.json() as { error?: string };
                if (data.error) { setSMTPError(data.error); } else { setSMTPSaved(true); setSMTPFields(f => ({ ...f, pass: '' })); setTimeout(() => setSMTPSaved(false), 2000); loadSMTPConfig(); }
              } catch (err) { setSMTPError(err instanceof Error ? err.message : 'Failed'); }
              setSMTPSaving(false);
            }} disabled={smtpSaving || !smtpFields.host.trim() || !smtpFields.user.trim()}
              className={`px-4 py-2 rounded-lg text-white text-xs font-medium transition-all ${smtpSaved ? 'bg-emerald-500' : smtpSaving ? 'bg-forge-500/50 cursor-wait' : smtpFields.host.trim() && smtpFields.user.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
              {smtpSaved ? <><Check className="w-3.5 h-3.5 inline mr-1" />Saved</> : smtpSaving ? <><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Saving...</> : <><Save className="w-3.5 h-3.5 inline mr-1" />Save SMTP</>}
            </button>

            <button onClick={async () => {
              setSMTPTesting(true); setSMTPTestResult(null);
              try {
                const res = await fetch('/api/smtp/test', { method: 'POST' });
                const data = await res.json() as { ok: boolean; error?: string };
                setSMTPTestResult(data);
              } catch { setSMTPTestResult({ ok: false, error: 'Request failed' }); }
              setSMTPTesting(false);
            }} disabled={smtpTesting || !smtpConfig.configured}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all border ${
                smtpConfig.configured
                  ? 'border-forge-500/30 text-forge-400 hover:bg-forge-500/10'
                  : 'border-zinc-700 text-zinc-500 cursor-not-allowed opacity-50'
              }`}>
              {smtpTesting ? <><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Testing...</> : 'Test Connection'}
            </button>

            {smtpConfig.configured && smtpConfig.source === 'vault' && (
              <button title="Remove SMTP configuration" onClick={async () => {
                if (!confirm('Remove SMTP configuration from Vault?')) return;
                await fetch('/api/smtp/config', { method: 'DELETE' });
                setSMTPFields({ host: '', port: '587', user: '', pass: '', from: '', adminEmail: '' });
                loadSMTPConfig();
              }} className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              <strong>Gmail users:</strong> Use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="underline text-forge-400 hover:text-forge-300">App Password</a> (not your regular password). Enable 2-Step Verification in Google first, then generate an App Password for "Mail".
              Settings are encrypted in the Vault.
            </p>
          </div>
        </div>
      </section>

      {/* Home Assistant */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Home className="w-5 h-5 text-forge-400" />
            Smart Home (Home Assistant)
          </h2>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${haConfig.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
            {haConfig.configured ? 'Connected' : 'Not configured'}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-400">Control lights, switches, climate, scenes, and automations via Home Assistant. The agent can use natural language like "Turn off the lights" or "Set temperature to 22°C".</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Home Assistant URL</label>
              <input type="url" placeholder="http://homeassistant.local:8123" value={haFields.url} onChange={e => setHAFields(f => ({ ...f, url: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Long-Lived Access Token</label>
              <div className="relative">
                <input type={haShowToken ? 'text' : 'password'} placeholder="eyJ0eXAiOiJKV1QiLCJhbGc..." value={haFields.token} onChange={e => setHAFields(f => ({ ...f, token: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 font-mono" />
                <button type="button" onClick={() => setHAShowToken(!haShowToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {haShowToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {haError && <p className="text-xs text-red-400 font-medium">{haError}</p>}
          {haTestResult && (
            <p className={`text-xs font-medium ${haTestResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {haTestResult.ok ? `Connected! ${haTestResult.message || ''}${haTestResult.version ? ` (v${haTestResult.version})` : ''}` : `Test failed: ${haTestResult.message || haTestResult.error}`}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={async () => {
              setHASaving(true); setHAError(''); setHATestResult(null);
              try {
                const res = await fetch('/api/integrations/homeassistant/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: haFields.url.trim(), token: haFields.token.trim() }) });
                const data = await res.json() as { error?: string; configured?: boolean };
                if (data.error) { setHAError(data.error); } else { setHASaved(true); setHAFields(f => ({ ...f, token: '' })); setTimeout(() => setHASaved(false), 2000); loadHAConfig(); }
              } catch (err) { setHAError(err instanceof Error ? err.message : 'Failed'); }
              setHASaving(false);
            }} disabled={haSaving || !haFields.url.trim() || !haFields.token.trim()}
              className={`px-4 py-2 rounded-lg text-white text-xs font-medium transition-all ${haSaved ? 'bg-emerald-500' : haSaving ? 'bg-forge-500/50 cursor-wait' : haFields.url.trim() && haFields.token.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
              {haSaved ? <><Check className="w-3.5 h-3.5 inline mr-1" />Saved</> : haSaving ? <><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Saving...</> : <><Save className="w-3.5 h-3.5 inline mr-1" />Save</>}
            </button>

            <button onClick={async () => {
              setHATesting(true); setHATestResult(null);
              try {
                const res = await fetch('/api/integrations/homeassistant/test', { method: 'POST' });
                const data = await res.json() as { ok: boolean; message?: string; version?: string; error?: string };
                setHATestResult(data);
              } catch { setHATestResult({ ok: false, message: 'Request failed' }); }
              setHATesting(false);
            }} disabled={haTesting || !haConfig.configured}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all border ${haConfig.configured ? 'border-forge-500/30 text-forge-400 hover:bg-forge-500/10' : 'border-zinc-700 text-zinc-500 cursor-not-allowed opacity-50'}`}>
              {haTesting ? <><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Testing...</> : 'Test Connection'}
            </button>

            {haConfig.configured && (
              <button title="Remove Home Assistant configuration" onClick={async () => {
                if (!confirm('Remove Home Assistant configuration?')) return;
                await fetch('/api/integrations/homeassistant/config', { method: 'DELETE' });
                setHAFields({ url: '', token: '' });
                loadHAConfig();
              }} className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Go to <strong>Home Assistant → Profile → Long-Lived Access Tokens → Create Token</strong>. The token and URL are encrypted in the Vault. Once connected, say <em>"Turn off the lights"</em> or <em>"Set bedroom temperature to 22°C"</em> via any channel.
            </p>
          </div>
        </div>
      </section>

      {/* Spotify */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Music className="w-5 h-5 text-forge-400" />
            Spotify
          </h2>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${spotifyConfig.authenticated ? 'bg-emerald-500/20 text-emerald-400' : spotifyConfig.configured ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-700 text-zinc-400'}`}>
            {spotifyConfig.authenticated ? 'Connected' : spotifyConfig.configured ? 'Not authorized' : 'Not configured'}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-400">Control Spotify playback via natural language. Say "Play my focus playlist" or "Next track" from any channel.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Client ID</label>
              <input type="text" placeholder="Your Spotify Client ID" value={spotifyFields.clientId} onChange={e => setSpotifyFields(f => ({ ...f, clientId: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 font-mono" />
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Client Secret</label>
              <div className="relative">
                <input type={spotifyShowSecret ? 'text' : 'password'} placeholder="Your Spotify Client Secret" value={spotifyFields.clientSecret} onChange={e => setSpotifyFields(f => ({ ...f, clientSecret: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 font-mono" />
                <button type="button" onClick={() => setSpotifyShowSecret(!spotifyShowSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {spotifyShowSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {spotifyConfig.redirectUri && (
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Redirect URI (add this to your Spotify app)</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono overflow-x-auto">{spotifyConfig.redirectUri}</code>
                <button title="Copy redirect URI" onClick={() => { navigator.clipboard.writeText(spotifyConfig.redirectUri || ''); }} className="px-2 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {spotifyError && <p className="text-xs text-red-400 font-medium">{spotifyError}</p>}

          <div className="flex gap-2 flex-wrap">
            <button onClick={async () => {
              setSpotifySaving(true); setSpotifyError('');
              try {
                const res = await fetch('/api/integrations/spotify/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: spotifyFields.clientId.trim(), clientSecret: spotifyFields.clientSecret.trim() }) });
                const data = await res.json() as { error?: string; configured?: boolean };
                if (data.error) { setSpotifyError(data.error); } else { setSpotifySaved(true); setSpotifyFields(f => ({ ...f, clientSecret: '' })); setTimeout(() => setSpotifySaved(false), 2000); loadSpotifyConfig(); }
              } catch (err) { setSpotifyError(err instanceof Error ? err.message : 'Failed'); }
              setSpotifySaving(false);
            }} disabled={spotifySaving || !spotifyFields.clientId.trim() || !spotifyFields.clientSecret.trim()}
              className={`px-4 py-2 rounded-lg text-white text-xs font-medium transition-all ${spotifySaved ? 'bg-emerald-500' : spotifySaving ? 'bg-forge-500/50 cursor-wait' : spotifyFields.clientId.trim() && spotifyFields.clientSecret.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
              {spotifySaved ? <><Check className="w-3.5 h-3.5 inline mr-1" />Saved</> : spotifySaving ? <><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Saving...</> : <><Save className="w-3.5 h-3.5 inline mr-1" />Save</>}
            </button>

            {spotifyConfig.configured && !spotifyConfig.authenticated && (
              <button onClick={async () => {
                try {
                  const res = await fetch('/api/integrations/spotify/authorize');
                  const data = await res.json() as { url?: string; error?: string };
                  if (data.url) window.open(data.url, '_blank', 'width=500,height=700');
                  else setSpotifyError(data.error || 'Failed to get authorize URL');
                  // Poll for auth completion
                  const poll = setInterval(() => { loadSpotifyConfig(); }, 2000);
                  setTimeout(() => clearInterval(poll), 120_000);
                } catch { setSpotifyError('Failed to start authorization'); }
              }} className="px-4 py-2 rounded-lg text-xs font-medium transition-all border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                <ExternalLink className="w-3.5 h-3.5 inline mr-1" />Authorize Spotify
              </button>
            )}

            {spotifyConfig.authenticated && (
              <span className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Authorized
              </span>
            )}

            {spotifyConfig.configured && (
              <button title="Remove Spotify configuration" onClick={async () => {
                if (!confirm('Remove Spotify configuration and disconnect?')) return;
                await fetch('/api/integrations/spotify/config', { method: 'DELETE' });
                setSpotifyFields({ clientId: '', clientSecret: '' });
                loadSpotifyConfig();
              }} className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline text-forge-400 hover:text-forge-300">Spotify Developer Dashboard</a> → Create App → copy Client ID and Secret. Add the <strong>Redirect URI</strong> shown above to your app settings. Requires <strong>Spotify Premium</strong> for playback control.
            </p>
          </div>
        </div>
      </section>

      {/* Image Generation */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Image className="w-5 h-5 text-forge-400" />
            {t('settings.imageGeneration')}
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
                    {isConfigured ? 'Connected' : t('settings.notSet')}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">{t('settings.apiKey')}</label>
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
                    {isConfigured ? 'Connected' : t('settings.notSet')}
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
            {t('settings.voiceEngine')}
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
                    {isConfigured ? 'Connected' : t('settings.notSet')}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">{t('settings.apiKey')}</label>
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

          {/* VPS STT/TTS (Whisper + Piper) */}
          {(() => {
            const svc = services.find(s => s.name === 'stt-tts-api');
            const meta = SERVICE_META['stt-tts-api'];
            const isConfigured = svc?.configured ?? false;
            const isSaving = svcSaving['stt-tts-api'] ?? false;
            const isSaved = svcSaved['stt-tts-api'] ?? false;
            const isVisible = svcShowKey['stt-tts-api'] ?? false;

            const whisperSvc = services.find(s => s.name === 'whisper-api-url');
            const piperSvc = services.find(s => s.name === 'piper-api-url');
            const kokoroSvc = services.find(s => s.name === 'kokoro-api-url');
            const whisperMeta = SERVICE_META['whisper-api-url'];
            const piperMeta = SERVICE_META['piper-api-url'];
            const kokoroMeta = SERVICE_META['kokoro-api-url'];
            return (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">VPS STT/TTS (Whisper + Piper)</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                    {isConfigured ? 'Connected' : t('settings.notSet')}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">{t('settings.apiKey')}</label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        placeholder={isConfigured ? '••••••••••••' : meta.placeholder}
                        value={svcKeys['stt-tts-api'] ?? ''}
                        onChange={e => setSvcKeys(k => ({ ...k, 'stt-tts-api': e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSvcSave('stt-tts-api')}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                      <button aria-label="Toggle visibility" onClick={() => setSvcShowKey(s => ({ ...s, 'stt-tts-api': !isVisible }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                        {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button aria-label="Save STT/TTS key" onClick={() => handleSvcSave('stt-tts-api')} disabled={isSaving || !(svcKeys['stt-tts-api']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['stt-tts-api']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button aria-label="Remove STT/TTS key" onClick={() => handleSvcRemove('stt-tts-api')} disabled={svcDeleting['stt-tts-api']}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                        {svcDeleting['stt-tts-api'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {svcErrors['stt-tts-api'] && <p className="text-xs text-red-400 mt-1">{svcErrors['stt-tts-api']}</p>}
                </div>

                {/* Whisper API URL */}
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Whisper API URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={whisperSvc?.configured ? 'Configured' : whisperMeta.placeholder}
                      value={svcKeys['whisper-api-url'] ?? ''}
                      onChange={e => setSvcKeys(k => ({ ...k, 'whisper-api-url': e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleSvcSave('whisper-api-url')}
                      className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                    />
                    <button aria-label="Save Whisper URL" onClick={() => handleSvcSave('whisper-api-url')} disabled={svcSaving['whisper-api-url'] || !(svcKeys['whisper-api-url']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${svcSaved['whisper-api-url'] ? 'bg-emerald-500' : svcSaving['whisper-api-url'] ? 'bg-forge-500/50 cursor-wait' : svcKeys['whisper-api-url']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {svcSaved['whisper-api-url'] ? <Check className="w-4 h-4" /> : svcSaving['whisper-api-url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                  </div>
                  {svcErrors['whisper-api-url'] && <p className="text-xs text-red-400 mt-1">{svcErrors['whisper-api-url']}</p>}
                </div>

                {/* Piper API URL */}
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Piper API URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={piperSvc?.configured ? 'Configured' : piperMeta.placeholder}
                      value={svcKeys['piper-api-url'] ?? ''}
                      onChange={e => setSvcKeys(k => ({ ...k, 'piper-api-url': e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleSvcSave('piper-api-url')}
                      className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                    />
                    <button aria-label="Save Piper URL" onClick={() => handleSvcSave('piper-api-url')} disabled={svcSaving['piper-api-url'] || !(svcKeys['piper-api-url']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${svcSaved['piper-api-url'] ? 'bg-emerald-500' : svcSaving['piper-api-url'] ? 'bg-forge-500/50 cursor-wait' : svcKeys['piper-api-url']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {svcSaved['piper-api-url'] ? <Check className="w-4 h-4" /> : svcSaving['piper-api-url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                  </div>
                  {svcErrors['piper-api-url'] && <p className="text-xs text-red-400 mt-1">{svcErrors['piper-api-url']}</p>}
                </div>

                {/* Kokoro API URL */}
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Kokoro TTS URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={kokoroSvc?.configured ? 'Configured' : kokoroMeta.placeholder}
                      value={svcKeys['kokoro-api-url'] ?? ''}
                      onChange={e => setSvcKeys(k => ({ ...k, 'kokoro-api-url': e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleSvcSave('kokoro-api-url')}
                      className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                    />
                    <button aria-label="Save Kokoro URL" onClick={() => handleSvcSave('kokoro-api-url')} disabled={svcSaving['kokoro-api-url'] || !(svcKeys['kokoro-api-url']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${svcSaved['kokoro-api-url'] ? 'bg-emerald-500' : svcSaving['kokoro-api-url'] ? 'bg-forge-500/50 cursor-wait' : svcKeys['kokoro-api-url']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {svcSaved['kokoro-api-url'] ? <Check className="w-4 h-4" /> : svcSaving['kokoro-api-url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                  </div>
                  {svcErrors['kokoro-api-url'] && <p className="text-xs text-red-400 mt-1">{svcErrors['kokoro-api-url']}</p>}
                </div>

                {/* Kokoro API Key */}
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Kokoro API Key</label>
                  <div className="flex gap-2">
                    <input
                      type={svcShowKey['kokoro-api-key'] ? 'text' : 'password'}
                      placeholder={services.find(s => s.name === 'kokoro-api-key')?.configured ? '••••••••' : SERVICE_META['kokoro-api-key'].placeholder}
                      value={svcKeys['kokoro-api-key'] ?? ''}
                      onChange={e => setSvcKeys(k => ({ ...k, 'kokoro-api-key': e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleSvcSave('kokoro-api-key')}
                      className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                    />
                    <button aria-label="Toggle Kokoro key visibility" onClick={() => setSvcShowKey(k => ({ ...k, 'kokoro-api-key': !k['kokoro-api-key'] }))}
                      className="px-2 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                      {svcShowKey['kokoro-api-key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button aria-label="Save Kokoro key" onClick={() => handleSvcSave('kokoro-api-key')} disabled={svcSaving['kokoro-api-key'] || !(svcKeys['kokoro-api-key']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${svcSaved['kokoro-api-key'] ? 'bg-emerald-500' : svcSaving['kokoro-api-key'] ? 'bg-forge-500/50 cursor-wait' : svcKeys['kokoro-api-key']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {svcSaved['kokoro-api-key'] ? <Check className="w-4 h-4" /> : svcSaving['kokoro-api-key'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                  </div>
                  {svcErrors['kokoro-api-key'] && <p className="text-xs text-red-400 mt-1">{svcErrors['kokoro-api-key']}</p>}
                </div>

                <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Free STT/TTS on your VPS — no OpenAI credits needed
                </p>
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

      {/* Wake Word Detection */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-forge-400" />
            Wake Word Detection
          </h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${wakeWordStatus?.running ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
            {wakeWordStatus?.running ? 'Listening' : 'Stopped'}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {/* Picovoice AccessKey */}
          {(() => {
            const svc = services.find(s => s.name === 'picovoice-key');
            const meta = SERVICE_META['picovoice-key'];
            const isConfigured = svc?.configured ?? false;
            const isSaving = svcSaving['picovoice-key'] ?? false;
            const isSaved = svcSaved['picovoice-key'] ?? false;
            const isVisible = svcShowKey['picovoice-key'] ?? false;
            return (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-white">Picovoice AccessKey</span>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{meta.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                    {isConfigured ? 'Connected' : 'Not set'}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">AccessKey</label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        placeholder={isConfigured ? '••••••••••••' : meta.placeholder}
                        value={svcKeys['picovoice-key'] ?? ''}
                        onChange={e => setSvcKeys(k => ({ ...k, 'picovoice-key': e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSvcSave('picovoice-key')}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                      />
                      <button aria-label="Toggle visibility" onClick={() => setSvcShowKey(s => ({ ...s, 'picovoice-key': !isVisible }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                        {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button aria-label="Save Picovoice key" onClick={() => handleSvcSave('picovoice-key')} disabled={isSaving || !(svcKeys['picovoice-key']?.trim())}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${isSaved ? 'bg-emerald-500' : isSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['picovoice-key']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}>
                      {isSaved ? <Check className="w-4 h-4" /> : isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    {isConfigured && (
                      <button aria-label="Remove Picovoice key" onClick={() => handleSvcRemove('picovoice-key')} disabled={svcDeleting['picovoice-key']}
                        className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all">
                        {svcDeleting['picovoice-key'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {svcErrors['picovoice-key'] && <p className="text-xs text-red-400 mt-1">{svcErrors['picovoice-key']}</p>}
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Free tier: 3 months. Get your key at{' '}
                    <a href="https://console.picovoice.ai/" target="_blank" rel="noopener noreferrer" className="text-forge-400 hover:underline">
                      console.picovoice.ai
                    </a>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Wake Word Controls */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-white">Detection Controls</span>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Keyword: <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">{wakeWordStatus?.keyword ?? 'hey_forge'}</code>
                </p>
              </div>
              <button
                onClick={async () => {
                  setWakeWordStarting(true);
                  try {
                    const endpoint = wakeWordStatus?.running ? '/api/wakeword/stop' : '/api/wakeword/start';
                    await fetch(endpoint, { method: 'POST' });
                    loadWakeWordStatus();
                  } catch { /* ignore */ }
                  setWakeWordStarting(false);
                }}
                disabled={wakeWordStarting}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  wakeWordStatus?.running
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                    : 'bg-forge-500 hover:bg-forge-600 text-white'
                } disabled:opacity-50`}
              >
                {wakeWordStarting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : wakeWordStatus?.running ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                {wakeWordStatus?.running ? 'Stop Listening' : 'Start Listening'}
              </button>
            </div>

            {/* Sensitivity slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-400">Sensitivity</label>
                <span className="text-xs text-zinc-300 font-mono">{wakeWordSensitivity.toFixed(2)}</span>
              </div>
              <input
                title="Wake word sensitivity"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={wakeWordSensitivity}
                onChange={e => setWakeWordSensitivity(parseFloat(e.target.value))}
                onMouseUp={async () => {
                  await fetch('/api/wakeword/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensitivity: wakeWordSensitivity }),
                  });
                  loadWakeWordStatus();
                }}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-forge-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Less sensitive (fewer false positives)</span>
                <span>More sensitive</span>
              </div>
            </div>

            {/* Status info */}
            {wakeWordStatus && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{wakeWordStatus.detectionCount}</p>
                  <p className="text-[10px] text-zinc-500">Detections</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{wakeWordStatus.uptime > 0 ? `${Math.floor(wakeWordStatus.uptime / 60)}m` : '—'}</p>
                  <p className="text-[10px] text-zinc-500">Uptime</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{wakeWordStatus.lastDetection ? new Date(wakeWordStatus.lastDetection).toLocaleTimeString() : '—'}</p>
                  <p className="text-[10px] text-zinc-500">Last Detection</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-forge-500/10 border border-forge-500/20">
              <Info className="w-3.5 h-3.5 text-forge-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-forge-300/90 leading-relaxed">
                Say <strong>&quot;Hey Forge&quot;</strong> to activate hands-free voice commands.
                Works on desktop (microphone), mobile (browser), and embedded devices (Node Protocol).
                Requires Picovoice AccessKey for accurate detection. Without it, a basic energy-based fallback is used.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Node Protocol (IoT/Embedded) */}
      {(() => {
        const nodeKeyVisible = svcShowKey['node-api-key'] ?? false;
        const nodeIsSaving = svcSaving['node-api-key'] ?? false;
        const nodeIsSaved = svcSaved['node-api-key'] ?? false;

        const handleGenerateKey = async () => {
          setNodeGenerating(true);
          try {
            const res = await fetch('/api/nodes/generate-key', { method: 'POST' });
            const data = await res.json() as { success: boolean; key: string };
            if (data.success) {
              setNodeGeneratedKey(data.key);
              loadServices();
            }
          } catch { /* ignore */ }
          setNodeGenerating(false);
        };

        const copyToClipboard = (text: string, label: string) => {
          navigator.clipboard.writeText(text);
          setNodeCopied(label);
          setTimeout(() => setNodeCopied(null), 2000);
        };

        return (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Wifi className="w-5 h-5 text-forge-400" />
                Node Protocol (IoT/Embedded)
              </h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${nodeConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                {nodeConfigured ? 'Active' : 'Not configured'}
              </span>
            </div>

            <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
              {/* Generate or manual key */}
              <div className="p-5 space-y-3">
                <div>
                  <span className="font-medium text-white">API Key</span>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Shared secret for IoT/embedded node agents (Raspberry Pi, Jetson, NanoKVM). Stored encrypted in Vault (AES-256-GCM).
                  </p>
                </div>

                {/* Generate Key button */}
                {!nodeConfigured && !nodeGeneratedKey && (
                  <button
                    onClick={handleGenerateKey}
                    disabled={nodeGenerating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-forge-500 hover:bg-forge-600 text-white text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {nodeGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {nodeGenerating ? 'Generating...' : 'Generate Secure Key'}
                  </button>
                )}

                {/* Show generated key (one-time display) */}
                {nodeGeneratedKey && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-[11px] text-amber-300/90 leading-relaxed">
                        <strong>Copy this key now!</strong> It will not be shown again after you leave this page.
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-emerald-400 font-mono break-all select-all">
                        {nodeGeneratedKey}
                      </code>
                      <button
                        onClick={() => copyToClipboard(nodeGeneratedKey, 'key')}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${nodeCopied === 'key' ? 'bg-emerald-500 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'}`}
                      >
                        {nodeCopied === 'key' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Manual key input (or change existing) */}
                {(nodeConfigured || nodeGeneratedKey) && (
                  <div className="pt-2">
                    <label className="text-xs text-zinc-400 mb-1 block">{nodeConfigured ? 'Change key' : 'Or enter manually'}</label>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={nodeKeyVisible ? 'text' : 'password'}
                          placeholder={nodeConfigured ? '••••••••••••' : 'fnode_...'}
                          value={svcKeys['node-api-key'] ?? ''}
                          onChange={e => setSvcKeys(k => ({ ...k, 'node-api-key': e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleSvcSave('node-api-key')}
                          className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                        />
                        <button
                          aria-label="Toggle visibility"
                          onClick={() => setSvcShowKey(s => ({ ...s, 'node-api-key': !nodeKeyVisible }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                        >
                          {nodeKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <button
                        aria-label="Save node key"
                        onClick={() => handleSvcSave('node-api-key')}
                        disabled={nodeIsSaving || !(svcKeys['node-api-key']?.trim())}
                        className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${nodeIsSaved ? 'bg-emerald-500' : nodeIsSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['node-api-key']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}
                      >
                        {nodeIsSaved ? <Check className="w-4 h-4" /> : nodeIsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </button>
                      {nodeConfigured && (
                        <>
                          <button
                            aria-label="Regenerate key"
                            onClick={handleGenerateKey}
                            disabled={nodeGenerating}
                            className="px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-600 border border-zinc-700 text-xs font-medium transition-all"
                          >
                            {nodeGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          </button>
                          <button
                            aria-label="Remove node key"
                            onClick={() => handleSvcRemove('node-api-key')}
                            disabled={svcDeleting['node-api-key']}
                            className="px-3 py-2 rounded-lg text-red-400 hover:text-white hover:bg-red-500/80 border border-red-500/30 text-xs font-medium transition-all"
                          >
                            {svcDeleting['node-api-key'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                    {svcErrors['node-api-key'] && <p className="text-[11px] text-red-400 mt-1">{svcErrors['node-api-key']}</p>}
                    <p className="text-[10px] text-zinc-500 mt-1">Encrypted in Vault — persists across restarts. No .env file needed.</p>
                  </div>
                )}

                {/* Not configured — manual input fallback */}
                {!nodeConfigured && !nodeGeneratedKey && (
                  <div className="pt-2 border-t border-zinc-800/50">
                    <label className="text-xs text-zinc-400 mb-1 block">Or enter your own key</label>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={nodeKeyVisible ? 'text' : 'password'}
                          placeholder="Enter custom key..."
                          value={svcKeys['node-api-key'] ?? ''}
                          onChange={e => setSvcKeys(k => ({ ...k, 'node-api-key': e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleSvcSave('node-api-key')}
                          className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
                        />
                        <button
                          aria-label="Toggle visibility"
                          onClick={() => setSvcShowKey(s => ({ ...s, 'node-api-key': !nodeKeyVisible }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                        >
                          {nodeKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <button
                        aria-label="Save node key"
                        onClick={() => handleSvcSave('node-api-key')}
                        disabled={nodeIsSaving || !(svcKeys['node-api-key']?.trim())}
                        className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-all ${nodeIsSaved ? 'bg-emerald-500' : nodeIsSaving ? 'bg-forge-500/50 cursor-wait' : svcKeys['node-api-key']?.trim() ? 'bg-forge-500 hover:bg-forge-600' : 'bg-zinc-700 cursor-not-allowed opacity-50'}`}
                      >
                        {nodeIsSaved ? <Check className="w-4 h-4" /> : nodeIsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Connection instructions (shown when configured) */}
              {nodeConfigured && nodeConnInfo && (
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-forge-400" />
                    <span className="font-medium text-white text-sm">Connection Instructions</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">WebSocket URL</span>
                      <div className="flex items-center gap-1.5">
                        <code className="text-zinc-200 font-mono">{nodeConnInfo.wsUrl}</code>
                        <button onClick={() => copyToClipboard(nodeConnInfo.wsUrl || '', 'ws')}
                          className={`p-0.5 rounded ${nodeCopied === 'ws' ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                          {nodeCopied === 'ws' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Key prefix</span>
                      <code className="text-zinc-300 font-mono">{nodeConnInfo.keyPrefix}</code>
                    </div>
                  </div>

                  <div className="mt-2">
                    <p className="text-[11px] text-zinc-400 mb-1.5">Run on your device:</p>
                    <div className="relative">
                      <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-[11px] text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">
{`./forgeai-node \\
  --gateway ${nodeConnInfo.gatewayUrl} \\
  --token YOUR_KEY \\
  --name "My-RaspberryPi"`}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(`./forgeai-node --gateway ${nodeConnInfo.gatewayUrl} --token YOUR_KEY --name "My-Device"`, 'cmd')}
                        className={`absolute top-2 right-2 p-1 rounded ${nodeCopied === 'cmd' ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {nodeCopied === 'cmd' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <p className="text-[10px] text-zinc-500">
                    Supports: Raspberry Pi 2-5, Jetson, BeagleBone, NanoKVM, any Linux ARM/AMD64 device. Binary ~5MB, zero dependencies.
                  </p>
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* Config Sync */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-forge-400" />
          Config Sync
        </h2>
        <div className="rounded-xl border border-zinc-800 p-5 space-y-5">
          <p className="text-xs text-zinc-500">Securely transfer all Gateway configurations (LLM keys, TTS, system settings) between ForgeAI instances using encrypted one-time sync codes.</p>

          {syncSummary && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-zinc-400">
                <span className="text-white font-medium">{syncSummary.total} keys</span> stored in Vault
                {Object.entries(syncSummary.categories).length > 0 && (
                  <span> — {Object.entries(syncSummary.categories).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                )}
              </div>
            </div>
          )}

          {/* Push Config to Remote */}
          <div className="space-y-2">
            <p className="text-sm text-white font-medium">Push Config to Remote</p>
            <p className="text-[11px] text-zinc-500">Send this Gateway's config to another Gateway. The remote must have a sync code ready.</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="http://remote-ip:18800" value={syncRemoteUrl} onChange={e => setSyncRemoteUrl(e.target.value)}
                className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
              <input type="text" placeholder="SYNC CODE" maxLength={8} value={syncCode} onChange={e => setSyncCode(e.target.value.toUpperCase())}
                className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-forge-500/50" />
            </div>
            <button onClick={handleSyncPush} disabled={syncStatus === 'pushing' || !syncRemoteUrl.trim() || !syncCode.trim()}
              className="px-4 py-2 rounded-lg bg-forge-500 text-white text-sm font-medium hover:bg-forge-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
              {syncStatus === 'pushing' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</> : <><ExternalLink className="w-3.5 h-3.5" /> Push Config</>}
            </button>
          </div>

          {/* Generate Receive Code */}
          <div className="space-y-2 pt-3 border-t border-zinc-800">
            <p className="text-sm text-white font-medium">Receive from Another Gateway</p>
            <p className="text-[11px] text-zinc-500">Generate a one-time code so another Gateway can push its config here. Code expires in 5 minutes.</p>
            <button onClick={handleSyncGenerate} disabled={syncStatus === 'generating'}
              className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
              {syncStatus === 'generating' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</> : <><Key className="w-3.5 h-3.5" /> Generate Sync Code</>}
            </button>
            {syncGeneratedCode && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-forge-500/10 border border-forge-500/30">
                <code className="text-lg font-mono font-bold text-forge-400 tracking-[0.3em] select-all">{syncGeneratedCode}</code>
                <button aria-label="Copy sync code" onClick={() => { navigator.clipboard.writeText(syncGeneratedCode); }}
                  className="p-1 text-zinc-400 hover:text-white transition-colors">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Status message */}
          {syncMessage && (
            <div className={`text-xs px-3 py-2 rounded-lg ${syncStatus === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : syncStatus === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
              {syncMessage}
            </div>
          )}
        </div>
      </section>

      {/* Database */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-forge-400" />
          {t('settings.database')}
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
