import { EventEmitter } from 'events';

export interface IWhatsAppProvider {
  events: EventEmitter;
  initialize(): Promise<void>;
  sendMessage(to: string, message: string): Promise<void>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';