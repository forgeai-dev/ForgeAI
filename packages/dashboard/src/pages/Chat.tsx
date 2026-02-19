import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, AlertTriangle, Bot, User, Loader2, Plus, MessageSquare, Terminal, CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, X, Eraser, ImagePlus, Brain, FileCode, Globe, Monitor, Database, Wrench, Smartphone, Radio, Hash } from 'lucide-react';
import { api, type ChatResponse, type AgentStep, type SessionSummary, type StoredMessage, type AgentInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  blocked?: boolean;
  blockReason?: string;
  model?: string;
  duration?: number;
  tokens?: number;
  steps?: AgentStep[];
  imageUrls?: string[];
  senderName?: string;
}

// Channel badge config
const CHANNEL_CONFIG: Record<string, { label: string; icon: typeof MessageSquare; color: string; bg: string }> = {
  telegram: { label: 'Telegram', icon: Send, color: 'text-sky-400', bg: 'bg-sky-500/15' },
  whatsapp: { label: 'WhatsApp', icon: Smartphone, color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  teams: { label: 'Teams', icon: Hash, color: 'text-violet-400', bg: 'bg-violet-500/15' },
  googlechat: { label: 'Google Chat', icon: Globe, color: 'text-blue-400', bg: 'bg-blue-500/15' },
  discord: { label: 'Discord', icon: Radio, color: 'text-indigo-400', bg: 'bg-indigo-500/15' },
  webchat: { label: 'Web', icon: MessageSquare, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
};

function ChannelBadge({ channelType }: { channelType?: string }) {
  if (!channelType || channelType === 'webchat') return null;
  const cfg = CHANNEL_CONFIG[channelType];
  if (!cfg) return <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-medium uppercase">{channelType}</span>;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-medium', cfg.bg, cfg.color)}>
      <Icon className="w-2.5 h-2.5" />{cfg.label}
    </span>
  );
}

// Convert absolute Windows/Linux paths for .forgeai screenshots/workspace to API URLs
function convertPathsToUrls(text: string): string {
  // Match absolute paths to .forgeai directory
  return text.replace(
    /(?:[A-Z]:\\[^\s)]+?|\/[^\s)]+?)\.forgeai[/\\](screenshots|workspace|uploads)[/\\]([^\s)]+)/gi,
    (_match, folder, filename) => `/api/files/${folder}/${filename.replace(/\\/g, '/')}`
  );
}

// Lightweight markdown renderer for chat messages
function MessageContent({ content }: { content: string }) {
  const processed = convertPathsToUrls(content);

  // Split into code blocks and non-code blocks
  const parts = processed.split(/(```[\s\S]*?```)/g);

  return (
    <div className="text-sm text-zinc-200 space-y-2">
      {parts.map((part, i) => {
        // Code block
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const newlineIdx = inner.indexOf('\n');
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return (
            <pre key={i} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 overflow-x-auto text-xs font-mono text-zinc-300">
              <code>{code}</code>
            </pre>
          );
        }

        // Non-code: render inline markdown
        return <InlineMarkdown key={i} text={part} />;
      })}
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <>
      {lines.map((line, i) => {
        // Empty line → spacer
        if (!line.trim()) return <div key={i} className="h-1" />;

        // Render the line with inline elements
        return <p key={i} className="whitespace-pre-wrap">{renderInline(line)}</p>;
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Regex for: images, bold, links, inline code
  const regex = /!\[([^\]]*)\]\(([^)]+)\)|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined && match[1] !== undefined) {
      // Image: ![alt](url)
      const src = match[2];
      const alt = match[1] || 'Image';
      nodes.push(
        <img
          key={`img-${match.index}`}
          src={src}
          alt={alt}
          className="max-w-full rounded-lg border border-zinc-700/50 my-2 cursor-pointer hover:opacity-90 transition-opacity"
          style={{ maxHeight: '400px' }}
          onClick={() => window.open(src, '_blank')}
        />
      );
    } else if (match[3] !== undefined) {
      // Bold: **text**
      nodes.push(<strong key={`b-${match.index}`} className="font-semibold text-white">{match[3]}</strong>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Link: [text](url)
      nodes.push(
        <a key={`a-${match.index}`} href={match[5]} target="_blank" rel="noopener noreferrer"
          className="text-forge-400 hover:text-forge-300 underline underline-offset-2">{match[4]}</a>
      );
    } else if (match[6] !== undefined) {
      // Inline code: `code`
      nodes.push(
        <code key={`c-${match.index}`} className="bg-zinc-900/80 px-1.5 py-0.5 rounded text-xs font-mono text-forge-300">{match[6]}</code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function getToolIcon(toolName?: string) {
  switch (toolName) {
    case 'shell_exec': return <Terminal className="w-3.5 h-3.5" />;
    case 'file_manager': return <FileCode className="w-3.5 h-3.5" />;
    case 'web_browse': case 'browser': return <Globe className="w-3.5 h-3.5" />;
    case 'desktop': return <Monitor className="w-3.5 h-3.5" />;
    case 'knowledge_base': return <Database className="w-3.5 h-3.5" />;
    default: return <Wrench className="w-3.5 h-3.5" />;
  }
}

function formatToolArgs(tool?: string, args?: Record<string, unknown>): string {
  if (!args) return '';
  const filtered = Object.entries(args).filter(([k]) => !k.startsWith('_'));
  if (tool === 'shell_exec') {
    const cmd = String(args['command'] || '').substring(0, 120);
    const cwd = args['cwd'] ? ` (cwd: ${args['cwd']})` : '';
    return cmd + cwd;
  }
  if (tool === 'file_manager') {
    const action = args['action'] || '';
    const path = args['path'] || '';
    return `${action} ${path}`;
  }
  if (tool === 'web_browse' || tool === 'browser') {
    return String(args['url'] || args['query'] || '').substring(0, 200);
  }
  return filtered.map(([k, v]) => `${k}: ${String(v).substring(0, 60)}`).join(', ');
}

function extractResultTitle(result?: string): string | null {
  if (!result) return null;
  const titleMatch = result.match(/^title[=:]\s*(.+)/im);
  if (titleMatch) return titleMatch[1].substring(0, 120);
  const firstLine = result.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 5 && firstLine.length < 150) return firstLine;
  return null;
}

function groupSteps(steps: AgentStep[]): Array<{ call?: AgentStep; result?: AgentStep; thinking?: AgentStep; status?: AgentStep }> {
  const groups: Array<{ call?: AgentStep; result?: AgentStep; thinking?: AgentStep; status?: AgentStep }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === 'tool_call') {
      const next = steps[i + 1];
      if (next && next.type === 'tool_result') {
        groups.push({ call: step, result: next });
        i++;
      } else {
        groups.push({ call: step });
      }
    } else if (step.type === 'tool_result' && !groups.some(g => g.result === step)) {
      groups.push({ result: step });
    } else if (step.type === 'thinking') {
      groups.push({ thinking: step });
    } else if (step.type === 'status') {
      groups.push({ status: step });
    }
  }
  return groups;
}

function ToolCard({ call, result }: { call?: AgentStep; result?: AgentStep }) {
  const [showResult, setShowResult] = useState(false);
  const toolName = call?.tool || result?.tool || 'unknown';
  const isSuccess = result?.success !== false;
  const hasFailed = result && !result.success;
  const duration = result?.duration;
  const args = call?.args;
  const argsStr = formatToolArgs(toolName, args);
  const isWebBrowse = toolName === 'web_browse' || toolName === 'browser';
  const url = isWebBrowse ? String(args?.['url'] || '') : '';
  const resultTitle = extractResultTitle(result?.result);
  const resultText = result?.result || '';

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden transition-all',
      hasFailed
        ? 'border-red-500/20 bg-red-500/[0.03]'
        : result
          ? 'border-green-500/15 bg-green-500/[0.02]'
          : 'border-zinc-700/40 bg-zinc-800/30'
    )}>
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => resultText && setShowResult(!showResult)}
      >
        <div className={cn(
          'w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0',
          hasFailed ? 'bg-red-500/10' : 'bg-blue-500/10'
        )}>
          <span className={hasFailed ? 'text-red-400' : 'text-blue-400'}>
            {getToolIcon(toolName)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">{toolName}</span>
            {duration !== undefined && (
              <span className="text-[10px] text-zinc-500 tabular-nums">{duration}ms</span>
            )}
          </div>
          {isWebBrowse && url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-400/70 hover:text-blue-400 truncate block mt-0.5"
              onClick={e => e.stopPropagation()}
            >
              {url.length > 80 ? url.substring(0, 80) + '...' : url}
            </a>
          ) : argsStr ? (
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{argsStr}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result && (
            hasFailed
              ? <XCircle className="w-4 h-4 text-red-400" />
              : <CheckCircle2 className="w-4 h-4 text-green-400" />
          )}
          {resultText && (
            showResult
              ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </div>

      {resultTitle && !showResult && (
        <div className="px-3 pb-2 -mt-0.5">
          <p className="text-[11px] text-zinc-400 truncate pl-8">{resultTitle}</p>
        </div>
      )}

      {showResult && resultText && (
        <div className="border-t border-zinc-700/20 px-3 py-2">
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed font-mono">
            {resultText.substring(0, 800)}{resultText.length > 800 ? '\n...' : ''}
          </pre>
        </div>
      )}
    </div>
  );
}

function StepRenderer({ steps }: { steps: AgentStep[] }) {
  const [expanded, setExpanded] = useState(true);
  if (!steps || steps.length === 0) return null;

  const toolCalls = steps.filter(s => s.type === 'tool_call');
  const thinkingSteps = steps.filter(s => s.type === 'thinking');
  const successes = steps.filter(s => s.type === 'tool_result' && s.success).length;
  const failures = steps.filter(s => s.type === 'tool_result' && !s.success).length;
  const grouped = groupSteps(steps);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-300 transition-colors w-full"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-medium flex items-center gap-3">
          {thinkingSteps.length > 0 && (
            <span className="text-amber-400 inline-flex items-center gap-1">
              <Brain className="w-3 h-3" /> {thinkingSteps.length}
            </span>
          )}
          {toolCalls.length > 0 && (
            <span className="text-blue-400 inline-flex items-center gap-1">
              <Wrench className="w-3 h-3" /> {toolCalls.length} action{toolCalls.length > 1 ? 's' : ''}
            </span>
          )}
          {successes > 0 && (
            <span className="text-green-400 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {successes}
            </span>
          )}
          {failures > 0 && (
            <span className="text-red-400 inline-flex items-center gap-1">
              <XCircle className="w-3 h-3" /> {failures}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {grouped.map((group, i) => (
            <div key={i}>
              {group.thinking && (
                <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2">
                  <Brain className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-200/80 whitespace-pre-wrap leading-relaxed">
                    {group.thinking.message}
                  </p>
                </div>
              )}
              {(group.call || group.result) && (
                <ToolCard call={group.call} result={group.result} />
              )}
              {group.status && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 px-1">
                  <Clock className="w-3 h-3" />
                  <span>{group.status.message}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LiveProgress {
  sessionId?: string;
  status: string;
  iteration: number;
  maxIterations: number;
  currentTool?: string;
  currentArgs?: string;
  elapsed?: number;
  startedAt?: number;
  steps: Array<{ type: string; tool?: string; message?: string; success?: boolean; duration?: number }>;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionChannelType, setSessionChannelType] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsConnectedRef = useRef(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string; base64: string } | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const refreshSessions = useCallback(() => {
    api.getSessions().then(data => setSessions(data.sessions)).catch(() => {});
  }, []);

  const refreshAgents = useCallback(() => {
    api.getAgents().then(data => {
      setAgents(data.agents);
      if (!activeAgentId) {
        const def = data.agents.find(a => a.isDefault);
        if (def) setActiveAgentId(def.id);
      }
    }).catch(() => {});
  }, [activeAgentId]);

  // Load sessions and agents on mount
  useEffect(() => { refreshSessions(); refreshAgents(); }, [refreshSessions, refreshAgents]);

  // ─── Session persistence: save to localStorage ───
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('forgeai-active-session', sessionId);
    }
  }, [sessionId]);

  // Auto-scroll on new messages or progress updates
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, liveProgress]);

  // ─── WebSocket connection for real-time progress (with reconnect) ───
  const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSubscribeRef = useRef<string | null>(null);
  const recoverRef = useRef<() => void>(() => {});

  const handleWSMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const currentSid = pendingSubscribeRef.current;

      if (data.type === 'agent.progress' && data.progress) {
        // Only show progress if it matches the currently viewed session
        const eventSid = data.sessionId || data.progress?.sessionId;
        if (eventSid && currentSid && eventSid !== currentSid) return;

        const p = data.progress;
        const channelLabel = data.channelType && data.channelType !== 'webchat'
          ? `[${data.channelType}] ` : '';
        setLiveProgress(p);
        if (p.status === 'calling_tool' && p.currentTool) {
          setExecutionStatus(`${channelLabel}[${p.iteration}/${p.maxIterations}] ▶ ${p.currentTool}`);
        } else if (p.status === 'thinking') {
          setExecutionStatus(`${channelLabel}[${p.iteration}/${p.maxIterations}] Pensando...`);
        } else if (p.status === 'done') {
          setExecutionStatus(`${channelLabel}Finalizando...`);
        }
      } else if (data.type === 'agent.step' && data.step) {
        const eventSid = data.sessionId;
        if (eventSid && currentSid && eventSid !== currentSid) return;
        setLiveProgress(prev => prev ? { ...prev, steps: [...prev.steps, data.step] } : prev);
      } else if (data.type === 'agent.done') {
        // Always refresh sessions list (new channel messages appear in sidebar)
        api.getSessions().then(d => setSessions(d.sessions ?? [])).catch(() => {});

        // If it's from a channel and matches currently viewed session, reload messages
        const eventSid = data.sessionId as string | undefined;
        const isChannelEvent = data.channelType && data.channelType !== 'webchat';

        if (isChannelEvent && eventSid) {
          // Reload messages if currently viewing this channel session
          const currentSid = pendingSubscribeRef.current;
          if (currentSid === eventSid) {
            setTimeout(() => {
              api.getSession(eventSid).then(d => {
                if (!d.session) return;
                setMessages(
                  d.session.messages
                    .filter((m: StoredMessage) => m.role === 'user' || m.role === 'assistant')
                    .map((m: StoredMessage) => ({
                      id: m.id,
                      role: m.role as 'user' | 'assistant',
                      content: m.content,
                      model: m.model,
                      duration: m.duration,
                      tokens: m.tokens,
                      blocked: m.blocked,
                      blockReason: m.blockReason,
                      steps: m.steps,
                      senderName: m.senderName,
                    }))
                );
              }).catch(() => {});
            }, 300);
          }
        } else {
          // Webchat agent.done — existing behavior
          setExecutionStatus('Finalizando...');
          const sid = pendingSubscribeRef.current;
          if (sid) {
            setTimeout(() => {
              api.getSession(sid).then(d => {
                if (!d.session) return;
                setMessages(
                  d.session.messages
                    .filter((m: StoredMessage) => m.role === 'user' || m.role === 'assistant')
                    .map((m: StoredMessage) => ({
                      id: m.id,
                      role: m.role as 'user' | 'assistant',
                      content: m.content,
                      model: m.model,
                      duration: m.duration,
                      tokens: m.tokens,
                      blocked: m.blocked,
                      blockReason: m.blockReason,
                      steps: m.steps,
                      senderName: m.senderName,
                    }))
                );
                setLoading(false);
                setExecutionStatus(null);
                setLiveProgress(null);
              }).catch(() => {});
            }, 500);
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }, []);

  const connectWS = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already open/connecting
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsConnectedRef.current = true;
      wsRef.current = ws;
      // Auto-subscribe to pending session
      if (pendingSubscribeRef.current) {
        ws.send(JSON.stringify({ type: 'session.subscribe', sessionId: pendingSubscribeRef.current }));
      }
      // Recover active progress on reconnect (handles refresh/navigation)
      recoverRef.current();
    };
    ws.onmessage = handleWSMessage;
    ws.onclose = () => {
      wsConnectedRef.current = false;
      wsRef.current = null;
      // Reconnect after 3s
      if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
      wsReconnectTimer.current = setTimeout(() => connectWS(), 3000);
    };
    ws.onerror = () => { wsConnectedRef.current = false; };
  }, [handleWSMessage]);

  useEffect(() => {
    // Small delay to avoid React Strict Mode double-invoke teardown noise
    const t = setTimeout(() => connectWS(), 200);
    return () => {
      clearTimeout(t);
      if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; wsConnectedRef.current = false; }
    };
  }, [connectWS]);

  const wsSubscribe = useCallback((sid: string) => {
    pendingSubscribeRef.current = sid;
    if (wsRef.current && wsConnectedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'session.subscribe', sessionId: sid }));
    }
  }, []);

  // Fallback polling (only if WS not connected)
  const startProgressPolling = useCallback((sid: string) => {
    wsSubscribe(sid);
    if (wsConnectedRef.current) return; // WS handles it
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/progress/${sid}`);
        const data = await res.json() as { progress: LiveProgress | null };
        if (data.progress) {
          setLiveProgress(data.progress);
          const p = data.progress;
          if (p.status === 'calling_tool' && p.currentTool) {
            setExecutionStatus(`[${p.iteration}/${p.maxIterations}] ▶ ${p.currentTool}`);
          } else if (p.status === 'thinking') {
            setExecutionStatus(`[${p.iteration}/${p.maxIterations}] Pensando...`);
          } else if (p.status === 'done') {
            setExecutionStatus('Finalizando...');
          }
        }
      } catch { /* ignore */ }
    }, 800);
  }, [wsSubscribe]);

  const stopProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setLiveProgress(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopProgressPolling(), [stopProgressPolling]);

  // Load a session from persistent storage
  const loadSession = useCallback(async (sid: string) => {
    try {
      const data = await api.getSession(sid);
      if (!data.session) return;

      setSessionId(sid);
      setSessionChannelType(data.session.channelType ?? null);
      setMessages(
        data.session.messages
          .filter((m: StoredMessage) => m.role === 'user' || m.role === 'assistant')
          .map((m: StoredMessage) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            model: m.model,
            duration: m.duration,
            tokens: m.tokens,
            blocked: m.blocked,
            blockReason: m.blockReason,
            steps: m.steps,
            senderName: m.senderName,
          }))
      );
    } catch { /* ignore */ }
  }, []);

  // ─── Recover active execution state (survives refresh + navigation) ───
  const recoveredOnceRef = useRef(false);
  const recoverActiveProgress = useCallback(async (targetSid?: string) => {
    // Prevent duplicate polling
    if (progressIntervalRef.current) return;

    const sid = targetSid || pendingSubscribeRef.current;
    if (!sid) return;

    try {
      const { active } = await api.getActiveSessions();
      if (!active || active.length === 0) return;

      const match = active.find(a => a.sessionId === sid);
      if (!match) return;

      // Current session is being processed — recover progress state
      setLoading(true);
      setLiveProgress({
        sessionId: match.sessionId,
        status: match.status as LiveProgress['status'],
        iteration: match.iteration,
        maxIterations: match.maxIterations,
        currentTool: match.currentTool,
        steps: match.steps as AgentStep[],
        startedAt: match.startedAt,
      });
      const label = match.status === 'calling_tool' && match.currentTool
        ? `[${match.iteration}/${match.maxIterations}] ▶ ${match.currentTool}`
        : `[${match.iteration}/${match.maxIterations}] Pensando...`;
      setExecutionStatus(label);

      // Fallback polling (5s) to detect completion if WS misses the done event
      progressIntervalRef.current = setInterval(async () => {
        try {
          const r = await api.getActiveSessions();
          const still = r.active?.find(a => a.sessionId === sid);
          if (still) {
            setLiveProgress({
              sessionId: still.sessionId,
              status: still.status as LiveProgress['status'],
              iteration: still.iteration,
              maxIterations: still.maxIterations,
              currentTool: still.currentTool,
              steps: still.steps as AgentStep[],
              startedAt: still.startedAt,
            });
            const lbl = still.status === 'calling_tool' && still.currentTool
              ? `[${still.iteration}/${still.maxIterations}] ▶ ${still.currentTool}`
              : `[${still.iteration}/${still.maxIterations}] Pensando...`;
            setExecutionStatus(lbl);
          } else {
            // Agent finished — stop polling, reload messages
            clearInterval(progressIntervalRef.current!);
            progressIntervalRef.current = null;
            api.getSession(sid).then(d => {
              if (!d.session) return;
              setMessages(
                d.session.messages
                  .filter((m: StoredMessage) => m.role === 'user' || m.role === 'assistant')
                  .map((m: StoredMessage) => ({
                    id: m.id,
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                    model: m.model,
                    duration: m.duration,
                    tokens: m.tokens,
                    blocked: m.blocked,
                    blockReason: m.blockReason,
                    steps: m.steps,
                    senderName: m.senderName,
                  }))
              );
              setLoading(false);
              setExecutionStatus(null);
              setLiveProgress(null);
            }).catch(() => {});
          }
        } catch {
          // On error (e.g. 429), stop polling
          clearInterval(progressIntervalRef.current!);
          progressIntervalRef.current = null;
        }
      }, 5000);
    } catch { /* ignore — no active sessions or network error */ }
  }, []);

  // Keep recoverRef in sync (used by WS onopen to avoid circular deps)
  useEffect(() => {
    recoverRef.current = () => {
      if (!recoveredOnceRef.current) {
        recoveredOnceRef.current = true;
        recoverActiveProgress();
      }
    };
  }, [recoverActiveProgress]);

  // ─── Restore active session on mount ───
  useEffect(() => {
    const saved = localStorage.getItem('forgeai-active-session');
    if (!saved) return;

    // Load session messages
    api.getSession(saved).then(data => {
      if (!data.session) return;
      setSessionId(saved);
      setSessionChannelType(data.session.channelType ?? null);
      setMessages(
        data.session.messages
          .filter((m: StoredMessage) => m.role === 'user' || m.role === 'assistant')
          .map((m: StoredMessage) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            model: m.model,
            duration: m.duration,
            tokens: m.tokens,
            blocked: m.blocked,
            blockReason: m.blockReason,
            steps: m.steps,
            senderName: m.senderName,
          }))
      );
    }).catch(() => {});

    // Subscribe WS + check for active execution
    pendingSubscribeRef.current = saved;
    if (wsRef.current && wsConnectedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'session.subscribe', sessionId: saved }));
    }

    // Delay to let WS connect first, then recover progress
    const t = setTimeout(() => recoverActiveProgress(saved), 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteSession(sid);
      if (sid === sessionId) {
        setMessages([]);
        setSessionId(null);
      }
      refreshSessions();
    } catch { /* ignore */ }
  };

  const deleteAllSessions = async () => {
    try {
      await api.deleteAllSessions();
      setMessages([]);
      setSessionId(null);
      setSessions([]);
      setConfirmDeleteAll(false);
      localStorage.removeItem('forgeai-active-session');
    } catch { /* ignore */ }
  };

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) { alert('Imagem muito grande (máx 10MB)'); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setPendingImage({ file, preview: dataUrl, base64 });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, []);

  const sendMessage = async () => {
    if ((!input.trim() && !pendingImage) || loading) return;

    const contentText = input.trim() || (pendingImage ? `[Imagem: ${pendingImage.file.name}]` : '');
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: contentText,
      imageUrls: pendingImage ? [pendingImage.preview] : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setExecutionStatus('Enviando...');

    // Determine sessionId for polling (use existing or predict new one)
    const activeSid = sessionId;

    try {
      setExecutionStatus('Pensando...');

      // Build image payload if present
      const imagePayload = pendingImage
        ? { data: pendingImage.base64, mimeType: pendingImage.file.type, filename: pendingImage.file.name }
        : undefined;
      setPendingImage(null);

      // Start sending and polling in parallel
      const sendPromise = api.sendMessage(contentText, activeSid ?? undefined, imagePayload, activeAgentId ?? undefined);

      // Start polling after a short delay (give backend time to create session)
      setTimeout(() => {
        if (activeSid) startProgressPolling(activeSid);
      }, 500);

      const res: ChatResponse = await sendPromise;
      stopProgressPolling();

      if (!sessionId) setSessionId(res.sessionId);

      const assistantMsg: Message = {
        id: res.id,
        role: 'assistant',
        content: res.content,
        thinking: res.thinking,
        blocked: res.blocked,
        blockReason: res.blockReason,
        model: res.model,
        duration: res.duration,
        tokens: res.usage.totalTokens,
        steps: res.steps,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      refreshSessions();
    } catch (err) {
      stopProgressPolling();
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Erro: ${err instanceof Error ? err.message : 'Falha na requisição'}`,
        },
      ]);
    } finally {
      setLoading(false);
      setExecutionStatus(null);
      setLiveProgress(null);
      inputRef.current?.focus();
    }
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(null);
    setSessionChannelType(null);
    localStorage.removeItem('forgeai-active-session');
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar — Session History */}
      {sidebarOpen && (
        <div className="w-64 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
          <div className="p-3 border-b border-zinc-800 space-y-2">
            <button
              onClick={newChat}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo Chat
            </button>
            {sessions.length > 0 && (
              <div>
                {!confirmDeleteAll ? (
                  <button
                    onClick={() => setConfirmDeleteAll(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                    title="Limpar todas as conversas"
                  >
                    <Eraser className="w-3 h-3" />
                    Limpar tudo
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={deleteAllSessions}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAll(false)}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">Nenhuma conversa ainda</p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                className={cn(
                  'group w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer relative',
                  s.id === sessionId
                    ? 'bg-forge-500/10 border border-forge-500/20 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                )}
              >
                <div className="flex items-center gap-2 pr-5">
                  {s.channelType && s.channelType !== 'webchat' ? (
                    (() => { const cfg = CHANNEL_CONFIG[s.channelType]; const I = cfg?.icon ?? MessageSquare; return <I className={cn('w-3 h-3 flex-shrink-0', cfg?.color ?? 'text-zinc-400')} />; })()
                  ) : (
                    <MessageSquare className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="truncate font-medium">{s.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5 text-[10px] text-zinc-500">
                  <ChannelBadge channelType={s.channelType} />
                  <span>{s.messageCount} msgs</span>
                  <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="absolute top-2 right-2 p-0.5 rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Deletar conversa"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-zinc-400 hover:text-white transition-colors"
              title="Toggle sidebar"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                ForgeAI Chat
                {sessionChannelType && sessionChannelType !== 'webchat' && <ChannelBadge channelType={sessionChannelType} />}
              </h1>
              <p className="text-xs text-zinc-500">
                {sessionId ? `Sessão: ${sessionId.slice(0, 16)}...` : 'Nova conversa'}
              </p>
            </div>
          </div>
          {sessionId && (
            <button
              onClick={(e) => deleteSession(sessionId, e as React.MouseEvent)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
              title="Deletar esta conversa"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Deletar
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-forge-500/20 to-forge-700/20 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-forge-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-1">ForgeAI Assistant</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Posso criar arquivos, executar comandos e construir projetos.
                Peça para criar um site, rodar código, ou qualquer coisa que precisar.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3 max-w-3xl',
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                msg.role === 'user'
                  ? 'bg-forge-500/20 text-forge-400'
                  : 'bg-zinc-700/50 text-zinc-300'
              )}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div className={cn(
                'rounded-xl px-4 py-3 max-w-[80%]',
                msg.role === 'user'
                  ? 'bg-forge-500/10 border border-forge-500/20'
                  : msg.blocked
                    ? 'bg-red-500/10 border border-red-500/20'
                    : 'bg-zinc-800/50 border border-zinc-700/50'
              )}>
                {msg.role === 'user' && msg.senderName && sessionChannelType && sessionChannelType !== 'webchat' && (
                  <div className="text-[10px] text-zinc-500 mb-1 font-medium">{msg.senderName}</div>
                )}
                {msg.blocked && (
                  <div className="flex items-center gap-2 text-red-400 text-xs mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{msg.blockReason}</span>
                  </div>
                )}
                {msg.imageUrls && msg.imageUrls.length > 0 && (
                  <div className="mb-2">
                    {msg.imageUrls.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt="Imagem enviada"
                        className="max-w-full rounded-lg border border-zinc-700/50 cursor-pointer hover:opacity-90 transition-opacity max-h-60"
                        onClick={() => window.open(url, '_blank')}
                      />
                    ))}
                  </div>
                )}
                <MessageContent content={msg.content} />
                {msg.steps && <StepRenderer steps={msg.steps} />}
                {msg.role === 'assistant' && (msg.model || msg.duration) && (
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-700/30">
                    {msg.model && <span className="text-[10px] text-zinc-500">{msg.model}</span>}
                    {msg.duration !== undefined && <span className="text-[10px] text-zinc-500">{(msg.duration / 1000).toFixed(1)}s</span>}
                    {msg.tokens !== undefined && msg.tokens > 0 && <span className="text-[10px] text-zinc-500">{msg.tokens} tokens</span>}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 max-w-3xl">
              <div className="w-8 h-8 rounded-lg bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-zinc-300" />
              </div>
              <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-3 flex-1 max-w-[80%]">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 text-forge-400 animate-spin" />
                  <span className="text-xs text-zinc-300 font-medium">{executionStatus || 'Pensando...'}</span>
                  {liveProgress && (
                    <span className="text-[10px] text-zinc-500 ml-auto">
                      {((liveProgress.elapsed ?? (liveProgress.startedAt ? Date.now() - liveProgress.startedAt : 0)) / 1000).toFixed(0)}s
                    </span>
                  )}
                </div>
                {liveProgress && liveProgress.steps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-700/30 space-y-1.5 max-h-80 overflow-y-auto">
                    {(() => {
                      const liveSteps = liveProgress.steps.slice(-12);
                      const grouped: Array<{ call?: typeof liveSteps[0]; result?: typeof liveSteps[0]; thinking?: typeof liveSteps[0] }> = [];
                      for (let idx = 0; idx < liveSteps.length; idx++) {
                        const s = liveSteps[idx];
                        if (s.type === 'tool_call') {
                          const next = liveSteps[idx + 1];
                          if (next && next.type === 'tool_result') {
                            grouped.push({ call: s, result: next });
                            idx++;
                          } else {
                            grouped.push({ call: s });
                          }
                        } else if (s.type === 'tool_result' && !grouped.some(g => g.result === s)) {
                          grouped.push({ result: s });
                        } else if (s.type === 'thinking') {
                          grouped.push({ thinking: s });
                        }
                      }
                      return grouped.map((g, i) => (
                        <div key={i}>
                          {g.thinking && (
                            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2.5 py-1.5">
                              <Brain className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />
                              <p className="text-[11px] text-amber-200/80 whitespace-pre-wrap leading-relaxed line-clamp-4">
                                {g.thinking.message}
                              </p>
                            </div>
                          )}
                          {(g.call || g.result) && (
                            <div className={cn(
                              'rounded-lg border overflow-hidden',
                              g.result && !g.result.success
                                ? 'border-red-500/20 bg-red-500/[0.03]'
                                : g.result
                                  ? 'border-green-500/15 bg-green-500/[0.02]'
                                  : 'border-zinc-700/40 bg-zinc-800/30'
                            )}>
                              <div className="flex items-center gap-2 px-2.5 py-1.5">
                                <div className={cn(
                                  'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
                                  g.result && !g.result.success ? 'bg-red-500/10' : 'bg-blue-500/10'
                                )}>
                                  <span className={cn('scale-90', g.result && !g.result.success ? 'text-red-400' : 'text-blue-400')}>
                                    {getToolIcon(g.call?.tool || g.result?.tool)}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[11px] font-semibold text-zinc-200">
                                    {g.call?.tool || g.result?.tool}
                                  </span>
                                  {g.result?.duration !== undefined && (
                                    <span className="text-[10px] text-zinc-500 ml-1.5 tabular-nums">{g.result.duration}ms</span>
                                  )}
                                  {g.call?.message && (
                                    <p className="text-[10px] text-zinc-500 truncate">
                                      {g.call.message.length > 80 ? g.call.message.substring(0, 80) + '...' : g.call.message}
                                    </p>
                                  )}
                                </div>
                                {g.result && (
                                  g.result.success
                                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                    : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                                )}
                                {g.call && !g.result && (
                                  <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-zinc-800">
          {agents.length > 0 && (
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <span className="text-[10px] text-zinc-500 mr-1">Agent:</span>
              {agents.map(a => (
                <button
                  key={a.id}
                  onClick={() => setActiveAgentId(a.id)}
                  title={`${a.name} (${a.provider}/${a.model})`}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeAgentId === a.id
                      ? 'bg-forge-500/20 text-forge-400 border border-forge-500/40'
                      : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300 hover:border-zinc-600'
                  )}
                >
                  {a.isDefault ? '★ ' : ''}{a.name}
                </button>
              ))}
              <a
                href="/agents"
                title="Gerenciar agentes"
                className="px-2 py-1 rounded-md text-[11px] text-zinc-600 border border-dashed border-zinc-700/50 hover:text-zinc-400 hover:border-zinc-600 transition-all"
              >
                + Gerenciar
              </a>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 mb-2 px-2">
              <div className="w-2 h-2 rounded-full bg-forge-400 animate-pulse" />
              <span className="text-xs text-zinc-400">Agente trabalhando... Aguarde.</span>
            </div>
          )}
          {pendingImage && (
            <div className="flex items-center gap-2 mb-2 px-2">
              <img src={pendingImage.preview} alt="Preview" className="w-16 h-16 rounded-lg object-cover border border-zinc-700" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 truncate">{pendingImage.file.name}</p>
                <p className="text-[10px] text-zinc-500">{(pendingImage.file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button onClick={() => setPendingImage(null)} title="Remover imagem" className="text-zinc-500 hover:text-red-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} aria-label="Selecionar imagem" />
          {sessionChannelType && sessionChannelType !== 'webchat' ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-500">
              <ChannelBadge channelType={sessionChannelType} />
              <span>Conversa somente leitura — mensagens do canal {CHANNEL_CONFIG[sessionChannelType]?.label ?? sessionChannelType}</span>
            </div>
          ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Anexar imagem"
              className="w-11 h-11 rounded-xl border border-zinc-700 hover:border-forge-500/50 text-zinc-400 hover:text-forge-400 disabled:opacity-50 flex items-center justify-center transition-colors"
            >
              <ImagePlus className="w-4 h-4" />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={loading ? 'Agente executando...' : 'Peça para criar algo...'}
              disabled={loading}
              className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-forge-500/50 focus:border-forge-500/50 disabled:opacity-50 transition-all"
            />
            <button
              type="submit"
              disabled={loading || (!input.trim() && !pendingImage)}
              title="Enviar mensagem"
              className="w-11 h-11 rounded-xl bg-forge-500 hover:bg-forge-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white flex items-center justify-center transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}
