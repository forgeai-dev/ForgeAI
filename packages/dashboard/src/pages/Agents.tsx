import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Trash2, Pencil, Users, Star, Cpu, X } from 'lucide-react';
import { api, type AgentInfo } from '@/lib/api';
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
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewAgentForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    api.getAgents().then(d => setAgents(d.agents)).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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

  const startEdit = (agent: AgentInfo) => {
    setEditingId(agent.id);
    setForm({ id: agent.id, name: agent.name, persona: '', model: agent.model, provider: agent.provider });
    setShowForm(false);
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
                onChange={e => setForm({ ...form, provider: e.target.value })}
                title="Selecionar provider"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
              >
                <option value="">Mesmo do default</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="moonshot">Moonshot (Kimi)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="groq">Groq</option>
                <option value="mistral">Mistral</option>
                <option value="xai">xAI (Grok)</option>
                <option value="local">Local LLM (Ollama)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Modelo (opcional)</label>
              <input
                value={form.model}
                onChange={e => setForm({ ...form, model: e.target.value })}
                placeholder="ex: gpt-4o, claude-sonnet-4-20250514"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-forge-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-zinc-400 mb-1">Persona / System Prompt</label>
            <textarea
              value={form.persona}
              onChange={e => setForm({ ...form, persona: e.target.value })}
              placeholder="Descreva a personalidade e especialidade deste agente..."
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
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Nome"
                    className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                  />
                  <input
                    value={form.persona}
                    onChange={e => setForm({ ...form, persona: e.target.value })}
                    placeholder="Persona (opcional)"
                    className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white focus:border-forge-500 focus:outline-none"
                  />
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

      {/* Info */}
      <div className="mt-8 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Como funciona</h4>
        <ul className="text-xs text-zinc-500 space-y-1">
          <li>Cada agente tem seu próprio modelo, persona e permissões de tools</li>
          <li>No Chat, selecione qual agente deve responder usando o seletor acima do input</li>
          <li>Agentes podem se comunicar entre si via session tools (sessions_list, sessions_send)</li>
          <li>O agente DEFAULT é usado quando nenhum outro é especificado</li>
        </ul>
      </div>
    </div>
  );
}
