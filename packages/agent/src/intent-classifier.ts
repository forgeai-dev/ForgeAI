import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:IntentClassifier');

// ═══════════════════════════════════════════════════════════
//  INTENT CLASSIFIER
//  Pre-processes user messages to determine complexity,
//  detect ambiguity, and route to the right execution path.
//  Zero extra LLM calls — pure heuristic for speed.
// ═══════════════════════════════════════════════════════════

export type IntentType = 'simple' | 'complex' | 'ambiguous' | 'followup' | 'greeting';

export interface IntentResult {
  type: IntentType;
  confidence: number;         // 0-1
  reason: string;             // human-readable explanation
  suggestedAction: SuggestedAction;
  contextHint?: string;       // hint to inject into system prompt
  skipTools?: boolean;        // if true, respond without tool loop
  disambiguationOptions?: string[]; // possible interpretations for ambiguous msgs
}

export type SuggestedAction =
  | 'respond_directly'      // simple/greeting — no tools needed
  | 'clarify_first'         // ambiguous — ask user what they mean
  | 'plan_and_execute'      // complex — create plan, then execute step by step
  | 'continue_workflow'     // followup — continue existing workflow
  | 'extract_context_first' // complex but vague — extract context before planning
  ;

// ─── Pattern definitions ─────────────────────────────────

const GREETING_PATTERNS = [
  /^(oi|olá|ola|hey|hi|hello|e aí|eai|fala|bom dia|boa tarde|boa noite|good morning|good afternoon|good evening|yo|opa|salve)(?:\b|$)/i,
  /^(como vai|how are you|tudo bem|tudo certo|beleza|blz|suave)\??$/i,
];

const STATUS_CHECK_PATTERNS = [
  /^(online|está aí|ta ai|tá aí|you there|are you there|alive|ping|test|teste)\??$/i,
  /^(funciona|working|funcionando|está funcionando|tá funcionando)\??$/i,
  /^(status|uptime)\??$/i,
];

const YES_NO_PATTERNS = [
  /^(sim|s|yes|y|yeah|yep|yup|claro|com certeza|pode|ok|okay|blz|beleza|tranquilo|bora|vamos|dale|go|sure|of course)(?:\b|$)\.?$/i,
  /^(não|nao|n|no|nope|nah|negativo|cancel|cancelar|para|stop)(?:\b|$)\.?$/i,
];

const THANKS_PATTERNS = [
  /^(obrigad[oa]|vlw|valeu|thanks|thank you|thx|ty|grato|agradecido|tmj|show|massa)\b/i,
];

const FOLLOWUP_PATTERNS = [
  /^(continua|continue|segue|prossiga|go on|go ahead|next|próximo|proximo)\b/i,
  /^(e agora|and now|what'?s next|o que mais)\b/i,
  /^(isso|that|esse|this|aquele|aquilo)\b/i,
  /\b(o que (vc|você|voce) (disse|falou|fez|mencionou))\b/i,
  /\b(muda|change|altera|modifica|ajusta|adiciona|add|remove|tira)\b.*\b(isso|that|esse|aquilo|it)\b/i,
];

const COMPLEX_INDICATORS = [
  /\b(cri[ea]|create|build|make|faz|faça|faca|gera|generate|implement|construa|desenvolv|develop)\b/i,
  /\b(configur[ea]|setup|set up|instala?|install|deploy|implanta)\b/i,
  /\b(site|app|aplicação|aplicativo|application|sistema|system|projeto|project|api|backend|frontend|server|servidor|bot)\b/i,
  /\b(integra|connect|conecta|automatiz|automate|monitor|agenda|schedul)\b/i,
  /\b(analisa|analy[sz]e|pesquisa|research|investig|busca|search|scrape|crawl|extrai|extract)\b/i,
  /\b(database|banco de dados|mysql|sqlite|redis|mongo)\b/i,
  /\b(docker|kubernetes|nginx|pm2|systemd|cron)\b/i,
];

const AMBIGUOUS_SINGLE_WORDS = new Set([
  'online', 'offline', 'status', 'ajuda', 'help', 'info', 'informação',
  'mais', 'more', 'detalhes', 'details', 'explica', 'explain',
  'mostra', 'show', 'lista', 'list', 'envia', 'send', 'abre', 'open',
  'roda', 'run', 'executa', 'execute', 'para', 'stop', 'inicia', 'start',
  'atualiza', 'update', 'limpa', 'clean', 'clear', 'reseta', 'reset',
]);

// Words that could mean different things depending on context
const DISAMBIGUATION_MAP: Record<string, { question: string; options: string[] }> = {
  'online': {
    question: 'Quando você diz "online", você quer saber:',
    options: [
      'Se eu (ForgeAI) estou online e funcionando?',
      'O status de algum serviço ou servidor?',
      'Se alguma pessoa/bot está online?',
      'Outra coisa? Me explique melhor.',
    ],
  },
  'status': {
    question: 'Sobre qual status você quer saber:',
    options: [
      'Status geral do ForgeAI (modelo, sessão, uptime)?',
      'Status de algum serviço rodando no servidor?',
      'Status de alguma tarefa ou workflow?',
      'Use /status para ver o status do sistema.',
    ],
  },
  'ajuda': {
    question: 'Posso ajudar! Sobre o que você precisa:',
    options: [
      'Lista de comandos disponíveis? Use /help',
      'Como usar uma ferramenta específica?',
      'Ajuda com um projeto ou código?',
      'Outra coisa? Me explique o que precisa.',
    ],
  },
  'help': {
    question: 'I can help! What do you need:',
    options: [
      'List of available commands? Use /help',
      'How to use a specific tool?',
      'Help with a project or code?',
      'Something else? Tell me more.',
    ],
  },
};

// ─── Classifier ──────────────────────────────────────────

export function classifyIntent(
  message: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): IntentResult {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // Skip classification for slash commands — they have their own handlers
  if (trimmed.startsWith('/')) {
    return {
      type: 'simple',
      confidence: 1.0,
      reason: 'Slash command',
      suggestedAction: 'respond_directly',
      skipTools: true,
    };
  }

  // 1. Greetings
  if (GREETING_PATTERNS.some(p => p.test(trimmed))) {
    return {
      type: 'greeting',
      confidence: 0.95,
      reason: 'Greeting detected',
      suggestedAction: 'respond_directly',
      skipTools: true,
      contextHint: 'The user is greeting you. Respond warmly and briefly. Ask how you can help.',
    };
  }

  // 2. Status checks
  if (STATUS_CHECK_PATTERNS.some(p => p.test(trimmed))) {
    return {
      type: 'simple',
      confidence: 0.9,
      reason: 'Status check',
      suggestedAction: 'respond_directly',
      skipTools: true,
      contextHint: 'The user is checking if you are online/working. Confirm you are active and ready. Be brief.',
    };
  }

  // 3. Yes/No answers
  if (YES_NO_PATTERNS.some(p => p.test(trimmed))) {
    const hasHistory = conversationHistory && conversationHistory.length >= 2;
    if (hasHistory) {
      return {
        type: 'followup',
        confidence: 0.85,
        reason: 'Yes/No response to previous context',
        suggestedAction: 'continue_workflow',
        contextHint: 'The user is responding yes/no to your previous message. Act accordingly based on conversation context.',
      };
    }
    return {
      type: 'ambiguous',
      confidence: 0.6,
      reason: 'Yes/No without context',
      suggestedAction: 'clarify_first',
      contextHint: 'The user sent a yes/no without prior context. Ask what they are referring to.',
    };
  }

  // 4. Thanks
  if (THANKS_PATTERNS.some(p => p.test(trimmed))) {
    return {
      type: 'simple',
      confidence: 0.9,
      reason: 'Thanks/acknowledgment',
      suggestedAction: 'respond_directly',
      skipTools: true,
      contextHint: 'The user is thanking you. Respond briefly and warmly.',
    };
  }

  // 5. Followup patterns
  if (FOLLOWUP_PATTERNS.some(p => p.test(trimmed))) {
    return {
      type: 'followup',
      confidence: 0.8,
      reason: 'Followup/continuation request',
      suggestedAction: 'continue_workflow',
      contextHint: 'The user wants to continue from where you left off. Check conversation history for context.',
    };
  }

  // 6. Ambiguous single words or very short messages
  if (wordCount <= 2) {
    const singleWord = lower.replace(/[?!.]+$/, '').trim();
    
    // Check disambiguation map
    if (DISAMBIGUATION_MAP[singleWord]) {
      const disambig = DISAMBIGUATION_MAP[singleWord];
      return {
        type: 'ambiguous',
        confidence: 0.85,
        reason: `Ambiguous single word: "${singleWord}"`,
        suggestedAction: 'clarify_first',
        contextHint: `IMPORTANT: The user sent an ambiguous message "${trimmed}". Do NOT assume what they mean. Instead, ask for clarification. ${disambig.question}\n${disambig.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
        disambiguationOptions: disambig.options,
      };
    }

    // Check if it's a known ambiguous word
    if (AMBIGUOUS_SINGLE_WORDS.has(singleWord)) {
      // If there's conversation history, treat as followup
      const hasRecentContext = conversationHistory && conversationHistory.length >= 2;
      if (hasRecentContext) {
        return {
          type: 'followup',
          confidence: 0.7,
          reason: `Short message with conversation context: "${singleWord}"`,
          suggestedAction: 'continue_workflow',
          contextHint: `The user sent "${trimmed}". Use conversation history to understand what they mean.`,
        };
      }

      return {
        type: 'ambiguous',
        confidence: 0.75,
        reason: `Ambiguous short message: "${singleWord}"`,
        suggestedAction: 'clarify_first',
        contextHint: `The user sent "${trimmed}" without context. This is ambiguous. Ask what specifically they mean by this — what do they want you to do? Don't assume.`,
      };
    }
  }

  // 7. Complex task detection
  const complexScore = COMPLEX_INDICATORS.reduce((score, pattern) => {
    return score + (pattern.test(trimmed) ? 1 : 0);
  }, 0);

  // Long messages (>30 words) are likely complex
  const lengthScore = wordCount > 50 ? 2 : wordCount > 30 ? 1.5 : wordCount > 15 ? 1 : 0;
  const totalComplexity = complexScore + lengthScore;

  if (totalComplexity >= 2) {
    // High complexity — needs planning
    const isVague = wordCount < 10 && complexScore >= 2;
    return {
      type: 'complex',
      confidence: Math.min(0.95, 0.6 + totalComplexity * 0.1),
      reason: `Complex task (score: ${totalComplexity})`,
      suggestedAction: isVague ? 'extract_context_first' : 'plan_and_execute',
      contextHint: isVague
        ? 'The user has a complex request but provided little context. Before planning, ask clarifying questions: What technology/language? What specific features? Any references or examples?'
        : 'This is a complex task. Create a plan (plan_create) before starting. Break it into clear steps.',
    };
  }

  if (totalComplexity >= 1) {
    // Medium complexity — might need tools but not necessarily a full plan
    return {
      type: 'complex',
      confidence: 0.6,
      reason: `Medium complexity task (score: ${totalComplexity})`,
      suggestedAction: 'plan_and_execute',
    };
  }

  // 8. Simple questions (no complex indicators, moderate length)
  if (wordCount <= 15 && complexScore === 0) {
    return {
      type: 'simple',
      confidence: 0.6,
      reason: 'Short message without complex indicators',
      suggestedAction: 'respond_directly',
      contextHint: 'This appears to be a simple question. Respond concisely. Only use tools if actually needed.',
    };
  }

  // 9. Default — treat as potentially complex
  return {
    type: 'complex',
    confidence: 0.5,
    reason: 'Default classification',
    suggestedAction: 'plan_and_execute',
  };
}

// ─── Utility: build context hint for injection into system prompt ───

export function buildIntentContext(intent: IntentResult): string | null {
  if (!intent.contextHint) return null;

  const parts: string[] = [];

  parts.push(`--- Message Intelligence ---`);
  parts.push(`Classification: ${intent.type} (${Math.round(intent.confidence * 100)}% confidence)`);
  parts.push(`Action: ${intent.suggestedAction.replace(/_/g, ' ')}`);
  parts.push(intent.contextHint);

  if (intent.disambiguationOptions) {
    parts.push(`\nSuggested disambiguation options to present to user:`);
    for (const opt of intent.disambiguationOptions) {
      parts.push(`- ${opt}`);
    }
  }

  return parts.join('\n');
}

// ─── Logging helper ───

export function logIntent(sessionId: string, message: string, intent: IntentResult): void {
  const preview = message.length > 60 ? message.substring(0, 60) + '...' : message;
  logger.info(`Intent: ${intent.type} (${Math.round(intent.confidence * 100)}%) → ${intent.suggestedAction}`, {
    sessionId,
    message: preview,
    reason: intent.reason,
  });
}
