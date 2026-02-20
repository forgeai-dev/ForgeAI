import { useEffect, useState, useRef } from 'react';
import { Mic, Volume2, Play, Square, Loader2, Settings2, RefreshCw, Check, AudioLines } from 'lucide-react';

interface VoiceConfig {
  ttsProvider: string;
  sttProvider: string;
  ttsVoice: string;
  ttsSpeed: number;
  language: string;
  enabled: boolean;
}

interface ProviderStatus {
  provider: string;
  configured: boolean;
}

interface VoiceInfo {
  id: string;
  name: string;
  language: string;
}

export function VoicePage() {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [providers, setProviders] = useState<{ tts: ProviderStatus[]; stt: ProviderStatus[] }>({ tts: [], stt: [] });
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // TTS test
  const [ttsText, setTtsText] = useState('Hello! I am ForgeAI, your AI assistant.');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // STT test
  const [recording, setRecording] = useState(false);
  const [sttResult, setSttResult] = useState<string | null>(null);
  const [sttBusy, setSttBusy] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfgRes, voicesRes] = await Promise.all([
        fetch('/api/voice/config').then(r => r.json()),
        fetch('/api/voice/voices').then(r => r.json()),
      ]);
      setConfig(cfgRes.config);
      setProviders(cfgRes.providers ?? { tts: [], stt: [] });
      setVoices(voicesRes.voices ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const saveConfig = async (update: Partial<VoiceConfig>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/voice/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await res.json() as { config: VoiceConfig };
      setConfig(data.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const toggleEnabled = () => {
    if (!config) return;
    saveConfig({ enabled: !config.enabled });
  };

  const testTTS = async () => {
    if (!ttsText.trim()) return;
    setTtsBusy(true);
    setTtsAudioUrl(null);
    try {
      const res = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ttsText }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setTtsAudioUrl(url);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play();
        }
      }
    } catch { /* ignore */ }
    setTtsBusy(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        setSttBusy(true);
        try {
          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64, format: 'webm' }),
          });
          const data = await res.json() as { text?: string; error?: string };
          setSttResult(data.text ?? data.error ?? 'No result');
        } catch (err) {
          setSttResult(`Error: ${err}`);
        }
        setSttBusy(false);
      };
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setSttResult(null);
    } catch (err) {
      setSttResult(`Microphone error: ${err}`);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading voice engine...
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forge-500/20 flex items-center justify-center">
            <AudioLines className="w-5 h-5 text-forge-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Voice</h1>
            <p className="text-sm text-zinc-500">Speech-to-Text (STT) & Text-to-Speech (TTS)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>}
          <button
            aria-label="Toggle voice engine"
            onClick={toggleEnabled}
            className={`relative w-12 h-7 rounded-full transition-colors ${config?.enabled ? 'bg-forge-500' : 'bg-zinc-700'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-all ${config?.enabled ? 'right-1' : 'left-1'}`} />
          </button>
          <span className={`text-xs font-medium ${config?.enabled ? 'text-forge-400' : 'text-zinc-500'}`}>
            {config?.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>

      {/* Configuration */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-forge-400" />
          Configuration
        </h2>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-5">
          {/* TTS Provider */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">TTS Provider</label>
              <select
                title="TTS Provider"
                value={config?.ttsProvider ?? 'openai'}
                onChange={async (e) => {
                  const newProvider = e.target.value;
                  await saveConfig({ ttsProvider: newProvider });
                  // Reload voices for the new provider and auto-select the first one
                  try {
                    const vRes = await fetch('/api/voice/voices').then(r => r.json());
                    const newVoices = vRes.voices ?? [];
                    setVoices(newVoices);
                    if (newVoices.length > 0) {
                      saveConfig({ ttsVoice: newVoices[0].id });
                    }
                  } catch { /* ignore */ }
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              >
                {providers.tts.map(p => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider === 'openai' ? 'OpenAI TTS' : p.provider === 'elevenlabs' ? 'ElevenLabs' : p.provider === 'kokoro' ? 'Kokoro (Local)' : p.provider === 'piper' ? 'Piper (VPS)' : p.provider}
                    {p.configured ? ' ✓' : ' (not configured)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">STT Provider</label>
              <select
                title="STT Provider"
                value={config?.sttProvider ?? 'whisper'}
                onChange={(e) => saveConfig({ sttProvider: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              >
                {providers.stt.map(p => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider === 'whisper' ? 'OpenAI Whisper' : p.provider === 'openai' ? 'OpenAI' : p.provider}
                    {p.configured ? ' ✓' : ' (not configured)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Voice + Speed */}
          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Voice</label>
              <select
                title="Voice"
                value={config?.ttsVoice ?? 'alloy'}
                onChange={(e) => saveConfig({ ttsVoice: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              >
                {voices.map(v => (
                  <option key={v.id} value={v.id}>{v.name} ({v.language})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Speed: {config?.ttsSpeed?.toFixed(1) ?? '1.0'}x</label>
              <input
                type="range"
                title="TTS Speed"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config?.ttsSpeed ?? 1.0}
                onChange={(e) => saveConfig({ ttsSpeed: parseFloat(e.target.value) })}
                className="w-full accent-forge-500"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Language</label>
              <select
                title="Language"
                value={config?.language ?? 'en'}
                onChange={(e) => saveConfig({ language: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              >
                <option value="en">English</option>
                <option value="pt">Portuguese</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
          </div>

          {/* Provider status */}
          <div className="flex items-center gap-4 pt-2 border-t border-zinc-800">
            <span className="text-xs text-zinc-500">Provider Status:</span>
            {providers.tts.map(p => (
              <span key={`tts-${p.provider}`} className={`text-xs px-2 py-0.5 rounded-full ${p.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
                TTS: {p.provider} {p.configured ? '✓' : '✗'}
              </span>
            ))}
            {providers.stt.map(p => (
              <span key={`stt-${p.provider}`} className={`text-xs px-2 py-0.5 rounded-full ${p.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
                STT: {p.provider} {p.configured ? '✓' : '✗'}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Test TTS */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-forge-400" />
          Test TTS (Text-to-Speech)
        </h2>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-3">
          <textarea
            value={ttsText}
            onChange={(e) => setTtsText(e.target.value)}
            placeholder="Type text to synthesize..."
            rows={2}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={testTTS}
              disabled={ttsBusy || !config?.enabled}
              className="flex items-center gap-2 px-4 py-2 bg-forge-600 hover:bg-forge-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ttsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Synthesize & Play
            </button>
            {ttsAudioUrl && (
              <audio ref={audioRef} controls className="h-8 flex-1" src={ttsAudioUrl} />
            )}
          </div>
          {!config?.enabled && (
            <p className="text-xs text-amber-400">Enable voice engine to test TTS</p>
          )}
        </div>
      </section>

      {/* Test STT */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Mic className="w-5 h-5 text-forge-400" />
          Test STT (Speech-to-Text)
        </h2>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-3">
          <div className="flex items-center gap-3">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={!config?.enabled || sttBusy}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mic className="w-4 h-4" />
                Start Recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white rounded-lg text-sm font-medium transition-colors animate-pulse"
              >
                <Square className="w-4 h-4" />
                Stop Recording
              </button>
            )}
            {sttBusy && <span className="text-xs text-zinc-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Transcribing...</span>}
            <button onClick={loadAll} className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded transition-colors" title="Reload config">
              <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {sttResult && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3">
              <p className="text-xs text-zinc-500 mb-1">Transcription:</p>
              <p className="text-sm text-white">{sttResult}</p>
            </div>
          )}

          {!config?.enabled && (
            <p className="text-xs text-amber-400">Enable voice engine to test STT</p>
          )}
        </div>
      </section>

      {/* Available Voices */}
      {voices.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Available Voices ({voices.length})</h2>
          <div className="grid grid-cols-3 gap-2">
            {voices.map(v => (
              <div key={v.id}
                className={`rounded-lg border px-3 py-2 cursor-pointer transition-all ${
                  config?.ttsVoice === v.id
                    ? 'border-forge-500 bg-forge-500/10'
                    : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-600'
                }`}
                onClick={() => saveConfig({ ttsVoice: v.id })}
              >
                <p className="text-sm text-white font-medium">{v.name}</p>
                <p className="text-[10px] text-zinc-500">{v.id} · {v.language}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
