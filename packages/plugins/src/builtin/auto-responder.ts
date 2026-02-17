import type { ForgePlugin, PluginContext, InboundMessage, MessageHookResult } from '../types.js';

interface AutoResponse {
  trigger: string;
  response: string;
  exact?: boolean;
}

const DEFAULT_RESPONSES: AutoResponse[] = [
  { trigger: 'ping', response: '🏓 Pong!', exact: true },
  { trigger: 'version', response: '🔥 ForgeAI v0.1.0', exact: true },
  { trigger: 'help', response: '📖 Available commands: ping, version, help, status\n\nFor full AI chat, just type your message normally.', exact: true },
  { trigger: 'status', response: '✅ ForgeAI is running and all systems are operational.', exact: true },
];

export const AutoResponderPlugin: ForgePlugin = {
  manifest: {
    id: 'forgeai-auto-responder',
    name: 'Auto Responder',
    version: '0.1.0',
    description: 'Automatically responds to common commands like ping, help, version, and status without invoking the LLM.',
    author: 'ForgeAI',
    tags: ['builtin', 'utility'],
    permissions: ['hooks.message', 'storage.read', 'storage.write'],
  },

  async onActivate(ctx: PluginContext): Promise<void> {
    const customResponses = await ctx.storage.get('custom_responses') as AutoResponse[] | null;
    if (!customResponses) {
      await ctx.storage.set('custom_responses', []);
    }
    ctx.logger.info('Auto Responder activated with default responses');
  },

  async onMessage(ctx: PluginContext, message: InboundMessage): Promise<MessageHookResult> {
    const input = message.content.trim().toLowerCase();

    // Check default responses
    for (const r of DEFAULT_RESPONSES) {
      if (r.exact ? input === r.trigger : input.includes(r.trigger)) {
        ctx.logger.debug(`Auto-responded to "${input}" with trigger "${r.trigger}"`);
        return { handled: true, response: r.response };
      }
    }

    // Check custom responses
    const customResponses = (await ctx.storage.get('custom_responses') as AutoResponse[]) || [];
    for (const r of customResponses) {
      if (r.exact ? input === r.trigger : input.includes(r.trigger)) {
        ctx.logger.debug(`Custom auto-response for "${input}"`);
        return { handled: true, response: r.response };
      }
    }

    return { handled: false };
  },
};
