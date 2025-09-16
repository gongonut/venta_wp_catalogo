import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class Producto {
  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  nombreCorto: string;

  @Prop()
  nombreLargo: string;

  @Prop()
  descripcion: string;

  @Prop({ required: true })
  precioVenta: number;

  @Prop({ required: true, default: 0 })
  existencia: number;

  @Prop()
  categoria: string;

  @Prop([String])
  fotos: string[];
}

export const ProductoSchema = SchemaFactory.createForClass(Producto);