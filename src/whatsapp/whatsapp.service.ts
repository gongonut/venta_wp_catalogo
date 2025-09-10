import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BotsService } from '../bots/bots.service';
import { WhatsappGateway } from './whatsapp.gateway';
import { BotDocument } from '../bots/schemas/bot.schema';
import { ModuleRef } from '@nestjs/core';
import { IWhatsAppProvider, WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private sessions = new Map<string, IWhatsAppProvider>();

  constructor(
    private readonly botsService: BotsService,
    private readonly gateway: WhatsappGateway,
    private readonly moduleRef: ModuleRef,
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
}
