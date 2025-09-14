import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { BotsService } from '../bots/bots.service';
import { WhatsappGateway } from './whatsapp.gateway';
import { BotDocument } from '../bots/schemas/bot.schema';
import { ModuleRef } from '@nestjs/core';
import { GenericMessage, IWhatsAppProvider, WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { ConversationService } from '../conversation/conversation.service';
import { WAMessage } from '@whiskeysockets/baileys';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import { join } from 'path';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private sessions = new Map<string, IWhatsAppProvider>();
  private readonly SESSIONS_DIR = join(process.cwd(), 'auth_info_baileys');

  constructor(
    private readonly botsService: BotsService,
    private readonly gateway: WhatsappGateway,
    private readonly moduleRef: ModuleRef,
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService: ConversationService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing WhatsApp service...');
    const bots = await this.botsService.findAllActive();
    bots.forEach(bot => {
      if (bot.status === 'active') {
        this.startBotSession(bot).catch(error => this.logger.error(`Failed to auto-start session for ${bot.sessionId}`, error));
      }
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'purge_old_sessions',
    timeZone: 'America/Bogota',
  })
  async handlePurgeOldSessions() {
    this.logger.log('Running scheduled job: Purging old WhatsApp session directories...');
    try {
      const activeSessionIds = new Set(this.sessions.keys());
      const allSessionDirs = await fs.readdir(this.SESSIONS_DIR, { withFileTypes: true });

      const deletionPromises = allSessionDirs
        .filter(dirent => dirent.isDirectory() && !activeSessionIds.has(dirent.name))
        .map(dirent => {
          const dirPath = join(this.SESSIONS_DIR, dirent.name);
          this.logger.log(`Deleting inactive session directory: ${dirPath}`);
          return fs.rm(dirPath, { recursive: true, force: true });
        });

      await Promise.all(deletionPromises);
      this.logger.log('Finished purging old WhatsApp session directories.');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn('Session directory not found, skipping purge. It will be created on first session init.');
      } else {
        this.logger.error('Error purging old WhatsApp session directories', error);
      }
    }
  }

  async startBotSession(bot: BotDocument): Promise<string | null> {
    if (this.sessions.has(bot.sessionId)) {
      this.logger.warn(`Session start requested for already active session: ${bot.sessionId}`);
      return null;
    }

    return new Promise(async (resolve, reject) => {
      this.logger.log(`Starting bot session for: ${bot.name} (${bot.sessionId})`);
      const session = await this.moduleRef.resolve<IWhatsAppProvider>(WHATSAPP_PROVIDER);
      this.sessions.set(bot.sessionId, session);

      const timeout = setTimeout(() => {
        this.sessions.delete(bot.sessionId);
        reject(new Error('Timeout waiting for QR code'));
      }, 30000); // 30s timeout

      session.events.on('qr', (qr) => {
        clearTimeout(timeout);
        this.botsService.update(bot.id, { qr, status: 'pairing' });
        this.gateway.sendQrCode(bot.sessionId, qr);
        resolve(qr);
      });

      session.events.on('status', (statusEvent) => {
        if (statusEvent.status === 'open') {
          clearTimeout(timeout);
          if (statusEvent.user && statusEvent.user.id) {
            const phoneNumber = statusEvent.user.id.split(':')[0].split('@')[0];
            this.botsService.update(bot.id, { phoneNumber, qr: '', status: 'active' });
            this.gateway.sendStatus(bot.sessionId, 'active');
          }
          resolve(null); // Connection is open, no QR code
        } else if (statusEvent.status === 'close') {
          this.sessions.delete(bot.sessionId);
          this.botsService.update(bot.id, { status: 'inactive' });
          this.gateway.sendStatus(bot.sessionId, 'inactive');
          if (statusEvent.shouldReconnect) {
            this.logger.log(`Reconnecting session ${bot.sessionId} in 5 seconds...`);
            setTimeout(() => this.startBotSession(bot), 5000);
          }
        }
      });

      session.events.on('message', (message: WAMessage) => {
        if (message.key.fromMe) return;

        const genericMessage: GenericMessage = {
          from: message.key.remoteJid!,
          text: message.message?.conversation || message.message?.extendedTextMessage?.text || '',
          isFromMe: message.key.fromMe || false,
          originalMessage: message,
          sessionId: bot.sessionId,
        };

        this.conversationService.handleIncomingMessage(genericMessage);
      });

      try {
        await session.initialize(bot.sessionId);
      } catch (error) {
        clearTimeout(timeout);
        this.sessions.delete(bot.sessionId);
        this.logger.error(`Failed to initialize bot session ${bot.sessionId}`, error);
        this.botsService.update(bot.id, { status: 'error' });
        reject(error);
      }
    });
  }

  async stopBotSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.disconnect();
      this.sessions.delete(sessionId);
      this.logger.log(`Stopped bot session: ${sessionId}`);
    }
  }

  async sendMessage(sessionId: string, to: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.sendMessage(to, message);
    } else {
      this.logger.warn(`Attempted to send message via non-existent session: ${sessionId}`);
    }
  }
}

