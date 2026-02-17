import { useState, useEffect, useCallback } from 'react';
import { Mail, Inbox, Send, Search, RefreshCw, Loader2, Eye, MailOpen, Paperclip, Tag, AlertCircle, CheckCircle, Key } from 'lucide-react';
import { api, type GmailMessage } from '@/lib/api';

type GmailTab = 'inbox' | 'compose' | 'config';

export function GmailPage() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<GmailTab>('inbox');

  // Inbox state
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<GmailMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(false);

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'error' | null>(null);

  // Config state
  const [accessToken, setAccessToken] = useState('');
  const [configuring, setConfiguring] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await api.getGmailStatus();
      setConfigured(res.configured);
      if (res.configured) {
        setTab('inbox');
      } else {
        setTab('config');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadInbox = useCallback(async () => {
    if (!configured) return;
    setInboxLoading(true);
    try {
      const [msgRes, unreadRes] = await Promise.all([
        searchQuery
          ? api.searchGmail(searchQuery, 15)
          : api.getGmailMessages({ maxResults: 15 }),
        api.getGmailUnread(),
      ]);
      setMessages(msgRes.messages ?? []);
      setUnreadCount(unreadRes.unreadCount ?? 0);
    } catch { /* ignore */ }
    setInboxLoading(false);
  }, [configured, searchQuery]);

  useEffect(() => { checkStatus(); }, [checkStatus]);
  useEffect(() => { if (configured && tab === 'inbox') loadInbox(); }, [configured, tab, loadInbox]);

  const handleConfigure = async () => {
    if (!accessToken.trim()) return;
    setConfiguring(true);
    try {
      await api.configureGmail(accessToken.trim());
      setConfigured(true);
      setTab('inbox');
      setAccessToken('');
    } catch { /* ignore */ }
    setConfiguring(false);
  };

  const handleSend = async () => {
    if (!composeTo || !composeSubject || !composeBody) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.sendGmail(composeTo, composeSubject, composeBody);
      if (res.sent) {
        setSendResult('success');
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setTimeout(() => setSendResult(null), 3000);
      } else {
        setSendResult('error');
      }
    } catch {
      setSendResult('error');
    }
    setSending(false);
  };

  const handleMarkRead = async (id: string) => {
    await api.markGmailRead(id);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isUnread: false } : m));
    if (selectedMsg?.id === id) setSelectedMsg(prev => prev ? { ...prev, isUnread: false } : null);
  };

  const openMessage = async (msg: GmailMessage) => {
    setSelectedMsg(msg);
    if (msg.isUnread) handleMarkRead(msg.id);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-forge-400" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Mail className="w-6 h-6 text-red-400" />
            Gmail
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {configured ? `${unreadCount} não lidos` : 'Configure o acesso ao Gmail para começar'}
          </p>
        </div>

        {configured && (
          <div className="flex items-center gap-2">
            {(['inbox', 'compose', 'config'] as GmailTab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedMsg(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === t
                    ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30'
                    : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
              >
                {t === 'inbox' && <Inbox className="w-3.5 h-3.5" />}
                {t === 'compose' && <Send className="w-3.5 h-3.5" />}
                {t === 'config' && <Key className="w-3.5 h-3.5" />}
                {t === 'inbox' ? 'Inbox' : t === 'compose' ? 'Escrever' : 'Config'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-400" />
            Configurar Gmail
          </h2>
          <p className="text-sm text-zinc-400">
            Para usar o Gmail, você precisa de um OAuth2 Access Token do Google.
            Configure o Google como provider OAuth2 na página Settings e use o token gerado aqui.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Access Token</label>
              <input
                type="password"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder="ya29.a0..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
            <button
              onClick={handleConfigure}
              disabled={configuring || !accessToken.trim()}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                configuring ? 'bg-forge-500/50 text-white cursor-wait'
                  : accessToken.trim() ? 'bg-forge-500 hover:bg-forge-600 text-white'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {configuring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Conectar
            </button>
          </div>
          {configured && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm mt-2">
              <CheckCircle className="w-4 h-4" />
              Gmail conectado
            </div>
          )}
        </div>
      )}

      {/* Inbox Tab */}
      {tab === 'inbox' && configured && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadInbox()}
                placeholder="Buscar emails (ex: from:user@gmail.com, is:unread, subject:...)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
            <button
              onClick={loadInbox}
              disabled={inboxLoading}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {inboxLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex gap-4">
            {/* Message list */}
            <div className="w-80 shrink-0 space-y-1 max-h-[600px] overflow-y-auto">
              {messages.length === 0 && !inboxLoading && (
                <div className="text-center py-8 text-zinc-500 text-sm">
                  {searchQuery ? 'Nenhum resultado' : 'Inbox vazio'}
                </div>
              )}
              {messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => openMessage(msg)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all border ${
                    selectedMsg?.id === msg.id
                      ? 'bg-forge-500/10 border-forge-500/30'
                      : 'bg-zinc-900/50 border-transparent hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {msg.isUnread && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
                    <span className={`text-xs truncate ${msg.isUnread ? 'text-white font-semibold' : 'text-zinc-400'}`}>
                      {msg.fromName || msg.from}
                    </span>
                  </div>
                  <p className={`text-sm truncate ${msg.isUnread ? 'text-zinc-200 font-medium' : 'text-zinc-400'}`}>
                    {msg.subject || '(sem assunto)'}
                  </p>
                  <p className="text-[10px] text-zinc-600 truncate mt-0.5">{msg.snippet}</p>
                </button>
              ))}
            </div>

            {/* Message detail */}
            <div className="flex-1 min-w-0">
              {selectedMsg ? (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selectedMsg.subject || '(sem assunto)'}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                      <span className="text-zinc-300">{selectedMsg.fromName || selectedMsg.from}</span>
                      <span>&lt;{selectedMsg.from}&gt;</span>
                      <span>→</span>
                      <span>{selectedMsg.to.join(', ')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-600">{selectedMsg.date}</span>
                      {selectedMsg.isUnread && (
                        <button onClick={() => handleMarkRead(selectedMsg.id)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          <MailOpen className="w-3 h-3" /> Marcar como lido
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedMsg.labels.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {selectedMsg.labels.filter(l => !['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(l)).map(label => (
                        <span key={label} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 flex items-center gap-1">
                          <Tag className="w-2.5 h-2.5" /> {label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-zinc-800 pt-4">
                    <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {selectedMsg.body || selectedMsg.snippet}
                    </pre>
                  </div>

                  {selectedMsg.attachments.length > 0 && (
                    <div className="border-t border-zinc-800 pt-3">
                      <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> {selectedMsg.attachments.length} anexo(s)
                      </p>
                      <div className="space-y-1">
                        {selectedMsg.attachments.map((att, i) => (
                          <div key={i} className="text-xs text-zinc-400 bg-zinc-900 rounded px-2 py-1.5 flex items-center justify-between">
                            <span className="truncate">{att.filename}</span>
                            <span className="text-zinc-600 shrink-0 ml-2">{(att.size / 1024).toFixed(1)} KB</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  <Eye className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Selecione um email para ler</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose Tab */}
      {tab === 'compose' && configured && (
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-6 space-y-4 max-w-2xl">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-forge-400" />
            Escrever Email
          </h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Para</label>
              <input
                type="email"
                value={composeTo}
                onChange={e => setComposeTo(e.target.value)}
                placeholder="destinatario@email.com"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Assunto</label>
              <input
                type="text"
                value={composeSubject}
                onChange={e => setComposeSubject(e.target.value)}
                placeholder="Assunto do email"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Mensagem</label>
              <textarea
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
                placeholder="Escreva sua mensagem..."
                rows={8}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-forge-500/50 resize-y"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSend}
              disabled={sending || !composeTo || !composeSubject || !composeBody}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                sending ? 'bg-forge-500/50 text-white cursor-wait'
                  : (composeTo && composeSubject && composeBody) ? 'bg-forge-500 hover:bg-forge-600 text-white'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar
            </button>
            {sendResult === 'success' && (
              <span className="text-sm text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Enviado!
              </span>
            )}
            {sendResult === 'error' && (
              <span className="text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> Erro ao enviar
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GmailPage;
