import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, generateId } from '@forgeai/shared';
import type { AgentConfig } from '@forgeai/shared';
import { AgentRuntime, AgentManager, createAgentManager, createLLMRouter } from '@forgeai/agent';
import { getWSBroadcaster } from './ws-broadcaster.js';
import { WebChatChannel, TeamsChannel, createTeamsChannel, TelegramChannel, createTelegramChannel, WhatsAppChannel, createWhatsAppChannel, GoogleChatChannel, createGoogleChatChannel, NodeChannel, createNodeChannel } from '@forgeai/channels';
import { createDefaultToolRegistry, type ToolRegistry, createSandboxManager, type SandboxManager, setAgentManagerRef } from '@forgeai/tools';
import { createAdvancedRateLimiter, type AdvancedRateLimiter, createIPFilter, type IPFilter, type Vault } from '@forgeai/security';
import { createTailscaleHelper, type TailscaleHelper } from '../remote/tailscale-helper.js';
import { createPluginManager, AutoResponderPlugin, ContentFilterPlugin, ChatCommandsPlugin, type PluginManager, createPluginSDK, type PluginSDK } from '@forgeai/plugins';
import { createVoiceEngine, type VoiceEngine, createMCPClient, type MCPClient, createMemoryManager, type MemoryManager, createRAGEngine, type RAGEngine, extractTextFromFile, createAutoPlanner, type AutoPlanner } from '@forgeai/agent';
import { createOAuth2Manager, type OAuth2Manager, createAPIKeyManager, type APIKeyManager, createGDPRManager, type GDPRManager } from '@forgeai/security';
import { createGitHubIntegration, type GitHubIntegration, createRSSFeedManager, type RSSFeedManager, createGmailIntegration, type GmailIntegration, createCalendarIntegration, type CalendarIntegration, createNotionIntegration, type NotionIntegration } from '@forgeai/tools';
import { createWebhookManager, type WebhookManager } from '../webhooks/webhook-manager.js';
import { createWorkflowEngine, type WorkflowEngine } from '@forgeai/workflows';
import { handleChatCommand, formatUsageFooter, setAutopilotRef, setPairingRef } from './chat-commands.js';
import { createAutopilotEngine, type AutopilotEngine } from '../autopilot/autopilot-engine.js';
import { createPairingManager, type PairingManager } from '../pairing/pairing-manager.js';
import { ChatHistoryStore, createChatHistoryStore, type StoredMessage } from '../chat-history-store.js';
import { loadWorkspacePrompts, getWorkspacePromptFiles } from '@forgeai/agent';
import { createOTelManager, type OTelManager } from '../telemetry/otel-manager.js';

const logger = createLogger('Core:ChatRoutes');

let agentRuntime: AgentRuntime | null = null;
let agentManager: AgentManager | null = null;
let webChatChannel: WebChatChannel | null = null;
let teamsChannel: TeamsChannel | null = null;
let googleChatChannel: GoogleChatChannel | null = null;
let telegramChannel: TelegramChannel | null = null;
let whatsAppChannel: WhatsAppChannel | null = null;
let toolRegistry: ToolRegistry | null = null;
let pluginManager: PluginManager | null = null;
let workflowEngine: WorkflowEngine | null = null;
let sandboxManager: SandboxManager | null = null;
let advancedRateLimiter: AdvancedRateLimiter | null = null;
let pluginSDK: PluginSDK | null = null;
let voiceEngine: VoiceEngine | null = null;
let webhookManager: WebhookManager | null = null;
let ipFilter: IPFilter | null = null;
let tailscaleHelper: TailscaleHelper | null = null;
let mcpClient: MCPClient | null = null;
let memoryManager: MemoryManager | null = null;
let oauth2Manager: OAuth2Manager | null = null;
let ragEngine: RAGEngine | null = null;
let autoPlanner: AutoPlanner | null = null;
let apiKeyManager: APIKeyManager | null = null;
let gdprManager: GDPRManager | null = null;
let githubIntegration: GitHubIntegration | null = null;
let rssFeedManager: RSSFeedManager | null = null;
let gmailIntegration: GmailIntegration | null = null;
let calendarIntegration: CalendarIntegration | null = null;
let notionIntegration: NotionIntegration | null = null;
let otelManager: OTelManager | null = null;
let chatHistoryStore: ChatHistoryStore | null = null;
let autopilotEngine: AutopilotEngine | null = null;
let pairingManager: PairingManager | null = null;
let nodeChannel: NodeChannel | null = null;

export function getAgentRuntime(): AgentRuntime | null {
  return agentRuntime;
}

export function getAgentManager(): AgentManager | null {
  return agentManager;
}

export function getWebChatChannel(): WebChatChannel | null {
  return webChatChannel;
}

export function getToolRegistry(): ToolRegistry | null {
  return toolRegistry;
}

export function getPluginManager(): PluginManager | null {
  return pluginManager;
}

export function getWorkflowEngine(): WorkflowEngine | null {
  return workflowEngine;
}

export function getTelegramChannel(): TelegramChannel | null {
  return telegramChannel;
}

export async function registerChatRoutes(app: FastifyInstance, vault?: Vault): Promise<void> {
  // Initialize LLM Router (starts empty — no env var auto-registration)
  const router = createLLMRouter();

  // Load saved API keys from Vault and register providers
  if (vault?.isInitialized()) {
    const { AnthropicProvider, OpenAIProvider, GoogleProvider, MoonshotProvider, MistralProvider, GroqProvider, DeepSeekProvider, XAIProvider, OllamaProvider } = await import('@forgeai/agent');

    const VAULT_PROVIDER_MAP: Array<{ envKey: string; name: string; factory: (key: string) => any }> = [
      { envKey: 'ANTHROPIC_API_KEY', name: 'anthropic', factory: (k) => new AnthropicProvider(k) },
      { envKey: 'OPENAI_API_KEY', name: 'openai', factory: (k) => new OpenAIProvider(k) },
      { envKey: 'GOOGLE_API_KEY', name: 'google', factory: (k) => new GoogleProvider(k) },
      { envKey: 'MOONSHOT_API_KEY', name: 'moonshot', factory: (k) => new MoonshotProvider(k) },
      { envKey: 'MISTRAL_API_KEY', name: 'mistral', factory: (k) => new MistralProvider(k) },
      { envKey: 'GROQ_API_KEY', name: 'groq', factory: (k) => new GroqProvider(k) },
      { envKey: 'DEEPSEEK_API_KEY', name: 'deepseek', factory: (k) => new DeepSeekProvider(k) },
      { envKey: 'XAI_API_KEY', name: 'xai', factory: (k) => new XAIProvider(k) },
    ];

    const vaultKeys = vault.listKeys();

    for (const entry of VAULT_PROVIDER_MAP) {
      const vaultKey = `env:${entry.envKey}`;
      if (vaultKeys.includes(vaultKey)) {
        try {
          const apiKey = vault.get(vaultKey);
          if (apiKey) {
            router.registerProvider(entry.factory(apiKey));
            logger.info(`Loaded ${entry.name} from Vault`);
          }
        } catch {
          logger.warn(`Failed to decrypt ${entry.envKey} from Vault`);
        }
      }
    }

    // Restore Ollama provider from Vault (base URL + optional API key)
    if (vaultKeys.includes('env:OLLAMA_BASE_URL')) {
      try {
        const ollamaUrl = vault.get('env:OLLAMA_BASE_URL');
        const ollamaApiKey = vaultKeys.includes('env:OLLAMA_API_KEY') ? vault.get('env:OLLAMA_API_KEY') : undefined;
        if (ollamaUrl) {
          const ollamaProvider = new OllamaProvider(ollamaUrl, ollamaApiKey || undefined);
          router.registerProvider(ollamaProvider);
          logger.info('Loaded local (Ollama) from Vault', { url: ollamaUrl, auth: ollamaApiKey ? 'Bearer token' : 'none' });
        }
      } catch {
        logger.warn('Failed to restore Ollama provider from Vault');
      }
    }

    // Load channel tokens from Vault into process.env (only connection tokens, not permissions)
    const channelEnvKeys = [
      'TELEGRAM_BOT_TOKEN',
      'DISCORD_BOT_TOKEN',
      'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET',
      'TEAMS_APP_ID', 'TEAMS_APP_PASSWORD',
      'LEONARDO_API_KEY',
      'ELEVENLABS_API_KEY',
      'STABLE_DIFFUSION_URL',
      'VOICE_ENABLED',
      'OLLAMA_BASE_URL',
      'SECURITY_WEBHOOK_URL',
      'RBAC_ENFORCE',
      'STT_TTS_API_KEY',
      'WHISPER_API_URL',
      'PIPER_API_URL',
      'KOKORO_API_URL',
      'KOKORO_API_KEY',
      'NODE_API_KEY',
    ];
    for (const envKey of channelEnvKeys) {
      const vaultKey = `env:${envKey}`;
      if (vaultKeys.includes(vaultKey)) {
        try {
          process.env[envKey] = vault.get(vaultKey) ?? undefined;
          logger.info(`Loaded ${envKey} from Vault`);
        } catch {
          logger.warn(`Failed to decrypt ${envKey} from Vault`);
        }
      }
    }

    // Load custom model lists from Vault and apply to registered providers
    for (const providerName of ['openai', 'anthropic', 'google', 'moonshot', 'deepseek', 'groq', 'mistral', 'xai', 'local']) {
      const modelsKey = `models:${providerName}`;
      if (vaultKeys.includes(modelsKey)) {
        try {
          const raw = vault.get(modelsKey);
          if (raw) {
            const models = JSON.parse(raw) as string[];
            const registered = router.getProviders().get(providerName as any);
            if (registered && 'setModels' in registered && typeof (registered as any).setModels === 'function') {
              (registered as any).setModels(models);
              logger.info(`Loaded custom models for ${providerName} from Vault`, { count: models.length });
            }
          }
        } catch {
          logger.warn(`Failed to load custom models for ${providerName} from Vault`);
        }
      }
    }
  }

  // ─── Channel Permissions via Vault ────────────────────────
  // Permissions are stored as JSON in Vault under keys like "channel:telegram:permissions"
  interface ChannelPermissions {
    allowedUsers: string[];
    allowedGroups: string[];
    adminUsers: string[];
    respondInGroups: 'always' | 'mention' | 'never';
  }

  const defaultPerms = (mode: 'always' | 'mention' | 'never' = 'mention'): ChannelPermissions => ({
    allowedUsers: [],
    allowedGroups: [],
    adminUsers: [],
    respondInGroups: mode,
  });

  const loadChannelPermissions = (channelName: string, fallbackMode: 'always' | 'mention' | 'never' = 'mention'): ChannelPermissions => {
    if (!vault?.isInitialized()) return defaultPerms(fallbackMode);
    try {
      const raw = vault.get(`channel:${channelName}:permissions`);
      if (raw) return { ...defaultPerms(fallbackMode), ...JSON.parse(raw) };
    } catch {
      logger.warn(`Failed to load permissions for ${channelName} from Vault`);
    }
    return defaultPerms(fallbackMode);
  };

  const saveChannelPermissions = (channelName: string, perms: ChannelPermissions): boolean => {
    if (!vault?.isInitialized()) return false;
    try {
      vault.set(`channel:${channelName}:permissions`, JSON.stringify(perms));
      return true;
    } catch {
      logger.warn(`Failed to save permissions for ${channelName} to Vault`);
      return false;
    }
  };

  // ─── Load onboard-provider.json (from forge onboard wizard) ────────────────
  try {
    const { resolve: pathResolve } = await import('node:path');
    const { readFileSync, unlinkSync, existsSync } = await import('node:fs');
    const onboardPath = pathResolve(process.cwd(), '.forgeai', 'onboard-provider.json');
    if (existsSync(onboardPath)) {
      const raw = JSON.parse(readFileSync(onboardPath, 'utf-8'));
      if (raw.provider && raw.apiKey) {
        const { AnthropicProvider, OpenAIProvider, GoogleProvider, MoonshotProvider, MistralProvider, GroqProvider, DeepSeekProvider, XAIProvider } = await import('@forgeai/agent');
        const factoryMap: Record<string, (k: string) => any> = {
          anthropic: (k) => new AnthropicProvider(k),
          openai: (k) => new OpenAIProvider(k),
          google: (k) => new GoogleProvider(k),
          moonshot: (k) => new MoonshotProvider(k),
          mistral: (k) => new MistralProvider(k),
          groq: (k) => new GroqProvider(k),
          deepseek: (k) => new DeepSeekProvider(k),
          xai: (k) => new XAIProvider(k),
        };
        const factory = factoryMap[raw.provider];
        if (factory) {
          router.registerProvider(factory(raw.apiKey));
          // Persist to Vault
          const envKeyMap: Record<string, string> = {
            anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY',
            moonshot: 'MOONSHOT_API_KEY', mistral: 'MISTRAL_API_KEY', groq: 'GROQ_API_KEY',
            deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY',
          };
          if (vault?.isInitialized() && envKeyMap[raw.provider]) {
            vault.set(`env:${envKeyMap[raw.provider]}`, raw.apiKey);
          }
          logger.info(`Onboard: loaded ${raw.provider} provider from wizard`);
        }
        // Remove temp file after processing
        unlinkSync(onboardPath);
      }
    }
  } catch (err) {
    logger.debug('No onboard-provider.json found or failed to process');
  }

  const providers = router.getProviders();

  if (providers.size === 0) {
    logger.warn('No LLM providers configured — add API keys via Dashboard Settings page or run: forge onboard');
  } else {
    logger.info(`LLM providers available: ${Array.from(providers.keys()).join(', ')}`);
  }

  // Provider priority list — used to pick the best available provider dynamically
  const PROVIDER_DEFAULTS: Array<{ provider: string; model: string }> = [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'moonshot', model: 'kimi-k2.5' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'mistral', model: 'mistral-large-latest' },
    { provider: 'xai', model: 'grok-3' },
  ];

  // Helper: sync agentRuntime config to the best available provider in the router
  const syncAgentToRouter = () => {
    const runtime = agentManager?.getDefaultAgent() ?? agentRuntime;
    if (!runtime) return;
    const currentProviders = router.getProviders();
    for (const pd of PROVIDER_DEFAULTS) {
      if (currentProviders.has(pd.provider as any)) {
        runtime.updateConfig({ provider: pd.provider, model: pd.model });
        return;
      }
    }
  };

  let defaultProvider = 'anthropic';
  let defaultModel = 'claude-sonnet-4-20250514';

  for (const pd of PROVIDER_DEFAULTS) {
    if (providers.has(pd.provider as any)) {
      defaultProvider = pd.provider;
      defaultModel = pd.model;
      break;
    }
  }

  const agentConfig: AgentConfig = {
    id: 'default',
    name: 'ForgeAI Assistant',
    model: defaultModel,
    provider: defaultProvider as any,
    temperature: 0.7,
    maxTokens: 16384,
    tools: [],
    sandboxMode: 'always',
  };

  agentRuntime = new AgentRuntime(agentConfig, router);

  // Initialize AgentManager (multi-agent support)
  agentManager = createAgentManager(router);
  agentManager.addAgent({
    id: 'main',
    name: 'ForgeAI Assistant',
    model: defaultModel,
    provider: defaultProvider as any,
    temperature: 0.7,
    maxTokens: 16384,
    default: true,
  });
  // Keep agentRuntime as convenience ref to default agent
  agentRuntime = agentManager.getDefaultAgent()!;

  // Initialize Chat History Store (persistent JSON)
  chatHistoryStore = createChatHistoryStore();
  logger.info('Chat history store initialized (persistent)');

  // Initialize Tool Registry and attach to AgentManager (propagates to all agents)
  toolRegistry = createDefaultToolRegistry();
  agentManager.setToolExecutor(toolRegistry);

  // Wire session tools with AgentManager for agent-to-agent communication
  setAgentManagerRef(agentManager);

  logger.info(`Tool registry initialized: ${toolRegistry.size} tools registered (attached to ${agentManager.size} agents)`);

  // Initialize Plugin Manager
  pluginManager = createPluginManager(toolRegistry);
  pluginManager.register(AutoResponderPlugin);
  pluginManager.register(ContentFilterPlugin);
  pluginManager.register(ChatCommandsPlugin);
  await pluginManager.activateAll();
  logger.info(`Plugin manager initialized: ${pluginManager.size} plugins (${pluginManager.activeCount} active)`);

  // Initialize Workflow Engine
  workflowEngine = createWorkflowEngine(toolRegistry);
  logger.info('Workflow engine initialized');

  // Initialize WebChat channel
  webChatChannel = new WebChatChannel();
  await webChatChannel.connect();

  // Wire WebChat inbound → AgentManager → response
  webChatChannel.onMessage(async (inbound) => {
    if (!agentManager) return;

    const sessionId = (inbound.raw as Record<string, unknown>)['sessionId'] as string ?? inbound.senderId;

    const result = await agentManager.processMessage({
      sessionId,
      userId: inbound.senderId,
      content: inbound.content,
      channelType: 'webchat',
    });

    await webChatChannel!.send({
      channelType: 'webchat',
      recipientId: inbound.senderId,
      content: result.content,
    });
  });

  // ─── Microsoft Teams Channel ────────────────────────
  const teamsAppId = process.env.TEAMS_APP_ID;
  const teamsAppPassword = process.env.TEAMS_APP_PASSWORD;

  if (teamsAppId && teamsAppPassword) {
    teamsChannel = createTeamsChannel({
      appId: teamsAppId,
      appPassword: teamsAppPassword,
      allowFrom: process.env.TEAMS_ALLOW_FROM?.split(',').map(s => s.trim()) ?? ['*'],
    });
    await teamsChannel.connect();

    // Wire Teams inbound → AgentManager → response
    teamsChannel.onMessage(async (inbound: any) => {
      if (!agentManager) return;

      const sessionId = inbound.groupId ?? inbound.senderId;
      const teamsMeta = { channelType: 'teams', userId: inbound.senderId };
      await chatHistoryStore?.saveMessage(sessionId, {
        id: `teams-user-${Date.now()}`,
        role: 'user',
        content: inbound.content,
        senderName: inbound.senderName || inbound.senderId,
        timestamp: new Date().toISOString(),
      }, teamsMeta);

      const result = await agentManager.processMessage({
        sessionId,
        userId: inbound.senderId,
        content: inbound.content,
        channelType: 'teams',
      });

      const teamsContent = result.content || '(Sem resposta — o agente atingiu o limite de iterações)';

      await chatHistoryStore?.saveMessage(sessionId, {
        id: result.id,
        role: 'assistant',
        content: teamsContent,
        model: result.model,
        provider: result.provider,
        duration: result.duration,
        tokens: result.usage?.totalTokens,
        steps: result.steps,
        timestamp: new Date().toISOString(),
      }, teamsMeta);

      getWSBroadcaster().broadcastAll({
        type: 'agent.done',
        sessionId,
        channelType: 'teams',
        timestamp: Date.now(),
      });

      await teamsChannel!.send({
        channelType: 'teams',
        recipientId: inbound.senderId,
        groupId: inbound.groupId,
        content: teamsContent,
        replyToId: inbound.channelMessageId,
      });
    });

    // Webhook endpoint for Bot Framework
    app.post('/api/teams/messages', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!teamsChannel) {
        reply.status(503).send({ error: 'Teams channel not initialized' });
        return;
      }
      await teamsChannel.processActivity(
        { body: request.body, headers: request.headers as Record<string, string> },
        { status: (code: number) => ({ send: (body?: unknown) => reply.status(code).send(body ?? '') }) },
      );
    });

    logger.info('Microsoft Teams channel initialized');
  } else {
    logger.info('Teams channel skipped (TEAMS_APP_ID/TEAMS_APP_PASSWORD not set)');
  }

  // ─── Google Chat Channel ────────────────────────────
  const googleChatProjectId = process.env.GOOGLE_CHAT_PROJECT_ID;

  if (googleChatProjectId) {
    const gcPerms = loadChannelPermissions('googlechat', 'always');
    googleChatChannel = createGoogleChatChannel({
      projectId: googleChatProjectId,
      credentials: process.env.GOOGLE_CHAT_CREDENTIALS,
      allowFrom: gcPerms.allowedUsers.length > 0 ? gcPerms.allowedUsers : undefined,
      allowSpaces: gcPerms.allowedGroups.length > 0 ? gcPerms.allowedGroups : undefined,
    });
    await googleChatChannel.connect();

    // Wire Google Chat inbound → AgentManager → response
    googleChatChannel.onMessage(async (inbound: any) => {
      if (!agentManager) return;

      const sessionId = inbound.groupId ?? inbound.senderId;
      const gcMeta = { channelType: 'googlechat', userId: inbound.senderId };
      await chatHistoryStore?.saveMessage(sessionId, {
        id: `gc-user-${Date.now()}`,
        role: 'user',
        content: inbound.content,
        senderName: inbound.senderName || inbound.senderId,
        timestamp: new Date().toISOString(),
      }, gcMeta);

      const result = await agentManager.processMessage({
        content: inbound.content,
        sessionId,
        userId: inbound.senderId,
        channelType: 'googlechat',
      });

      const gcContent = result.content || '(Sem resposta — o agente atingiu o limite de iterações)';

      await chatHistoryStore?.saveMessage(sessionId, {
        id: result.id,
        role: 'assistant',
        content: gcContent,
        model: result.model,
        provider: result.provider,
        duration: result.duration,
        tokens: result.usage?.totalTokens,
        steps: result.steps,
        timestamp: new Date().toISOString(),
      }, gcMeta);

      getWSBroadcaster().broadcastAll({
        type: 'agent.done',
        sessionId,
        channelType: 'googlechat',
        timestamp: Date.now(),
      });

      await googleChatChannel!.send({
        channelType: 'googlechat',
        recipientId: inbound.id,  // Used to match pending sync reply
        groupId: inbound.groupId,
        content: gcContent,
      });
    });

    // Webhook endpoint for Google Chat
    app.post('/api/googlechat/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!googleChatChannel) {
        reply.status(503).send({ error: 'Google Chat channel not initialized' });
        return;
      }
      const event = request.body as any;
      const response = await googleChatChannel.processWebhook(event);
      if (response) {
        reply.send(response);
      } else {
        reply.send({});
      }
    });

    logger.info('Google Chat channel initialized');
  } else {
    logger.info('Google Chat channel skipped (GOOGLE_CHAT_PROJECT_ID not set)');
  }

  // ─── Telegram Channel ────────────────────────────
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  if (telegramBotToken) {
    try {
      const tgPerms = loadChannelPermissions('telegram', 'mention');
      telegramChannel = createTelegramChannel({
        botToken: telegramBotToken,
        allowFrom: tgPerms.allowedUsers.length > 0 ? tgPerms.allowedUsers : ['*'],
        allowGroups: tgPerms.allowedGroups,
        adminUsers: tgPerms.adminUsers,
        respondInGroups: tgPerms.respondInGroups,
      });

      // Wire Telegram inbound → Chat Commands → AgentManager → response
      telegramChannel.onMessage(async (inbound) => {
        if (!agentManager) return;

        // React with 👀 to show ForgeAI saw the message
        const tgChatId = inbound.groupId ?? inbound.senderId;
        await telegramChannel!.setMessageReaction(tgChatId, Number(inbound.channelMessageId), '👀');

        const sessionId = inbound.groupId
          ? `tg-group-${inbound.groupId}`
          : `tg-dm-${inbound.senderId}`;

        // ── Universal chat commands ──
        const cmdResult = handleChatCommand(inbound.content, sessionId, agentManager, {
          channelType: 'telegram',
          userId: inbound.senderId,
          isGroup: !!inbound.groupId,
          isAdmin: (telegramChannel as any)?.adminUsers?.has?.(inbound.senderId) ?? false,
        });
        if (cmdResult.handled && cmdResult.response) {
          // Handle pairing action — auto-add user to channel permissions
          if (cmdResult.pairingAction) {
            const { userId, role } = cmdResult.pairingAction;
            telegramChannel!.addAllowedUser(userId);
            if (role === 'admin') {
              telegramChannel!.addAdmin(userId);
            }
            // Persist to Vault
            if (vault?.isInitialized()) {
              const perms = telegramChannel!.getPermissions();
              await vault.set('channel:telegram:permissions', JSON.stringify(perms));
            }
            logger.info('Pairing: user added to Telegram permissions', { userId, role });
          }
          await telegramChannel!.send({
            channelType: 'telegram',
            recipientId: inbound.senderId,
            groupId: inbound.groupId,
            content: cmdResult.response,
            replyToId: inbound.channelMessageId,
          });
          return;
        }
        if (cmdResult.handled) return;

        const chatId = inbound.groupId ?? inbound.senderId;

        // Voice message → STT transcription (always attempt if audio + OpenAI key available)
        let messageContent = inbound.content;
        let isVoiceMessage = false;
        if (inbound.audio && voiceEngine) {
          try {
            const sttResult = await voiceEngine.listen(inbound.audio.buffer, { format: 'ogg' });
            messageContent = sttResult.text;
            isVoiceMessage = true;
            logger.info('Voice transcribed (Telegram)', { text: messageContent.substring(0, 100), confidence: sttResult.confidence });
          } catch (err) {
            logger.error('STT transcription failed (Telegram)', err);
            await telegramChannel!.send({
              channelType: 'telegram',
              recipientId: inbound.senderId,
              groupId: inbound.groupId,
              content: '🎤 Não consegui transcrever o áudio. Verifique se a OPENAI_API_KEY está configurada no Dashboard → Settings.',
              replyToId: inbound.channelMessageId,
            });
            return;
          }
        } else if (inbound.audio && !voiceEngine) {
          await telegramChannel!.send({
            channelType: 'telegram',
            recipientId: inbound.senderId,
            groupId: inbound.groupId,
            content: '🎤 Mensagens de voz não estão disponíveis. Configure a OPENAI_API_KEY para habilitar transcrição via Whisper.',
            replyToId: inbound.channelMessageId,
          });
          return;
        }

        // Persist inbound user message to chat history
        const channelMeta = { channelType: 'telegram', userId: inbound.senderId };
        const senderLabel = inbound.senderName || inbound.senderId;
        await chatHistoryStore?.saveMessage(sessionId, {
          id: `tg-user-${Date.now()}`,
          role: 'user',
          content: messageContent,
          senderName: senderLabel,
          timestamp: new Date().toISOString(),
        }, channelMeta);

        // Send initial status message — will be updated with real progress
        await telegramChannel!.sendTyping(chatId);
        let statusMsgId = await telegramChannel!.sendStatusMessage(
          chatId,
          isVoiceMessage ? '🎤 Mensagem de voz recebida, processando...' : '⏳ Analisando sua solicitacao...',
          inbound.channelMessageId,
        );
        let lastStatusUpdate = Date.now();
        let lastStatusText = '';

        // Register progress listener: broadcast to WS + update Telegram status msg
        const wsBroadcaster = getWSBroadcaster();
        const targetAgent = agentManager.getDefaultAgent();
        let lastTyping = Date.now();
        const tgProgressListener = (event: Record<string, unknown>) => {
          // Broadcast to dashboard for real-time channel progress
          wsBroadcaster.broadcastAll({ ...event, type: `agent.${event.type}`, sessionId, channelType: 'telegram' });

          // Send typing indicator every 4s
          if (Date.now() - lastTyping > 4000) {
            lastTyping = Date.now();
            telegramChannel!.sendTyping(chatId).catch(() => {});
          }

          // Update Telegram status message with real progress (throttled to every 3s)
          if (statusMsgId && Date.now() - lastStatusUpdate > 3000) {
            let newText = '';
            const evType = event.type as string;
            if (evType === 'step') {
              const step = event.step as { type: string; message?: string; tool?: string } | undefined;
              if (step?.type === 'thinking' && step.message) {
                const thought = step.message.length > 200 ? step.message.substring(0, 200) + '...' : step.message;
                newText = `💭 ${thought}`;
              } else if (step?.type === 'tool_call' && step.tool) {
                newText = `⚙️ Executando: ${step.tool}`;
              }
            } else if (evType === 'progress') {
              const p = event.progress as { status: string; iteration: number; maxIterations: number; currentTool?: string } | undefined;
              if (p?.status === 'calling_tool' && p.currentTool) {
                newText = `⚙️ [${p.iteration}/${p.maxIterations}] ${p.currentTool}`;
              } else if (p?.status === 'thinking') {
                newText = `💭 [${p.iteration}/${p.maxIterations}] Pensando...`;
              }
            }

            if (newText && newText !== lastStatusText) {
              lastStatusUpdate = Date.now();
              lastStatusText = newText;
              telegramChannel!.editMessage(chatId, statusMsgId, newText).catch(() => {});
            }
          }
        };
        if (targetAgent) {
          targetAgent.onProgress(sessionId, tgProgressListener as any);
        }

        const result = await agentManager.processMessage({
          sessionId,
          userId: inbound.senderId,
          content: messageContent,
          channelType: 'telegram',
          image: inbound.image,
        });

        // Clean up progress listener
        if (targetAgent) {
          targetAgent.offProgress(sessionId, tgProgressListener as any);
        }

        // Delete the status message now that we have the real response
        if (statusMsgId) {
          await telegramChannel!.deleteMessage(chatId, statusMsgId);
        }

        // Append usage footer if enabled
        const footer = formatUsageFooter(sessionId, result);

        // Build smart fallback when agent hits max iterations with no text response
        let responseContent = result.content;
        if (!responseContent && result.steps && result.steps.length > 0) {
          const toolCalls = result.steps.filter((s: { type: string }) => s.type === 'tool_call');
          const toolResults = result.steps.filter((s: { type: string; success?: boolean }) => s.type === 'tool_result');
          const successes = toolResults.filter((s: { success?: boolean }) => s.success).length;
          const failures = toolResults.filter((s: { success?: boolean }) => !s.success).length;
          const toolNames = [...new Set(toolCalls.map((s: { tool?: string }) => s.tool).filter(Boolean))];
          responseContent = `Processo concluido (${result.steps.length} etapas, ${toolCalls.length} acoes).\n`;
          responseContent += `Ferramentas: ${toolNames.join(', ') || 'nenhuma'}\n`;
          responseContent += `Resultados: ${successes} ok, ${failures} erro(s)\n`;
          responseContent += `O agente atingiu o limite de iteracoes. Se precisar continuar, envie outra mensagem.`;
        } else if (!responseContent) {
          responseContent = 'Processo concluido, mas nao houve resposta textual. Envie outra mensagem se precisar de mais informacoes.';
        }
        const tgContent = responseContent + footer;

        // Persist assistant response to chat history
        await chatHistoryStore?.saveMessage(sessionId, {
          id: result.id,
          role: 'assistant',
          content: tgContent,
          model: result.model,
          provider: result.provider,
          duration: result.duration,
          tokens: result.usage?.totalTokens,
          steps: result.steps,
          timestamp: new Date().toISOString(),
        }, channelMeta);

        // Send screenshots from agent steps (browser tool captures)
        if (result.steps && result.steps.length > 0) {
          for (const step of result.steps) {
            if (step.type === 'tool_result' && step.result) {
              const resultStr = typeof step.result === 'string' ? step.result : JSON.stringify(step.result);
              const pathMatch = resultStr.match(/"path"\s*:\s*"([^"]+\.png)"/);
              if (pathMatch) {
                const screenshotPath = pathMatch[1].replace(/\\\\/g, '\\');
                const { existsSync } = await import('node:fs');
                if (existsSync(screenshotPath)) {
                  await telegramChannel!.sendPhoto(chatId, screenshotPath, 'Screenshot');
                }
              }
            }
          }
        }

        // Broadcast agent.done to ALL clients so Chat dashboard updates in real-time
        getWSBroadcaster().broadcastAll({
          type: 'agent.done',
          sessionId,
          channelType: 'telegram',
          timestamp: Date.now(),
        });

        await telegramChannel!.send({
          channelType: 'telegram',
          recipientId: inbound.senderId,
          groupId: inbound.groupId,
          content: tgContent,
          replyToId: inbound.channelMessageId,
        });

        // Send TTS audio response if original was voice message
        if (isVoiceMessage && voiceEngine?.isEnabled() && responseContent) {
          try {
            const ttsResult = await voiceEngine.speak(responseContent.substring(0, 4000));
            const audioBuffer = Buffer.isBuffer(ttsResult.audio) ? ttsResult.audio : Buffer.from(ttsResult.audio);
            await telegramChannel!.sendVoice(chatId, audioBuffer, undefined, inbound.channelMessageId);
            logger.info('TTS voice response sent (Telegram)', { chars: responseContent.length, format: ttsResult.format });
          } catch (ttsErr) {
            logger.error('TTS response failed (Telegram)', ttsErr);
          }
        }
      });

      await telegramChannel.connect();
      logger.info('Telegram channel initialized');
    } catch (error) {
      logger.error('Failed to initialize Telegram channel', error);
    }
  } else {
    logger.info('Telegram channel skipped (TELEGRAM_BOT_TOKEN not set)');
  }

  // ─── WhatsApp Channel ────────────────────────────
  // Só inicializa se tiver sessão existente ou se foi habilitado via Vault
  const waEnabled = vault?.isInitialized() && vault.has('channel:whatsapp:enabled');
  const waSessionExists = (await import('node:fs')).existsSync(
    (await import('node:path')).resolve(process.cwd(), '.forgeai', 'whatsapp-session', 'creds.json')
  );

  if (waEnabled || waSessionExists) {
    try {
      const waPerms = loadChannelPermissions('whatsapp', 'always');
      whatsAppChannel = createWhatsAppChannel({
        allowFrom: waPerms.allowedUsers.length > 0 ? waPerms.allowedUsers : ['*'],
        allowGroups: waPerms.allowedGroups,
        adminUsers: waPerms.adminUsers,
        respondInGroups: waPerms.respondInGroups,
        printQR: true,
      });

      // Wire WhatsApp inbound → Chat Commands → AgentManager → response
      whatsAppChannel.onMessage(async (inbound) => {
        if (!agentManager) return;

        const sessionId = inbound.groupId
          ? `wa-group-${inbound.groupId}`
          : `wa-dm-${inbound.senderId}`;

        // ── Universal chat commands ──
        const cmdResult = handleChatCommand(inbound.content, sessionId, agentManager, {
          channelType: 'whatsapp',
          userId: inbound.senderId,
          isGroup: !!inbound.groupId,
          isAdmin: (whatsAppChannel as any)?.adminUsers?.has?.(inbound.senderId) ?? false,
        });
        if (cmdResult.handled && cmdResult.response) {
          // Handle pairing action — auto-add user to channel permissions
          if (cmdResult.pairingAction) {
            const { userId, role } = cmdResult.pairingAction;
            whatsAppChannel!.addAllowedUser(userId);
            if (role === 'admin') {
              whatsAppChannel!.addAdmin(userId);
            }
            if (vault?.isInitialized()) {
              const perms = whatsAppChannel!.getPermissions();
              await vault.set('channel:whatsapp:permissions', JSON.stringify(perms));
            }
            logger.info('Pairing: user added to WhatsApp permissions', { userId, role });
          }
          await whatsAppChannel!.send({
            channelType: 'whatsapp',
            recipientId: inbound.senderId,
            groupId: inbound.groupId,
            content: cmdResult.response,
            replyToId: inbound.channelMessageId,
          });
          return;
        }
        if (cmdResult.handled) return;

        const waJid = inbound.groupId ?? inbound.senderId;

        // Voice message → STT transcription (always attempt if audio + OpenAI key available)
        let waMessageContent = inbound.content;
        if (inbound.audio && voiceEngine) {
          try {
            const sttResult = await voiceEngine.listen(inbound.audio.buffer, { format: 'ogg' });
            waMessageContent = sttResult.text;
            logger.info('Voice transcribed (WhatsApp)', { text: waMessageContent.substring(0, 100), confidence: sttResult.confidence });
          } catch (err) {
            logger.error('STT transcription failed (WhatsApp)', err);
            waMessageContent = '🎤 [Áudio recebido mas transcrição falhou — verifique OPENAI_API_KEY]';
          }
        }

        // Persist inbound user message to chat history
        const waMeta = { channelType: 'whatsapp', userId: inbound.senderId };
        const waSender = inbound.senderName || inbound.senderId;
        await chatHistoryStore?.saveMessage(sessionId, {
          id: `wa-user-${Date.now()}`,
          role: 'user',
          content: waMessageContent,
          senderName: waSender,
          timestamp: new Date().toISOString(),
        }, waMeta);

        // Send typing indicator while processing
        await whatsAppChannel!.sendTyping(waJid);

        // Register progress listener: broadcast to WS (dashboard) + periodic typing
        const waWsBroadcaster = getWSBroadcaster();
        const waTargetAgent = agentManager.getDefaultAgent();
        let waLastTyping = Date.now();
        const waProgressListener = (event: Record<string, unknown>) => {
          waWsBroadcaster.broadcastAll({ ...event, type: `agent.${event.type}`, sessionId, channelType: 'whatsapp' });
          if (Date.now() - waLastTyping > 4000) {
            waLastTyping = Date.now();
            whatsAppChannel!.sendTyping(waJid).catch(() => {});
          }
        };
        if (waTargetAgent) {
          waTargetAgent.onProgress(sessionId, waProgressListener as any);
        }

        const result = await agentManager.processMessage({
          sessionId,
          userId: inbound.senderId,
          content: waMessageContent,
          channelType: 'whatsapp',
          image: inbound.image,
        });

        // Clean up progress listener
        if (waTargetAgent) {
          waTargetAgent.offProgress(sessionId, waProgressListener as any);
        }

        const footer = formatUsageFooter(sessionId, result);
        const waContent = (result.content || '(Sem resposta — o agente atingiu o limite de iteracoes)') + footer;

        // Persist assistant response to chat history
        await chatHistoryStore?.saveMessage(sessionId, {
          id: result.id,
          role: 'assistant',
          content: waContent,
          model: result.model,
          provider: result.provider,
          duration: result.duration,
          tokens: result.usage?.totalTokens,
          steps: result.steps,
          timestamp: new Date().toISOString(),
        }, waMeta);

        // Broadcast agent.done to ALL clients so Chat dashboard updates in real-time
        getWSBroadcaster().broadcastAll({
          type: 'agent.done',
          sessionId,
          channelType: 'whatsapp',
          timestamp: Date.now(),
        });

        await whatsAppChannel!.send({
          channelType: 'whatsapp',
          recipientId: inbound.senderId,
          groupId: inbound.groupId,
          content: waContent,
          replyToId: inbound.channelMessageId,
        });
      });

      await whatsAppChannel.connect();
      logger.info('WhatsApp channel initialized');
    } catch (error) {
      logger.error('Failed to initialize WhatsApp channel', error);
    }
  } else {
    logger.info('WhatsApp channel skipped (not configured — enable via Dashboard Channels page)');
  }

  // ─── Node Protocol Channel ────────────────────────────
  // Hot-reloadable: can be initialized/reinitialized when NODE_API_KEY changes via Dashboard

  const initNodeChannel = (apiKey: string) => {
    // Disconnect previous instance if any
    if (nodeChannel) {
      nodeChannel.disconnect().catch(() => {});
      nodeChannel = null;
      logger.info('Previous NodeChannel instance disconnected (hot-reload)');
    }

    nodeChannel = createNodeChannel({ apiKey, maxNodes: 100 });

    // Wire Node inbound → AgentManager → response
    nodeChannel.onMessage(async (inbound) => {
      if (!agentManager) return;

      const sessionId = `node-${inbound.senderId}`;
      const nodeMeta = { channelType: 'node', userId: inbound.senderId };

      await chatHistoryStore?.saveMessage(sessionId, {
        id: `node-user-${Date.now()}`,
        role: 'user',
        content: inbound.content,
        senderName: inbound.senderName || inbound.senderId,
        timestamp: new Date().toISOString(),
      }, nodeMeta);

      const result = await agentManager.processMessage({
        sessionId,
        userId: inbound.senderId,
        content: inbound.content,
        channelType: 'node',
      });

      const nodeContent = result.content || '(No response)';

      await chatHistoryStore?.saveMessage(sessionId, {
        id: result.id,
        role: 'assistant',
        content: nodeContent,
        model: result.model,
        provider: result.provider,
        duration: result.duration,
        tokens: result.usage?.totalTokens,
        steps: result.steps,
        timestamp: new Date().toISOString(),
      }, nodeMeta);

      getWSBroadcaster().broadcastAll({
        type: 'agent.done',
        sessionId,
        channelType: 'node',
        timestamp: Date.now(),
      });

      await nodeChannel!.send({
        channelType: 'node',
        recipientId: inbound.senderId,
        content: nodeContent,
        replyToId: inbound.channelMessageId,
      });
    });

    logger.info('Node Protocol channel initialized (hot-reloadable)');
  };

  // Initialize on startup if key exists
  const nodeApiKey = process.env.NODE_API_KEY || '';
  if (nodeApiKey) {
    initNodeChannel(nodeApiKey);
  } else {
    logger.info('Node Protocol: waiting for NODE_API_KEY (configure via Dashboard → Settings)');
  }

  // WebSocket route — always registered, delegates to current nodeChannel
  app.get('/ws/node', { websocket: true }, (socket, request) => {
    if (!nodeChannel) {
      socket.close(4003, 'Node Protocol not configured — set NODE_API_KEY in Dashboard');
      return;
    }
    const ip = request.headers['x-forwarded-for'] || request.ip || 'unknown';
    nodeChannel.handleConnection(socket as any, String(ip));
  });

  // ─── REST API: Nodes ────────────────────────────────

  // GET /api/nodes — list connected nodes + channel status
  app.get('/api/nodes', async () => {
    return {
      enabled: !!nodeChannel,
      nodes: nodeChannel ? nodeChannel.getConnectedNodes() : [],
      total: nodeChannel ? nodeChannel.getConnectedNodes().length : 0,
    };
  });

  // POST /api/nodes/generate-key — generate a cryptographically secure API key
  app.post('/api/nodes/generate-key', async () => {
    const { randomBytes } = await import('node:crypto');
    const key = `fnode_${randomBytes(24).toString('base64url')}`;

    // Save to env + Vault
    process.env.NODE_API_KEY = key;
    if (vault?.isInitialized()) {
      vault.set('env:NODE_API_KEY', key);
    }

    // Hot-reload NodeChannel with new key
    initNodeChannel(key);

    logger.info('Node Protocol key generated and saved to Vault');
    return { success: true, key, persisted: vault?.isInitialized() ?? false };
  });

  // GET /api/nodes/connection-info — get connection instructions for node agents
  app.get('/api/nodes/connection-info', async (request: FastifyRequest) => {
    const hasKey = !!process.env.NODE_API_KEY;
    const host = request.headers.host || `localhost:${process.env.GATEWAY_PORT || 18800}`;
    const proto = request.headers['x-forwarded-proto'] || 'http';
    const gatewayUrl = `${proto}://${host}`;
    const wsUrl = `${proto === 'https' ? 'wss' : 'ws'}://${host}/ws/node`;

    return {
      enabled: hasKey,
      gatewayUrl,
      wsUrl,
      key: hasKey ? '••••••••' : null,
      keyPrefix: hasKey ? process.env.NODE_API_KEY!.substring(0, 10) + '...' : null,
      example: hasKey
        ? `./forgeai-node --gateway ${gatewayUrl} --token YOUR_KEY --name "My-Device"`
        : 'Generate a key first via Dashboard → Settings',
    };
  });

  // GET /api/nodes/:nodeId — get specific node info
  app.get('/api/nodes/:nodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!nodeChannel) { reply.status(503).send({ error: 'Node channel not initialized — set NODE_API_KEY in Dashboard' }); return; }
    const { nodeId } = request.params as { nodeId: string };
    const node = nodeChannel.getNode(nodeId);
    if (!node) { reply.status(404).send({ error: `Node '${nodeId}' not found` }); return; }
    return { node };
  });

  // POST /api/nodes/:nodeId/command — execute command on a node
  app.post('/api/nodes/:nodeId/command', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!nodeChannel) { reply.status(503).send({ error: 'Node channel not initialized' }); return; }
    const { nodeId } = request.params as { nodeId: string };
    const { cmd, args, timeout } = request.body as { cmd: string; args?: string[]; timeout?: number };
    if (!cmd) { reply.status(400).send({ error: 'cmd is required' }); return; }
    try {
      const result = await nodeChannel.sendCommand(nodeId, cmd, args, timeout);
      return { success: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(500).send({ error: msg });
      return;
    }
  });

  // POST /api/nodes/:nodeId/message — send a message to a node
  app.post('/api/nodes/:nodeId/message', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!nodeChannel) { reply.status(503).send({ error: 'Node channel not initialized' }); return; }
    const { nodeId } = request.params as { nodeId: string };
    const { content } = request.body as { content: string };
    if (!content) { reply.status(400).send({ error: 'content is required' }); return; }
    const sent = nodeChannel.sendToNode(nodeId, { type: 'response', ts: Date.now(), content } as any);
    if (!sent) { reply.status(404).send({ error: `Node '${nodeId}' not connected` }); return; }
    return { success: true };
  });

  // ─── REST API: Chat ────────────────────────────────

  // POST /api/chat — send a message and get a response
  app.post('/api/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      message?: string;
      sessionId?: string;
      userId?: string;
      agentId?: string;
      model?: string;
      provider?: string;
      image?: { data: string; mimeType: string; filename?: string };
    };

    if (!body.message || typeof body.message !== 'string') {
      reply.status(400).send({ error: 'message is required' });
      return;
    }

    if (!agentManager) {
      reply.status(503).send({ error: 'Agent runtime not initialized' });
      return;
    }

    const sessionId = body.sessionId ?? generateId('sess');
    const userId = body.userId ?? 'webchat-user';

    try {
      // ── Universal chat commands ──
      const cmdResult = handleChatCommand(body.message, sessionId, agentManager, {
        channelType: 'webchat',
        userId,
        isGroup: false,
        isAdmin: true,
      });
      if (cmdResult.handled) {
        const cmdStored: StoredMessage = {
          id: `cmd-${Date.now()}`,
          role: 'assistant',
          content: cmdResult.response ?? '',
          timestamp: new Date().toISOString(),
        };
        const webchatMeta = { channelType: 'webchat', userId };
        await chatHistoryStore?.saveMessage(sessionId, cmdStored, webchatMeta);
        return {
          id: cmdStored.id,
          content: cmdResult.response ?? '',
          model: 'system',
          provider: 'system',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          blocked: false,
          duration: 0,
          sessionId,
          agentId: 'system',
        };
      }

      // Persist user message
      const webchatMeta = { channelType: 'webchat', userId };
      const userStored: StoredMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: body.message,
        timestamp: new Date().toISOString(),
      };
      await chatHistoryStore?.saveMessage(sessionId, userStored, webchatMeta);

      // Register WS progress listener for real-time streaming
      const wsBroadcaster = getWSBroadcaster();
      const targetAgent = body.agentId ? agentManager.getAgent(body.agentId) : agentManager.getDefaultAgent();
      const progressListener = (event: Record<string, unknown>) => {
        wsBroadcaster.broadcastToSession(sessionId, { ...event, type: `agent.${event.type}` });
      };
      if (targetAgent) {
        targetAgent.onProgress(sessionId, progressListener as any);
      }

      const result = await agentManager.processMessage({
        sessionId,
        userId,
        content: body.message,
        channelType: 'webchat',
        agentId: body.agentId,
        image: body.image ? { base64: body.image.data, mimeType: body.image.mimeType } : undefined,
        modelOverride: body.model,
        providerOverride: body.provider,
      });

      // Clean up progress listener
      if (targetAgent) {
        targetAgent.offProgress(sessionId, progressListener as any);
      }

      // Append usage footer if enabled via /usage command
      const footer = formatUsageFooter(sessionId, result);
      if (footer) result.content += footer;

      // Persist assistant message with steps
      const assistantStored: StoredMessage = {
        id: result.id,
        role: 'assistant',
        content: result.content,
        model: result.model,
        provider: result.provider,
        duration: result.duration,
        tokens: result.usage.totalTokens,
        blocked: result.blocked,
        blockReason: result.blockReason,
        steps: result.steps,
        timestamp: new Date().toISOString(),
      };
      await chatHistoryStore?.saveMessage(sessionId, assistantStored, webchatMeta);

      // Broadcast agent.done AFTER message is persisted so frontend can fetch it
      wsBroadcaster.broadcastToSession(sessionId, {
        type: 'agent.done',
        sessionId,
        timestamp: Date.now(),
      });

      return {
        id: result.id,
        content: result.content,
        thinking: result.thinking,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        blocked: result.blocked,
        blockReason: result.blockReason,
        duration: result.duration,
        sessionId,
        steps: result.steps,
        toolIterations: result.toolIterations,
      };
    } catch (error) {
      logger.error('Chat request failed', error);
      reply.status(500).send({ error: 'Internal server error' });
      return;
    }
  });

  // POST /api/chat/voice — send audio, get text + optional TTS audio back
  app.post('/api/chat/voice', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      audio?: string; // base64-encoded audio
      format?: string; // audio format (ogg, wav, mp3)
      sessionId?: string;
      userId?: string;
      agentId?: string;
      ttsResponse?: boolean; // if true, return TTS audio of the response
    };

    if (!body.audio) {
      reply.status(400).send({ error: 'audio (base64) is required' });
      return;
    }

    if (!voiceEngine?.isEnabled()) {
      reply.status(503).send({ error: 'Voice engine not enabled. Set VOICE_ENABLED=true and configure OPENAI_API_KEY.' });
      return;
    }

    if (!agentManager) {
      reply.status(503).send({ error: 'Agent runtime not initialized' });
      return;
    }

    const sessionId = body.sessionId ?? generateId('sess');
    const userId = body.userId ?? 'voice-user';

    try {
      // Step 1: STT — transcribe audio to text
      const audioBuffer = Buffer.from(body.audio, 'base64');
      const sttResult = await voiceEngine.listen(audioBuffer, { format: body.format ?? 'wav' });

      logger.info('Voice chat: STT complete', { text: sttResult.text.substring(0, 100), confidence: sttResult.confidence });

      // Step 2: Process message through agent
      const result = await agentManager.processMessage({
        sessionId,
        userId,
        content: sttResult.text,
        channelType: 'voice',
        agentId: body.agentId,
      });

      // Step 3: Optional TTS — synthesize response to audio
      let ttsAudio: string | undefined;
      let ttsFormat: string | undefined;
      if (body.ttsResponse) {
        try {
          const ttsResult = await voiceEngine.speak(result.content.substring(0, 4000));
          ttsAudio = ttsResult.audio.toString('base64');
          ttsFormat = ttsResult.format;
        } catch (ttsErr) {
          logger.error('TTS synthesis failed', ttsErr);
        }
      }

      return {
        id: result.id,
        transcription: sttResult.text,
        transcriptionConfidence: sttResult.confidence,
        content: result.content,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        duration: result.duration,
        sessionId,
        ttsAudio,
        ttsFormat,
      };
    } catch (error) {
      logger.error('Voice chat request failed', error);
      reply.status(500).send({ error: 'Voice processing failed' });
      return;
    }
  });

  // POST /api/voice/synthesize — TTS: convert text to audio
  app.post('/api/voice/synthesize', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { text?: string; voice?: string; speed?: number; format?: string };

    if (!body.text) {
      reply.status(400).send({ error: 'text is required' });
      return;
    }

    if (!voiceEngine?.isEnabled()) {
      reply.status(503).send({ error: 'Voice engine not enabled' });
      return;
    }

    try {
      const result = await voiceEngine.speak(body.text, {
        voice: body.voice,
        speed: body.speed,
        format: (body.format as 'mp3' | 'wav' | 'ogg') ?? 'mp3',
      });

      reply.header('Content-Type', `audio/${result.format}`);
      reply.header('X-Voice-Duration-Ms', String(result.durationMs));
      reply.header('X-Voice-Char-Count', String(result.charCount));
      return reply.send(result.audio);
    } catch (error) {
      logger.error('TTS synthesis failed', error);
      reply.status(500).send({ error: 'TTS synthesis failed' });
      return;
    }
  });

  // POST /api/voice/transcribe — STT: convert audio to text
  app.post('/api/voice/transcribe', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { audio?: string; format?: string; language?: string };

    if (!body.audio) {
      reply.status(400).send({ error: 'audio (base64) is required' });
      return;
    }

    if (!voiceEngine?.isEnabled()) {
      reply.status(503).send({ error: 'Voice engine not enabled' });
      return;
    }

    try {
      const audioBuffer = Buffer.from(body.audio, 'base64');
      const result = await voiceEngine.listen(audioBuffer, {
        format: body.format ?? 'wav',
        language: body.language,
      });

      return {
        text: result.text,
        confidence: result.confidence,
        language: result.language,
        durationMs: result.durationMs,
        provider: result.provider,
      };
    } catch (error) {
      logger.error('STT transcription failed', error);
      reply.status(500).send({ error: 'STT transcription failed' });
      return;
    }
  });

  // POST /api/chat/stream — streamed response via SSE
  app.post('/api/chat/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      message?: string;
      sessionId?: string;
      userId?: string;
    };

    if (!body.message || typeof body.message !== 'string') {
      reply.status(400).send({ error: 'message is required' });
      return;
    }

    if (!agentRuntime) {
      reply.status(503).send({ error: 'Agent runtime not initialized' });
      return;
    }

    const sessionId = body.sessionId ?? generateId('sess');
    const userId = body.userId ?? 'webchat-user';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      const stream = agentRuntime.processMessageStream({
        sessionId,
        userId,
        content: body.message,
        channelType: 'webchat',
      });

      let result;
      let iterResult = await stream.next();

      while (!iterResult.done) {
        const chunk = iterResult.value as string;
        reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        iterResult = await stream.next();
      }

      result = iterResult.value;

      reply.raw.write(`data: ${JSON.stringify({
        type: 'done',
        id: result.id,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        blocked: result.blocked,
        duration: result.duration,
        sessionId,
      })}\n\n`);

    } catch (error) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream failed' })}\n\n`);
      logger.error('Stream request failed', error);
    } finally {
      reply.raw.end();
    }
  });

  // GET /api/chat/history/:sessionId — get conversation history (persistent)
  app.get('/api/chat/history/:sessionId', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    // Try persistent store first
    if (chatHistoryStore) {
      const session = await chatHistoryStore.loadSession(sessionId);
      if (session) {
        return { sessionId, messages: session.messages };
      }
    }

    // Fallback to in-memory
    if (agentRuntime) {
      const messages = agentRuntime.getHistoryMessages(sessionId);
      return { sessionId, messages };
    }

    return { sessionId, messages: [] };
  });

  // DELETE /api/chat/history/:sessionId — clear conversation
  app.delete('/api/chat/history/:sessionId', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    if (agentRuntime) {
      agentRuntime.clearHistory(sessionId);
    }
    if (chatHistoryStore) {
      await chatHistoryStore.deleteSession(sessionId);
    }

    return { success: true, sessionId };
  });

  // GET /api/chat/active — return all sessions currently being processed (for progress recovery)
  app.get('/api/chat/active', async () => {
    if (!agentManager) return { active: [] };
    return { active: agentManager.getActiveSessions() };
  });

  // GET /api/chat/sessions — list all persistent chat sessions
  app.get('/api/chat/sessions', async () => {
    if (!chatHistoryStore) return { sessions: [] };
    const sessions = await chatHistoryStore.listSessions();
    return { sessions };
  });

  // DELETE /api/chat/sessions — delete ALL sessions
  app.delete('/api/chat/sessions', async () => {
    if (!chatHistoryStore) return { success: false, deleted: 0 };
    if (agentRuntime) {
      agentRuntime.clearAllHistory();
    }
    const deleted = await chatHistoryStore.deleteAllSessions();
    return { success: true, deleted };
  });

  // DELETE /api/chat/sessions/:sessionId — delete a specific session
  app.delete('/api/chat/sessions/:sessionId', async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    if (agentRuntime) {
      agentRuntime.clearHistory(sessionId);
    }
    if (chatHistoryStore) {
      await chatHistoryStore.deleteSession(sessionId);
    }
    return { success: true, sessionId };
  });

  // GET /api/chat/sessions/:sessionId — load a specific session with all messages
  app.get('/api/chat/sessions/:sessionId', async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!chatHistoryStore) return { session: null };
    const session = await chatHistoryStore.loadSession(sessionId);
    return { session };
  });

  // GET /api/providers — list ALL LLM providers (configured or not)
  const ALL_PROVIDERS_META: Array<{ name: string; displayName: string; models: string[]; envKey: string }> = [
    { name: 'openai', displayName: 'OpenAI (GPT)', models: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3-pro', 'o4-mini'], envKey: 'OPENAI_API_KEY' },
    { name: 'anthropic', displayName: 'Anthropic (Claude)', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'], envKey: 'ANTHROPIC_API_KEY' },
    { name: 'google', displayName: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'], envKey: 'GOOGLE_API_KEY' },
    { name: 'moonshot', displayName: 'Kimi (Moonshot)', models: ['kimi-k2.5', 'kimi-k2-0711-preview', 'moonshot-v1-auto', 'moonshot-v1-128k'], envKey: 'MOONSHOT_API_KEY' },
    { name: 'deepseek', displayName: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'], envKey: 'DEEPSEEK_API_KEY' },
    { name: 'groq', displayName: 'Groq', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'], envKey: 'GROQ_API_KEY' },
    { name: 'mistral', displayName: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'pixtral-large-latest'], envKey: 'MISTRAL_API_KEY' },
    { name: 'xai', displayName: 'xAI (Grok)', models: ['grok-4', 'grok-3', 'grok-3-mini', 'grok-2'], envKey: 'XAI_API_KEY' },
    { name: 'local', displayName: 'Local LLM (Ollama)', models: ['llama3.1:8b', 'mistral:7b', 'codellama:13b', 'phi3:mini', 'qwen2.5:7b', 'deepseek-r1:8b'], envKey: 'OLLAMA_BASE_URL' },
  ];

  app.get('/api/providers/balances', async () => {
    try {
      const balances = await router.getBalances();
      const totalBalance = balances
        .filter(b => b.available && b.balance != null)
        .reduce((sum, b) => sum + (b.balance ?? 0), 0);
      return { balances, totalBalance, currency: 'USD' };
    } catch {
      return { balances: [], totalBalance: 0, currency: 'USD' };
    }
  });

  app.get('/api/providers', async () => {
    const registeredProviders = router.getProviders();
    const providerList = await Promise.all(ALL_PROVIDERS_META.map(async meta => {
      const registered = registeredProviders.get(meta.name as any);
      let models = meta.models;
      if (registered) {
        // For providers with async fetchModels (e.g. Ollama), fetch real installed models
        if (typeof (registered as any).fetchModels === 'function') {
          try {
            models = await (registered as any).fetchModels();
          } catch {
            models = registered.listModels();
          }
        } else {
          models = registered.listModels();
        }
      }
      return {
        name: meta.name,
        displayName: registered?.displayName ?? meta.displayName,
        configured: registered?.isConfigured() ?? false,
        models,
      };
    }));

    return { providers: providerList, routes: router.getRoutes() };
  });

  // POST /api/providers/:name/key — save API key and register provider
  app.post('/api/providers/:name/key', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { apiKey, ollamaApiKey } = request.body as { apiKey: string; ollamaApiKey?: string };

    if (!apiKey || apiKey.trim().length === 0) {
      return { error: 'API key is required' };
    }

    const meta = ALL_PROVIDERS_META.find(p => p.name === name);
    if (!meta) {
      return { error: `Unknown provider: ${name}` };
    }

    const trimmedKey = apiKey.trim();

    // Create provider instance and validate API key before saving
    try {
      const { GoogleProvider, MoonshotProvider, MistralProvider, GroqProvider, DeepSeekProvider, XAIProvider, OpenAIProvider, AnthropicProvider, OllamaProvider } = await import('@forgeai/agent');
      const providerMap: Record<string, () => any> = {
        anthropic: () => new AnthropicProvider(trimmedKey),
        openai: () => new OpenAIProvider(trimmedKey),
        google: () => new GoogleProvider(trimmedKey),
        moonshot: () => new MoonshotProvider(trimmedKey),
        mistral: () => new MistralProvider(trimmedKey),
        groq: () => new GroqProvider(trimmedKey),
        deepseek: () => new DeepSeekProvider(trimmedKey),
        xai: () => new XAIProvider(trimmedKey),
        local: () => new OllamaProvider(trimmedKey, ollamaApiKey?.trim() || undefined), // trimmedKey = base URL, ollamaApiKey = optional auth
      };

      const factory = providerMap[name];
      if (!factory) return { error: 'Provider registration failed' };

      const provider = factory();

      // Validate: try listing models or a minimal chat to confirm key works
      if (name === 'local') {
        // For local LLMs, validate by fetching model list instead of chat
        try {
          const models = await (provider as any).fetchModels();
          if (!models || models.length === 0) {
            return { error: `Could not connect to Ollama at ${trimmedKey}. Make sure Ollama is running.` };
          }
          logger.info(`Ollama connected: ${models.length} models found`, { models: models.slice(0, 5) });
        } catch (validationErr: any) {
          return { error: `Could not connect to Ollama at ${trimmedKey}: ${validationErr.message}` };
        }
      } else {
        try {
          await provider.chat({
            messages: [{ role: 'user', content: 'hi' }],
            model: provider.listModels()[0],
            maxTokens: 1,
            temperature: 0,
          });
        } catch (validationErr: any) {
          const errMsg = String(validationErr?.message ?? validationErr);
          if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('Invalid') || errMsg.includes('Unauthorized') || errMsg.includes('invalid_api_key')) {
            logger.warn(`API key validation failed for ${name}`, { error: errMsg });
            return { error: `Invalid API key: authentication failed. Please check your key.` };
          }
          // Other errors (rate limit, model not found, etc.) — key is likely valid
          logger.debug(`API key validation for ${name} returned non-auth error (key likely valid)`, { error: errMsg });
        }
      }

      // Key is valid — persist to Vault and register
      if (vault?.isInitialized()) {
        vault.set(`env:${meta.envKey}`, trimmedKey);
        // Save Ollama API key separately if provided
        if (name === 'local' && ollamaApiKey?.trim()) {
          vault.set('env:OLLAMA_API_KEY', ollamaApiKey.trim());
          logger.info('Ollama API key saved to Vault');
        }
        logger.info(`API key for ${name} saved to Vault`, { name });
      }

      router.registerProvider(provider);
      syncAgentToRouter();
      logger.info(`Provider ${name} configured via API`, { name });
      return { success: true, provider: name, configured: true, persisted: vault?.isInitialized() ?? false };
    } catch (err) {
      logger.error('Failed to register provider', { name, error: String(err) });
      return { error: `Failed to register provider: ${String(err)}` };
    }
  });

  // DELETE /api/providers/:name/key — remove API key and unregister provider
  app.delete('/api/providers/:name/key', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const meta = ALL_PROVIDERS_META.find(p => p.name === name);
    if (!meta) return { error: `Unknown provider: ${name}` };

    // Remove from env
    delete process.env[meta.envKey];

    // Remove from Vault
    if (vault?.isInitialized()) {
      vault.delete(`env:${meta.envKey}`);
      logger.info(`API key for ${name} removed from Vault`, { name });
    }

    // Remove provider from router so it no longer appears as configured
    router.removeProvider(name as any);
    syncAgentToRouter();
    logger.info(`Provider ${name} key removed`, { name });
    return { success: true, provider: name, removed: true };
  });

  // ─── Custom Models per Provider ───
  // GET /api/providers/:name/models — list models (custom or default)
  app.get('/api/providers/:name/models', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const meta = ALL_PROVIDERS_META.find(p => p.name === name);
    if (!meta) return { error: `Unknown provider: ${name}` };

    // Check Vault for custom models
    const vaultKey = `models:${name}`;
    let customModels: string[] | null = null;
    if (vault?.isInitialized()) {
      try {
        const stored = vault.get(vaultKey);
        if (stored) customModels = JSON.parse(stored) as string[];
      } catch { /* ignore */ }
    }

    const registered = router.getProviders().get(name as any);
    const models = customModels ?? registered?.listModels() ?? meta.models;
    return { provider: name, models, custom: !!customModels };
  });

  // POST /api/providers/:name/models — save custom model list
  app.post('/api/providers/:name/models', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { models } = request.body as { models: string[] };
    const meta = ALL_PROVIDERS_META.find(p => p.name === name);
    if (!meta) return { error: `Unknown provider: ${name}` };

    if (!models || !Array.isArray(models) || models.length === 0) {
      return { error: 'models must be a non-empty array of strings' };
    }

    const cleaned = models.map(m => m.trim()).filter(m => m.length > 0);
    if (cleaned.length === 0) return { error: 'No valid model names provided' };

    // Save to Vault
    if (vault?.isInitialized()) {
      vault.set(`models:${name}`, JSON.stringify(cleaned));
    }

    // Apply to running provider
    const registered = router.getProviders().get(name as any);
    if (registered && 'setModels' in registered && typeof (registered as any).setModels === 'function') {
      (registered as any).setModels(cleaned);
    }

    logger.info(`Custom models for ${name} saved`, { name, count: cleaned.length });
    return { success: true, provider: name, models: cleaned };
  });

  // DELETE /api/providers/:name/models — reset to default models
  app.delete('/api/providers/:name/models', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const meta = ALL_PROVIDERS_META.find(p => p.name === name);
    if (!meta) return { error: `Unknown provider: ${name}` };

    if (vault?.isInitialized()) {
      vault.delete(`models:${name}`);
    }

    // Reset provider to defaults by re-registering
    const registered = router.getProviders().get(name as any);
    if (registered && 'setModels' in registered && typeof (registered as any).setModels === 'function') {
      (registered as any).setModels(meta.models);
    }

    logger.info(`Custom models for ${name} reset to defaults`, { name });
    return { success: true, provider: name, models: meta.models, reset: true };
  });

  // ─── Service Keys (Leonardo, ElevenLabs, SD URL, Voice) ───
  // Same pattern as LLM provider keys — saved to Vault, loaded to process.env

  const SERVICE_KEYS_META = [
    { name: 'leonardo', display: 'Leonardo AI', envKey: 'LEONARDO_API_KEY', type: 'key' as const },
    { name: 'elevenlabs', display: 'ElevenLabs', envKey: 'ELEVENLABS_API_KEY', type: 'key' as const },
    { name: 'stable-diffusion', display: 'Stable Diffusion', envKey: 'STABLE_DIFFUSION_URL', type: 'url' as const },
    { name: 'voice-enabled', display: 'Voice Engine', envKey: 'VOICE_ENABLED', type: 'toggle' as const },
    { name: 'security-webhook', display: 'Security Webhook', envKey: 'SECURITY_WEBHOOK_URL', type: 'url' as const },
    { name: 'rbac-enforce', display: 'RBAC Hard Enforcement', envKey: 'RBAC_ENFORCE', type: 'toggle' as const },
    { name: 'stt-tts-api', display: 'VPS STT/TTS (Whisper+Piper)', envKey: 'STT_TTS_API_KEY', type: 'key' as const },
    { name: 'whisper-api-url', display: 'VPS Whisper URL', envKey: 'WHISPER_API_URL', type: 'url' as const },
    { name: 'piper-api-url', display: 'VPS Piper URL', envKey: 'PIPER_API_URL', type: 'url' as const },
    { name: 'kokoro-api-url', display: 'Kokoro TTS URL', envKey: 'KOKORO_API_URL', type: 'url' as const },
    { name: 'kokoro-api-key', display: 'Kokoro API Key', envKey: 'KOKORO_API_KEY', type: 'key' as const },
    { name: 'node-api-key', display: 'Node Protocol Key', envKey: 'NODE_API_KEY', type: 'key' as const },
  ];

  // GET /api/services — list service configs status
  app.get('/api/services', async () => {
    return {
      services: SERVICE_KEYS_META.map(s => ({
        name: s.name,
        display: s.display,
        type: s.type,
        configured: s.type === 'toggle'
          ? process.env[s.envKey] === 'true'
          : !!process.env[s.envKey],
        value: s.type === 'toggle' ? process.env[s.envKey] === 'true' : undefined,
      })),
    };
  });

  // POST /api/services/:name — save service key/url/toggle
  app.post('/api/services/:name', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { value } = request.body as { value: string };
    const meta = SERVICE_KEYS_META.find(s => s.name === name);
    if (!meta) return { error: `Unknown service: ${name}` };

    if (!value && meta.type !== 'toggle') {
      return { error: 'value is required' };
    }

    const trimmed = (value ?? '').trim();
    process.env[meta.envKey] = trimmed;

    if (vault?.isInitialized()) {
      vault.set(`env:${meta.envKey}`, trimmed);
    }

    // If voice toggle changed, update voice engine
    if (meta.name === 'voice-enabled' && voiceEngine) {
      voiceEngine.setConfig({ enabled: trimmed === 'true' } as any);
    }

    // Hot-reload NodeChannel when key is set/changed via Dashboard
    if (meta.name === 'node-api-key' && trimmed) {
      initNodeChannel(trimmed);
      logger.info('NodeChannel hot-reloaded with new key from Dashboard');
    }

    logger.info(`Service ${name} configured via API`, { name, persisted: vault?.isInitialized() ?? false });
    return { success: true, service: name, configured: true };
  });

  // DELETE /api/services/:name — remove service key
  app.delete('/api/services/:name', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const meta = SERVICE_KEYS_META.find(s => s.name === name);
    if (!meta) return { error: `Unknown service: ${name}` };

    delete process.env[meta.envKey];
    if (vault?.isInitialized()) {
      vault.delete(`env:${meta.envKey}`);
    }

    if (meta.name === 'voice-enabled' && voiceEngine) {
      voiceEngine.setConfig({ enabled: false } as any);
    }

    // Disconnect NodeChannel when key is removed
    if (meta.name === 'node-api-key' && nodeChannel) {
      nodeChannel.disconnect().catch(() => {});
      nodeChannel = null;
      logger.info('NodeChannel disconnected — key removed via Dashboard');
    }

    logger.info(`Service ${name} key removed`, { name });
    return { success: true, service: name, removed: true };
  });

  // ─── REST API: Tools ───────────────────────────────

  // GET /api/tools — list available tools
  app.get('/api/tools', async () => {
    if (!toolRegistry) return { tools: [] };
    return { tools: toolRegistry.list() };
  });

  // POST /api/tools/execute — execute a tool
  app.post('/api/tools/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      tool?: string;
      params?: Record<string, unknown>;
      userId?: string;
    };

    if (!body.tool || typeof body.tool !== 'string') {
      reply.status(400).send({ error: 'tool name is required' });
      return;
    }

    if (!toolRegistry) {
      reply.status(503).send({ error: 'Tool registry not initialized' });
      return;
    }

    const result = await toolRegistry.execute(
      body.tool,
      body.params ?? {},
      body.userId ?? 'api-user'
    );

    return result;
  });

  // GET /api/tools/definitions — tool definitions for LLM function calling
  app.get('/api/tools/definitions', async () => {
    if (!toolRegistry) return { tools: [] };
    return { tools: toolRegistry.listForLLM() };
  });

  // ─── REST API: Plugins ───────────────────────────

  app.get('/api/plugins', async () => {
    if (!pluginManager) return { plugins: [] };
    return { plugins: pluginManager.list() };
  });

  app.post('/api/plugins/:id/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!pluginManager) { reply.status(503).send({ error: 'Plugin manager not ready' }); return; }
    try {
      await pluginManager.activate(id);
      return { success: true, id };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
  });

  app.post('/api/plugins/:id/deactivate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!pluginManager) { reply.status(503).send({ error: 'Plugin manager not ready' }); return; }
    await pluginManager.deactivate(id);
    return { success: true, id };
  });

  // ─── REST API: Workflows ─────────────────────────

  app.get('/api/workflows', async () => {
    if (!workflowEngine) return { workflows: [] };
    return { workflows: workflowEngine.list() };
  });

  app.post('/api/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id?: string; name?: string; description?: string; steps?: unknown[]; variables?: Record<string, unknown> };
    if (!body.name || !body.steps) { reply.status(400).send({ error: 'name and steps are required' }); return; }
    if (!workflowEngine) { reply.status(503).send({ error: 'Workflow engine not ready' }); return; }
    const workflow = {
      id: body.id ?? generateId('wf'),
      name: body.name,
      description: body.description ?? '',
      version: '1.0.0',
      steps: body.steps as any[],
      variables: body.variables,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    workflowEngine.register(workflow);
    return { success: true, workflow };
  });

  app.post('/api/workflows/:id/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { variables?: Record<string, unknown> }) || {};
    if (!workflowEngine) { reply.status(503).send({ error: 'Workflow engine not ready' }); return; }
    try {
      const run = await workflowEngine.execute(id, body.variables);
      return {
        runId: run.id,
        status: run.status,
        duration: run.duration,
        stepsCompleted: Array.from(run.stepResults.values()).filter(s => s.status === 'completed').length,
        stepsTotal: run.stepResults.size,
        error: run.error,
      };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
  });

  app.get('/api/workflows/runs', async (request: FastifyRequest) => {
    const query = request.query as { workflowId?: string };
    if (!workflowEngine) return { runs: [] };
    return { runs: workflowEngine.listRuns(query.workflowId) };
  });

  // ─── REST API: Sessions ─────────────────────────

  app.get('/api/sessions', async () => {
    if (!agentRuntime) return { sessions: [] };
    return { sessions: agentRuntime.listSessions() };
  });

  app.get('/api/sessions/:sessionId', async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!agentRuntime) return { session: null };
    const info = agentRuntime.getSessionInfo(sessionId);
    const messages = agentRuntime.getHistoryMessages(sessionId);
    return { session: info, messages };
  });

  // ─── REST API: Usage ──────────────────────────────

  app.get('/api/usage', async (request: FastifyRequest) => {
    if (!agentRuntime) return { summary: null };
    const query = request.query as { userId?: string; sessionId?: string; since?: string };
    const filter: { userId?: string; sessionId?: string; since?: Date } = {};
    if (query.userId) filter.userId = query.userId;
    if (query.sessionId) filter.sessionId = query.sessionId;
    if (query.since) filter.since = new Date(query.since);
    return { summary: agentRuntime.getUsageTracker().getSummary(filter) };
  });

  app.get('/api/usage/records', async (request: FastifyRequest) => {
    if (!agentRuntime) return { records: [] };
    const query = request.query as { limit?: string; offset?: string };
    const limit = parseInt(query.limit ?? '50', 10);
    const offset = parseInt(query.offset ?? '0', 10);
    return { records: agentRuntime.getUsageTracker().getRecords(limit, offset) };
  });

  // ─── REST API: Progress Polling ─────────────────────

  app.get('/api/chat/progress/:sessionId', async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!agentManager) return { progress: null };
    const progress = agentManager.getProgress(sessionId);
    if (!progress) return { progress: null };
    return {
      progress: {
        status: progress.status,
        iteration: progress.iteration,
        maxIterations: progress.maxIterations,
        currentTool: progress.currentTool,
        currentArgs: progress.currentArgs,
        elapsed: Date.now() - progress.startedAt,
        steps: (progress.steps as any[]).map((s) => ({
          type: s.type,
          tool: s.tool,
          message: s.message,
          success: s.success,
          duration: s.duration,
          timestamp: s.timestamp,
        })),
      },
    };
  });

  // ─── REST API: Agent Stats ──────────────────────────

  app.get('/api/agent/stats', async () => {
    if (!agentRuntime) return { stats: null };

    const sessions = agentRuntime.listSessions();
    const usage = agentRuntime.getUsageTracker();
    const summary = usage.getSummary();
    const config = agentRuntime.getConfig();

    // Per-session cost breakdown
    const sessionStats = sessions.map(s => {
      const sUsage = usage.getSessionUsage(s.sessionId);
      return {
        sessionId: s.sessionId,
        messageCount: s.messageCount,
        totalTokens: sUsage.totalTokens,
        totalCost: sUsage.totalCost,
        requests: sUsage.requests,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
      };
    });

    // Persistent sessions count (from chat history store)
    let persistentSessionCount = 0;
    if (chatHistoryStore) {
      const stored = await chatHistoryStore.listSessions();
      persistentSessionCount = stored.length;
    }

    // Tools info
    const toolsList = toolRegistry ? toolRegistry.list().map(t => t.name) : [];

    // Sandbox status
    let sandboxStatus = 'unavailable';
    try {
      const { execSync } = await import('node:child_process');
      execSync('docker info', { stdio: 'ignore', timeout: 3000 });
      sandboxStatus = 'available';
    } catch { sandboxStatus = 'unavailable'; }

    return {
      stats: {
        agent: {
          model: config.model,
          provider: config.provider,
          thinkingLevel: agentRuntime.getThinkingLevel(),
          temperature: (agentRuntime as any).config?.temperature ?? 0.7,
          maxTokens: (agentRuntime as any).config?.maxTokens ?? 4096,
        },
        tools: toolsList,
        toolCount: toolsList.length,
        sandboxStatus,
        agents: agentManager?.listAgents() ?? [],
        activeSessions: sessions.length,
        totalSessions: persistentSessionCount,
        usage: {
          totalRequests: summary.totalRequests,
          totalTokens: summary.totalTokens,
          totalCost: summary.totalCost,
          byProvider: summary.byProvider,
          byModel: summary.byModel,
        },
        sessions: sessionStats,
      },
    };
  });

  // ─── REST API: Serve Workspace/Screenshot Files ───

  app.get('/api/files/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { resolve, normalize, sep } = await import('node:path');
    const { createReadStream, existsSync, statSync } = await import('node:fs');
    const urlPath = (request.params as { '*': string })['*'];
    if (!urlPath) { reply.status(400).send({ error: 'No path' }); return; }

    // Allow serving from .forgeai/screenshots/ and .forgeai/workspace/
    const baseDir = resolve(process.cwd(), '.forgeai');
    const filePath = normalize(resolve(baseDir, urlPath));

    // Security: prevent directory traversal
    if (!filePath.startsWith(baseDir + sep) && filePath !== baseDir) {
      reply.status(403).send({ error: 'Access denied' });
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      reply.status(404).send({ error: 'File not found' });
      return;
    }

    // Determine content type
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      html: 'text/html', css: 'text/css', js: 'application/javascript',
      json: 'application/json', txt: 'text/plain',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(createReadStream(filePath));
  });

  // ─── REST API: Image Upload ──────────────────────

  app.post('/api/chat/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const { resolve } = await import('node:path');
    const { mkdirSync, existsSync, writeFileSync } = await import('node:fs');

    const uploadDir = resolve(process.cwd(), '.forgeai', 'uploads');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

    // Expect base64 JSON body: { filename, data (base64), mimeType }
    const body = request.body as { filename?: string; data?: string; mimeType?: string };
    if (!body.data || !body.mimeType) {
      reply.status(400).send({ error: 'data (base64) and mimeType are required' });
      return;
    }

    const ext = body.mimeType.split('/')[1] || 'png';
    const filename = body.filename || `upload_${Date.now()}.${ext}`;
    const filepath = resolve(uploadDir, filename);

    const buffer = Buffer.from(body.data, 'base64');
    writeFileSync(filepath, buffer);

    const url = `/api/files/uploads/${filename}`;
    logger.info('Image uploaded', { filename, size: buffer.length, url });

    return { success: true, filename, url, path: filepath, size: buffer.length };
  });

  // ─── REST API: Multi-Agent Management ──────────────

  // GET /api/agents — list all agents
  app.get('/api/agents', async () => {
    if (!agentManager) return { agents: [] };
    return { agents: agentManager.listAgents(), bindings: agentManager.getBindings() };
  });

  // POST /api/agents — add a new agent
  app.post('/api/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!agentManager) { reply.status(503).send({ error: 'Agent manager not ready' }); return; }
    const body = request.body as {
      id?: string; name?: string; model?: string; provider?: string;
      persona?: string; systemPrompt?: string; temperature?: number;
      tools?: { allow?: string[]; deny?: string[] };
    };
    if (!body.id || !body.name) {
      reply.status(400).send({ error: 'id and name are required' });
      return;
    }
    if (agentManager.getAgent(body.id)) {
      reply.status(409).send({ error: `Agent '${body.id}' already exists` });
      return;
    }
    agentManager.addAgent({
      id: body.id,
      name: body.name,
      model: body.model,
      provider: body.provider as any,
      persona: body.persona,
      systemPrompt: body.systemPrompt,
      temperature: body.temperature,
      tools: body.tools,
    });
    return { success: true, agent: agentManager.listAgents().find((a: { id: string }) => a.id === body.id) };
  });

  // DELETE /api/agents/:id — remove an agent
  app.delete('/api/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!agentManager) { reply.status(503).send({ error: 'Agent manager not ready' }); return; }
    const { id } = request.params as { id: string };
    const removed = agentManager.removeAgent(id);
    if (!removed) {
      reply.status(400).send({ error: `Cannot remove agent '${id}' (default or not found)` });
      return;
    }
    return { success: true };
  });

  // PATCH /api/agents/:id — update agent config
  app.patch('/api/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!agentManager) { reply.status(503).send({ error: 'Agent manager not ready' }); return; }
    const { id } = request.params as { id: string };
    const body = request.body as { model?: string; provider?: string; name?: string; persona?: string };
    const updated = agentManager.updateAgent(id, body);
    if (!updated) {
      reply.status(404).send({ error: `Agent '${id}' not found` });
      return;
    }
    return { success: true, agent: agentManager.listAgents().find((a: { id: string }) => a.id === id) };
  });

  // POST /api/agents/bindings — add a routing binding
  app.post('/api/agents/bindings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!agentManager) { reply.status(503).send({ error: 'Agent manager not ready' }); return; }
    const body = request.body as { agentId?: string; match?: Record<string, unknown> };
    if (!body.agentId || !body.match) {
      reply.status(400).send({ error: 'agentId and match are required' });
      return;
    }
    agentManager.addBinding({ agentId: body.agentId, match: body.match as any });
    return { success: true, bindings: agentManager.getBindings() };
  });

  // POST /api/agents/send — agent-to-agent message
  app.post('/api/agents/send', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!agentManager) { reply.status(503).send({ error: 'Agent manager not ready' }); return; }
    const body = request.body as { fromAgentId?: string; toAgentId?: string; message?: string };
    if (!body.fromAgentId || !body.toAgentId || !body.message) {
      reply.status(400).send({ error: 'fromAgentId, toAgentId, and message are required' });
      return;
    }
    const result = await agentManager.agentSendMessage({
      fromAgentId: body.fromAgentId,
      toAgentId: body.toAgentId,
      content: body.message,
    });
    if (!result) {
      reply.status(403).send({ error: 'Agent-to-agent communication failed or disabled' });
      return;
    }
    return { success: true, response: result.content, model: result.model, duration: result.duration };
  });

  // ─── REST API: Agent Settings ─────────────────────

  app.get('/api/agent/config', async () => {
    if (!agentRuntime) return { config: null };
    return {
      config: agentRuntime.getConfig(),
      thinkingLevel: agentRuntime.getThinkingLevel(),
    };
  });

  app.post('/api/agent/thinking', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { level?: string };
    if (!body.level || !['off', 'low', 'medium', 'high'].includes(body.level)) {
      reply.status(400).send({ error: 'level must be one of: off, low, medium, high' });
      return;
    }
    if (!agentRuntime) { reply.status(503).send({ error: 'Agent not ready' }); return; }
    agentRuntime.setThinkingLevel(body.level as 'off' | 'low' | 'medium' | 'high');
    return { success: true, thinkingLevel: body.level };
  });

  // ─── Sandbox Manager ──────────────────────────────

  sandboxManager = createSandboxManager({
    enabled: process.env.SANDBOX_ENABLED === 'true',
  });

  advancedRateLimiter = createAdvancedRateLimiter();

  // ─── REST API: Sandbox ────────────────────────────

  app.get('/api/sandbox/status', async () => {
    if (!sandboxManager) return { error: 'Sandbox not initialized' };
    return { sandbox: await sandboxManager.getStatus() };
  });

  app.post('/api/sandbox/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!sandboxManager) { reply.status(503).send({ error: 'Sandbox not initialized' }); return; }
    const body = request.body as { code?: string; language?: string };
    if (!body.code) { reply.status(400).send({ error: 'code is required' }); return; }
    const result = await sandboxManager.execute(body.code, body.language ?? 'javascript');
    return result;
  });

  // ─── REST API: Advanced Rate Limiting ──────────────

  app.get('/api/rate-limits', async () => {
    if (!advancedRateLimiter) return { rules: [] };
    return { rules: advancedRateLimiter.getRules() };
  });

  app.post('/api/rate-limits', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!advancedRateLimiter) { reply.status(503).send({ error: 'Rate limiter not initialized' }); return; }
    const body = request.body as { key?: string; windowMs?: number; maxRequests?: number; burstLimit?: number; burstWindowMs?: number };
    if (!body.key || !body.windowMs || !body.maxRequests) {
      reply.status(400).send({ error: 'key, windowMs, and maxRequests are required' });
      return;
    }
    advancedRateLimiter.addRule({
      key: body.key,
      windowMs: body.windowMs,
      maxRequests: body.maxRequests,
      burstLimit: body.burstLimit,
      burstWindowMs: body.burstWindowMs,
    });
    return { success: true, rules: advancedRateLimiter.getRules() };
  });

  // ─── Plugin SDK / Store ────────────────────────────

  pluginSDK = createPluginSDK();

  app.get('/api/plugins/store', async () => {
    if (!pluginSDK) return { plugins: [] };
    return { plugins: pluginSDK.listPlugins() };
  });

  app.post('/api/plugins/store/:id/enable', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!pluginSDK) { reply.status(503).send({ error: 'SDK not ready' }); return; }
    const { id } = request.params as { id: string };
    return { success: pluginSDK.enablePlugin(id) };
  });

  app.post('/api/plugins/store/:id/disable', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!pluginSDK) { reply.status(503).send({ error: 'SDK not ready' }); return; }
    const { id } = request.params as { id: string };
    return { success: pluginSDK.disablePlugin(id) };
  });

  app.get('/api/plugins/store/categories', async () => {
    if (!pluginSDK) return { categories: [] };
    return { categories: pluginSDK.getCategories() };
  });

  app.post('/api/plugins/store/template', async (request: FastifyRequest) => {
    const { name } = request.body as { name?: string };
    if (!pluginSDK) return { template: '' };
    return { template: pluginSDK.generatePluginTemplate(name ?? 'MyPlugin') };
  });

  // ─── Voice Engine ──────────────────────────────────

  voiceEngine = createVoiceEngine({
    enabled: process.env.VOICE_ENABLED === 'true',
  });

  // Restore voice config from Vault
  if (vault?.isInitialized()) {
    try {
      const savedVoiceConfig = vault.get('config:voice');
      if (savedVoiceConfig) {
        const parsed = JSON.parse(savedVoiceConfig);
        voiceEngine.setConfig(parsed);
        logger.info('Voice config restored from Vault', parsed);
      }
    } catch { /* ignore parse errors */ }
  }

  app.get('/api/voice/config', async () => {
    if (!voiceEngine) return { error: 'Voice not initialized' };
    return { config: voiceEngine.getConfig(), providers: voiceEngine.getAvailableProviders() };
  });

  app.get('/api/voice/voices', async () => {
    if (!voiceEngine) return { voices: [] };
    return { voices: await voiceEngine.listVoices() };
  });

  app.put('/api/voice/config', async (request: FastifyRequest) => {
    if (!voiceEngine) return { error: 'Voice not initialized' };
    const body = request.body as {
      enabled?: boolean;
      ttsProvider?: string;
      sttProvider?: string;
      ttsVoice?: string;
      ttsSpeed?: number;
      language?: string;
    };
    voiceEngine.setConfig(body as any);

    // Persist voice config to Vault
    if (vault?.isInitialized()) {
      const fullConfig = voiceEngine.getConfig();
      vault.set('config:voice', JSON.stringify(fullConfig));
    }

    logger.info('Voice config updated', body);
    return { config: voiceEngine.getConfig() };
  });

  // ─── Language Setting ──────────────────────────────

  app.get('/api/settings/language', async () => {
    const lang = vault?.isInitialized() ? (vault.get('config:language') ?? 'en') : 'en';
    return { language: lang };
  });

  app.put('/api/settings/language', async (request: FastifyRequest) => {
    const body = request.body as { language?: string };
    const lang = body.language ?? 'en';
    if (vault?.isInitialized()) {
      vault.set('config:language', lang);
    }
    logger.info('Language updated', { language: lang });
    return { language: lang };
  });

  // ─── Webhook Manager ───────────────────────────────

  webhookManager = createWebhookManager();

  app.get('/api/webhooks', async () => {
    if (!webhookManager) return { outbound: [], inbound: [] };
    return { outbound: webhookManager.listOutbound(), inbound: webhookManager.listInbound() };
  });

  app.post('/api/webhooks/outbound', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!webhookManager) { reply.status(503).send({ error: 'Webhook manager not ready' }); return; }
    const body = request.body as { name?: string; url?: string; events?: string[]; secret?: string };
    if (!body.name || !body.url || !body.events) {
      reply.status(400).send({ error: 'name, url, and events are required' }); return;
    }
    const wh = webhookManager.registerOutbound({ name: body.name, url: body.url, events: body.events, secret: body.secret, enabled: true });
    return { webhook: wh };
  });

  app.post('/api/webhooks/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!webhookManager) { reply.status(503).send({ error: 'Webhook manager not ready' }); return; }
    const body = request.body as { name?: string; path?: string; secret?: string; handler?: string };
    if (!body.name || !body.path || !body.handler) {
      reply.status(400).send({ error: 'name, path, and handler are required' }); return;
    }
    const wh = webhookManager.registerInbound({ name: body.name, path: body.path, secret: body.secret, handler: body.handler });
    return { webhook: wh };
  });

  app.get('/api/webhooks/events', async () => {
    if (!webhookManager) return { events: [] };
    return { events: webhookManager.getEventLog(50) };
  });

  // Inbound webhook receiver (wildcard)
  app.post('/api/webhooks/receive/:path', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!webhookManager) { reply.status(503).send({ error: 'Webhook manager not ready' }); return; }
    const { path } = request.params as { path: string };
    const signature = (request.headers['x-webhook-signature'] as string) ?? undefined;
    const result = await webhookManager.processInbound(`/${path}`, request.body, signature);
    if (!result.handled) reply.status(404);
    return result;
  });

  // ─── IP Filter ──────────────────────────────────────────

  ipFilter = createIPFilter({
    enabled: process.env.IP_FILTER_ENABLED === 'true',
    mode: (process.env.IP_FILTER_MODE as 'allowlist' | 'blocklist') ?? 'blocklist',
  });

  app.get('/api/ip-filter', async () => {
    if (!ipFilter) return { config: {} };
    return { config: ipFilter.getConfig() };
  });

  app.post('/api/ip-filter', async (request: FastifyRequest) => {
    if (!ipFilter) return { error: 'IP filter not initialized' };
    const body = request.body as { enabled?: boolean; mode?: 'allowlist' | 'blocklist' };
    if (body.enabled !== undefined) ipFilter.setEnabled(body.enabled);
    if (body.mode) ipFilter.setMode(body.mode);
    return { config: ipFilter.getConfig() };
  });

  app.post('/api/ip-filter/allowlist', async (request: FastifyRequest) => {
    if (!ipFilter) return { error: 'IP filter not initialized' };
    const { ip, action } = request.body as { ip: string; action: 'add' | 'remove' };
    if (action === 'add') ipFilter.addToAllowlist(ip);
    else ipFilter.removeFromAllowlist(ip);
    return { config: ipFilter.getConfig() };
  });

  app.post('/api/ip-filter/blocklist', async (request: FastifyRequest) => {
    if (!ipFilter) return { error: 'IP filter not initialized' };
    const { ip, action } = request.body as { ip: string; action: 'add' | 'remove' };
    if (action === 'add') ipFilter.addToBlocklist(ip);
    else ipFilter.removeFromBlocklist(ip);
    return { config: ipFilter.getConfig() };
  });

  // ─── Tailscale Remote Access ────────────────────────────

  tailscaleHelper = createTailscaleHelper();

  app.get('/api/remote/status', async () => {
    if (!tailscaleHelper) return { status: { installed: false, running: false } };
    const status = await tailscaleHelper.checkStatus();
    return { status };
  });

  app.post('/api/remote/serve', async (request: FastifyRequest) => {
    if (!tailscaleHelper) return { error: 'Tailscale helper not initialized' };
    const body = request.body as { port?: number; funnel?: boolean };
    const result = await tailscaleHelper.serve({ port: body.port ?? 18800, funnel: body.funnel });
    return result;
  });

  app.post('/api/remote/stop', async () => {
    if (!tailscaleHelper) return { error: 'Tailscale helper not initialized' };
    return tailscaleHelper.stopServe();
  });

  // ─── MCP (Model Context Protocol) ─────────────────────

  mcpClient = createMCPClient();

  app.get('/api/mcp/servers', async () => {
    if (!mcpClient) return { servers: [] };
    return { servers: mcpClient.getServers() };
  });

  app.post('/api/mcp/servers', async (request: FastifyRequest) => {
    if (!mcpClient) return { error: 'MCP not initialized' };
    const config = request.body as { name: string; url: string; apiKey?: string; transport?: string };
    mcpClient.addServer({ name: config.name, url: config.url, apiKey: config.apiKey, transport: (config.transport as 'http') ?? 'http', enabled: true });
    return { success: true, servers: mcpClient.getServers() };
  });

  app.post('/api/mcp/servers/:name/connect', async (request: FastifyRequest) => {
    if (!mcpClient) return { error: 'MCP not initialized' };
    const { name } = request.params as { name: string };
    return mcpClient.connect(name);
  });

  app.delete('/api/mcp/servers/:name', async (request: FastifyRequest) => {
    if (!mcpClient) return { error: 'MCP not initialized' };
    const { name } = request.params as { name: string };
    mcpClient.removeServer(name);
    return { success: true };
  });

  app.get('/api/mcp/tools', async () => {
    if (!mcpClient) return { tools: [] };
    return { tools: mcpClient.getTools() };
  });

  app.post('/api/mcp/tools/call', async (request: FastifyRequest) => {
    if (!mcpClient) return { error: 'MCP not initialized' };
    const { name, arguments: args } = request.body as { name: string; arguments: Record<string, unknown> };
    return mcpClient.callTool(name, args);
  });

  app.get('/api/mcp/resources', async () => {
    if (!mcpClient) return { resources: [] };
    return { resources: mcpClient.getResources() };
  });

  // ─── Long-term Memory ─────────────────────────────────

  memoryManager = createMemoryManager();

  // Attach memory manager to all agents for cross-session memory
  if (agentManager) {
    agentManager.setMemoryManager(memoryManager);
  }

  app.get('/api/memory/stats', async () => {
    if (!memoryManager) return { stats: {} };
    return { stats: memoryManager.getStats(), config: memoryManager.getConfig() };
  });

  app.post('/api/memory/store', async (request: FastifyRequest) => {
    if (!memoryManager) return { error: 'Memory not initialized' };
    const { id, content, metadata, sessionId } = request.body as { id: string; content: string; metadata?: Record<string, unknown>; sessionId?: string };
    const entry = memoryManager.store(id ?? generateId(), content, metadata ?? {}, sessionId);
    return { entry: { id: entry.id, content: entry.content, importance: entry.importance, timestamp: entry.timestamp } };
  });

  app.post('/api/memory/search', async (request: FastifyRequest) => {
    if (!memoryManager) return { results: [] };
    const { query, limit, sessionId } = request.body as { query: string; limit?: number; sessionId?: string };
    const results = memoryManager.search(query, limit ?? 10, sessionId);
    return { results: results.map(r => ({ id: r.entry.id, content: r.entry.content, score: Math.round(r.score * 1000) / 1000, importance: r.entry.importance })) };
  });

  app.delete('/api/memory/:id', async (request: FastifyRequest) => {
    if (!memoryManager) return { error: 'Memory not initialized' };
    const { id } = request.params as { id: string };
    return { deleted: memoryManager.delete(id) };
  });

  app.post('/api/memory/consolidate', async () => {
    if (!memoryManager) return { error: 'Memory not initialized' };
    return memoryManager.consolidate();
  });

  // ─── OAuth2 / SSO ─────────────────────────────────────

  oauth2Manager = createOAuth2Manager();

  // Auto-register providers from env
  if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
    oauth2Manager.registerBuiltin('google', process.env.OAUTH_GOOGLE_CLIENT_ID, process.env.OAUTH_GOOGLE_CLIENT_SECRET, process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:18800/api/oauth/callback');
  }
  if (process.env.OAUTH_GITHUB_CLIENT_ID && process.env.OAUTH_GITHUB_CLIENT_SECRET) {
    oauth2Manager.registerBuiltin('github', process.env.OAUTH_GITHUB_CLIENT_ID, process.env.OAUTH_GITHUB_CLIENT_SECRET, process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:18800/api/oauth/callback');
  }

  app.get('/api/oauth/providers', async () => {
    if (!oauth2Manager) return { providers: [] };
    return { providers: oauth2Manager.getProviders() };
  });

  app.get('/api/oauth/authorize/:provider', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!oauth2Manager) { reply.status(503).send({ error: 'OAuth2 not initialized' }); return; }
    const { provider } = request.params as { provider: string };
    const result = oauth2Manager.getAuthorizationUrl(provider);
    if (!result) { reply.status(404).send({ error: `Provider '${provider}' not configured` }); return; }
    return { authUrl: result.url, state: result.state };
  });

  app.get('/api/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!oauth2Manager) { reply.status(503).send({ error: 'OAuth2 not initialized' }); return; }
    const { code, state } = request.query as { code: string; state: string };
    if (!code || !state) { reply.status(400).send({ error: 'Missing code or state' }); return; }
    return oauth2Manager.handleCallback(code, state);
  });

  // ─── RAG (Retrieval-Augmented Generation) ──────────

  ragEngine = createRAGEngine();

  app.get('/api/rag/stats', async () => {
    if (!ragEngine) return { stats: {} };
    return { stats: ragEngine.getStats(), config: ragEngine.getConfig() };
  });

  app.get('/api/rag/documents', async () => {
    if (!ragEngine) return { documents: [] };
    return { documents: ragEngine.listDocuments() };
  });

  app.post('/api/rag/ingest', async (request: FastifyRequest) => {
    if (!ragEngine) return { error: 'RAG not initialized' };
    const { id, content, metadata } = request.body as { id: string; content: string; metadata?: Record<string, unknown> };
    const doc = ragEngine.ingest(id ?? generateId(), content, metadata ?? {});
    return { document: { id: doc.id, chunks: doc.chunks.length, metadata: doc.metadata } };
  });

  app.post('/api/rag/search', async (request: FastifyRequest) => {
    if (!ragEngine) return { results: [] };
    const { query, limit } = request.body as { query: string; limit?: number };
    const results = ragEngine.search(query, limit);
    return { results: results.map(r => ({ documentId: r.document.id, chunk: r.chunk.content.slice(0, 200), score: Math.round(r.score * 1000) / 1000, metadata: r.document.metadata })) };
  });

  app.post('/api/rag/context', async (request: FastifyRequest) => {
    if (!ragEngine) return { context: '' };
    const { query, maxTokens } = request.body as { query: string; maxTokens?: number };
    return { context: ragEngine.buildContext(query, maxTokens) };
  });

  app.delete('/api/rag/documents/:id', async (request: FastifyRequest) => {
    if (!ragEngine) return { error: 'RAG not initialized' };
    const { id } = request.params as { id: string };
    return { deleted: ragEngine.remove(id) };
  });

  // GET /api/rag/config — get current config
  app.get('/api/rag/config', async () => {
    if (!ragEngine) return { config: {} };
    return { config: ragEngine.getConfig() };
  });

  // POST /api/rag/config — update config at runtime
  app.post('/api/rag/config', async (request: FastifyRequest) => {
    if (!ragEngine) return { error: 'RAG not initialized' };
    const body = request.body as Record<string, unknown>;
    const config = ragEngine.updateConfig(body);
    return { config };
  });

  // POST /api/rag/upload — upload a file to ingest into RAG
  app.post('/api/rag/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!ragEngine) { reply.status(503).send({ error: 'RAG not initialized' }); return; }

    const data = await request.file();
    if (!data) { reply.status(400).send({ error: 'No file uploaded' }); return; }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const filename = data.filename || 'unknown.txt';

    const text = extractTextFromFile(filename, buffer);
    if (text.startsWith('[') && text.endsWith(']')) {
      reply.status(400).send({ error: text });
      return;
    }

    const id = data.fields?.id
      ? String((data.fields.id as any).value || generateId())
      : filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

    const metadata: Record<string, unknown> = {
      title: filename,
      filename,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
    };

    const doc = await ragEngine.ingestAsync(id, text, metadata);
    return { document: { id: doc.id, chunks: doc.chunks.length, metadata: doc.metadata, contentLength: text.length } };
  });

  // ─── Auto-Planning ────────────────────────────────

  autoPlanner = createAutoPlanner();

  app.get('/api/planner/plans', async () => {
    if (!autoPlanner) return { plans: [] };
    return { plans: autoPlanner.listPlans() };
  });

  app.post('/api/planner/plans', async (request: FastifyRequest) => {
    if (!autoPlanner) return { error: 'Planner not initialized' };
    const { goal, steps } = request.body as { goal: string; steps: Array<{ description: string; type?: 'action' | 'decision' | 'parallel' | 'loop'; toolName?: string; toolArgs?: Record<string, unknown> }> };
    const plan = autoPlanner.createPlan(goal, steps);
    return { plan: { id: plan.id, goal: plan.goal, steps: plan.totalSteps, status: plan.status } };
  });

  app.get('/api/planner/plans/:id', async (request: FastifyRequest) => {
    if (!autoPlanner) return { error: 'Planner not initialized' };
    const { id } = request.params as { id: string };
    const plan = autoPlanner.getPlan(id);
    return plan ? { plan } : { error: 'Plan not found' };
  });

  app.delete('/api/planner/plans/:id', async (request: FastifyRequest) => {
    if (!autoPlanner) return { error: 'Planner not initialized' };
    const { id } = request.params as { id: string };
    return { deleted: autoPlanner.deletePlan(id) };
  });

  // ─── API Key Management ───────────────────────────

  apiKeyManager = createAPIKeyManager();

  app.get('/api/keys', async () => {
    if (!apiKeyManager) return { keys: [] };
    return { keys: apiKeyManager.list(), scopes: apiKeyManager.getScopes(), stats: apiKeyManager.getStats() };
  });

  app.post('/api/keys', async (request: FastifyRequest) => {
    if (!apiKeyManager) return { error: 'API key manager not initialized' };
    const { name, scopes, expiresInDays, rateLimit } = request.body as { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number };
    const result = apiKeyManager.create(name, scopes, expiresInDays, rateLimit);
    return { key: result };
  });

  app.post('/api/keys/:id/revoke', async (request: FastifyRequest) => {
    if (!apiKeyManager) return { error: 'API key manager not initialized' };
    const { id } = request.params as { id: string };
    return { revoked: apiKeyManager.revoke(id) };
  });

  app.delete('/api/keys/:id', async (request: FastifyRequest) => {
    if (!apiKeyManager) return { error: 'API key manager not initialized' };
    const { id } = request.params as { id: string };
    return { deleted: apiKeyManager.delete(id) };
  });

  // ─── GDPR ─────────────────────────────────────────

  gdprManager = createGDPRManager();

  app.get('/api/gdpr/status', async () => {
    if (!gdprManager) return { status: {} };
    return { status: gdprManager.getStatus() };
  });

  app.post('/api/gdpr/export', async (request: FastifyRequest) => {
    if (!gdprManager) return { error: 'GDPR not initialized' };
    const { userId } = request.body as { userId: string };
    const data = await gdprManager.exportUserData(userId);
    return { export: { userId: data.userId, exportedAt: data.exportedAt, sections: Object.keys(data).length } };
  });

  app.post('/api/gdpr/delete', async (request: FastifyRequest) => {
    if (!gdprManager) return { error: 'GDPR not initialized' };
    const { userId } = request.body as { userId: string };
    const result = await gdprManager.deleteUserData(userId);
    return { result };
  });

  // ─── GitHub Integration ───────────────────────────

  githubIntegration = createGitHubIntegration();
  if (process.env.GITHUB_TOKEN) {
    githubIntegration.configure({ token: process.env.GITHUB_TOKEN, owner: process.env.GITHUB_OWNER, repo: process.env.GITHUB_REPO });
  }

  app.get('/api/integrations/github/status', async () => {
    if (!githubIntegration) return { configured: false };
    return { configured: githubIntegration.isConfigured() };
  });

  app.post('/api/integrations/github/configure', async (request: FastifyRequest) => {
    if (!githubIntegration) return { error: 'GitHub not initialized' };
    const config = request.body as { token: string; owner?: string; repo?: string };
    githubIntegration.configure(config);
    return { configured: true };
  });

  app.get('/api/integrations/github/issues', async (request: FastifyRequest) => {
    if (!githubIntegration) return { issues: [] };
    const { owner, repo, state } = request.query as { owner?: string; repo?: string; state?: string };
    const issues = await githubIntegration.listIssues(owner, repo, (state as 'open') ?? 'open');
    return { issues };
  });

  app.get('/api/integrations/github/pulls', async (request: FastifyRequest) => {
    if (!githubIntegration) return { pulls: [] };
    const { owner, repo, state } = request.query as { owner?: string; repo?: string; state?: string };
    const pulls = await githubIntegration.listPRs(owner, repo, (state as 'open') ?? 'open');
    return { pulls };
  });

  app.post('/api/integrations/github/search', async (request: FastifyRequest) => {
    if (!githubIntegration) return { results: { totalCount: 0, items: [] } };
    const { query, owner, repo } = request.body as { query: string; owner?: string; repo?: string };
    const results = await githubIntegration.searchCode(query, owner, repo);
    return { results };
  });

  // ─── RSS Feeds ────────────────────────────────────

  rssFeedManager = createRSSFeedManager();

  app.get('/api/integrations/rss/feeds', async () => {
    if (!rssFeedManager) return { feeds: [] };
    return { feeds: rssFeedManager.getFeeds() };
  });

  app.post('/api/integrations/rss/feeds', async (request: FastifyRequest) => {
    if (!rssFeedManager) return { error: 'RSS not initialized' };
    const { url, interval } = request.body as { url: string; interval?: number };
    const feed = rssFeedManager.addFeed(url, interval);
    return { feed: { id: feed.id, url: feed.url } };
  });

  app.post('/api/integrations/rss/feeds/:id/fetch', async (request: FastifyRequest) => {
    if (!rssFeedManager) return { error: 'RSS not initialized' };
    const { id } = request.params as { id: string };
    const items = await rssFeedManager.fetchFeed(id);
    return { items };
  });

  app.delete('/api/integrations/rss/feeds/:id', async (request: FastifyRequest) => {
    if (!rssFeedManager) return { error: 'RSS not initialized' };
    const { id } = request.params as { id: string };
    return { deleted: rssFeedManager.removeFeed(id) };
  });

  // ─── Gmail Integration ────────────────────────
  gmailIntegration = createGmailIntegration();

  app.post('/api/integrations/gmail/configure', async (request: FastifyRequest) => {
    if (!gmailIntegration) return { error: 'Gmail not initialized' };
    const { accessToken, refreshToken, clientId, clientSecret } = request.body as {
      accessToken: string; refreshToken?: string; clientId?: string; clientSecret?: string;
    };
    if (!accessToken) return { error: 'accessToken is required' };
    gmailIntegration.configure({ accessToken, refreshToken, clientId, clientSecret });
    return { configured: true };
  });

  app.get('/api/integrations/gmail/status', async () => {
    return { configured: gmailIntegration?.isConfigured() ?? false };
  });

  app.get('/api/integrations/gmail/messages', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const { maxResults, query, labelIds } = request.query as { maxResults?: string; query?: string; labelIds?: string };
    const messages = await gmailIntegration.listMessages({
      maxResults: maxResults ? Number(maxResults) : 10,
      query: query || undefined,
      labelIds: labelIds ? labelIds.split(',') : undefined,
    });
    return { messages };
  });

  app.get('/api/integrations/gmail/messages/:id', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const { id } = request.params as { id: string };
    const message = await gmailIntegration.getMessage(id);
    return { message };
  });

  app.post('/api/integrations/gmail/send', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const opts = request.body as { to: string; subject: string; body: string; cc?: string[]; bcc?: string[]; threadId?: string };
    if (!opts.to || !opts.subject || !opts.body) return { error: 'to, subject, and body are required' };
    const result = await gmailIntegration.sendEmail(opts);
    return { sent: !!result, ...result };
  });

  app.get('/api/integrations/gmail/search', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const { q, maxResults } = request.query as { q?: string; maxResults?: string };
    if (!q) return { error: 'q (query) parameter is required' };
    const messages = await gmailIntegration.search({ query: q, maxResults: maxResults ? Number(maxResults) : 10 });
    return { messages };
  });

  app.get('/api/integrations/gmail/labels', async () => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const labels = await gmailIntegration.getLabels();
    return { labels };
  });

  app.get('/api/integrations/gmail/unread', async () => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const count = await gmailIntegration.getUnreadCount();
    return { unreadCount: count };
  });

  app.get('/api/integrations/gmail/threads/:id', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const { id } = request.params as { id: string };
    const messages = await gmailIntegration.getThread(id);
    return { messages };
  });

  app.post('/api/integrations/gmail/messages/:id/read', async (request: FastifyRequest) => {
    if (!gmailIntegration?.isConfigured()) return { error: 'Gmail not configured' };
    const { id } = request.params as { id: string };
    const success = await gmailIntegration.markAsRead(id);
    return { success };
  });

  // ─── Calendar Integration ────────────────────────
  calendarIntegration = createCalendarIntegration();

  app.post('/api/integrations/calendar/configure', async (request: FastifyRequest) => {
    if (!calendarIntegration) return { error: 'Calendar not initialized' };
    const { accessToken, refreshToken, clientId, clientSecret, calendarId } = request.body as {
      accessToken: string; refreshToken?: string; clientId?: string; clientSecret?: string; calendarId?: string;
    };
    if (!accessToken) return { error: 'accessToken is required' };
    calendarIntegration.configure({ accessToken, refreshToken, clientId, clientSecret, calendarId });
    return { configured: true };
  });

  app.get('/api/integrations/calendar/status', async () => {
    return { configured: calendarIntegration?.isConfigured() ?? false };
  });

  app.get('/api/integrations/calendar/calendars', async () => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const calendars = await calendarIntegration.getCalendars();
    return { calendars };
  });

  app.get('/api/integrations/calendar/events', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { maxResults, timeMin, timeMax, query, calendarId } = request.query as {
      maxResults?: string; timeMin?: string; timeMax?: string; query?: string; calendarId?: string;
    };
    const events = await calendarIntegration.listEvents({
      maxResults: maxResults ? Number(maxResults) : 20,
      timeMin: timeMin || undefined,
      timeMax: timeMax || undefined,
      query: query || undefined,
      calendarId: calendarId || undefined,
    });
    return { events };
  });

  app.get('/api/integrations/calendar/events/:id', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { id } = request.params as { id: string };
    const event = await calendarIntegration.getEvent(id);
    return { event };
  });

  app.post('/api/integrations/calendar/events', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const opts = request.body as { summary: string; start: string; end: string; description?: string; location?: string; allDay?: boolean; attendees?: string[]; calendarId?: string };
    if (!opts.summary || !opts.start || !opts.end) return { error: 'summary, start, and end are required' };
    const event = await calendarIntegration.createEvent(opts, opts.calendarId);
    return { event };
  });

  app.patch('/api/integrations/calendar/events/:id', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { id } = request.params as { id: string };
    const opts = request.body as { summary?: string; description?: string; location?: string; start?: string; end?: string; calendarId?: string };
    const event = await calendarIntegration.updateEvent(id, opts, (opts as { calendarId?: string }).calendarId);
    return { event };
  });

  app.delete('/api/integrations/calendar/events/:id', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { id } = request.params as { id: string };
    const deleted = await calendarIntegration.deleteEvent(id);
    return { deleted };
  });

  app.post('/api/integrations/calendar/quickadd', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { text } = request.body as { text: string };
    if (!text) return { error: 'text is required' };
    const event = await calendarIntegration.quickAdd(text);
    return { event };
  });

  app.get('/api/integrations/calendar/today', async () => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const events = await calendarIntegration.getToday();
    return { events };
  });

  app.get('/api/integrations/calendar/upcoming', async (request: FastifyRequest) => {
    if (!calendarIntegration?.isConfigured()) return { error: 'Calendar not configured' };
    const { days } = request.query as { days?: string };
    const events = await calendarIntegration.getUpcoming(days ? Number(days) : 7);
    return { events };
  });

  // ─── Notion Integration ────────────────────────
  notionIntegration = createNotionIntegration();

  app.post('/api/integrations/notion/configure', async (request: FastifyRequest) => {
    if (!notionIntegration) return { error: 'Notion not initialized' };
    const { apiKey, defaultDatabaseId } = request.body as { apiKey: string; defaultDatabaseId?: string };
    if (!apiKey) return { error: 'apiKey is required' };
    notionIntegration.configure({ apiKey, defaultDatabaseId });
    return { configured: true };
  });

  app.get('/api/integrations/notion/status', async () => {
    return { configured: notionIntegration?.isConfigured() ?? false };
  });

  app.post('/api/integrations/notion/search', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { query, filter, pageSize } = request.body as { query: string; filter?: 'page' | 'database'; pageSize?: number };
    const results = await notionIntegration.search(query ?? '', { filter, pageSize });
    return { results };
  });

  app.get('/api/integrations/notion/pages/:id', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { id } = request.params as { id: string };
    const page = await notionIntegration.getPage(id);
    return { page };
  });

  app.get('/api/integrations/notion/pages/:id/content', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { id } = request.params as { id: string };
    const blocks = await notionIntegration.getPageContent(id);
    return { blocks };
  });

  app.post('/api/integrations/notion/pages', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const opts = request.body as { parentPageId?: string; parentDatabaseId?: string; title: string; content?: string };
    if (!opts.title) return { error: 'title is required' };
    const page = await notionIntegration.createPage(opts);
    return { page };
  });

  app.post('/api/integrations/notion/pages/:id/append', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };
    if (!content) return { error: 'content is required' };
    const blocks = await notionIntegration.appendBlocks(id, content);
    return { blocks };
  });

  app.get('/api/integrations/notion/databases/:id', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { id } = request.params as { id: string };
    const database = await notionIntegration.getDatabase(id);
    return { database };
  });

  app.post('/api/integrations/notion/databases/:id/query', async (request: FastifyRequest) => {
    if (!notionIntegration?.isConfigured()) return { error: 'Notion not configured' };
    const { id } = request.params as { id: string };
    const { filter, sorts, pageSize } = request.body as { filter?: Record<string, unknown>; sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>; pageSize?: number };
    const pages = await notionIntegration.queryDatabase(id, { filter, sorts, pageSize });
    return { pages };
  });

  // ─── OpenTelemetry ────────────────────────
  otelManager = createOTelManager({
    enabled: !!process.env.OTEL_ENABLED,
    tracesEndpoint: process.env.OTEL_TRACES_ENDPOINT,
    metricsEndpoint: process.env.OTEL_METRICS_ENDPOINT,
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'forgeai-gateway',
  });

  app.get('/api/telemetry/status', async () => {
    return otelManager?.getStatus() ?? { enabled: false };
  });

  app.post('/api/telemetry/configure', async (request: FastifyRequest) => {
    if (!otelManager) return { error: 'Telemetry not initialized' };
    const { enabled, tracesEndpoint, metricsEndpoint } = request.body as { enabled?: boolean; tracesEndpoint?: string; metricsEndpoint?: string };
    if (enabled === true) {
      otelManager = createOTelManager({ enabled: true, tracesEndpoint, metricsEndpoint });
    } else if (enabled === false) {
      otelManager.stop();
    }
    return { status: otelManager.getStatus() };
  });

  app.get('/api/telemetry/spans', async (request: FastifyRequest) => {
    if (!otelManager) return { spans: [] };
    const { limit } = request.query as { limit?: string };
    return { spans: otelManager.getRecentSpans(limit ? Number(limit) : 50) };
  });

  app.get('/api/telemetry/metrics', async (request: FastifyRequest) => {
    if (!otelManager) return { metrics: [] };
    const { limit } = request.query as { limit?: string };
    return { metrics: otelManager.getRecentMetrics(limit ? Number(limit) : 100) };
  });

  // ─── Channels Configuration ────────────────────────

  const CHANNELS_META = [
    { name: 'telegram', displayName: 'Telegram', envKeys: { botToken: 'TELEGRAM_BOT_TOKEN' } },
    { name: 'discord', displayName: 'Discord', envKeys: { botToken: 'DISCORD_BOT_TOKEN' } },
    { name: 'slack', displayName: 'Slack', envKeys: { botToken: 'SLACK_BOT_TOKEN', appToken: 'SLACK_APP_TOKEN', signingSecret: 'SLACK_SIGNING_SECRET' } },
    { name: 'whatsapp', displayName: 'WhatsApp', envKeys: {} },
    { name: 'teams', displayName: 'Microsoft Teams', envKeys: { appId: 'TEAMS_APP_ID', appPassword: 'TEAMS_APP_PASSWORD' } },
    { name: 'googlechat', displayName: 'Google Chat', envKeys: { projectId: 'GOOGLE_CHAT_PROJECT_ID' } },
    { name: 'webchat', displayName: 'WebChat', envKeys: {} },
  ];

  app.get('/api/channels/status', async () => {
    const channels = CHANNELS_META.map(ch => {
      const envEntries = Object.values(ch.envKeys);
      const configured = ch.name === 'webchat'
        ? true
        : envEntries.length > 0 && envEntries.some(envKey => !!process.env[envKey]);
      return { name: ch.name, displayName: ch.displayName, configured };
    });
    return { channels };
  });

  app.post('/api/channels/:name/configure', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const body = request.body as Record<string, string>;
    const meta = CHANNELS_META.find(c => c.name === name);
    if (!meta) return { error: `Unknown channel: ${name}` };

    const envKeys = meta.envKeys as Record<string, string>;
    for (const [field, envKey] of Object.entries(envKeys)) {
      if (body[field] && body[field].trim()) {
        const trimmedVal = body[field].trim();
        process.env[envKey] = trimmedVal;

        // Persist to Vault (encrypted, survives restart)
        if (vault?.isInitialized()) {
          vault.set(`env:${envKey}`, trimmedVal);
        }
      }
    }

    logger.info(`Channel ${name} configured via API`, { name, persisted: vault?.isInitialized() ?? false });
    return { success: true, channel: name, persisted: vault?.isInitialized() ?? false };
  });

  // DELETE /api/channels/:name/key — remove channel tokens
  app.delete('/api/channels/:name/key', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const meta = CHANNELS_META.find(c => c.name === name);
    if (!meta) return { error: `Unknown channel: ${name}` };

    const envKeys = meta.envKeys as Record<string, string>;
    for (const [, envKey] of Object.entries(envKeys)) {
      delete process.env[envKey];
      if (vault?.isInitialized()) {
        vault.delete(`env:${envKey}`);
      }
    }

    logger.info(`Channel ${name} tokens removed`, { name });
    return { success: true, channel: name, removed: true };
  });

  // POST /api/channels/whatsapp/enable — habilitar WhatsApp (próximo restart inicia QR pairing)
  app.post('/api/channels/whatsapp/enable', async () => {
    if (!vault?.isInitialized()) return { error: 'Vault not initialized' };
    vault.set('channel:whatsapp:enabled', 'true');
    logger.info('WhatsApp channel enabled via Dashboard (will start on next restart)');
    return { success: true, message: 'WhatsApp enabled. Restart gateway to start QR pairing.' };
  });

  // DELETE /api/channels/whatsapp/enable — desabilitar WhatsApp
  app.delete('/api/channels/whatsapp/enable', async () => {
    if (!vault?.isInitialized()) return { error: 'Vault not initialized' };
    vault.delete('channel:whatsapp:enabled');
    logger.info('WhatsApp channel disabled via Dashboard');
    return { success: true, message: 'WhatsApp disabled.' };
  });

  // GET /api/channels/whatsapp/enabled — check if enabled
  app.get('/api/channels/whatsapp/enabled', async () => {
    const enabled = vault?.isInitialized() && vault.has('channel:whatsapp:enabled');
    const hasSession = (await import('node:fs')).existsSync(
      (await import('node:path')).resolve(process.cwd(), '.forgeai', 'whatsapp-session', 'creds.json')
    );
    return { enabled: enabled || hasSession, hasSession };
  });

  // ─── Channel Permissions API (Vault-first) ────────────────────────
  // Permissions are persisted to Vault and also synced to live channel instances.
  // Dashboard can configure permissions even when channels are offline.

  const PERM_CHANNELS = ['telegram', 'whatsapp'];

  // Sync Vault permissions to a live channel instance
  const syncPermsToChannel = (name: string, perms: ChannelPermissions) => {
    const channel = name === 'telegram' ? telegramChannel : name === 'whatsapp' ? whatsAppChannel : null;
    if (!channel) return;
    const ch = channel as any;
    if (typeof ch.addAllowedUser !== 'function') return;

    // Get current live state and sync differences
    const live = ch.getPermissions() as { allowedUsers: string[]; allowedGroups: string[]; adminUsers: string[] };

    // Sync users
    for (const u of perms.allowedUsers) {
      if (!live.allowedUsers.includes(u)) ch.addAllowedUser(u);
    }
    for (const u of live.allowedUsers) {
      if (!perms.allowedUsers.includes(u)) ch.removeAllowedUser(u);
    }
    // Sync groups
    for (const g of perms.allowedGroups) {
      if (!live.allowedGroups.includes(g)) ch.addAllowedGroup(g);
    }
    for (const g of live.allowedGroups) {
      if (!perms.allowedGroups.includes(g)) ch.removeAllowedGroup(g);
    }
    // Sync admins
    for (const a of perms.adminUsers) {
      if (!live.adminUsers.includes(a)) ch.addAdmin(a);
    }
    for (const a of live.adminUsers) {
      if (!perms.adminUsers.includes(a)) ch.removeAdmin(a);
    }
  };

  // GET /api/channels/:name/permissions — get current permissions (from Vault)
  app.get('/api/channels/:name/permissions', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    const perms = loadChannelPermissions(name, name === 'whatsapp' ? 'always' : 'mention');
    return { channel: name, permissions: perms, persisted: vault?.isInitialized() ?? false };
  });

  // PUT /api/channels/:name/permissions — replace all permissions at once
  app.put('/api/channels/:name/permissions', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    const body = request.body as Partial<ChannelPermissions>;
    const current = loadChannelPermissions(name, name === 'whatsapp' ? 'always' : 'mention');
    const updated: ChannelPermissions = {
      allowedUsers: body.allowedUsers ?? current.allowedUsers,
      allowedGroups: body.allowedGroups ?? current.allowedGroups,
      adminUsers: body.adminUsers ?? current.adminUsers,
      respondInGroups: body.respondInGroups ?? current.respondInGroups,
    };
    const persisted = saveChannelPermissions(name, updated);
    syncPermsToChannel(name, updated);
    return { success: true, channel: name, permissions: updated, persisted };
  });

  // POST /api/channels/:name/permissions/users — add allowed user
  app.post('/api/channels/:name/permissions/users', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { userId } = request.body as { userId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    if (!userId) return { error: 'userId is required' };
    const perms = loadChannelPermissions(name);
    if (!perms.allowedUsers.includes(userId.trim())) perms.allowedUsers.push(userId.trim());
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'added', userId, persisted };
  });

  // DELETE /api/channels/:name/permissions/users/:userId — remove allowed user
  app.delete('/api/channels/:name/permissions/users/:userId', async (request: FastifyRequest) => {
    const { name, userId } = request.params as { name: string; userId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    const perms = loadChannelPermissions(name);
    perms.allowedUsers = perms.allowedUsers.filter(u => u !== userId);
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'removed', userId, persisted };
  });

  // POST /api/channels/:name/permissions/groups — add allowed group
  app.post('/api/channels/:name/permissions/groups', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { groupId } = request.body as { groupId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    if (!groupId) return { error: 'groupId is required' };
    const perms = loadChannelPermissions(name);
    if (!perms.allowedGroups.includes(groupId.trim())) perms.allowedGroups.push(groupId.trim());
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'added', groupId, persisted };
  });

  // DELETE /api/channels/:name/permissions/groups/:groupId — remove allowed group
  app.delete('/api/channels/:name/permissions/groups/:groupId', async (request: FastifyRequest) => {
    const { name, groupId } = request.params as { name: string; groupId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    const perms = loadChannelPermissions(name);
    perms.allowedGroups = perms.allowedGroups.filter(g => g !== groupId);
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'removed', groupId, persisted };
  });

  // POST /api/channels/:name/permissions/admins — add admin user
  app.post('/api/channels/:name/permissions/admins', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const { userId } = request.body as { userId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    if (!userId) return { error: 'userId is required' };
    const perms = loadChannelPermissions(name);
    if (!perms.adminUsers.includes(userId.trim())) perms.adminUsers.push(userId.trim());
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'added', admin: userId, persisted };
  });

  // DELETE /api/channels/:name/permissions/admins/:userId — remove admin user
  app.delete('/api/channels/:name/permissions/admins/:userId', async (request: FastifyRequest) => {
    const { name, userId } = request.params as { name: string; userId: string };
    if (!PERM_CHANNELS.includes(name)) return { error: `Channel ${name} does not support permissions` };
    const perms = loadChannelPermissions(name);
    perms.adminUsers = perms.adminUsers.filter(a => a !== userId);
    const persisted = saveChannelPermissions(name, perms);
    syncPermsToChannel(name, perms);
    return { success: true, action: 'removed', admin: userId, persisted };
  });

  // GET /api/channels/live — live channel status + permissions from Vault
  app.get('/api/channels/live', async () => {
    const channels = [];

    // Telegram — always show permissions (from Vault), connected status from live instance
    channels.push({
      name: 'telegram',
      connected: telegramChannel?.isConnected() ?? false,
      hasPermissions: true,
      permissions: loadChannelPermissions('telegram', 'mention'),
    });

    // WhatsApp — always show permissions (from Vault)
    channels.push({
      name: 'whatsapp',
      connected: whatsAppChannel?.isConnected() ?? false,
      hasPermissions: true,
      permissions: loadChannelPermissions('whatsapp', 'always'),
    });

    // Teams
    channels.push({
      name: 'teams',
      connected: teamsChannel?.isConnected() ?? false,
      hasPermissions: false,
    });

    // WebChat
    channels.push({
      name: 'webchat',
      connected: webChatChannel?.isConnected() ?? false,
      hasPermissions: false,
    });

    return { channels };
  });

  logger.info('Chat routes registered');
  logger.info('Tool routes registered');
  logger.info('Plugin routes registered');
  logger.info('Workflow routes registered');
  logger.info('Session & Usage routes registered');
  logger.info('Sandbox & Rate limit routes registered');
  logger.info('Voice, Webhook & Plugin Store routes registered');
  logger.info('IP Filter, Tailscale & Phase 12 routes registered');
  logger.info('MCP, Memory, OAuth2 & Phase 13 routes registered');
  logger.info('RAG, Planner, API Keys, GDPR, GitHub, RSS & Phase 14 routes registered');
  logger.info('Channels configuration & permissions routes registered');

  // ─── Autopilot Engine ────────────────────────────
  autopilotEngine = createAutopilotEngine();
  setAutopilotRef(autopilotEngine);
  autopilotEngine.setHandler(async (task) => {
    if (!agentManager) return 'Agent not ready';

    const sessionId = `autopilot-${task.category.toLowerCase().replace(/\s+/g, '-')}`;
    const prompt = `[Autopilot Task — ${task.category}]\n${task.text}`;

    try {
      const result = await agentManager.processMessage({
        sessionId,
        userId: 'autopilot',
        content: prompt,
        channelType: 'autopilot',
      });

      // Deliver to Telegram if connected
      if (telegramChannel?.isConnected()) {
        const tgPerms = telegramChannel.getPermissions();
        const adminId = tgPerms.adminUsers[0];
        if (adminId) {
          await telegramChannel.send({
            channelType: 'telegram',
            recipientId: adminId,
            content: `🤖 **Autopilot** [${task.category}]\n\n${result.content}`,
          });
        }
      }

      logger.info('Autopilot task completed', { task: task.text, tokens: result.usage.totalTokens });
      return result.content;
    } catch (err) {
      logger.error('Autopilot task failed', err);
      return 'Error';
    }
  });
  autopilotEngine.start();
  logger.info('Autopilot engine initialized');

  // ─── Autopilot API ────────────────────────────
  app.get('/api/autopilot/status', async () => {
    return autopilotEngine?.getStatus() ?? { enabled: false, running: false, taskCount: 0 };
  });

  app.post('/api/autopilot/reload', async () => {
    autopilotEngine?.reload();
    return { reloaded: true, tasks: autopilotEngine?.getTasks().length ?? 0 };
  });

  // ─── Pairing Manager ────────────────────────────
  pairingManager = createPairingManager();
  setPairingRef(pairingManager);
  logger.info('Pairing manager initialized');

  // ─── Pairing API ────────────────────────────
  app.post<{ Body: { expiresInHours?: number; maxUses?: number; role?: string; label?: string; channel?: string } }>(
    '/api/pairing/generate',
    async (request) => {
      if (!pairingManager) return { error: 'Pairing not available' };
      const { expiresInHours, maxUses, role, label, channel } = request.body ?? {};
      const code = pairingManager.generate({
        expiresInHours: expiresInHours ?? 24,
        maxUses: maxUses ?? 1,
        role: (role === 'admin' ? 'admin' : 'user'),
        label,
        channel,
      });
      return code;
    }
  );

  app.get('/api/pairing/codes', async () => {
    if (!pairingManager) return { codes: [] };
    return { codes: pairingManager.listCodes() };
  });

  app.delete<{ Params: { code: string } }>('/api/pairing/codes/:code', async (request) => {
    if (!pairingManager) return { revoked: false };
    const revoked = pairingManager.revoke(request.params.code);
    return { revoked };
  });

  app.get('/api/pairing/stats', async () => {
    if (!pairingManager) return { total: 0, active: 0, expired: 0, totalRedeemed: 0 };
    return pairingManager.getStats();
  });

  logger.info('Pairing routes registered');

  // ─── Workspace Prompts API ────────────────────────────
  const workspacePath = (await import('node:path')).resolve(process.cwd(), '.forgeai', 'workspace');
  const forgeaiPath = (await import('node:path')).resolve(process.cwd(), '.forgeai');

  // AUTOPILOT.md is a special file: lives in .forgeai/ root, not /workspace/
  // It's editable via the same Workspace UI but has different semantics
  const AUTOPILOT_FILE = { filename: 'AUTOPILOT.md', label: 'Autopilot Tasks' };

  const resolveFilePath = (filename: string) => {
    const path = require('node:path');
    if (filename === 'AUTOPILOT.md') return path.resolve(forgeaiPath, filename);
    return path.resolve(workspacePath, filename);
  };

  const getAllowedFiles = () => {
    const promptFiles = getWorkspacePromptFiles().map(f => f.filename);
    return [...promptFiles, AUTOPILOT_FILE.filename];
  };

  app.get('/api/workspace/prompts', async () => {
    const prompts = loadWorkspacePrompts({ workspacePath });
    const files = getWorkspacePromptFiles();
    const fs = await import('node:fs');

    const result = files.map(f => {
      const filePath = resolveFilePath(f.filename);
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { /* new file */ }
      const loaded = prompts.files.find(pf => pf.filename === f.filename);
      return {
        filename: f.filename,
        label: f.label,
        content,
        active: loaded?.loaded ?? false,
        chars: loaded?.chars ?? 0,
      };
    });

    // Add AUTOPILOT.md
    const autopilotPath = resolveFilePath('AUTOPILOT.md');
    let autopilotContent = '';
    try { autopilotContent = fs.readFileSync(autopilotPath, 'utf-8'); } catch { /* not created yet */ }
    result.push({
      filename: AUTOPILOT_FILE.filename,
      label: AUTOPILOT_FILE.label,
      content: autopilotContent,
      active: autopilotEngine?.isRunning() ?? false,
      chars: autopilotContent.length,
    });

    return { files: result };
  });

  app.get<{ Params: { filename: string } }>('/api/workspace/prompts/:filename', async (request) => {
    const { filename } = request.params;
    if (!getAllowedFiles().includes(filename)) {
      return { error: 'Invalid filename', allowed: getAllowedFiles() };
    }
    const fs = await import('node:fs');
    const filePath = resolveFilePath(filename);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { filename, content };
    } catch {
      return { filename, content: '' };
    }
  });

  app.put<{ Params: { filename: string }; Body: { content: string } }>(
    '/api/workspace/prompts/:filename',
    async (request) => {
      const { filename } = request.params;
      const { content } = request.body ?? {};
      if (!getAllowedFiles().includes(filename)) {
        return { error: 'Invalid filename', allowed: getAllowedFiles() };
      }
      if (typeof content !== 'string') {
        return { error: 'content must be a string' };
      }
      const fs = await import('node:fs');
      const filePath = resolveFilePath(filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.info('Workspace prompt updated', { filename, chars: content.length });

      // Auto-reload autopilot if AUTOPILOT.md was saved
      if (filename === 'AUTOPILOT.md' && autopilotEngine) {
        autopilotEngine.reload();
        logger.info('Autopilot reloaded after AUTOPILOT.md save');
      }

      return { saved: true, filename, chars: content.length };
    }
  );

  logger.info('Workspace prompts routes registered');
}
