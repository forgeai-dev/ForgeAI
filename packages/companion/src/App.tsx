import { useState, useEffect, useRef, useCallback } from 'react';
import { Flame, Send, Settings, X, Minus, Square, Link, Key, ArrowRight, Mic, MicOff, Volume2, Download, ZoomIn, MessageSquare, Plus, Clock, Trash2 } from 'lucide-react';

// Tauri API
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    __showAbout?: () => void;
  }
}

const invoke = (cmd: string, args?: Record<string, unknown>) =>
  window.__TAURI__?.core.invoke(cmd, args) ?? Promise.reject('Tauri not available');

interface CompanionStatus {
  connected: boolean;
  gateway_url: string | null;
  companion_id: string | null;
  auth_token: string | null;
  safety_active: boolean;
  version: string;
}

interface AgentStep {
  type: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  message?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  images?: string[]; // URLs or base64 data URIs for screenshots
  steps?: AgentStep[];
}

type View = 'chat' | 'setup' | 'settings' | 'about';

// ─── Drag ───
const startDrag = (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button')) return;
  // Try custom command first, then plugin API as fallback
  invoke('window_start_drag').catch(() => {
    invoke('plugin:window|start_dragging').catch(() => {});
  });
};

// ─── Title Bar ───
function TitleBar({ children }: { children?: React.ReactNode }) {
  return (
    <div
      onMouseDown={startDrag}
      className="app-titlebar h-11 flex items-center justify-between pr-4 shrink-0 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2.5 select-none pointer-events-none">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center shrink-0">
          <Flame className="w-3 h-3 text-white" />
        </div>
        <span className="text-[13px] text-zinc-300 font-medium">ForgeAI Companion</span>
      </div>
      <div className="flex items-center gap-0.5">
        {children}
        <button
          onClick={() => invoke('window_minimize')}
          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => invoke('window_maximize')}
          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => invoke('window_hide')}
          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          title="Close to tray"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

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
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try { return localStorage.getItem('forgeai_session_id'); } catch { return null; }
  });
  const [recording, setRecording] = useState(false);
  const [voiceMode, setVoiceMode] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState('Hey Forge');
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>([0,0,0,0,0,0,0,0,0,0,0,0]);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  // Config Sync state
  const [syncRemoteUrl, setSyncRemoteUrl] = useState('');
  const [syncCode, setSyncCode] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pushing' | 'generating' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncGeneratedCode, setSyncGeneratedCode] = useState('');
  // Real-time agent progress via WebSocket
  const [agentProgress, setAgentProgress] = useState<{ tool?: string; status?: string } | null>(null);
  const [stepsExpanded, setStepsExpanded] = useState<Record<number, boolean>>({});
  // Session history state
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string; lastMessage?: string }>>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  const showAbout = useCallback(() => setView('about'), []);

  // Listen for Rust events: voice-state, voice-audio-level, wake-word-detected
  useEffect(() => {
    window.__showAbout = showAbout;
    loadStatus();

    const cleanups: (() => void)[] = [];
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        // Voice state transitions from Rust
        const u1 = await listen<{ state: string }>('voice-state', (ev) => {
          const s = ev.payload.state as 'idle' | 'listening' | 'processing' | 'speaking';
          setVoiceMode(s);
          setRecording(s === 'listening');
          if (s === 'idle') setAudioLevels([0,0,0,0,0,0,0,0,0,0,0,0]);
        });
        cleanups.push(u1 as unknown as () => void);

        // Real-time audio levels for waveform
        const u2 = await listen<{ level: number; done: boolean }>('voice-audio-level', (ev) => {
          if (ev.payload.done) return;
          setAudioLevels((prev) => {
            const next = [...prev.slice(1), ev.payload.level];
            return next;
          });
        });
        cleanups.push(u2 as unknown as () => void);

        // Wake word detection
        const u3 = await listen('wake-word-detected', () => {
          if (voiceModeRef.current === 'idle') {
            handleVoiceJarvis();
          }
        });
        cleanups.push(u3 as unknown as () => void);
      } catch {
        // Tauri event API not available
      }
    })();

    return () => {
      delete window.__showAbout;
      cleanups.forEach((fn) => fn());
    };
  }, [showAbout]);

  // Persist sessionId to localStorage for memory across restarts
  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem('forgeai_session_id', sessionId);
      else localStorage.removeItem('forgeai_session_id');
    } catch {}
  }, [sessionId]);

  // Load session list from Gateway via Rust backend
  const loadSessions = useCallback(async () => {
    if (!status?.connected) return;
    setSessionsLoading(true);
    try {
      const data = (await invoke('list_sessions')) as { sessions?: Array<{ id: string; title: string; messageCount: number; updatedAt: string; lastMessage?: string }> };
      if (data.sessions) {
        setSessions(data.sessions.slice(0, 50));
      }
    } catch (err) {
      console.error('[ForgeAI] Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  }, [status?.connected]);

  // Load session history when selecting a session via Rust backend
  const loadSessionHistory = useCallback(async (sid: string) => {
    setHistoryLoading(true);
    try {
      const data = (await invoke('get_session_history', { sessionId: sid })) as { messages?: Array<any> };
      if (data.messages && Array.isArray(data.messages)) {
        const mapped: ChatMessage[] = data.messages.map((m: any) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content || '',
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          steps: m.steps,
        }));
        setMessages(mapped);
        setSessionId(sid);
        setStepsExpanded({});
      }
    } catch (err) {
      console.error('[ForgeAI] Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
      setShowSessions(false);
    }
  }, []);

  // Start a new session
  const handleNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStepsExpanded({});
    setAgentProgress(null);
    setShowSessions(false);
    try { localStorage.removeItem('forgeai_session_id'); } catch {}
    // Refresh session list so the previous conversation appears
    setTimeout(() => loadSessions(), 300);
  }, [loadSessions]);

  // Delete a session via Rust backend
  const handleDeleteSession = useCallback(async (sid: string) => {
    try {
      await invoke('delete_session', { sessionId: sid });
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (sessionId === sid) handleNewSession();
    } catch (err) {
      console.error('[ForgeAI] Failed to delete session:', err);
    }
  }, [sessionId, handleNewSession]);

  // Load last session history and session list on connect
  useEffect(() => {
    if (status?.connected) {
      loadSessions();
      if (sessionId) {
        loadSessionHistory(sessionId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WebSocket connection — connects immediately when gateway_url is available
  // This ensures the CompanionBridge is registered BEFORE any chat message is sent
  useEffect(() => {
    const gwUrl = status?.gateway_url;
    if (!gwUrl) return;

    const companionId = status?.companion_id || '';
    const authToken = status?.auth_token || '';
    const params = new URLSearchParams();
    if (companionId) params.set('companionId', companionId);
    if (authToken) params.set('token', authToken);
    const qs = params.toString();
    const wsUrl = gwUrl.replace(/^http/, 'ws') + '/ws' + (qs ? `?${qs}` : '');
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[ForgeAI] WS connected', companionId ? `(companion: ${companionId})` : '');
          // Subscribe to current session if available
          if (sessionId) {
            ws.send(JSON.stringify({ type: 'session.subscribe', sessionId }));
          }
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);

            // Handle action_request from Gateway — execute locally via Rust and send result back
            if (msg.type === 'action_request' && msg.requestId) {
              console.log('[ForgeAI] Action request:', msg.action, msg.requestId);
              invoke('execute_action', {
                request: {
                  action: msg.action || '',
                  path: msg.params?.path || null,
                  command: msg.params?.command || null,
                  content: msg.params?.content || null,
                  process_name: msg.params?.process_name || null,
                  app_name: msg.params?.app_name || null,
                  confirmed: true,
                },
              }).then((result: unknown) => {
                const r = result as { success: boolean; output: string };
                ws.send(JSON.stringify({
                  type: 'action_result',
                  requestId: msg.requestId,
                  success: r.success,
                  output: r.output,
                }));
                console.log('[ForgeAI] Action result sent:', msg.action, r.success);
              }).catch((err: unknown) => {
                ws.send(JSON.stringify({
                  type: 'action_result',
                  requestId: msg.requestId,
                  success: false,
                  output: `Companion error: ${err}`,
                }));
              });
              return;
            }

            if (msg.type === 'agent.step' && msg.step) {
              const step = msg.step as AgentStep;
              if (step.type === 'tool_call') {
                setAgentProgress({ tool: step.tool, status: 'calling' });
              } else if (step.type === 'tool_result') {
                setAgentProgress({ tool: step.tool, status: step.success ? 'done' : 'failed' });
              }
            } else if (msg.type === 'agent.progress' && msg.progress) {
              const p = msg.progress as Record<string, string>;
              if (p.currentTool) {
                setAgentProgress({ tool: p.currentTool, status: p.status || 'working' });
              }
            } else if (msg.type === 'agent.done') {
              setAgentProgress(null);
            }
          } catch {}
        };

        ws.onclose = () => {
          wsRef.current = null;
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch {}
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [status?.gateway_url, status?.companion_id, status?.auth_token]);

  // Subscribe to session when sessionId changes (WS already connected)
  useEffect(() => {
    if (sessionId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'session.subscribe', sessionId }));
    }
  }, [sessionId]);

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
      // Force the Rust WS loop to reconnect with fresh credentials
      await invoke('force_reconnect_gateway_ws').catch(() => {});
      await loadStatus();
      setView('chat');
      setMessages([
        {
          role: 'system',
          content: 'Connected to ForgeAI Gateway! Say something or type a command.',
          timestamp: Date.now(),
        },
      ]);
      // Wake word is OFF by default — user can enable in Settings
    } catch (e) {
      setPairError(String(e));
    }
    setPairing(false);
  };

  const handleDisconnect = async () => {
    try {
      await invoke('disconnect');
      setStatus(null);
      setSessionId(null);
      setView('setup');
      setMessages([]);
    } catch {}
  };

  // Extract local screenshot file paths from agent steps and/or message text
  const extractScreenshotPaths = (steps?: Array<{ type: string; result?: unknown }>, content?: string): string[] => {
    const paths: string[] = [];
    const seen = new Set<string>();

    const addPath = (rawPath: string) => {
      // Normalize: unescape double-backslashes from JSON, keep OS-native separators
      const normalized = rawPath.replace(/\\\\/g, '\\');
      if (!seen.has(normalized) && normalized.includes('.forgeai')) {
        seen.add(normalized);
        paths.push(normalized);
      }
    };

    // Extract "path":"..." or "screenshot":"..." from JSON strings
    const extractFromJson = (str: string) => {
      const jsonPattern = /"(?:path|screenshot)"\s*:\s*"([^"]+\.(?:png|jpg|jpeg|webp))"/gi;
      let m;
      while ((m = jsonPattern.exec(str)) !== null) addPath(m[1]);
    };

    // Extract paths in backticks or markdown ![](path) from text
    const extractFromText = (str: string) => {
      const backtickPattern = /`([^`]*?\.forgeai[\\\/]screenshots[\\\/][^`]*?\.(?:png|jpg|jpeg|webp))`/gi;
      let m;
      while ((m = backtickPattern.exec(str)) !== null) addPath(m[1]);
      // Markdown image syntax: ![alt](path)
      const mdImgPattern = /!\[[^\]]*\]\(([^)]*?\.forgeai[\\\/]screenshots[\\\/][^)]*?\.(?:png|jpg|jpeg|webp))\)/gi;
      while ((m = mdImgPattern.exec(str)) !== null) addPath(m[1]);
    };

    // 1) Extract from steps (tool results)
    if (steps && steps.length > 0) {
      console.log('[ForgeAI] Steps received:', steps.length);
      for (const step of steps) {
        if (step.type === 'tool_result' && step.result) {
          const str = typeof step.result === 'string' ? step.result : JSON.stringify(step.result);
          extractFromJson(str);
        }
      }
    }

    // 2) Fallback: extract from message text content
    if (content) {
      extractFromText(content);
      extractFromJson(content);
    }

    console.log('[ForgeAI] Extracted screenshot paths:', paths);
    return paths;
  };

  // Load screenshot files via Rust backend → base64 data URLs
  // Tries local file first; if not found, fetches from Gateway HTTP (remote VPS support)
  const loadScreenshots = async (filePaths: string[]): Promise<string[]> => {
    if (filePaths.length === 0) return [];
    const gwUrl = status?.gateway_url || gatewayUrl || undefined;
    const loaded = await Promise.all(
      filePaths.map(async (p) => {
        try {
          const dataUrl = (await invoke('read_screenshot', { path: p, gatewayUrl: gwUrl })) as string;
          console.log('[ForgeAI] Loaded screenshot:', p.split(/[\\\/]/).pop());
          return dataUrl;
        } catch (e) {
          console.error('[ForgeAI] Failed to load screenshot:', p, e);
          return null;
        }
      })
    );
    return loaded.filter((u): u is string => u !== null);
  };

  // ─── Config Sync handlers ───
  const handleSyncPush = async () => {
    if (!syncRemoteUrl.trim() || !syncCode.trim()) return;
    const gwUrl = status?.gateway_url || gatewayUrl;
    if (!gwUrl) { setSyncMessage('Not connected to a Gateway'); setSyncStatus('error'); return; }

    setSyncStatus('pushing');
    setSyncMessage('');
    try {
      const resp = await fetch(`${gwUrl}/api/config/sync-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteUrl: syncRemoteUrl.trim(), syncCode: syncCode.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        setSyncStatus('success');
        setSyncMessage(`✓ ${data.pushed} configs pushed. ${data.imported} imported on remote.`);
      } else {
        setSyncStatus('error');
        setSyncMessage(data.error || 'Sync failed');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Network error');
    }
  };

  const handleSyncGenerate = async () => {
    const gwUrl = status?.gateway_url || gatewayUrl;
    if (!gwUrl) { setSyncMessage('Not connected to a Gateway'); setSyncStatus('error'); return; }

    setSyncStatus('generating');
    setSyncGeneratedCode('');
    try {
      const resp = await fetch(`${gwUrl}/api/config/sync-init`, { method: 'POST' });
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
      const result = (await invoke('chat_send', {
        message: text,
        sessionId,
      })) as {
        content: string;
        sessionId: string;
        model?: string;
        blocked?: boolean;
        blockReason?: string;
        steps?: AgentStep[];
      };

      if (!sessionId && result.sessionId) setSessionId(result.sessionId);

      const responseContent = result.blocked ? `🛡️ Blocked: ${result.blockReason || 'Safety filter'}` : result.content;
      const screenshotPaths = extractScreenshotPaths(result.steps, responseContent);
      const images = await loadScreenshots(screenshotPaths);
      setAgentProgress(null);

      // Filter steps to only show tool_call and tool_result pairs
      const toolSteps = (result.steps || []).filter(
        (s) => s.type === 'tool_call' || s.type === 'tool_result'
      );

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: responseContent,
          timestamp: Date.now(),
          images: images.length > 0 ? images : undefined,
          steps: toolSteps.length > 0 ? toolSteps : undefined,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${e}`, timestamp: Date.now() },
      ]);
    }
    setLoading(false);
    // Refresh session list so this conversation appears in history
    loadSessions();
  };

  // Full Jarvis pipeline: record → STT → AI → TTS → play
  // State transitions (listening/processing/speaking/idle) are driven by Rust events
  const handleVoiceJarvis = async () => {
    if (voiceModeRef.current !== 'idle') return;

    try {
      const result = (await invoke('chat_voice', { sessionId })) as {
        transcription: string;
        content: string;
        sessionId: string;
        ttsAudio?: string;
        steps?: Array<{ type: string; result?: unknown }>;
      };

      if (!sessionId && result.sessionId) setSessionId(result.sessionId);

      if (result.transcription) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: `🎤 ${result.transcription}`, timestamp: Date.now() },
        ]);
      }

      if (result.content) {
        const screenshotPaths = extractScreenshotPaths(result.steps, result.content);
        const images = await loadScreenshots(screenshotPaths);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.content, timestamp: Date.now(), images: images.length > 0 ? images : undefined },
        ]);
      }
    } catch (e) {
      const errMsg = String(e);
      if (!errMsg.includes('too short')) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Voice error: ${errMsg}`, timestamp: Date.now() },
        ]);
      }
    }
  };

  const handleMicToggle = async () => {
    if (voiceMode !== 'idle') {
      setVoiceMode('idle');
      setRecording(false);
      setAudioLevels([0,0,0,0,0,0,0,0,0,0,0,0]);
      try { await invoke('voice_stop'); } catch {}
    } else {
      handleVoiceJarvis();
    }
  };

  // Start wake word detection when connected
  const startWakeWord = async () => {
    try {
      await invoke('wake_word_start');
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: '🎙️ Voice activated — say "Hey Forge" to talk.', timestamp: Date.now() },
      ]);
    } catch {
      // Wake word not available (no mic or already running)
    }
  };

  // ─── About View ───
  if (view === 'about') {
    return (
      <div className="w-full h-full bg-zinc-950 flex flex-col overflow-hidden">
        <TitleBar />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center mb-5 shadow-lg shadow-orange-500/20">
            <Flame className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-lg font-bold text-white">ForgeAI Companion</h2>
          <p className="text-xs text-zinc-500 mt-1">Version {status?.version || '1.0.0'}</p>
          <div className="mt-6 w-full space-y-2 text-xs">
            <div className="flex justify-between py-2 px-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50">
              <span className="text-zinc-500">Safety System</span>
              <span className="text-emerald-400">Active</span>
            </div>
            <div className="flex justify-between py-2 px-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50">
              <span className="text-zinc-500">Platform</span>
              <span className="text-zinc-300">Windows x64</span>
            </div>
            <div className="flex justify-between py-2 px-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50">
              <span className="text-zinc-500">Engine</span>
              <span className="text-zinc-300">Tauri 2 + Rust</span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 mt-6">getforgeai.com</p>
          <button
            onClick={() => setView(status?.connected ? 'chat' : 'setup')}
            className="mt-4 px-6 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-all"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ─── Setup View ───
  if (view === 'setup') {
    return (
      <div className="w-full h-full bg-zinc-950 flex flex-col overflow-hidden">
        <TitleBar />

        {/* Content */}
        <div className="flex-1 flex flex-col items-center setup-content">
          {/* Logo + title */}
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center shadow-lg shadow-orange-500/20 mb-4">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Connect to Gateway</h1>
          <p className="text-sm text-zinc-500 mt-1">Enter your Gateway URL and pairing code</p>

          {/* Form card */}
          <div className="setup-card setup-card-mt">
            {/* Gateway URL */}
            <div className="setup-field-gap">
              <label className="setup-label">Gateway URL</label>
              <div className="setup-input-wrap">
                <div className="setup-input-icon">
                  <Link className="w-4 h-4" />
                </div>
                <input
                  type="url"
                  placeholder="http://localhost:18800"
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  className="setup-input"
                />
              </div>
            </div>

            {/* Pairing Code */}
            <div>
              <label className="setup-label">Pairing Code</label>
              <div className="setup-input-wrap">
                <div className="setup-input-icon">
                  <Key className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  placeholder="FORGE-ABCD-1234"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  maxLength={20}
                  className="setup-input setup-input-tracking"
                />
              </div>
            </div>
          </div>

          {pairError && (
            <div className="setup-error">
              {pairError}
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={handlePair}
            disabled={pairing || !gatewayUrl.trim() || pairingCode.length < 6}
            className="setup-btn setup-btn-mt"
          >
            {pairing ? 'Connecting...' : 'Connect'}
            {!pairing && (
              <span className="setup-btn-arrow">
                <ArrowRight className="w-5 h-5 text-white" />
              </span>
            )}
          </button>

          {/* Status indicator */}
          <div className="flex items-center gap-2 mt-4">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-zinc-400">
              <span className="text-emerald-400 font-medium">Ready</span> to connect
            </span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer */}
          <div className="flex items-center gap-3 text-[12px] text-zinc-600 pt-4">
            <span>Dashboard</span>
            <span className="text-zinc-700">&bull;</span>
            <span>Settings</span>
            <span className="text-zinc-700">&bull;</span>
            <span>Pairing</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Chat View ───
  return (
    <div className="w-full h-full bg-zinc-950 flex flex-col overflow-hidden relative">
      {/* Header */}
      <TitleBar>
        <button
          onClick={() => { setShowSessions(!showSessions); if (!showSessions) loadSessions(); }}
          className={`w-8 h-8 flex items-center justify-center hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors ${showSessions ? 'text-orange-400' : 'text-zinc-500'}`}
          title="Chat History"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <button
          onClick={handleNewSession}
          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </TitleBar>

      {/* Session Sidebar */}
      {showSessions && (
        <div className="session-sidebar">
          <div className="session-sidebar-header">
            <span className="session-sidebar-title">Chat History</span>
            <button onClick={() => setShowSessions(false)} className="session-sidebar-close" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {sessionsLoading ? (
            <div className="session-sidebar-loading">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="session-sidebar-empty">No previous chats</div>
          ) : (
            <div className="session-sidebar-list">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`session-item ${sessionId === s.id ? 'session-item-active' : ''}`}
                  onClick={() => loadSessionHistory(s.id)}
                >
                  <div className="session-item-content">
                    <div className="session-item-preview">
                      {s.title || s.lastMessage || s.id.slice(0, 20) + '...'}
                    </div>
                    <div className="session-item-meta">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                      <span className="session-item-count">{s.messageCount} msgs</span>
                    </div>
                  </div>
                  <button
                    className="session-item-delete"
                    title="Delete session"
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History loading overlay */}
      {historyLoading && (
        <div className="session-loading-overlay">
          <div className="loading-dots">
            <div className="loading-dot" />
            <div className="loading-dot" />
            <div className="loading-dot" />
          </div>
          <span className="session-loading-text">Loading conversation...</span>
        </div>
      )}

      {/* Settings View */}
      {view === 'settings' && (
        <div className="settings-view">
          {/* Voice Section */}
          <div className="settings-section">
            <div className="settings-section-title">Voice Assistant</div>

            <div className="settings-row">
              <div className="settings-row-left">
                <span className="settings-label">Wake Word</span>
                <span className="settings-hint">Activate by voice command</span>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  title="Toggle wake word detection"
                  checked={wakeWordEnabled}
                  onChange={(e) => {
                    setWakeWordEnabled(e.target.checked);
                    if (e.target.checked) {
                      startWakeWord();
                    } else {
                      invoke('wake_word_stop').catch(() => {});
                    }
                  }}
                />
                <span className="settings-toggle-slider" />
              </label>
            </div>

            <div className="settings-row">
              <div className="settings-row-left">
                <span className="settings-label">Trigger Phrase</span>
              </div>
              <select
                className="settings-select"
                title="Select trigger phrase"
                value={wakePhrase}
                onChange={(e) => setWakePhrase(e.target.value)}
              >
                <option value="Hey Forge">Hey Forge</option>
                <option value="Olá Forge">Olá Forge</option>
                <option value="Forge Online">Forge Online</option>
                <option value="Ok Forge">Ok Forge</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-left">
                <span className="settings-label">Always Listening</span>
                <span className="settings-hint">Keep mic open, only respond on wake word</span>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  title="Toggle always listening mode"
                  checked={alwaysListening}
                  onChange={(e) => setAlwaysListening(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </label>
            </div>
          </div>

          {/* Connection Section */}
          <div className="settings-section">
            <div className="settings-section-title">Connection</div>

            <div className="settings-row">
              <span className="settings-label">Gateway</span>
              <span className="settings-value">{status?.gateway_url || '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Safety</span>
              <span className="settings-value settings-value-active">Active</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Version</span>
              <span className="settings-value">{status?.version || '—'}</span>
            </div>
          </div>

          {/* Config Sync Section */}
          <div className="settings-section">
            <div className="settings-section-title">Config Sync</div>
            <span className="settings-hint sync-hint">
              Transfer API keys, TTS, channels and all settings to a remote Gateway securely.
            </span>

            {/* Push Config to Remote */}
            <div className="sync-subsection">
              <span className="settings-label">Push to Remote</span>
              <input
                type="text"
                placeholder="Remote URL (e.g. http://167.86.85.73:18800)"
                className="sync-input"
                value={syncRemoteUrl}
                onChange={(e) => setSyncRemoteUrl(e.target.value)}
              />
              <input
                type="text"
                placeholder="Sync Code (8 chars)"
                className="sync-input sync-input-code"
                maxLength={8}
                value={syncCode}
                onChange={(e) => setSyncCode(e.target.value.toUpperCase())}
              />
              <button
                className="settings-btn settings-btn-primary"
                onClick={handleSyncPush}
                disabled={syncStatus === 'pushing' || !syncRemoteUrl.trim() || !syncCode.trim()}
              >
                {syncStatus === 'pushing' ? 'Sending...' : 'Push Config'}
              </button>
            </div>

            {/* Generate Receive Code */}
            <div className="sync-subsection">
              <span className="settings-label">Receive from Another</span>
              <span className="settings-hint">Generate a code so another Gateway can push config here.</span>
              <button
                className="settings-btn settings-btn-secondary"
                onClick={handleSyncGenerate}
                disabled={syncStatus === 'generating'}
              >
                {syncStatus === 'generating' ? 'Generating...' : 'Generate Sync Code'}
              </button>
              {syncGeneratedCode && (
                <div className="sync-code-display">{syncGeneratedCode}</div>
              )}
            </div>

            {/* Status message */}
            {syncMessage && (
              <div className={`sync-message ${syncStatus === 'error' ? 'sync-message-error' : syncStatus === 'success' ? 'sync-message-success' : ''}`}>
                {syncMessage}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="settings-actions">
            <button
              onClick={() => setView('about')}
              className="settings-btn settings-btn-secondary"
            >
              About
            </button>
            <button
              onClick={handleDisconnect}
              className="settings-btn settings-btn-danger"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-logo">
              <Flame />
            </div>
            <p className="chat-empty-title">Hey! I'm ForgeAI</p>
            <p className="chat-empty-subtitle">
              Ask me anything or give me a command. I can manage files, launch apps, and more.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`chat-bubble chat-bubble-${msg.role}`}
          >
            {/* Tool steps (collapsible) */}
            {msg.steps && msg.steps.length > 0 && (
              <div className="step-container">
                <button
                  className="step-toggle"
                  onClick={() => setStepsExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
                >
                  <span className="step-toggle-icon">{stepsExpanded[i] ? '▾' : '▸'}</span>
                  <span>{msg.steps.filter(s => s.type === 'tool_call').length} tool{msg.steps.filter(s => s.type === 'tool_call').length !== 1 ? 's' : ''} used</span>
                </button>
                {stepsExpanded[i] && (
                  <div className="step-list">
                    {msg.steps.filter(s => s.type === 'tool_result').map((step, si) => (
                      <div key={si} className={`step-item ${step.success ? 'step-success' : 'step-fail'}`}>
                        <span className="step-icon">{step.success ? '✓' : '✗'}</span>
                        <span className="step-tool">{step.tool}</span>
                        {step.duration != null && <span className="step-dur">{step.duration}ms</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <pre>{msg.content}</pre>
            {msg.images && msg.images.length > 0 && (
              <div className="chat-bubble-images">
                {msg.images.map((src, j) => (
                  <div key={j} className="chat-bubble-img-wrapper">
                    <img
                      src={src}
                      alt={`Screenshot ${j + 1}`}
                      className="chat-bubble-img"
                      onClick={() => setExpandedImage(src)}
                    />
                    <div className="chat-bubble-img-overlay">
                      <ZoomIn className="w-4 h-4" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-bubble chat-bubble-assistant loading-bubble">
            {agentProgress?.tool ? (
              <div className="agent-progress">
                <div className="agent-progress-dot" />
                <span className="agent-progress-text">
                  {agentProgress.status === 'calling' ? `Calling ${agentProgress.tool}...` :
                   agentProgress.status === 'done' ? `${agentProgress.tool} done` :
                   agentProgress.status === 'failed' ? `${agentProgress.tool} failed` :
                   `Using ${agentProgress.tool}...`}
                </span>
              </div>
            ) : (
              <div className="loading-dots">
                <div className="loading-dot" />
                <div className="loading-dot" />
                <div className="loading-dot" />
              </div>
            )}
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* Voice Waveform Visualizer */}
      {voiceMode !== 'idle' && (
        <div className={`voice-viz voice-viz-${voiceMode}`}>
          <div className="voice-viz-bars">
            {audioLevels.map((level, i) => (
              <div
                key={i}
                className="voice-viz-bar"
                data-level={Math.round(level * 10)}
              />
            ))}
          </div>
          <span className="voice-viz-label">
            {voiceMode === 'listening' && 'Listening...'}
            {voiceMode === 'processing' && 'Processing...'}
            {voiceMode === 'speaking' && 'Speaking...'}
          </span>
        </div>
      )}

      {/* Image Viewer Modal */}
      {expandedImage && (
        <div className="image-viewer-overlay" onClick={() => setExpandedImage(null)}>
          <div className="image-viewer-toolbar" onClick={(e) => e.stopPropagation()}>
            <a
              href={expandedImage}
              download={`screenshot_${Date.now()}.png`}
              className="image-viewer-btn"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </a>
            <button className="image-viewer-btn" onClick={() => setExpandedImage(null)} title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <img
            src={expandedImage}
            alt="Screenshot expanded"
            className="image-viewer-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Input */}
      <div className="chat-input-bar">
        <button
          onClick={handleMicToggle}
          className={`chat-mic-btn ${voiceMode !== 'idle' ? 'recording' : ''}`}
          title={voiceMode !== 'idle' ? 'Stop' : 'Voice input (Jarvis mode)'}
        >
          {voiceMode !== 'idle' ? <MicOff style={{ width: 16, height: 16 }} /> : <Mic style={{ width: 16, height: 16 }} />}
        </button>
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="chat-send-btn"
          title="Send message"
        >
          <Send style={{ width: 16, height: 16, color: 'white' }} />
        </button>
      </div>
    </div>
  );
}
