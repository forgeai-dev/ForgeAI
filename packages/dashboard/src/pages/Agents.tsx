import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Trash2, Pencil, Users, Star, Cpu, X, Clock, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, type AgentInfo, type DelegationRecord, type ProviderInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

interface NewAgentForm {
  id: string;
  name: string;
  persona: string;
  model: string;
  provider: string;
}

const EMPTY_FORM: NewAgentForm = { id: '', name: '', persona: '', model: '', provider: '' };

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewAgentForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});

  const refresh = useCallback(() => {
    api.getAgents().then(d => { setAgents(d.agents); }).catch(() => {});
    api.getDelegations().then(d => setDelegations(d.delegations ?? [])).catch(() => {});
  }, []);

  // Fetch configured providers on mount
  useEffect(() => {
    api.getProviders().then(r => setProviders(r.providers.filter(p => p.configured))).catch(() => {});
  }, []);

  // Fetch models when provider changes
  const handleProviderChange = useCallback(async (providerName: string) => {
    setForm(f => ({ ...f, provider: providerName, model: '' }));
    if (!providerName || providerModels[providerName]) return;
    try {
      const res = await fetch(`/api/providers/${providerName}/models`);
      const data = await res.json() as { models: string[] };
      setProviderModels(m => ({ ...m, [providerName]: data.models ?? [] }));
    } catch { /* ignore */ }
  }, [providerModels]);

  useEffect(() => { refresh(); }, [refresh]);
  // Auto-refresh every 10s for live team status
  useEffect(() => {
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleCreate = async () => {
    if (!form.id.trim() || !form.name.trim()) {
      setError('ID e Nome são obrigatórios');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.addAgent({
        id: form.id.trim().toLowerCase().replace(/\s+/g, '-'),
        name: form.name.trim(),
        persona: form.persona.trim() || undefined,
        model: form.model.trim() || undefined,
        provider: form.provider.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar agente');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.updateAgent(id, {
        name: form.name.trim() || undefined,
        persona: form.persona.trim() || undefined,
        model: form.model.trim() || undefined,
        provider: form.provider.trim() || undefined,
      });
      setEditingId(null);
      setForm(EMPTY_FORM);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao atualizar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Remover agente "${id}"?`)) return;
    try {
      await api.removeAgent(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover');
    }
  };

  const startEdit = async (agent: AgentInfo) => {
    setEditingId(agent.id);
    setForm({ id: agent.id, name: agent.name, persona: '', model: agent.model, provider: agent.provider });
    setShowForm(false);
    // Pre-load models for the agent's current provider
    if (agent.provider && !providerModels[agent.provider]) {
      try {
        const res = await fetch(`/api/providers/${agent.provider}/models`);
        const data = await res.json() as { models: string[] };
        setProviderModels(m => ({ ...m, [agent.provider]: data.models ?? [] }));
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Agents</h1>
            <p className="text-sm text-zinc-400">Gerencie múltiplos agentes com personalidades e modelos diferentes</p>
          </div>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); setError(null); }}
          title="Criar novo agente"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-forge-500 hover:bg-forge-600 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Agente
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} title="Fechar"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div className="mb-6 p-5 rounded-xl border border-zinc-700 bg-zinc-800/50">
          <h3 className="text-sm font-semibold text-white mb-4">Criar Novo Agente</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">ID (único, sem espaços)</label>
              <input
                value={form.id}
                onChange={e => setForm({ ...form, id: e.target.value })}
                placeholder="ex: coder, research, writer"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-forge-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Nome</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="ex: Code Assistant"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-forge-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Provider (opcional)</label>
              <select
                value={form.provider}
                onChange={e => handleProviderChange(e.target.value)}
                title="Selecionar provider"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
              >
                <option value="">Mesmo do default</option>
                {providers.map(p => (
                  <option key={p.name} value={p.name}>{p.displayName}</option>
                ))}
              </select>
              {providers.length === 0 && (
                <p className="text-[10px] text-amber-400/70 mt-1">Nenhum provider configurado. Configure em Settings primeiro.</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Modelo (opcional)</label>
              <select
                value={form.model}
                onChange={e => setForm({ ...form, model: e.target.value })}
                title="Selecionar modelo"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                disabled={!form.provider}
              >
                <option value="">{form.provider ? 'Selecione um modelo' : 'Selecione o provider primeiro'}</option>
                {(providerModels[form.provider] ?? []).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-zinc-400 mb-1">Persona / System Prompt <span className="text-zinc-500">(opcional — se vazio, usa o prompt padrão do ForgeAI)</span></label>
            <textarea
              value={form.persona}
              onChange={e => setForm({ ...form, persona: e.target.value })}
              placeholder="Opcional: descreva a personalidade e especialidade deste agente. Deixe vazio para usar o system prompt padrão."
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-forge-500 focus:outline-none resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-forge-500 hover:bg-forge-600 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading ? 'Criando...' : 'Criar Agente'}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Agent Cards */}
      <div className="grid gap-4">
        {agents.map(agent => (
          <div
            key={agent.id}
            className={cn(
              'p-5 rounded-xl border transition-all',
              agent.isDefault
                ? 'border-forge-500/40 bg-forge-500/5'
                : 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600'
            )}
          >
            {editingId === agent.id ? (
              /* Edit mode */
              <div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Nome</label>
                    <input
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="Nome"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Provider</label>
                    <select
                      value={form.provider}
                      onChange={e => handleProviderChange(e.target.value)}
                      title="Selecionar provider"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                    >
                      <option value="">Mesmo do default</option>
                      {providers.map(p => (
                        <option key={p.name} value={p.name}>{p.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Modelo</label>
                    <select
                      value={form.model}
                      onChange={e => setForm({ ...form, model: e.target.value })}
                      title="Selecionar modelo"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                      disabled={!form.provider}
                    >
                      <option value="">{form.provider ? 'Selecione um modelo' : 'Selecione o provider primeiro'}</option>
                      {(providerModels[form.provider] ?? []).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Persona <span className="text-zinc-600">(opcional)</span></label>
                    <input
                      value={form.persona}
                      onChange={e => setForm({ ...form, persona: e.target.value })}
                      placeholder="Deixe vazio para usar o padrão"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-600 focus:border-forge-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleUpdate(agent.id)} disabled={loading}
                    className="px-3 py-1.5 rounded-lg bg-forge-500 text-white text-xs font-medium disabled:opacity-50">
                    Salvar
                  </button>
                  <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-300 text-xs">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0',
                    agent.isDefault
                      ? 'bg-gradient-to-br from-forge-500 to-forge-700'
                      : 'bg-gradient-to-br from-zinc-600 to-zinc-800'
                  )}>
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold">{agent.name}</h3>
                      {agent.isDefault && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-forge-500/15 text-forge-400 text-[10px] font-medium">
                          <Star className="w-3 h-3" /> DEFAULT
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 text-[10px] font-mono">
                        {agent.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        {agent.provider}/{agent.model}
                      </span>
                      <span>{agent.sessionCount} sessões</span>
                      <span>{agent.totalTokens.toLocaleString()} tokens</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(agent)}
                    title="Editar"
                    className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {!agent.isDefault && (
                    <button
                      onClick={() => handleDelete(agent.id)}
                      title="Remover"
                      className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {agents.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum agente encontrado</p>
          </div>
        )}
      </div>

      {/* ─── Sub-Agentes & Delegações ────────────── */}
      {delegations.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">Sub-Agentes & Delegações</h2>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium">
                {delegations.length}
              </span>
            </div>
            <button
              onClick={async () => {
                if (!confirm('Limpar todo o histórico de delegações?')) return;
                await api.clearDelegations();
                refresh();
              }}
              title="Limpar histórico"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar
            </button>
          </div>
          <div className="grid gap-3">
            {delegations.map(d => (
              <div key={d.id} className={cn(
                'p-4 rounded-xl border',
                d.status === 'completed' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
              )}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Bot className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <h3 className="text-white font-semibold text-sm truncate">{d.role}</h3>
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0',
                        d.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      )}>
                        {d.status === 'completed' ? <CheckCircle2 className="w-3 h-3 inline mr-0.5" /> : <AlertCircle className="w-3 h-3 inline mr-0.5" />}
                        {d.status}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-zinc-700/40 text-zinc-500 text-[10px]">
                        {d.source}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2 line-clamp-2">{d.task}</p>
                    {d.result && (
                      <p className="text-xs text-zinc-500 mb-2 line-clamp-2 italic">{d.result}</p>
                    )}
                    <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        {d.provider}/{d.model}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.round(d.duration / 1000)}s
                      </span>
                      <span>{d.steps} steps</span>
                      <span>{d.tokens.toLocaleString()} tokens</span>
                      <span>{new Date(d.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <button
                    onClick={async () => { await api.deleteDelegation(d.id); refresh(); }}
                    title="Remover"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0 ml-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {d.error && (
                  <div className="mt-2 px-2 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px]">
                    {d.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="mt-8 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Como funciona</h4>
        <ul className="text-xs text-zinc-500 space-y-1">
          <li>Cada agente tem seu próprio modelo, persona e permissões de tools</li>
          <li>No Chat, selecione qual agente deve responder usando o seletor acima do input</li>
          <li>Agentes podem se comunicar entre si via session tools (sessions_list, sessions_send)</li>
          <li>O agente DEFAULT é usado quando nenhum outro é especificado</li>
          <li><strong className="text-zinc-400">Forge Teams</strong>: equipes coordenadas de sub-agentes com grafos de dependência</li>
          <li><strong className="text-zinc-400">Delegações</strong>: histórico de tarefas delegadas a sub-agentes (agent_delegate + forge_team)</li>
        </ul>
      </div>
    </div>
  );
}


