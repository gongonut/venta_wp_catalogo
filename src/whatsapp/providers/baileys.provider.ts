import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { IWhatsAppProvider } from './whatsapp-provider.interface';
import * as pino from 'pino';

@Injectable()
export class BaileysProvider implements IWhatsAppProvider {
  events = new EventEmitter();
  private sock: any;
  private logger = new Logger(BaileysProvider.name);

  async initialize(sessionId: string): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(`auth_info_baileys/${sessionId}`);
    const pinoLogger = pino({ level: 'debug' });

    this.sock = makeWASocket({
      auth: state,
      logger: pinoLogger as any,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.events.emit('qr', qr);
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.error(`Connection closed for session ${sessionId}, reason: ${lastDisconnect.error}, reconnecting: ${shouldReconnect}`);
        this.events.emit('status', { status: 'close', shouldReconnect });
      } else if (connection === 'open') {
        this.logger.log(`Connection opened for session ${sessionId}`);
        this.events.emit('status', { status: 'open', user: this.sock.user });
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', (m) => {
      if (m.messages && m.messages.length > 0) {
        const message = m.messages[0];
        this.events.emit('message', message);
      }
    });
  }

  async sendMessage(to: string, message: string): Promise<void> {
    await this.sock.sendMessage(to, { text: message });
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
    }
  }
}
