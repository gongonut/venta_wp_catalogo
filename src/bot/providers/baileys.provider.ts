import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { IWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp-provider.interface';

@Injectable()
export class BaileysProvider implements IWhatsAppProvider {
  events = new EventEmitter();
  private sock: any;
  private logger = new Logger(BaileysProvider.name);

  async initialize(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    this.sock = makeWASocket({
      auth: state,
      logger: this.logger as any,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.logger.log('QR code available, please scan it.');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.error(`Connection closed due to ${lastDisconnect.error}, reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          this.initialize();
        }
      } else if (connection === 'open') {
        this.logger.log('Opened connection');
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', (m) => {
      if (m.messages && m.messages.length > 0) {
        const message = m.messages[0];
        // Emitir el mensaje para que el BotService lo procese
        this.events.emit('message', message);
      }
    });
  }

  async sendMessage(to: string, message: string): Promise<void> {
    await this.sock.sendMessage(to, { text: message });
  }
}