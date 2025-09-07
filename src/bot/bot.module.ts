import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BaileysProvider } from './providers/baileys.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';

@Module({
  providers: [
    BotService,
    {
      provide: WHATSAPP_PROVIDER,
      useClass: BaileysProvider,
    },
  ],
})
export class BotModule {}