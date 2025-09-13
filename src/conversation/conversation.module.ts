import { Module, forwardRef } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { EmpresasModule } from '../empresas/empresas.module';
import { ProductosModule } from '../productos/productos.module';
import { ClientesModule } from '../clientes/clientes.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    EmpresasModule, 
    ProductosModule, 
    ClientesModule, 
    PedidosModule,
    forwardRef(() => WhatsappModule),
    SessionsModule,
  ],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
