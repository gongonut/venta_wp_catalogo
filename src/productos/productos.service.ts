import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Producto, ProductoDocument } from './schemas/producto.schema';
import * as xlsx from 'xlsx';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductoImportDto } from './dto/producto-import.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProductosService {
  constructor(
    @InjectModel(Producto.name) private productoModel: Model<ProductoDocument>,
    private configService: ConfigService,
  ) {}

  async createWithImages(productoDto: any, files: Array<Express.Multer.File>): Promise<Producto> {
    // Los archivos ya fueron guardados por Multer. Solo necesitamos sus rutas.
    const imagePaths = files.map(file => `/uploads/productos/${file.filename}`);

    const newProducto = new this.productoModel({
      ...productoDto,
      fotos: imagePaths,
    });

    return newProducto.save();
  }

  registerUploadedAssets(files: Array<Express.Multer.File>) {
    const baseUrl = this.configService.get<string>('API_URL') || 'http://localhost:3000';
    const urls = files.map(file => `${baseUrl}/uploads/productos/${file.filename}`);
    return { urls };
  }

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
      throw new BadRequestException({ 
        message: 'Error al leer o parsear el archivo.', 
        details: 'Asegúrate de que el formato es correcto (Excel o JSON) y el archivo no está dañado.' 
      });
    }

    if (!Array.isArray(productsData) || productsData.length === 0) {
      throw new BadRequestException({ 
        message: 'El archivo no contiene productos o el formato es incorrecto.',
        details: 'Asegúrate de que el archivo no está vacío y los productos están en un formato de array/lista válido.'
      });
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

    const bulkOps = validProducts.map(productDto => {
      const { foto1, foto2, foto3, foto4, foto5, ...productData } = productDto;
      const fotos = [foto1, foto2, foto3, foto4, foto5].filter(Boolean);

      return {
        updateOne: {
          filter: { empresaId, sku: productData.sku },
          update: { $set: { ...productData, empresaId, fotos } },
          upsert: true,
        },
      };
    });

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

  async findCategoriesByEmpresa(empresaId: string): Promise<string[]> {
    // Usamos distinct para obtener las categorías únicas que no son nulas o vacías
    return this.productoModel.distinct('categoria', { empresaId, categoria: { $nin: [null, ''] } }).exec();
  }

  async findAllByEmpresaAndCategory(empresaId: string, categoria: string): Promise<ProductoDocument[]> {
    return this.productoModel.find({ empresaId, categoria }).exec();
  }

  async findOneBySkuAndEmpresa(sku: string, empresaId: string): Promise<ProductoDocument> {
    return this.productoModel.findOne({ sku, empresaId }).exec();
  }

  // TODO: Add methods for create, update, delete
}