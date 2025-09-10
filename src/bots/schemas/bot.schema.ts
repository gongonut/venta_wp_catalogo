import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BotDocument = Bot & Document;

@Schema({ timestamps: true })
export class Bot {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop({ default: 'inactive' })
  status: 'active' | 'inactive' | 'pairing' | 'error';

  @Prop({ type: Types.ObjectId, ref: 'Empresa', required: false })
  empresa?: Types.ObjectId;

  @Prop()
  qr?: string;

  @Prop()
  phoneNumber?: string;
}

export const BotSchema = SchemaFactory.createForClass(Bot);
