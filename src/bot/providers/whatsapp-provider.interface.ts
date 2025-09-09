import { EventEmitter } from 'events';

// 1. Definición del mensaje genérico para desacoplar el servicio de la librería
export interface GenericMessage {
  from: string;
  text: string;
  isFromMe: boolean;
  originalMessage: unknown; // Para mantener el mensaje original por si se necesita
}

export interface IWhatsAppProvider {
  events: EventEmitter;
  initialize(): Promise<void>;
  sendMessage(to: string, message: string): Promise<void>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';