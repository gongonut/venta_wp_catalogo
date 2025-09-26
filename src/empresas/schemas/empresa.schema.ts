import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Producto, ProductoSchema } from './producto.schema';
import { EmpresaTipo } from '../enums/empresa-tipo.enum';
import { PaisCodigo } from '../enums/pais-codigo.enum';
import { TipoWebPg } from '../enums/tipo-web-pg.enum';

export type EmpresaDocument = Empresa & Document;

@Schema()
export class Empresa {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true, unique: true })
  nombre: string;

  @Prop()
  logo: string;

  @Prop()
  leitmotiv: string;

  @Prop({ type: String, enum: Object.values(EmpresaTipo) })
  empresaTipo: EmpresaTipo;

  @Prop({ required: true, type: String, enum: Object.values(PaisCodigo) })
  codigoPais: PaisCodigo;

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

  @Prop({ type: Number })
  areaInfluencia: number;

  @Prop({ type: Boolean, default: false })
  opcionIA: boolean;

  @Prop({ required: true, type: String, enum: Object.values(TipoWebPg), default: TipoWebPg.CLARO })
  tipoWebPg: TipoWebPg;

  @Prop()
  saludoBienvenida: string;

  @Prop()
  saludoDespedida: string;

  @Prop([String])
  categorias: string[];

  @Prop({ type: [ProductoSchema] })
  productos: Producto[];
}

export const EmpresaSchema = SchemaFactory.createForClass(Empresa);
EmpresaSchema.index({ geoUbicacion: '2dsphere' });