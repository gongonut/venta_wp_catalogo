
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IWhatsAppProvider, WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { WAMessage } from '@whiskeysockets/baileys';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly whatsAppProvider: IWhatsAppProvider,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing WhatsApp provider...');
    this.whatsAppProvider.initialize();
    this.whatsAppProvider.events.on('message', (message: WAMessage) => {
      this.handleIncomingMessage(message);
    });
  }

  private handleIncomingMessage(message: WAMessage) {
    // Por ahora, solo registramos el mensaje.
    // Aquí irá la lógica para procesar el flujo conversacional.
    const messageContent = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    if (!message.key.fromMe && messageContent) {
        this.logger.log(`Received message from ${message.key.remoteJid}: "${messageContent}"`);
        // Ejemplo de respuesta simple
        this.sendMessage(message.key.remoteJid, `Echo: ${messageContent}`);
    }

  }

  async sendMessage(to: string, message: string): Promise<void> {
    this.logger.log(`Sending message to ${to}: "${message}"`);
    await this.whatsAppProvider.sendMessage(to, message);
  }
}
