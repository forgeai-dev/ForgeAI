import { useState, useEffect, useCallback } from 'react';
import { Save, Check, Loader2, FileText, Eye, EyeOff, RotateCcw, Brain, Heart, User, Bot, Clock } from 'lucide-react';
import { api, type WorkspacePromptFile } from '@/lib/api';

const FILE_ICONS: Record<string, React.ReactNode> = {
  'AGENTS.md': <Bot className="w-4 h-4" />,
  'SOUL.md': <Heart className="w-4 h-4" />,
  'IDENTITY.md': <FileText className="w-4 h-4" />,
  'USER.md': <User className="w-4 h-4" />,
  'AUTOPILOT.md': <Clock className="w-4 h-4" />,
};

const FILE_DESCRIPTIONS: Record<string, string> = {
  'AGENTS.md': 'Define como o agente se comporta, regras de execução e abordagem para tarefas.',
  'SOUL.md': 'Define a personalidade, tom de comunicação e estilo do agente.',
  'IDENTITY.md': 'Define quem o agente é — nome, papel e contexto.',
  'USER.md': 'Suas preferências pessoais — tech stack, projetos, informações sobre você.',
  'AUTOPILOT.md': 'Tarefas automáticas agendadas — @startup, @hourly, @morning, @afternoon, @evening.',
};

const isAutopilotFile = (filename: string) => filename === 'AUTOPILOT.md';

export function WorkspacePage() {
  const [files, setFiles] = useState<WorkspacePromptFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const res = await api.getWorkspacePrompts();
      setFiles(res.files ?? []);
      if (!activeFile && res.files?.length > 0) {
        const first = res.files[0];
        setActiveFile(first.filename);
        setEditContent(first.content);
        setOriginalContent(first.content);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeFile]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const selectFile = (filename: string) => {
    const file = files.find(f => f.filename === filename);
    if (file) {
      setActiveFile(filename);
      setEditContent(file.content);
      setOriginalContent(file.content);
      setSaved(false);
      setPreview(false);
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      await api.saveWorkspacePrompt(activeFile, editContent);
      setSaved(true);
      setOriginalContent(editContent);
      // Refresh files to update active status
      const res = await api.getWorkspacePrompts();
      setFiles(res.files ?? []);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleReset = () => {
    setEditContent(originalContent);
    setSaved(false);
  };

  const hasChanges = editContent !== originalContent;
  const activeFileData = files.find(f => f.filename === activeFile);
  const activeCount = files.filter(f => f.active).length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-forge-400" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-forge-400" />
          Workspace Prompts
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Personalize o comportamento, personalidade e identidade do agente editando os arquivos abaixo.
          Arquivos customizados são injetados automaticamente no system prompt.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar - File list */}
        <div className="w-56 shrink-0 space-y-2">
          <div className="text-xs text-zinc-500 font-medium mb-3">
            {activeCount}/{files.length} ativos
          </div>
          {files.map(file => (
            <button
              key={file.filename}
              onClick={() => selectFile(file.filename)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-2.5 ${
                activeFile === file.filename
                  ? 'bg-forge-500/20 text-forge-400 border border-forge-500/30'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent'
              }`}
            >
              <span className={activeFile === file.filename ? 'text-forge-400' : 'text-zinc-500'}>
                {FILE_ICONS[file.filename] ?? <FileText className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{file.filename}</div>
                <div className="text-[10px] text-zinc-600">{file.label}</div>
              </div>
              {file.active && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Ativo no prompt" />
              )}
            </button>
          ))}

          <div className="mt-4 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 text-[11px] text-zinc-500 space-y-1">
            <p><strong className="text-zinc-400">Como funciona:</strong></p>
            <p>Edite qualquer arquivo e salve. Os prompts são injetados no system prompt automaticamente.</p>
            <p>O AUTOPILOT.md define tarefas automáticas que o agente executa em horários configurados.</p>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 space-y-3">
          {activeFile && activeFileData && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    {FILE_ICONS[activeFile]}
                    {activeFile}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {FILE_DESCRIPTIONS[activeFile] ?? activeFileData.label}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeFileData.active && isAutopilotFile(activeFile) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                      Autopilot rodando
                    </span>
                  )}
                  {activeFileData.active && !isAutopilotFile(activeFile) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                      Ativo no prompt
                    </span>
                  )}
                  {!activeFileData.active && isAutopilotFile(activeFile) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-500">
                      Autopilot parado
                    </span>
                  )}
                  {!activeFileData.active && !isAutopilotFile(activeFile) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-500">
                      Template padrão (não injetado)
                    </span>
                  )}
                  <button
                    title={preview ? 'Editar' : 'Preview'}
                    onClick={() => setPreview(!preview)}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {preview ? (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 min-h-[400px] prose prose-invert prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-mono leading-relaxed">{editContent}</pre>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => { setEditContent(e.target.value); setSaved(false); }}
                  placeholder="Edite o conteúdo aqui..."
                  className="w-full min-h-[400px] bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-sm text-zinc-200 font-mono leading-relaxed placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-forge-500/50 resize-y"
                  spellCheck={false}
                />
              )}

              <div className="flex items-center justify-between">
                <div className="text-[11px] text-zinc-600">
                  {editContent.length} caracteres
                  {editContent.length > 4000 && (
                    <span className="text-amber-400 ml-2">
                      ⚠ Será truncado para 4000 chars no prompt
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <button
                      onClick={handleReset}
                      title="Desfazer alterações"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Desfazer
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      saved
                        ? 'bg-emerald-500 text-white'
                        : saving
                          ? 'bg-forge-500/50 text-white cursor-wait'
                          : hasChanges
                            ? 'bg-forge-500 hover:bg-forge-600 text-white'
                            : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    {saved ? <Check className="w-4 h-4" /> : saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saved ? 'Salvo!' : 'Salvar'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkspacePage;
