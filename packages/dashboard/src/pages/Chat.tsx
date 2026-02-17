import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, AlertTriangle, Bot, User, Loader2, Plus, MessageSquare, Terminal, CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, X, Eraser, ImagePlus } from 'lucide-react';
import { api, type ChatResponse, type AgentStep, type SessionSummary, type StoredMessage, type AgentInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocked?: boolean;
  blockReason?: string;
  model?: string;
  duration?: number;
  tokens?: number;
  steps?: AgentStep[];
  imageUrls?: string[];
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

function StepRenderer({ steps }: { steps: AgentStep[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!steps || steps.length === 0) return null;

  const toolCalls = steps.filter(s => s.type === 'tool_call');
  const successes = steps.filter(s => s.type === 'tool_result' && s.success).length;
  const failures = steps.filter(s => s.type === 'tool_result' && !s.success).length;

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Terminal className="w-3 h-3" />
        <span>
          {toolCalls.length} ação{toolCalls.length > 1 ? 'ões' : ''}
          {successes > 0 && <span className="text-green-400 ml-1">✓{successes}</span>}
          {failures > 0 && <span className="text-red-400 ml-1">✗{failures}</span>}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 pl-2 border-l border-zinc-700/50">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              {step.type === 'tool_call' && (
                <>
                  <Terminal className="w-3 h-3 mt-0.5 text-blue-400 flex-shrink-0" />
                  <div>
                    <span className="text-blue-400 font-medium">{step.tool}</span>
                    <span className="text-zinc-500 ml-1">
                      ({step.args ? Object.entries(step.args).map(([k, v]) => `${k}: ${String(v).substring(0, 40)}`).join(', ') : ''})
                    </span>
                  </div>
                </>
              )}
              {step.type === 'tool_result' && (
                <>
                  {step.success
                    ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-green-400 flex-shrink-0" />
                    : <XCircle className="w-3 h-3 mt-0.5 text-red-400 flex-shrink-0" />
                  }
                  <div>
                    <span className={step.success ? 'text-green-400' : 'text-red-400'}>{step.message}</span>
                    {step.result && (
                      <pre className="mt-0.5 text-zinc-500 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
                        {step.result.substring(0, 200)}{step.result.length > 200 ? '...' : ''}
                      </pre>
                    )}
                  </div>
                </>
              )}
              {step.type === 'thinking' && (
                <>
                  <Loader2 className="w-3 h-3 mt-0.5 text-yellow-400 flex-shrink-0" />
                  <span className="text-yellow-400">{step.message}</span>
                </>
              )}
              {step.type === 'status' && (
                <>
                  <Clock className="w-3 h-3 mt-0.5 text-zinc-400 flex-shrink-0" />
                  <span className="text-zinc-400">{step.message}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LiveProgress {
  status: string;
  iteration: number;
  maxIterations: number;
  currentTool?: string;
  currentArgs?: string;
  elapsed: number;
  steps: Array<{ type: string; tool?: string; message?: string; success?: boolean; duration?: number }>;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
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

  // Auto-scroll on new messages or progress updates
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, liveProgress]);

  // ─── WebSocket connection for real-time progress ───
  const handleWSMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'agent.progress' && data.progress) {
        const p = data.progress;
        setLiveProgress(p);
        if (p.status === 'calling_tool' && p.currentTool) {
          setExecutionStatus(`[${p.iteration}/${p.maxIterations}] ▶ ${p.currentTool}`);
        } else if (p.status === 'thinking') {
          setExecutionStatus(`[${p.iteration}/${p.maxIterations}] Pensando...`);
        } else if (p.status === 'done') {
          setExecutionStatus('Finalizando...');
        }
      } else if (data.type === 'agent.step' && data.step) {
        setLiveProgress(prev => prev ? { ...prev, steps: [...prev.steps, data.step] } : prev);
      } else if (data.type === 'agent.done') {
        setExecutionStatus('Finalizando...');
      }
    } catch { /* ignore parse errors */ }
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsConnectedRef.current = true;
      wsRef.current = ws;
    };
    ws.onmessage = handleWSMessage;
    ws.onclose = () => { wsConnectedRef.current = false; wsRef.current = null; };
    ws.onerror = () => { wsConnectedRef.current = false; };

    return () => { ws.close(); wsRef.current = null; wsConnectedRef.current = false; };
  }, [handleWSMessage]);

  const wsSubscribe = useCallback((sid: string) => {
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
          }))
      );
    } catch { /* ignore */ }
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
                  <MessageSquare className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate font-medium">{s.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5 text-[10px] text-zinc-500">
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
              <h1 className="text-lg font-semibold text-white">ForgeAI Chat</h1>
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
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-700/50 flex items-center justify-center">
                <Bot className="w-4 h-4 text-zinc-300" />
              </div>
              <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-3 min-w-[280px] max-w-[80%]">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 className="w-4 h-4 text-forge-400 animate-spin" />
                  <span className="text-xs text-zinc-300 font-medium">{executionStatus || 'Pensando...'}</span>
                  {liveProgress && (
                    <span className="text-[10px] text-zinc-500 ml-auto">
                      {(liveProgress.elapsed / 1000).toFixed(0)}s
                    </span>
                  )}
                </div>
                {liveProgress && liveProgress.steps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-700/30 space-y-1 max-h-40 overflow-y-auto">
                    {liveProgress.steps.slice(-8).map((step, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px]">
                        {step.type === 'tool_call' && (
                          <>
                            <Terminal className="w-2.5 h-2.5 mt-0.5 text-blue-400 flex-shrink-0" />
                            <span className="text-blue-400">{step.tool}</span>
                          </>
                        )}
                        {step.type === 'tool_result' && (
                          <>
                            {step.success
                              ? <CheckCircle2 className="w-2.5 h-2.5 mt-0.5 text-green-400 flex-shrink-0" />
                              : <XCircle className="w-2.5 h-2.5 mt-0.5 text-red-400 flex-shrink-0" />
                            }
                            <span className={step.success ? 'text-green-400' : 'text-red-400'}>
                              {step.tool} {step.duration !== undefined ? `(${step.duration}ms)` : ''}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
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
        </div>
      </div>
    </div>
  );
}
