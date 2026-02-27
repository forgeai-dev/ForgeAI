import { createLogger } from '@forgeai/shared';
import type { ThinkingLevel } from '@forgeai/shared';
import type { AgentManager } from '@forgeai/agent';
import type { AutopilotEngine } from '../autopilot/autopilot-engine.js';
import type { PairingManager } from '../pairing/pairing-manager.js';

const logger = createLogger('Core:ChatCommands');

// ─── Session settings (per-session overrides) ────────────────────────
export interface SessionSettings {
  verbose: boolean;
  usageMode: 'off' | 'tokens' | 'full';
  activation: 'mention' | 'always';
  thinkingLevel: ThinkingLevel;
}

const sessionSettings = new Map<string, SessionSettings>();

// ─── Autopilot reference (set by chat-routes) ────────────────────────
let autopilotRef: AutopilotEngine | null = null;

export function setAutopilotRef(engine: AutopilotEngine): void {
  autopilotRef = engine;
}

// ─── Pairing reference (set by chat-routes) ────────────────────────
let pairingRef: PairingManager | null = null;

export function setPairingRef(manager: PairingManager): void {
  pairingRef = manager;
}

function getSettings(sessionId: string): SessionSettings {
  if (!sessionSettings.has(sessionId)) {
    sessionSettings.set(sessionId, {
      verbose: false,
      usageMode: 'off',
      activation: 'mention',
      thinkingLevel: 'off',
    });
  }
  return sessionSettings.get(sessionId)!;
}

export function getSessionSettings(sessionId: string): SessionSettings {
  return getSettings(sessionId);
}

// ─── Command result ────────────────────────────
export interface CommandResult {
  handled: boolean;
  response?: string;
  pairingAction?: { userId: string; role: 'user' | 'admin' };
}

// ─── Uptime tracking ────────────────────────────
const startTime = Date.now();

function formatUptime(): string {
  const ms = Date.now() - startTime;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000) % 24;
  const d = Math.floor(ms / 86400000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ─── Main handler ────────────────────────────
export function handleChatCommand(
  message: string,
  sessionId: string,
  agentManager: AgentManager,
  options?: {
    channelType?: string;
    userId?: string;
    isGroup?: boolean;
    isAdmin?: boolean;
    restartFn?: () => void;
  },
): CommandResult {
  const trimmed = message.trim();

  // Must start with /
  if (!trimmed.startsWith('/')) return { handled: false };

  // Parse command and args
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = (spaceIdx > 0 ? trimmed.substring(0, spaceIdx) : trimmed).toLowerCase();
  const args = spaceIdx > 0 ? trimmed.substring(spaceIdx + 1).trim() : '';

  switch (cmd) {
    case '/status':
      return cmdStatus(sessionId, agentManager, options);

    case '/new':
    case '/reset':
      return cmdReset(sessionId, agentManager);

    case '/compact':
      return cmdCompact(sessionId, agentManager);

    case '/think':
      return cmdThink(sessionId, args, agentManager);

    case '/verbose':
      return cmdVerbose(sessionId, args);

    case '/usage':
      return cmdUsage(sessionId, args);

    case '/restart':
      return cmdRestart(options);

    case '/activation':
      return cmdActivation(sessionId, args);

    case '/help':
      return cmdHelp();

    case '/autopilot':
      return cmdAutopilot();

    case '/pair':
      return cmdPair(args, options);

    case '/stop':
      return cmdStop(sessionId, agentManager);

    default:
      return { handled: false };
  }
}

// ─── /status ────────────────────────────
function cmdStatus(
  sessionId: string,
  agentManager: AgentManager,
  options?: { channelType?: string; userId?: string; isGroup?: boolean },
): CommandResult {
  const agent = agentManager.getDefaultAgent();
  if (!agent) return { handled: true, response: '⚠️ Agente ainda nao inicializado.' };

  const config = agent.getConfig();
  const session = agent.getSessionInfo(sessionId);
  const settings = getSettings(sessionId);
  const msgs = session?.messageCount ?? 0;
  const tokens = session?.totalTokens ?? 0;

  const thinkEmoji = { off: '😴', low: '💭', medium: '🤔', high: '🧠' }[settings.thinkingLevel] ?? '💭';
  const activationEmoji = settings.activation === 'always' ? '📢' : '👋';

  const lines = [
    '╔══════════════════════════╗',
    '║    �  ForgeAI Status    ║',
    '╚══════════════════════════╝',
    '',
    `🤖  Modelo:    ${config.model}`,
    `�  Provider:  ${config.provider}`,
    `⏱️  Online ha: ${formatUptime()}`,
    options?.channelType ? `📡  Canal:     ${options.channelType}` : '',
    '',
    '── Sua Sessao ──────────────',
    `💬  Mensagens: ${msgs}`,
    `🔢  Tokens:    ${tokens.toLocaleString()}`,
    '',
    '── Configuracoes ───────────',
    `${thinkEmoji}  Raciocinio: ${settings.thinkingLevel === 'off' ? 'Desligado' : settings.thinkingLevel === 'low' ? 'Leve' : settings.thinkingLevel === 'medium' ? 'Medio' : 'Profundo'}`,
    `📝  Verboso:   ${settings.verbose ? 'Ligado' : 'Desligado'}`,
    `📊  Uso:       ${settings.usageMode === 'off' ? 'Oculto' : settings.usageMode === 'tokens' ? 'Resumido' : 'Detalhado'}`,
    `${activationEmoji}  Grupo:     ${settings.activation === 'always' ? 'Responde sempre' : 'So quando mencionado'}`,
    '',
    '💡 Digite /help para ver comandos',
  ].filter(Boolean);

  return { handled: true, response: lines.join('\n') };
}

// ─── /new, /reset ────────────────────────────
function cmdReset(sessionId: string, agentManager: AgentManager): CommandResult {
  const cleared = agentManager.clearSession(sessionId);
  sessionSettings.delete(sessionId);
  logger.info('Session reset via /new command', { sessionId });

  if (cleared) {
    return {
      handled: true,
      response: [
        '🔄  Sessao resetada!',
        '',
        '🧹  Historico limpo',
        '⚙️  Configuracoes restauradas',
        '✨  Pronto para uma nova conversa!',
        '',
        '💡  Dica: Mande qualquer mensagem para comecar.',
      ].join('\n'),
    };
  }
  return {
    handled: true,
    response: [
      '✨  Nova sessao iniciada!',
      '',
      '💡  Mande qualquer mensagem para comecar.',
    ].join('\n'),
  };
}

// ─── /compact ────────────────────────────
function cmdCompact(sessionId: string, agentManager: AgentManager): CommandResult {
  const agent = agentManager.getDefaultAgent();
  if (!agent) return { handled: true, response: '⚠️ Agente nao inicializado.' };

  const session = agent.getSessionInfo(sessionId);
  if (!session || session.messageCount === 0) {
    return {
      handled: true,
      response: [
        '📭  Sessao vazia!',
        '',
        'Nao tem nada para compactar.',
        'Comece uma conversa primeiro!',
      ].join('\n'),
    };
  }

  const beforeTokens = session.totalTokens;
  const beforeMsgs = session.messageCount;

  const history = agent.getHistoryMessages(sessionId);
  if (history.length <= 4) {
    return {
      handled: true,
      response: [
        '✅  Sessao ja esta enxuta!',
        '',
        `📋  So tem ${history.length} mensagens.`,
        '     Nao precisa compactar.',
      ].join('\n'),
    };
  }

  const oldMessages = history.slice(0, -4);
  agent.clearHistory(sessionId);

  logger.info('Session compacted via /compact', { sessionId, beforeMsgs, removed: oldMessages.length });

  const saved = Math.round((oldMessages.length / beforeMsgs) * 100);

  return {
    handled: true,
    response: [
      '📦  Sessao compactada!',
      '',
      `   Antes:   ${beforeMsgs} msgs (~${beforeTokens.toLocaleString()} tokens)`,
      `   Removeu: ${oldMessages.length} msgs antigas`,
      `   Ficou:   4 msgs recentes`,
      `   Economia: ~${saved}%`,
      '',
      '✅  Conversa continua normalmente!',
      '',
      '💡  Dica: Use /compact quando o bot',
      '     ficar lento (muito contexto).',
    ].join('\n'),
  };
}

// ─── /think ────────────────────────────
function cmdThink(sessionId: string, args: string, agentManager: AgentManager): CommandResult {
  const validLevels: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
  const level = args.toLowerCase() as ThinkingLevel;

  const levelInfo: Record<string, { emoji: string; name: string; desc: string }> = {
    off:    { emoji: '😴', name: 'Desligado', desc: 'Resposta direta, mais rapida' },
    low:    { emoji: '💭', name: 'Leve',      desc: 'Pensa um pouco antes de responder' },
    medium: { emoji: '🤔', name: 'Medio',     desc: 'Analisa com cuidado' },
    high:   { emoji: '🧠', name: 'Profundo',  desc: 'Maximo raciocinio (mais lento)' },
  };

  if (!args) {
    const current = getSettings(sessionId).thinkingLevel;
    const info = levelInfo[current];
    return {
      handled: true,
      response: [
        '🧠  Nivel de Raciocinio',
        '',
        `   Atual: ${info.emoji} ${info.name}`,
        '',
        '── Opcoes ──────────────────',
        ...Object.entries(levelInfo).map(([k, v]) =>
          `   ${current === k ? '▸' : ' '} ${v.emoji} /think ${k}  ${v.name}`,
        ),
        '',
        `💡  Exemplo: /think high`,
      ].join('\n'),
    };
  }

  if (!validLevels.includes(level)) {
    return {
      handled: true,
      response: [
        `❌  "${args}" nao e valido!`,
        '',
        '   Use: /think off | low | medium | high',
      ].join('\n'),
    };
  }

  getSettings(sessionId).thinkingLevel = level;
  const agent = agentManager.getDefaultAgent();
  if (agent) agent.setThinkingLevel(level);

  const info = levelInfo[level];
  logger.info('Thinking level changed via /think', { sessionId, level });

  return {
    handled: true,
    response: [
      `${info.emoji}  Raciocinio: ${info.name}`,
      `   ${info.desc}`,
    ].join('\n'),
  };
}

// ─── /verbose ────────────────────────────
function cmdVerbose(sessionId: string, args: string): CommandResult {
  if (!args) {
    const current = getSettings(sessionId).verbose;
    return {
      handled: true,
      response: [
        '📝  Modo Verboso',
        '',
        `   Atual: ${current ? '✅ Ligado' : '❌ Desligado'}`,
        '',
        current
          ? '   O bot explica o raciocinio dele.'
          : '   O bot responde de forma direta.',
        '',
        `💡  Use: /verbose ${current ? 'off' : 'on'}  para ${current ? 'desligar' : 'ligar'}`,
      ].join('\n'),
    };
  }

  const val = args.toLowerCase();
  if (val !== 'on' && val !== 'off') {
    return {
      handled: true,
      response: [
        `❌  "${args}" nao e valido!`,
        '',
        '   Use: /verbose on  (respostas detalhadas)',
        '   Ou:  /verbose off (respostas diretas)',
      ].join('\n'),
    };
  }

  getSettings(sessionId).verbose = val === 'on';
  logger.info('Verbose mode changed', { sessionId, verbose: val });

  return {
    handled: true,
    response: val === 'on'
      ? '📝  Modo verboso ligado!\n   Agora explico meu raciocinio.'
      : '📝  Modo verboso desligado!\n   Respostas mais diretas.',
  };
}

// ─── /usage ────────────────────────────
function cmdUsage(sessionId: string, args: string): CommandResult {
  const validModes = ['off', 'tokens', 'full'];
  const modeInfo: Record<string, { emoji: string; name: string; desc: string }> = {
    off:    { emoji: '🔇', name: 'Oculto',    desc: 'Sem info de uso nas respostas' },
    tokens: { emoji: '🔢', name: 'Resumido',  desc: 'Mostra total de tokens usado' },
    full:   { emoji: '📊', name: 'Detalhado', desc: 'Tokens + custo + tempo + modelo' },
  };

  if (!args) {
    const current = getSettings(sessionId).usageMode;
    const info = modeInfo[current];
    return {
      handled: true,
      response: [
        '📊  Info de Uso por Resposta',
        '',
        `   Atual: ${info.emoji} ${info.name}`,
        '',
        '── Opcoes ──────────────────',
        ...Object.entries(modeInfo).map(([k, v]) =>
          `   ${current === k ? '▸' : ' '} ${v.emoji} /usage ${k}  ${v.name}`,
        ),
        '',
        '💡  Com /usage full, cada resposta',
        '     mostra quantos tokens gastou.',
      ].join('\n'),
    };
  }

  const mode = args.toLowerCase();
  if (!validModes.includes(mode)) {
    return {
      handled: true,
      response: [
        `❌  "${args}" nao e valido!`,
        '',
        '   Use: /usage off | tokens | full',
      ].join('\n'),
    };
  }

  getSettings(sessionId).usageMode = mode as 'off' | 'tokens' | 'full';
  const info = modeInfo[mode];
  logger.info('Usage mode changed', { sessionId, mode });

  return {
    handled: true,
    response: `${info.emoji}  Uso: ${info.name}\n   ${info.desc}`,
  };
}

// ─── /restart ────────────────────────────
function cmdRestart(options?: { isAdmin?: boolean; restartFn?: () => void }): CommandResult {
  if (!options?.isAdmin) {
    return {
      handled: true,
      response: [
        '🔒  Comando exclusivo de admin!',
        '',
        '   Somente administradores podem',
        '   reiniciar o gateway.',
      ].join('\n'),
    };
  }

  if (options.restartFn) {
    setTimeout(() => options.restartFn!(), 1000);
    return {
      handled: true,
      response: [
        '🔄  Reiniciando gateway...',
        '',
        '   O bot vai desconectar e voltar',
        '   em alguns segundos.',
      ].join('\n'),
    };
  }

  return {
    handled: true,
    response: '⚠️  Restart nao disponivel neste contexto.',
  };
}

// ─── /activation ────────────────────────────
function cmdActivation(sessionId: string, args: string): CommandResult {
  const modeInfo: Record<string, { emoji: string; name: string; desc: string }> = {
    mention: { emoji: '👋', name: 'Mencao',  desc: 'Responde so quando @mencionado no grupo' },
    always:  { emoji: '📢', name: 'Sempre',  desc: 'Responde toda mensagem do grupo' },
  };

  if (!args) {
    const current = getSettings(sessionId).activation;
    const info = modeInfo[current];
    return {
      handled: true,
      response: [
        '🎯  Ativacao em Grupo',
        '',
        `   Atual: ${info.emoji} ${info.name}`,
        `   ${info.desc}`,
        '',
        '── Opcoes ──────────────────',
        ...Object.entries(modeInfo).map(([k, v]) =>
          `   ${current === k ? '▸' : ' '} ${v.emoji} /activation ${k}`,
        ),
        '',
        '💡  "mention" e mais seguro em',
        '     grupos com muita gente.',
      ].join('\n'),
    };
  }

  const mode = args.toLowerCase();
  if (!Object.keys(modeInfo).includes(mode)) {
    return {
      handled: true,
      response: [
        `❌  "${args}" nao e valido!`,
        '',
        '   Use: /activation mention',
        '   Ou:  /activation always',
      ].join('\n'),
    };
  }

  getSettings(sessionId).activation = mode as 'mention' | 'always';
  const info = modeInfo[mode];
  logger.info('Activation mode changed', { sessionId, mode });

  return {
    handled: true,
    response: `${info.emoji}  Grupo: ${info.name}\n   ${info.desc}`,
  };
}

// ─── /autopilot ────────────────────────────
function cmdAutopilot(): CommandResult {
  if (!autopilotRef) {
    return {
      handled: true,
      response: [
        '🤖  Autopilot nao esta ativo.',
        '',
        '💡  Para ativar, crie o arquivo:',
        '     .forgeai/AUTOPILOT.md',
        '',
        '     Com suas tarefas automaticas.',
        '     Ex: - @morning Bom dia!',
      ].join('\n'),
    };
  }

  const status = autopilotRef.getStatus();

  if (status.taskCount === 0) {
    return {
      handled: true,
      response: [
        '🤖  Autopilot',
        '',
        `   Status: ${status.running ? '✅ Ligado' : '⏸️ Parado'}`,
        '   Tarefas: Nenhuma ativa',
        '',
        '💡  Edite .forgeai/AUTOPILOT.md',
        '     para adicionar tarefas.',
        '',
        '── Exemplo ─────────────────',
        '   ## Rotinas Diarias',
        '   - @morning Bom dia! Resumo do dia',
        '   - @evening Resumo: o que foi feito',
        '',
        '   ## Monitoramento',
        '   - @hourly Checar se meu site esta online',
      ].join('\n'),
    };
  }

  const scheduleLabel: Record<string, string> = {
    startup: '🚀 Ao iniciar',
    hourly: '🕐 A cada hora',
    morning: '🌅 De manha',
    afternoon: '☀️ A tarde',
    evening: '🌙 A noite',
    custom: '🔄 Periodico',
  };

  const taskLines = status.tasks.map(t => {
    const label = scheduleLabel[t.schedule] ?? '🔄';
    const runs = t.runCount > 0 ? ` (${t.runCount}x)` : '';
    return `   ${label}  ${t.text}${runs}`;
  });

  return {
    handled: true,
    response: [
      '╔══════════════════════════╗',
      '║   🤖  Autopilot Status   ║',
      '╚══════════════════════════╝',
      '',
      `   Status:    ${status.running ? '✅ Ligado' : '⏸️ Parado'}`,
      `   Tarefas:   ${status.taskCount}`,
      `   Intervalo: ${status.intervalMinutes} min`,
      '',
      '── Tarefas Ativas ──────────',
      ...taskLines,
      '',
      '💡  Edite .forgeai/AUTOPILOT.md',
      '     para modificar tarefas.',
      '',
      '── Horarios ────────────────',
      '   @startup    Ao iniciar o bot',
      '   @hourly     A cada hora',
      '   @morning    De manha (7-9h)',
      '   @afternoon  A tarde (12-14h)',
      '   @evening    A noite (18-20h)',
    ].join('\n'),
  };
}

// ─── /pair ────────────────────────────
function cmdPair(
  args: string,
  options?: { channelType?: string; userId?: string },
): CommandResult {
  if (!pairingRef) {
    return {
      handled: true,
      response: [
        '🔗  Pareamento nao esta disponivel.',
        '',
        '💡  O admin precisa ativar o sistema',
        '     de pareamento no servidor.',
      ].join('\n'),
    };
  }

  if (!args) {
    return {
      handled: true,
      response: [
        '╔══════════════════════════╗',
        '║   🔗  Pareamento         ║',
        '╚══════════════════════════╝',
        '',
        '   Use: /pair CODIGO',
        '',
        '── Como funciona ───────────',
        '   1. O admin gera um codigo',
        '      no Dashboard ou via API',
        '   2. Voce digita: /pair FORGE-XXXX-XXXX',
        '   3. Pronto! Voce esta conectado.',
        '',
        '💡  Peca o codigo pro admin.',
      ].join('\n'),
    };
  }

  const userId = options?.userId;
  if (!userId) {
    return {
      handled: true,
      response: '❌  Nao foi possivel identificar seu usuario.',
    };
  }

  const result = pairingRef.redeem(args, userId, options?.channelType);

  if (result.success) {
    logger.info('User paired successfully', { userId, channel: options?.channelType, role: result.role });
    return {
      handled: true,
      response: [
        '╔══════════════════════════╗',
        '║   ✅  Pareado!            ║',
        '╚══════════════════════════╝',
        '',
        `   👤  ID: ${userId}`,
        `   🎭  Nivel: ${result.role === 'admin' ? '👑 Admin' : '👤 Usuario'}`,
        '',
        '   Agora voce pode conversar',
        '   comigo normalmente! 🎉',
        '',
        '💡  Digite /help para ver',
        '     todos os comandos.',
      ].join('\n'),
      pairingAction: { userId, role: result.role! },
    };
  }

  return {
    handled: true,
    response: [
      '❌  Pareamento falhou',
      '',
      `   ${result.message}`,
      '',
      '💡  Verifique o codigo e tente',
      '     novamente: /pair CODIGO',
    ].join('\n'),
  };
}

// ─── /stop ────────────────────────────
function cmdStop(sessionId: string, agentManager: AgentManager): CommandResult {
  const aborted = agentManager.abortSession(sessionId);
  if (aborted) {
    logger.info('Agent execution stopped via /stop command', { sessionId });
    return {
      handled: true,
      response: [
        '⏹️  Execucao parada!',
        '',
        '🛑  O agente foi interrompido.',
        '     A resposta parcial foi descartada.',
        '',
        '💡  Mande qualquer mensagem para',
        '     continuar normalmente.',
      ].join('\n'),
    };
  }
  return {
    handled: true,
    response: [
      '✅  Nenhuma execucao ativa',
      '',
      '     O agente nao esta processando',
      '     nada nesta sessao agora.',
    ].join('\n'),
  };
}

// ─── /help ────────────────────────────
function cmdHelp(): CommandResult {
  return {
    handled: true,
    response: [
      '╔══════════════════════════╗',
      '║   🔥 ForgeAI - Comandos  ║',
      '╚══════════════════════════╝',
      '',
      '── Conversa ────────────────',
      '  /new      Comecar conversa do zero',
      '  /stop     Parar execucao do agente',
      '  /compact  Limpar historico antigo',
      '            (economiza tokens)',
      '',
      '── Informacoes ─────────────',
      '  /status     Ver status completo',
      '  /autopilot  Tarefas automaticas',
      '  /help       Esta lista de comandos',
      '',
      '── Ajustes ─────────────────',
      '  /think    Nivel de raciocinio',
      '            off | low | medium | high',
      '  /verbose  Respostas detalhadas',
      '            on | off',
      '  /usage    Info de consumo',
      '            off | tokens | full',
      '',
      '── Grupos ──────────────────',
      '  /activation  Quando responder',
      '               mention | always',
      '',
      '── Acesso ──────────────────',
      '  /pair CODIGO  Parear com codigo',
      '',
      '── Admin ───────────────────',
      '  /restart  Reiniciar o gateway',
      '',
      '💡  Exemplo: /think high',
      '💡  Exemplo: /pair FORGE-A1B2-C3D4',
    ].join('\n'),
  };
}

// ─── Usage footer helper ────────────────────────────
export function formatUsageFooter(
  sessionId: string,
  result: { usage: { promptTokens: number; completionTokens: number; totalTokens: number; thinkingTokens?: number }; cost?: number; model: string; duration: number },
): string {
  const settings = getSettings(sessionId);
  if (settings.usageMode === 'off') return '';

  if (settings.usageMode === 'tokens') {
    return `\n\n── 📊 ${result.usage.totalTokens.toLocaleString()} tokens ──`;
  }

  // full mode
  const lines = [
    '',
    '── 📊 Uso ──────────────────',
    `   ${result.usage.promptTokens.toLocaleString()} entrada + ${result.usage.completionTokens.toLocaleString()} saida = ${result.usage.totalTokens.toLocaleString()} total`,
  ];
  if (result.usage.thinkingTokens) {
    lines.push(`   🧠 ${result.usage.thinkingTokens.toLocaleString()} tokens de raciocinio`);
  }
  if (result.cost != null && result.cost > 0) {
    lines.push(`   💰 Custo: $${result.cost.toFixed(4)}`);
  }
  lines.push(`   ⏱️ ${(result.duration / 1000).toFixed(1)}s | 🤖 ${result.model}`);

  return lines.join('\n');
}
