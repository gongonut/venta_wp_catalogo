
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Empresa } from '../../empresas/schemas/empresa.schema';
import { Cliente } from '../../clientes/schemas/cliente.schema';

export type PedidoDocument = Pedido & Document;

class PedidoItem {
  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  cantidad: number;
}

@Schema()
export class Pedido {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Empresa', required: true })
  empresaId: Empresa;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Cliente', required: true })
  clienteId: Cliente;

  @Prop({ default: Date.now })
  fecha: Date;

  @Prop([PedidoItem])
  items: PedidoItem[];

  @Prop({ required: true })
  totalPrecio: number;

  @Prop({ required: true, enum: ['pendiente', 'cerrado'], default: 'pendiente' })
  estadoPedido: string;
}

export const PedidoSchema = SchemaFactory.createForClass(Pedido);
