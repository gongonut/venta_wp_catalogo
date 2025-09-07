import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, BotDocument } from './schemas/bot.schema';

@Injectable()
export class BotsService {
  constructor(@InjectModel(Bot.name) private botModel: Model<BotDocument>) {}

  async create(name: string, empresaId?: string): Promise<BotDocument> {
    const sessionId = `session_${Date.now()}`;
    const bot = new this.botModel({ name, sessionId, empresa: empresaId });
    return bot.save();
  }

  async findAll(): Promise<BotDocument[]> {
    return this.botModel.find().exec();
  }

  async findAllActive(): Promise<BotDocument[]> {
    return this.botModel.find({ status: 'active' }).exec();
  }

  async findOne(id: string): Promise<BotDocument> {
    return this.botModel.findById(id).exec();
  }

  async update(id: string, updates: Partial<Bot>): Promise<BotDocument> {
    return this.botModel.findByIdAndUpdate(id, updates, { new: true }).exec();
  }

  async delete(id: string): Promise<any> {
    return this.botModel.findByIdAndDelete(id).exec();
  }
}
