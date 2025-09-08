
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Empresa } from '../../empresas/schemas/empresa.schema';

export type ProductoDocument = Producto & Document;

@Schema()
export class Producto {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Empresa', required: true })
  empresaId: Empresa;

  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  nombreCorto: string;

  @Prop()
  nombreLargo: string;

  @Prop({ index: true })
  categoria: string;

  @Prop({ default: 0 })
  existencia: number;

  @Prop({ default: 0 })
  costo: number;

  @Prop({ required: true, default: 0 })
  precioVenta: number;

  @Prop([String])
  fotos: string[];

  @Prop()
  ubicacionImg: string;
}

export const ProductoSchema = SchemaFactory.createForClass(Producto);
ProductoSchema.index({ empresaId: 1, sku: 1 }, { unique: true });
