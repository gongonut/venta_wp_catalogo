import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cliente, ClienteDocument } from './schemas/cliente.schema';

@Injectable()
export class ClientesService {
  constructor(@InjectModel(Cliente.name) private clienteModel: Model<ClienteDocument>) {}

  async findOrCreateByWhatsApp(whatsApp: string): Promise<ClienteDocument> {
    let cliente = await this.clienteModel.findOne({ whatsApp }).exec();
    if (!cliente) {
      // For now, we just create a client with the WhatsApp number.
      // In a real app, we might ask for more details.
      cliente = new this.clienteModel({ whatsApp });
      await cliente.save();
    }
    return cliente;
  }
}

