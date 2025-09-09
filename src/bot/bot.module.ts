import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BaileysProvider } from './providers/baileys.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { EmpresasModule } from '../empresas/empresas.module';
import { ProductosModule } from '../productos/productos.module';
import { ClientesModule } from '../clientes/clientes.module';
import { PedidosModule } from '../pedidos/pedidos.module';

@Module({
  imports: [EmpresasModule, ProductosModule, ClientesModule, PedidosModule],
  providers: [
    BotService,
    {
      provide: WHATSAPP_PROVIDER,
      useClass: BaileysProvider,
    },
  ],
  exports: [BotService], // Se exporta por si otros módulos necesitan interactuar con el bot
})
export class BotModule {}
