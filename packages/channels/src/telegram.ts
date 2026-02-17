import { Bot, type Context } from 'grammy';
import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export interface TelegramConfig {
  botToken: string;
  allowFrom?: string[];
  allowGroups?: string[];
  adminUsers?: string[];
  respondInGroups?: 'always' | 'mention' | 'never';
  webhookUrl?: string;
  webhookSecret?: string;
}

export class TelegramChannel extends BaseChannel {
  private bot: Bot;
  private config: TelegramConfig;
  private allowedUsers: Set<string>;
  private allowedGroups: Set<string>;
  private adminUsers: Set<string>;
  private botUsername: string = '';
  private botId: number = 0;

  constructor(config: TelegramConfig) {
    super('telegram');
    this.config = config;
    this.bot = new Bot(config.botToken);
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedGroups = new Set(config.allowGroups ?? []);
    this.adminUsers = new Set(config.adminUsers ?? []);

    this.setupHandlers();
  }

  // ─── Permission management API ────────────────────
  addAllowedUser(userId: string): void {
    this.allowedUsers.add(userId);
    this.logger.info('User added to allowlist', { userId });
  }

  removeAllowedUser(userId: string): void {
    this.allowedUsers.delete(userId);
    this.logger.info('User removed from allowlist', { userId });
  }

  addAllowedGroup(groupId: string): void {
    this.allowedGroups.add(groupId);
    this.logger.info('Group added to allowlist', { groupId });
  }

  removeAllowedGroup(groupId: string): void {
    this.allowedGroups.delete(groupId);
    this.logger.info('Group removed from allowlist', { groupId });
  }

  addAdmin(userId: string): void {
    this.adminUsers.add(userId);
    this.logger.info('Admin added', { userId });
  }

  removeAdmin(userId: string): void {
    this.adminUsers.delete(userId);
    this.logger.info('Admin removed', { userId });
  }

  getPermissions(): { allowedUsers: string[]; allowedGroups: string[]; adminUsers: string[] } {
    return {
      allowedUsers: [...this.allowedUsers],
      allowedGroups: [...this.allowedGroups],
      adminUsers: [...this.adminUsers],
    };
  }

  private isAdmin(userId: string): boolean {
    return this.adminUsers.has(userId) || this.adminUsers.has('*');
  }

  private isUserAllowed(userId: string): boolean {
    if (this.allowedUsers.size === 0 || this.allowedUsers.has('*')) return true;
    return this.allowedUsers.has(userId);
  }

  private isGroupAllowed(groupId: string): boolean {
    if (this.allowedGroups.size === 0 || this.allowedGroups.has('*')) return true;
    return this.allowedGroups.has(groupId);
  }

  private isBotMentioned(text: string, replyToBotMessage: boolean): boolean {
    if (replyToBotMessage) return true;
    if (this.botUsername && text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)) return true;
    return false;
  }

  private stripBotMention(text: string): string {
    if (!this.botUsername) return text;
    return text.replace(new RegExp(`@${this.botUsername}`, 'gi'), '').trim();
  }

  private setupHandlers(): void {
    // ─── /start command ────────────────────────────
    this.bot.command('start', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      const name = ctx.from?.first_name ?? 'User';
      await ctx.reply(
        `👋  Ola, ${name}! Eu sou o ForgeAI.\n\n` +
        `╔══════════════════════════╗\n` +
        `║   🔥  Bem-vindo!         ║\n` +
        `╚══════════════════════════╝\n\n` +
        `👤  Seu ID: \`${senderId}\`\n\n` +
        `Mande qualquer mensagem e eu\n` +
        `respondo com IA! Ou use comandos:\n\n` +
        `── Principais ──────────────\n` +
        `  /help     Ver todos os comandos\n` +
        `  /status   Status da sessao\n` +
        `  /new      Comecar do zero\n\n` +
        `── Ajustes ─────────────────\n` +
        `  /think    Nivel de raciocinio\n` +
        `  /usage    Ver consumo de tokens\n` +
        `  /compact  Economizar tokens\n\n` +
        `💡  Dica: Digite / para ver o menu.`,
        { parse_mode: 'Markdown' }
      );
    });

    // ─── Admin commands ────────────────────────────
    this.bot.command('allow', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      if (!this.isAdmin(senderId)) {
        await ctx.reply('⛔ Admin only command.');
        return;
      }
      const args = ctx.match?.trim();
      if (!args) {
        await ctx.reply('Usage: /allow <user_id or group_id>');
        return;
      }
      if (args.startsWith('-')) {
        this.addAllowedGroup(args);
        await ctx.reply(`✅ Group ${args} added to allowlist.`);
      } else {
        this.addAllowedUser(args);
        await ctx.reply(`✅ User ${args} added to allowlist.`);
      }
    });

    this.bot.command('block', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      if (!this.isAdmin(senderId)) {
        await ctx.reply('⛔ Admin only command.');
        return;
      }
      const args = ctx.match?.trim();
      if (!args) {
        await ctx.reply('Usage: /block <user_id or group_id>');
        return;
      }
      if (args.startsWith('-')) {
        this.removeAllowedGroup(args);
        await ctx.reply(`🚫 Group ${args} removed from allowlist.`);
      } else {
        this.removeAllowedUser(args);
        await ctx.reply(`🚫 User ${args} removed from allowlist.`);
      }
    });

    this.bot.command('listusers', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      if (!this.isAdmin(senderId)) {
        await ctx.reply('⛔ Admin only command.');
        return;
      }
      const perms = this.getPermissions();
      const lines = [
        '📋 **Permissions**',
        `👤 Allowed users: ${perms.allowedUsers.length ? perms.allowedUsers.join(', ') : '(all)'}`,
        `👥 Allowed groups: ${perms.allowedGroups.length ? perms.allowedGroups.join(', ') : '(all)'}`,
        `🔑 Admins: ${perms.adminUsers.length ? perms.adminUsers.join(', ') : '(none)'}`,
      ];
      await ctx.reply(lines.join('\n'));
    });

    this.bot.command('status', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      const lines = [
        `🤖 Bot: @${this.botUsername}`,
        `📡 Connected: ${this._connected}`,
        `💬 Chat type: ${ctx.chat?.type}`,
        `👤 Your ID: ${senderId}`,
        `🔑 Admin: ${this.isAdmin(senderId) ? 'Yes' : 'No'}`,
        `✅ Allowed: ${this.isUserAllowed(senderId) ? 'Yes' : 'No'}`,
        isGroup ? `👥 Group ID: ${ctx.chat?.id}` : '',
        isGroup ? `✅ Group allowed: ${this.isGroupAllowed(String(ctx.chat?.id))} ` : '',
        `🎯 Group mode: ${this.config.respondInGroups ?? 'mention'}`,
      ].filter(Boolean);
      await ctx.reply(lines.join('\n'));
    });

    this.bot.command('myid', async (ctx) => {
      const senderId = String(ctx.from?.id ?? '');
      const chatId = String(ctx.chat?.id ?? '');
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      await ctx.reply(
        `👤 Your user ID: \`${senderId}\`\n` +
        (isGroup ? `👥 This group ID: \`${chatId}\`` : `💬 This chat ID: \`${chatId}\``),
        { parse_mode: 'Markdown' }
      );
    });

    // ─── Message handlers ────────────────────────────
    this.bot.on('message:text', async (ctx: Context) => {
      const msg = ctx.message;
      if (!msg || !('text' in msg)) return;

      const text = (msg as { text: string }).text;

      // Skip only commands that have explicit grammY handlers above
      const handledByGrammy = ['/start', '/allow', '/block', '/listusers', '/status', '/myid'];
      const cmdName = text.split(/\s|@/)[0].toLowerCase();
      if (handledByGrammy.includes(cmdName)) return;

      const senderId = String(msg.from?.id ?? '');
      const senderName = msg.from?.first_name
        ? `${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}`
        : msg.from?.username ?? 'Unknown';

      // Allowlist check for users
      if (!this.isUserAllowed(senderId)) {
        this.logger.warn('Message from non-allowed user', { senderId, senderName });
        await ctx.reply('⛔ You are not authorized to use this bot. Contact the admin.');
        return;
      }

      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      const chatId = String(msg.chat.id);

      // Group permission & mention checks
      if (isGroup) {
        if (!this.isGroupAllowed(chatId)) {
          this.logger.debug('Message from non-allowed group', { chatId });
          return;
        }

        const groupMode = this.config.respondInGroups ?? 'mention';
        if (groupMode === 'never') return;

        if (groupMode === 'mention') {
          const replyToBotMsg = msg.reply_to_message?.from?.id === this.botId;
          if (!this.isBotMentioned(text, replyToBotMsg)) {
            return;
          }
        }
      }

      const cleanContent = isGroup ? this.stripBotMention(text) : text;

      const inbound: InboundMessage = {
        id: generateId('tmsg'),
        channelType: 'telegram',
        channelMessageId: String(msg.message_id),
        senderId,
        senderName,
        groupId: isGroup ? chatId : undefined,
        groupName: isGroup ? (msg.chat as { title?: string }).title : undefined,
        content: cleanContent,
        replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
        timestamp: new Date(msg.date * 1000),
        raw: msg as unknown as Record<string, unknown>,
      };

      this.logger.debug('Inbound message', { senderId, senderName, isGroup, chatId });
      await this.handleInbound(inbound);
    });

    // Handle photos with captions
    this.bot.on('message:photo', async (ctx: Context) => {
      const msg = ctx.message;
      if (!msg) return;

      const senderId = String(msg.from?.id ?? '');
      if (!this.isUserAllowed(senderId)) return;

      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      if (isGroup && !this.isGroupAllowed(String(msg.chat.id))) return;

      const caption = (msg as { caption?: string }).caption ?? '[Photo]';

      const inbound: InboundMessage = {
        id: generateId('tmsg'),
        channelType: 'telegram',
        channelMessageId: String(msg.message_id),
        senderId,
        senderName: msg.from?.first_name ?? 'Unknown',
        groupId: isGroup ? String(msg.chat.id) : undefined,
        groupName: isGroup ? (msg.chat as { title?: string }).title : undefined,
        content: caption,
        timestamp: new Date(msg.date * 1000),
        raw: msg as unknown as Record<string, unknown>,
      };

      await this.handleInbound(inbound);
    });

    this.bot.catch((err) => {
      this.logger.error('Bot error', err.error);
    });
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting Telegram bot...');

    try {
      const me = await this.bot.api.getMe();
      this.botUsername = me.username ?? '';
      this.botId = me.id;
      this.logger.info(`Telegram bot connected: @${me.username} (${me.first_name}), id=${me.id}`);

      // Registrar comandos no menu do Telegram (aparecem quando digita /)
      try {
        await this.bot.api.setMyCommands([
          { command: 'start', description: 'Iniciar o bot e ver comandos' },
          { command: 'help', description: 'Lista de todos os comandos' },
          { command: 'status', description: 'Status da sessão (modelo, tokens, uptime)' },
          { command: 'new', description: 'Resetar sessão (começar do zero)' },
          { command: 'compact', description: 'Compactar contexto (economizar tokens)' },
          { command: 'think', description: 'Nível de raciocínio: off|low|medium|high' },
          { command: 'verbose', description: 'Modo verboso: on|off' },
          { command: 'usage', description: 'Footer de uso: off|tokens|full' },
          { command: 'activation', description: 'Ativação em grupo: mention|always' },
          { command: 'autopilot', description: 'Ver tarefas automaticas do bot' },
          { command: 'pair', description: 'Parear com codigo de convite' },
          { command: 'myid', description: 'Ver seu user ID e chat ID' },
          { command: 'allow', description: 'Permitir um usuário (admin)' },
          { command: 'block', description: 'Bloquear um usuário (admin)' },
          { command: 'listusers', description: 'Listar permissões (admin)' },
        ]);
        this.logger.info('Telegram bot commands registered via setMyCommands');
      } catch (cmdErr) {
        this.logger.error('Failed to register bot commands via setMyCommands', cmdErr);
      }

      if (this.config.webhookUrl) {
        await this.bot.api.setWebhook(this.config.webhookUrl, {
          secret_token: this.config.webhookSecret,
        });
        this.logger.info('Webhook set', { url: this.config.webhookUrl });
      } else {
        // Long polling
        this.bot.start({
          onStart: () => {
            this.logger.info('Telegram bot polling started');
          },
        });
      }

      this._connected = true;
    } catch (error) {
      this.logger.error('Failed to connect Telegram bot', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting Telegram bot...');
    await this.bot.stop();
    this._connected = false;
    this.logger.info('Telegram bot disconnected');
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch {
      // Ignore typing indicator errors
    }
  }

  async setMessageReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji } as any]);
    } catch {
      // Ignore reaction errors (older bots/groups may not support reactions)
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    const chatId = message.groupId ?? message.recipientId;

    try {
      if (message.content.length > 4096) {
        // Split long messages
        const chunks = this.splitMessage(message.content, 4096);
        for (const chunk of chunks) {
          await this.bot.api.sendMessage(chatId, chunk, {
            parse_mode: message.format === 'markdown' ? 'MarkdownV2' : undefined,
            reply_parameters: message.replyToId
              ? { message_id: Number(message.replyToId) }
              : undefined,
          });
        }
      } else {
        await this.bot.api.sendMessage(chatId, message.content, {
          parse_mode: message.format === 'markdown' ? 'MarkdownV2' : undefined,
          reply_parameters: message.replyToId
            ? { message_id: Number(message.replyToId) }
            : undefined,
        });
      }

      this.logger.debug('Message sent', { chatId });
    } catch (error) {
      this.logger.error('Failed to send message', error, { chatId });
      throw error;
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength * 0.5) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt === -1 || splitAt < maxLength * 0.5) {
        splitAt = maxLength;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  getBotInstance(): Bot {
    return this.bot;
  }
}

export function createTelegramChannel(config: TelegramConfig): TelegramChannel {
  return new TelegramChannel(config);
}
