import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Producto, ProductoDocument } from './schemas/producto.schema';
import * as xlsx from 'xlsx';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductoImportDto } from './dto/producto-import.dto';

@Injectable()
export class ProductosService {
  constructor(@InjectModel(Producto.name) private productoModel: Model<ProductoDocument>) {}

  async importProducts(fileBuffer: Buffer, empresaId: string, fileType: 'excel' | 'json') {
    let productsData: any[];

    try {
      if (fileType === 'json') {
        productsData = JSON.parse(fileBuffer.toString('utf-8'));
      } else {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        productsData = xlsx.utils.sheet_to_json(worksheet);
      }
    } catch (error) {
      throw new BadRequestException('Error al leer o parsear el archivo. Asegúrate de que el formato es correcto.');
    }

    if (!Array.isArray(productsData) || productsData.length === 0) {
      throw new BadRequestException('El archivo no contiene productos o el formato es incorrecto.');
    }

    const validationErrors = [];
    const validProducts: ProductoImportDto[] = [];

    for (const item of productsData) {
      const productDto = plainToInstance(ProductoImportDto, item);
      const errors = await validate(productDto);

      if (errors.length > 0) {
        validationErrors.push({ sku: item.sku || 'SKU no definido', errors: errors.map(e => Object.values(e.constraints)).flat() });
      } else {
        validProducts.push(productDto);
      }
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Se encontraron errores de validación en los productos.',
        errors: validationErrors,
      });
    }

    const bulkOps = validProducts.map(product => ({
      updateOne: {
        filter: { empresaId, sku: product.sku },
        update: { $set: { ...product, empresaId } },
        upsert: true,
      },
    }));

    const result = await this.productoModel.bulkWrite(bulkOps);

    return {
      created: result.upsertedCount,
      updated: result.modifiedCount,
      errors: [], // En un futuro se podrían manejar errores individuales de la BD aquí
    };
  }

  async findAllByEmpresa(empresaId: string): Promise<ProductoDocument[]> {
    return this.productoModel.find({ empresaId }).exec();
  }

  async findOneBySkuAndEmpresa(sku: string, empresaId: string): Promise<ProductoDocument> {
    return this.productoModel.findOne({ sku, empresaId }).exec();
  }

  // TODO: Add methods for create, update, delete
}

