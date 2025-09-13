import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { Producto, ProductoSchema } from './schemas/producto.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Producto.name, schema: ProductoSchema }])],
  controllers: [ProductosController],
  providers: [ProductosService],
  exports: [ProductosService]
})
export class ProductosModule {}

