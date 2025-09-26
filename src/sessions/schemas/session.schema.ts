import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserSessionDocument = UserSession & Document;

// Define la estructura de un item en el carrito
@Schema({ _id: false })
class CartItem {
  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  precioVenta: number;

  @Prop({ required: true })
  nombreCorto: string;

  @Prop({ type: Object })
  presentacion?: any;
}
const CartItemSchema = SchemaFactory.createForClass(CartItem);

// Define la estructura de un producto pendiente
@Schema({ _id: false })
class PendingProduct {
  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  nombreCorto: string;

  @Prop({ required: true })
  precioVenta: number;

  @Prop({ required: true })
  existencia: number;

  @Prop({ type: Object })
  presentacion?: Map<string, { precioventa: number; existencia: number }>;
}
const PendingProductSchema = SchemaFactory.createForClass(PendingProduct);

// Define la estructura de la sesión del usuario en la BD
@Schema({ timestamps: true })
export class UserSession {
  @Prop({ required: true, unique: true, index: true })
  userJid: string;

  @Prop({ type: Object })
  company?: { code: string; id: string };

  @Prop({ type: [CartItemSchema], default: [] })
  cart: CartItem[];

  @Prop({ required: true, default: 'selecting_company' })
  state: string;

  @Prop([String])
  availableCategories?: string[];

  @Prop([String])
  displayedCompanies?: string[];

    @Prop({ type: Object, default: {} })
  numberedOptions: Record<string, string>;

  @Prop({ required: true })
  sessionId: string;

    @Prop({ type: Object })
  pendingOrder?: { sku: string; quantity: number; };

  @Prop({ type: PendingProductSchema })
  pendingProduct?: PendingProduct;
}


export const UserSessionSchema = SchemaFactory.createForClass(UserSession);