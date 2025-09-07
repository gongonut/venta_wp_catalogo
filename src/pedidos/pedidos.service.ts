import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Pedido, PedidoDocument } from './schemas/pedido.schema';
import { CreatePedidoDto } from './dto/create-pedido.dto';

@Injectable()
export class PedidosService {
  constructor(@InjectModel(Pedido.name) private pedidoModel: Model<PedidoDocument>) {}

  async create(createPedidoDto: CreatePedidoDto): Promise<PedidoDocument> {
    const createdPedido = new this.pedidoModel(createPedidoDto);
    return createdPedido.save();
  }
}

