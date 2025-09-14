import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Empresa, EmpresaDocument } from './schemas/empresa.schema';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';

@Injectable()
export class EmpresasService {
  constructor(@InjectModel(Empresa.name) private empresaModel: Model<EmpresaDocument>) {}

  async create(createEmpresaDto: CreateEmpresaDto): Promise<EmpresaDocument> {
    const createdEmpresa = new this.empresaModel(createEmpresaDto);
    return createdEmpresa.save();
  }

  async findAll(): Promise<EmpresaDocument[]> {
    return this.empresaModel.find().exec();
  }

  async findOne(id: string): Promise<EmpresaDocument> {
    return this.empresaModel.findById(id).exec();
  }

  async findOneByCode(code: string): Promise<EmpresaDocument> {
    return this.empresaModel.findOne({ code }).exec();
  }

  async findOneByName(name: string): Promise<EmpresaDocument> {
    // Búsqueda insensible a mayúsculas/minúsculas que coincida con el nombre exacto
    return this.empresaModel.findOne({ nombre: { $regex: `^${name}$`, $options: 'i' } }).exec();
  }

  async update(id: string, updateEmpresaDto: UpdateEmpresaDto): Promise<EmpresaDocument> {
    return this.empresaModel.findByIdAndUpdate(id, updateEmpresaDto, { new: true }).exec();
  }

  async delete(id: string): Promise<EmpresaDocument> {
    return this.empresaModel.findByIdAndDelete(id).exec();
  }
}