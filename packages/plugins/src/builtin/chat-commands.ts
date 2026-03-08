import type { ForgePlugin, PluginContext, InboundMessage, MessageHookResult } from '../types.js';

export const ChatCommandsPlugin: ForgePlugin = {
  manifest: {
    id: 'forgeai-chat-commands',
    name: 'Chat Commands',
    version: '0.1.0',
    description: 'Handles slash commands like /status, /new, /help, /tools, /plugins, /workflows, /compact, /usage, /think in any channel.',
    author: 'ForgeAI',
    tags: ['builtin', 'utility', 'commands'],
    permissions: ['hooks.message', 'storage.read', 'storage.write'],
  },

  async onActivate(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Chat Commands plugin activated');
  },

  async onMessage(ctx: PluginContext, message: InboundMessage): Promise<MessageHookResult> {
    const input = message.content.trim();

    // Only handle messages that start with /
    if (!input.startsWith('/')) {
      return { handled: false };
    }

    const [command] = input.slice(1).split(/\s+/);
    const cmd = command.toLowerCase();

    switch (cmd) {
      case 'status': {
        const toolCount = ctx.toolRegistry.size;
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const response = [
          '📊 **ForgeAI Status**',
          '',
          `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s`,
          `🔧 Tools: ${toolCount} registered`,
          `💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          `📡 Channel: ${message.channelType}`,
          `👤 User: ${message.userId}`,
          `🔗 Session: ${message.sessionId}`,
        ].join('\n');

        return { handled: true, response };
      }

      case 'new':
      case 'reset': {
        return {
          handled: true,
          response: '🔄 Session reset. Starting fresh conversation.',
        };
      }

      case 'help': {
        const response = [
          '📖 **ForgeAI Commands**',
          '',
          '`/status` — Show system status',
          '`/new` or `/reset` — Reset conversation',
          '`/compact` — Compact session context (free up tokens)',
          '`/usage off|tokens|full` — Per-response usage footer',
          '`/think off|low|medium|high` — Extended thinking level',
          '`/help` — Show this help',
          '`/tools` — List available tools',
          '`/plugins` — List active plugins',
          '`/workflows` — List workflows',
          '`/model` — Show current model info',
          '',
          'For normal AI chat, just type your message without a slash.',
        ].join('\n');

        return { handled: true, response };
      }

      case 'compact': {
        // Signal the gateway to compact the current session
        // The actual compaction is handled by the gateway via the metadata flag
        return {
          handled: true,
          response: '🗜️ Session context compacted. Older messages have been summarized to free up token space.',
          metadata: { action: 'compact', sessionId: message.sessionId },
        };
      }

      case 'usage': {
        const args = input.slice(1).split(/\s+/).slice(1);
        const mode = (args[0] || '').toLowerCase();
        if (!['off', 'tokens', 'full'].includes(mode)) {
          return { handled: true, response: '❓ Usage: `/usage off|tokens|full`' };
        }
        return {
          handled: true,
          response: `📊 Usage display set to **${mode}**.`,
          metadata: { action: 'set_usage_mode', mode },
        };
      }

      case 'think': {
        const args = input.slice(1).split(/\s+/).slice(1);
        const level = (args[0] || '').toLowerCase();
        if (!['off', 'low', 'medium', 'high'].includes(level)) {
          return { handled: true, response: '❓ Usage: `/think off|low|medium|high`' };
        }
        return {
          handled: true,
          response: `🧠 Thinking level set to **${level}**.`,
          metadata: { action: 'set_thinking', level },
        };
      }

      case 'tools': {
        const tools = ctx.toolRegistry.list();
        if (tools.length === 0) {
          return { handled: true, response: '🔧 No tools registered.' };
        }

        const lines = tools.map(t => `• **${t.name}** — ${t.description.slice(0, 80)}`);
        const response = [`🔧 **Available Tools** (${tools.length})`, '', ...lines].join('\n');
        return { handled: true, response };
      }

      case 'plugins': {
        return {
          handled: true,
          response: '🧩 Use the `/status` command or check the Dashboard at http://localhost:3000 for plugin details.',
        };
      }

      case 'workflows': {
        return {
          handled: true,
          response: '⚡ Use the API `GET /api/workflows` or check the Dashboard for workflow management.',
        };
      }

      case 'model': {
        const response = [
          '🤖 **Model Info**',
          '',
          'Current configuration is managed via environment variables:',
          '• `ANTHROPIC_API_KEY` → Claude models',
          '• `OPENAI_API_KEY` → GPT models',
          '',
          'The LLM Router automatically selects the best available provider.',
        ].join('\n');

        return { handled: true, response };
      }

      default:
        return {
          handled: true,
          response: `❓ Unknown command: \`/${cmd}\`. Type \`/help\` for available commands.`,
        };
    }
  },
};
