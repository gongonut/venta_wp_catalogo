import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { Cliente, ClienteSchema } from './schemas/cliente.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Cliente.name, schema: ClienteSchema }])],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService]
})
export class ClientesModule {}

