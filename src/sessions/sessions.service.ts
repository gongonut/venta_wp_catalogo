import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSession, UserSessionDocument } from './schemas/session.schema';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(UserSession.name) private sessionModel: Model<UserSessionDocument>,
  ) {}

  /**
   * Busca una sesión de usuario por su JID. Si no existe, la crea.
   * @param userJid El JID del usuario de WhatsApp.
   * @param sessionId El ID de la sesión del bot que maneja la conversación.
   * @returns El documento de la sesión del usuario.
   */
  async findOrCreate(userJid: string, sessionId: string): Promise<UserSessionDocument> {
    const session = await this.sessionModel.findOne({ userJid }).exec();

    if (session) {
      // Si la sesión del bot ha cambiado, actualizarla
      if (session.sessionId !== sessionId) {
        session.sessionId = sessionId;
        await session.save();
      }
      return session;
    }

    // Si no hay sesión, crear una nueva
    const newSession = new this.sessionModel({
      userJid,
      sessionId,
      state: 'selecting_company',
      cart: [],
    });
    return newSession.save();
  }

  async clearAllSessions(): Promise<{ deletedCount?: number }> {
    const result = await this.sessionModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  async delete(userJid: string): Promise<{ deletedCount?: number }> {
    const result = await this.sessionModel.deleteOne({ userJid }).exec();
    return { deletedCount: result.deletedCount };
  }
}