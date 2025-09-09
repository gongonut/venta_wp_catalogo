import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { GenericMessage, IWhatsAppProvider } from './whatsapp-provider.interface'; // Import GenericMessage

@Injectable()
export class BaileysProvider implements IWhatsAppProvider {
  events = new EventEmitter();
  private sock: any;
  private logger = new Logger(BaileysProvider.name);

  async initialize(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true, // Muestra el QR directamente en la terminal
      logger: this.logger as any,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.error(`Conexión cerrada: ${lastDisconnect.error}, reconectando: ${shouldReconnect}`);
        if (shouldReconnect) {
          this.initialize();
        }
      } else if (connection === 'open') {
        this.logger.log('Conexión abierta');
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', (m) => {
      if (m.messages && m.messages.length > 0) {
        const rawMessage: WAMessage = m.messages[0];

        const messageText = rawMessage.message?.conversation || rawMessage.message?.extendedTextMessage?.text || '';

        // No procesar mensajes vacíos o sin texto
        if (!messageText.trim()) {
          return;
        }

        // Crear el objeto GenericMessage
        const genericMessage: GenericMessage = {
          from: rawMessage.key.remoteJid!,
          text: messageText.trim(),
          isFromMe: rawMessage.key.fromMe || false,
          originalMessage: rawMessage,
        };

        // Emitir el mensaje genérico para que BotService lo procese
        this.events.emit('message', genericMessage);
      }
    });
  }

  async sendMessage(to: string, message: string): Promise<void> {
    // Asegurarse que el JID es correcto para grupos o usuarios
    const jid = to.includes('@g.us') || to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: message });
  }
}