
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClienteDocument = Cliente & Document;

@Schema()
export class Cliente {
  @Prop()
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
}

export const ClienteSchema = SchemaFactory.createForClass(Cliente);
ClienteSchema.index({ geoUbicacion: '2dsphere' });
