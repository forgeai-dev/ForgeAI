import { useState, useEffect, useRef } from 'react';

// Tauri API will be available at runtime via window.__TAURI__
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
  }
}

const invoke = (cmd: string, args?: Record<string, unknown>) =>
  window.__TAURI__?.core.invoke(cmd, args) ?? Promise.reject('Tauri not available');

interface CompanionStatus {
  connected: boolean;
  gateway_url: string | null;
  safety_active: boolean;
  version: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

type View = 'chat' | 'setup' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadStatus = async () => {
    try {
      const s = (await invoke('get_status')) as CompanionStatus;
      setStatus(s);
      if (!s.connected) setView('setup');
    } catch {
      setView('setup');
    }
  };

  const handlePair = async () => {
    setPairing(true);
    setPairError('');
    try {
      await invoke('pair_with_gateway', {
        gatewayUrl: gatewayUrl.trim(),
        pairingCode: pairingCode.trim(),
      });
      await loadStatus();
      setView('chat');
      setMessages([
        {
          role: 'system',
          content: 'Connected to ForgeAI Gateway! Say something or type a command.',
          timestamp: Date.now(),
        },
      ]);
    } catch (e) {
      setPairError(String(e));
    }
    setPairing(false);
  };

  const handleDisconnect = async () => {
    try {
      await invoke('disconnect');
      setStatus(null);
      setView('setup');
      setMessages([]);
    } catch {}
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, timestamp: Date.now() },
    ]);
    setLoading(true);

    try {
      // For now, echo back — will be replaced by WebSocket message
      const result = (await invoke('execute_action', {
        request: {
          action: 'shell',
          command: text,
          path: null,
          content: null,
          process_name: null,
          app_name: null,
          confirmed: false,
        },
      })) as { success: boolean; output: string; safety: { risk: string; reason: string } };

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.success
            ? result.output
            : `⚠️ ${result.output}`,
          timestamp: Date.now(),
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${e}`, timestamp: Date.now() },
      ]);
    }
    setLoading(false);
  };

  // ─── Setup View ───
  if (view === 'setup') {
    return (
      <div className="w-[380px] h-[520px] bg-zinc-950/95 backdrop-blur-xl rounded-2xl border border-zinc-800 flex flex-col overflow-hidden">
        <div data-tauri-drag-region className="px-5 py-4 border-b border-zinc-800">
          <h1 className="text-lg font-bold text-white">ForgeAI Companion</h1>
          <p className="text-[11px] text-zinc-500">Connect to your ForgeAI Gateway</p>
        </div>

        <div className="flex-1 p-5 flex flex-col justify-center gap-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/20 flex items-center justify-center mb-2">
            <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.44a4.5 4.5 0 00-6.364-6.364L4.5 8.25" />
            </svg>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Gateway URL</label>
            <input
              type="url"
              placeholder="http://127.0.0.1:18800 or https://your-vps.com:18800"
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Pairing Code</label>
            <input
              type="text"
              placeholder="6-digit code from Dashboard"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              maxLength={6}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-center text-lg tracking-[0.3em]"
            />
          </div>

          {pairError && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{pairError}</p>
          )}

          <button
            onClick={handlePair}
            disabled={pairing || !gatewayUrl.trim() || pairingCode.length < 6}
            className="w-full py-2.5 rounded-lg text-white text-sm font-medium bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-700 disabled:cursor-not-allowed transition-all"
          >
            {pairing ? 'Connecting...' : 'Connect'}
          </button>

          <p className="text-[10px] text-zinc-600 text-center">
            Generate a pairing code at Dashboard → Settings → Pairing
          </p>
        </div>
      </div>
    );
  }

  // ─── Chat View ───
  return (
    <div className="w-[380px] h-[520px] bg-zinc-950/95 backdrop-blur-xl rounded-2xl border border-zinc-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div data-tauri-drag-region className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-zinc-950" />
          </div>
          <div>
            <p className="text-sm font-medium text-white leading-tight">ForgeAI</p>
            <p className="text-[10px] text-emerald-400">Connected</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {view === 'settings' && (
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Gateway</span>
            <span className="text-xs text-zinc-300 font-mono">{status?.gateway_url || '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Safety System</span>
            <span className="text-xs text-emerald-400">Active</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Version</span>
            <span className="text-xs text-zinc-300">{status?.version || '—'}</span>
          </div>
          <button
            onClick={handleDisconnect}
            className="w-full py-2 rounded-lg text-red-400 text-xs font-medium border border-red-500/30 hover:bg-red-500/10 transition-all"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-3 animate-float">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <p className="text-sm text-zinc-400 font-medium">Hey! I'm ForgeAI</p>
            <p className="text-[11px] text-zinc-600 mt-1 max-w-[240px]">
              Ask me anything or give me a command. I can manage files, launch apps, control your smart home, and more.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-500 text-white rounded-br-md'
                  : msg.role === 'system'
                  ? 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/50 rounded-bl-md'
                  : 'bg-zinc-800 text-zinc-200 rounded-bl-md'
              }`}
            >
              <pre className="whitespace-pre-wrap font-[inherit]">{msg.content}</pre>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce bounce-dot-1" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce bounce-dot-2" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce bounce-dot-3" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-9 h-9 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-700 flex items-center justify-center transition-all"
            title="Send message"
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
