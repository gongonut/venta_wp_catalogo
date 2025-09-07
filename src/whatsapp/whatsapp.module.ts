import { Module, forwardRef, Scope } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { BaileysProvider } from './providers/baileys.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { WhatsappGateway } from './whatsapp.gateway';
import { BotsModule } from '../bots/bots.module';

@Module({
  imports: [forwardRef(() => BotsModule)],
  providers: [
    WhatsappService,
    WhatsappGateway,
    {
      provide: WHATSAPP_PROVIDER,
      useClass: BaileysProvider,
      scope: Scope.TRANSIENT,
    },
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
