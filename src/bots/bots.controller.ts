import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { BotsService } from './bots.service';
import { Bot, BotDocument } from './schemas/bot.schema';
import { WhatsappService } from '../whatsapp/whatsapp.service';

class CreateBotDto {
  name: string;
  empresaId?: string;
}

@Controller('bots')
export class BotsController {
  constructor(
    private readonly botsService: BotsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Post()
  async create(@Body() createBotDto: CreateBotDto): Promise<BotDocument> {
    const bot = await this.botsService.create(createBotDto.name, createBotDto.empresaId);
    try {
      await this.whatsappService.startBotSession(bot);
    } catch (error) {
      // Log the error, but don't block the response
      console.error(`Failed to start bot session and get QR code: ${error.message}`);
    }
    return this.botsService.findOne(bot.id);
  }

  @Get()
  findAll(): Promise<BotDocument[]> {
    return this.botsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<BotDocument> {
    return this.botsService.findOne(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<any> {
    const bot = await this.botsService.findOne(id);
    if (bot) {
      await this.whatsappService.stopBotSession(bot.sessionId);
    }
    return this.botsService.delete(id);
  }

  @Patch(':id/activate')
  async activate(@Param('id') id: string): Promise<BotDocument> {
    const bot = await this.botsService.findOne(id);
    if (bot) {
      await this.whatsappService.startBotSession(bot);
    }
    return this.botsService.findOne(id);
  }

  @Patch(':id/inactivate')
  async inactivate(@Param('id') id: string): Promise<BotDocument> {
    const bot = await this.botsService.findOne(id);
    if (bot) {
      await this.whatsappService.stopBotSession(bot.sessionId);
      return this.botsService.update(id, { status: 'inactive' });
    }
    return bot;
  }
}
