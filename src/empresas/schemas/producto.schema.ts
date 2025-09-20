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

  @Prop({
    type: Map,
    of: {
      precioventa: { type: Number, required: true },
      existencia: { type: Number, required: true, default: 0 },
    },
  })
  presentacion: Map<string, { precioventa: number; existencia: number }>;

  @Prop()
  categoria: string;

  @Prop([String])
  fotos: string[];
}

export const ProductoSchema = SchemaFactory.createForClass(Producto);