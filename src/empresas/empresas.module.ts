import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';
import { Empresa, EmpresaSchema } from './schemas/empresa.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Empresa.name, schema: EmpresaSchema }])],
  controllers: [EmpresasController],
  providers: [EmpresasService],
  exports: [EmpresasService]
})
export class EmpresasModule {}

