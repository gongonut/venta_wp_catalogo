import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmpresaDocument = Empresa & Document;

@Schema()
export class Empresa {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true, unique: true })
  nombre: string;

  @Prop()
  telefono: string;

  @Prop({ required: true, unique: true })
  whatsApp: string;

  @Prop()
  email: string;

  @Prop()
  direccion: string;

  @Prop({ type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], default: [0, 0] } })
  geoUbicacion: {
    type: string;
    coordinates: number[];
  };

  @Prop()
  saludoBienvenida: string;

  @Prop()
  saludoDespedida: string;

  @Prop([String])
  categorias: string[];
}

export const EmpresaSchema = SchemaFactory.createForClass(Empresa);
EmpresaSchema.index({ geoUbicacion: '2dsphere' });