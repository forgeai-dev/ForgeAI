import type { ForgePlugin, PluginContext, OutboundMessage } from '../types.js';

export const ContentFilterPlugin: ForgePlugin = {
  manifest: {
    id: 'forgeai-content-filter',
    name: 'Content Filter',
    version: '0.1.0',
    description: 'Filters sensitive data (SSN, credit cards, emails) from AI responses to prevent data leakage.',
    author: 'ForgeAI',
    tags: ['builtin', 'security'],
    permissions: ['hooks.message'],
  },

  async onActivate(ctx: PluginContext): Promise<void> {
    const enabled = await ctx.storage.get('enabled');
    if (enabled === null) {
      await ctx.storage.set('enabled', true);
      await ctx.storage.set('redact_emails', false);
    }
    ctx.logger.info('Content Filter activated');
  },

  async onResponse(ctx: PluginContext, response: OutboundMessage): Promise<OutboundMessage> {
    const enabled = await ctx.storage.get('enabled');
    if (!enabled) return response;

    let content = response.content;
    const redactEmails = await ctx.storage.get('redact_emails');

    // Redact SSN
    content = content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]');

    // Redact credit cards
    content = content.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED-CC]');

    // Optionally redact emails
    if (redactEmails) {
      content = content.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED-EMAIL]');
    }

    if (content !== response.content) {
      ctx.logger.info('Sensitive data redacted from response');
    }

    return { ...response, content };
  },
};
