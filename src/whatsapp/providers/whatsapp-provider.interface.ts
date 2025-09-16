import { EventEmitter } from 'events';

// Definición del mensaje genérico para desacoplar el servicio de la librería
export interface GenericMessage {
  from: string;
  text: string;
  isFromMe: boolean;
  originalMessage: unknown; // Para mantener el mensaje original por si se necesita
  sessionId: string; // ID de la sesión del bot que recibió el mensaje
}

export interface Button {
  id: string;
  text: string;
}

export interface IWhatsAppProvider {
  events: EventEmitter;
  initialize(sessionId: string): Promise<void>;
  sendMessage(to: string, message: string): Promise<void>;
  sendButtonsMessage(to: string, text: string, footer: string, buttons: Button[]): Promise<void>;
  disconnect(): Promise<void>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
