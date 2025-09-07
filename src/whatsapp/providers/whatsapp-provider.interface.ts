import { EventEmitter } from 'events';

export interface IWhatsAppProvider {
  events: EventEmitter;
  initialize(sessionId: string): Promise<void>;
  sendMessage(to: string, message: string): Promise<void>;
  disconnect(): Promise<void>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';