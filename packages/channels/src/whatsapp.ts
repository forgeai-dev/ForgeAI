import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeInMemoryStore,
  type WASocket,
} from '@whiskeysockets/baileys';
import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export interface WhatsAppConfig {
  allowFrom?: string[];
  allowGroups?: string[];
  adminUsers?: string[];
  respondInGroups?: 'always' | 'mention' | 'never';
  sessionPath?: string;
  printQR?: boolean;
}

export class WhatsAppChannel extends BaseChannel {
  private sock: WASocket | null = null;
  private config: WhatsAppConfig;
  private allowedUsers: Set<string>;
  private allowedGroups: Set<string>;
  private adminUsers: Set<string>;
  private store: ReturnType<typeof makeInMemoryStore>;
  private sessionPath: string;
  private botJid: string = '';

  constructor(config: WhatsAppConfig = {}) {
    super('whatsapp');
    this.config = config;
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedGroups = new Set(config.allowGroups ?? []);
    this.adminUsers = new Set(config.adminUsers ?? []);
    this.sessionPath = config.sessionPath ?? resolve(process.cwd(), '.forgeai', 'whatsapp-session');
    this.store = makeInMemoryStore({});

    // Ensure session directory exists
    if (!existsSync(this.sessionPath)) {
      mkdirSync(this.sessionPath, { recursive: true });
    }
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

  private isBotMentioned(msg: any): boolean {
    // Check if message mentions the bot or is a reply to the bot
    const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    if (this.botJid && mentionedJids.includes(this.botJid)) return true;
    // Check if reply to bot's message
    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (this.botJid && quotedParticipant === this.botJid) return true;
    return false;
  }

  private async handleAdminCommand(content: string, senderPhone: string, remoteJid: string): Promise<boolean> {
    if (!content.startsWith('!')) return false;
    const parts = content.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    if (!['!allow', '!block', '!listusers', '!status', '!myid'].includes(cmd)) return false;

    if (cmd === '!myid') {
      const isGroup = remoteJid.endsWith('@g.us');
      await this.sock?.sendMessage(remoteJid, {
        text: `👤 Your ID: ${senderPhone}\n` +
              (isGroup ? `👥 Group ID: ${remoteJid}` : `💬 Chat: ${remoteJid}`),
      });
      return true;
    }

    if (cmd === '!status') {
      const isGroup = remoteJid.endsWith('@g.us');
      const lines = [
        `🤖 ForgeAI WhatsApp Bot`,
        `📡 Connected: ${this._connected}`,
        `👤 Your ID: ${senderPhone}`,
        `🔑 Admin: ${this.isAdmin(senderPhone) ? 'Yes' : 'No'}`,
        `✅ Allowed: ${this.isUserAllowed(senderPhone) ? 'Yes' : 'No'}`,
        isGroup ? `👥 Group: ${remoteJid}` : '',
        isGroup ? `✅ Group allowed: ${this.isGroupAllowed(remoteJid)}` : '',
        `🎯 Group mode: ${this.config.respondInGroups ?? 'always'}`,
      ].filter(Boolean);
      await this.sock?.sendMessage(remoteJid, { text: lines.join('\n') });
      return true;
    }

    if (!this.isAdmin(senderPhone)) {
      await this.sock?.sendMessage(remoteJid, { text: '⛔ Admin only command.' });
      return true;
    }

    if (cmd === '!allow') {
      if (!args) {
        await this.sock?.sendMessage(remoteJid, { text: 'Usage: !allow <phone or group_jid>' });
        return true;
      }
      if (args.includes('@g.us')) {
        this.addAllowedGroup(args);
        await this.sock?.sendMessage(remoteJid, { text: `✅ Group ${args} added to allowlist.` });
      } else {
        this.addAllowedUser(args);
        await this.sock?.sendMessage(remoteJid, { text: `✅ User ${args} added to allowlist.` });
      }
      return true;
    }

    if (cmd === '!block') {
      if (!args) {
        await this.sock?.sendMessage(remoteJid, { text: 'Usage: !block <phone or group_jid>' });
        return true;
      }
      if (args.includes('@g.us')) {
        this.removeAllowedGroup(args);
        await this.sock?.sendMessage(remoteJid, { text: `🚫 Group ${args} removed from allowlist.` });
      } else {
        this.removeAllowedUser(args);
        await this.sock?.sendMessage(remoteJid, { text: `🚫 User ${args} removed from allowlist.` });
      }
      return true;
    }

    if (cmd === '!listusers') {
      const perms = this.getPermissions();
      const lines = [
        '📋 Permissions',
        `👤 Allowed users: ${perms.allowedUsers.length ? perms.allowedUsers.join(', ') : '(all)'}`,
        `👥 Allowed groups: ${perms.allowedGroups.length ? perms.allowedGroups.join(', ') : '(all)'}`,
        `🔑 Admins: ${perms.adminUsers.length ? perms.adminUsers.join(', ') : '(none)'}`,
      ];
      await this.sock?.sendMessage(remoteJid, { text: lines.join('\n') });
      return true;
    }

    return false;
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting to WhatsApp...');

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: this.config.printQR !== false,
      browser: ['ForgeAI', 'Desktop', '1.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    this.store.bind(this.sock.ev);

    // Handle connection updates
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('Scan the QR code above to connect WhatsApp');
        // QR is printed in terminal by Baileys when printQRInTerminal is true
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.logger.warn('WhatsApp connection closed', { statusCode, shouldReconnect });
        this._connected = false;

        if (shouldReconnect) {
          this.logger.info('Reconnecting to WhatsApp...');
          setTimeout(() => this.connect(), 3000);
        } else {
          this.logger.error('WhatsApp logged out. Delete session folder and scan QR again.');
        }
      }

      if (connection === 'open') {
        this._connected = true;
        this.botJid = this.sock?.user?.id ?? '';
        this.logger.info('WhatsApp connected successfully!', { botJid: this.botJid });
      }
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        // Skip own messages
        if (msg.key.fromMe) continue;

        // Skip status broadcasts
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const remoteJid = msg.key.remoteJid ?? '';
        const isGroup = remoteJid.endsWith('@g.us');
        const senderId = isGroup
          ? (msg.key.participant ?? '')
          : remoteJid;

        // Normalize phone number (remove @s.whatsapp.net)
        const senderPhone = senderId.replace('@s.whatsapp.net', '').replace('@lid', '');

        // Allowlist check for users
        if (!this.isUserAllowed(senderPhone)) {
          this.logger.warn('Message from non-allowed user', { senderPhone });
          continue;
        }

        // Extract text content
        const content = this.extractContent(msg);
        if (!content) continue;

        // Handle admin commands (!allow, !block, etc.)
        if (content.startsWith('!')) {
          const handled = await this.handleAdminCommand(content, senderPhone, remoteJid);
          if (handled) continue;
        }

        // Group permission checks
        if (isGroup) {
          if (!this.isGroupAllowed(remoteJid)) {
            this.logger.debug('Message from non-allowed group', { remoteJid });
            continue;
          }

          const groupMode = this.config.respondInGroups ?? 'always';
          if (groupMode === 'never') continue;
          if (groupMode === 'mention' && !this.isBotMentioned(msg)) continue;
        }

        const pushName = msg.pushName ?? senderPhone;

        const inbound: InboundMessage = {
          id: generateId('wamsg'),
          channelType: 'whatsapp',
          channelMessageId: msg.key.id ?? '',
          senderId: senderPhone,
          senderName: pushName,
          groupId: isGroup ? remoteJid : undefined,
          groupName: isGroup ? ((await this.getGroupName(remoteJid)) ?? undefined) : undefined,
          content,
          replyToId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
          timestamp: new Date((msg.messageTimestamp as number) * 1000),
          raw: msg as unknown as Record<string, unknown>,
        };

        this.logger.debug('Inbound WhatsApp message', { senderPhone, pushName, isGroup });
        await this.handleInbound(inbound);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting WhatsApp...');
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this._connected = false;
    this.logger.info('WhatsApp disconnected');
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      if (this.sock) {
        await this.sock.sendPresenceUpdate('composing', chatId);
      }
    } catch {
      // Ignore typing indicator errors
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.sock) {
      throw new Error('WhatsApp not connected');
    }

    const jid = message.groupId ?? this.toJid(message.recipientId);

    try {
      if (message.content.length > 4096) {
        const chunks = this.splitMessage(message.content, 4096);
        for (const chunk of chunks) {
          await this.sock.sendMessage(jid, { text: chunk });
        }
      } else {
        await this.sock.sendMessage(jid, { text: message.content });
      }
      this.logger.debug('WhatsApp message sent', { jid });
    } catch (error) {
      this.logger.error('Failed to send WhatsApp message', error);
      throw error;
    }
  }

  private extractContent(msg: any): string | null {
    // Plain text
    if (msg.message?.conversation) return msg.message.conversation;

    // Extended text (with quotes, links, etc.)
    if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;

    // Image with caption
    if (msg.message?.imageMessage?.caption) return msg.message.imageMessage.caption;

    // Video with caption
    if (msg.message?.videoMessage?.caption) return msg.message.videoMessage.caption;

    // Document with caption
    if (msg.message?.documentMessage?.caption) return msg.message.documentMessage.caption;

    // Image/video/audio without caption — return placeholder
    if (msg.message?.imageMessage) return '[Image]';
    if (msg.message?.videoMessage) return '[Video]';
    if (msg.message?.audioMessage) return '[Audio]';
    if (msg.message?.stickerMessage) return '[Sticker]';
    if (msg.message?.documentMessage) return `[Document: ${msg.message.documentMessage.fileName ?? 'file'}]`;
    if (msg.message?.contactMessage) return `[Contact: ${msg.message.contactMessage.displayName ?? 'unknown'}]`;
    if (msg.message?.locationMessage) return `[Location: ${msg.message.locationMessage.degreesLatitude},${msg.message.locationMessage.degreesLongitude}]`;

    return null;
  }

  private toJid(phone: string): string {
    // Remove + prefix and add WhatsApp suffix
    const clean = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');
    return `${clean}@s.whatsapp.net`;
  }

  private async getGroupName(groupJid: string): Promise<string | undefined> {
    try {
      if (!this.sock) return undefined;
      const metadata = await this.sock.groupMetadata(groupJid);
      return metadata.subject;
    } catch {
      return undefined;
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

  getSocket(): WASocket | null {
    return this.sock;
  }
}

export function createWhatsAppChannel(config?: WhatsAppConfig): WhatsAppChannel {
  return new WhatsAppChannel(config);
}
