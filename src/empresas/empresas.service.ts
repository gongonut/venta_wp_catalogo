import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Empresa, EmpresaDocument } from './schemas/empresa.schema';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { Producto } from './schemas/producto.schema';
import { ProductoImportDto } from './dto/producto-import.dto';
import { ConfigService } from '@nestjs/config';
import * as xlsx from 'xlsx';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class EmpresasService {
  constructor(
    @InjectModel(Empresa.name) private empresaModel: Model<EmpresaDocument>,
    private readonly configService: ConfigService,
  ) {}

  // Métodos CRUD para Empresas (existentes)
  async create(createEmpresaDto: CreateEmpresaDto): Promise<EmpresaDocument> {
    const createdEmpresa = new this.empresaModel(createEmpresaDto);
    return createdEmpresa.save();
  }

  async findAll(): Promise<EmpresaDocument[]> {
    return this.empresaModel.find().exec();
  }

  async findOne(id: string): Promise<EmpresaDocument> {
    const empresa = await this.empresaModel.findById(id).exec();
    if (!empresa) {
      throw new NotFoundException(`Empresa con ID "${id}" no encontrada.`);
    }
    return empresa;
  }

  async findOneByCode(code: string): Promise<EmpresaDocument> {
    const empresa = await this.empresaModel.findOne({ code }).exec();
    if (!empresa) {
      throw new NotFoundException(`Empresa con código "${code}" no encontrada.`);
    }
    return empresa;
  }

  async findOneByName(name: string): Promise<EmpresaDocument> {
    const empresa = await this.empresaModel.findOne({ nombre: { $regex: `^${name}$`, $options: 'i' } }).exec();
    if (!empresa) {
        throw new NotFoundException(`Empresa con nombre "${name}" no encontrada.`);
    }
    return empresa;
  }

  async update(id: string, updateEmpresaDto: UpdateEmpresaDto): Promise<EmpresaDocument> {
    const updatedEmpresa = await this.empresaModel.findByIdAndUpdate(id, updateEmpresaDto, { new: true }).exec();
    if (!updatedEmpresa) {
        throw new NotFoundException(`Empresa con ID "${id}" no encontrada para actualizar.`);
    }
    return updatedEmpresa;
  }

  async delete(id: string): Promise<EmpresaDocument> {
    const deletedEmpresa = await this.empresaModel.findByIdAndDelete(id).exec();
    if (!deletedEmpresa) {
        throw new NotFoundException(`Empresa con ID "${id}" no encontrada para eliminar.`);
    }
    return deletedEmpresa;
  }

  // --- Métodos para gestión de Productos (fusionados) ---

  registerUploadedAssets(files: Array<Express.Multer.File>) {
    const baseUrl = this.configService.get<string>('API_URL') || 'http://localhost:3000';
    const urls = files.map(file => `${baseUrl}/uploads/productos/${file.filename}`);
    return { urls };
  }

  async addProductWithImages(empresaId: string, productoDto: any, files: Array<Express.Multer.File>): Promise<EmpresaDocument> {
    const empresa = await this.findOne(empresaId);
    const imagePaths = files.map(file => `/uploads/productos/${file.filename}`);
    
    const newProducto = {
      ...productoDto,
      fotos: imagePaths,
    };

    if (newProducto.presentacion) {
      const presentacionMap = new Map();
      for (const [name, pres] of Object.entries(newProducto.presentacion)) {
        const newPres = {
          precioventa: (pres as any).precioventa,
          existencia: (pres as any).existencia ?? 0,
        };
        presentacionMap.set(name, newPres);
      }
      newProducto.presentacion = presentacionMap;
    }

    // Validar si el SKU ya existe
    const skuExists = empresa.productos.some(p => p.sku === newProducto.sku);
    if (skuExists) {
      throw new BadRequestException(`El producto con SKU "${newProducto.sku}" ya existe en esta empresa.`);
    }

    empresa.productos.push(newProducto as Producto);
    return empresa.save();
  }

  async importProductsForEmpresa(empresaId: string, fileBuffer: Buffer, fileType: 'excel' | 'json') {
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
      throw new BadRequestException('Error al leer o parsear el archivo. Asegúrate de que el formato es correcto y no está dañado.');
    }

    if (!Array.isArray(productsData) || productsData.length === 0) {
      throw new BadRequestException('El archivo no contiene productos o el formato es incorrecto.');
    }

    const validationErrors = [];
    const validProducts: ProductoImportDto[] = [];

    for (const item of productsData) {
      const productDto = plainToInstance(ProductoImportDto, item);
      const errors = await validate(productDto);

      if (item.presentacion) {
        try {
          JSON.parse(item.presentacion);
        } catch (e) {
          errors.push({
            property: 'presentacion',
            constraints: { json: 'La columna presentacion no es un JSON válido.' },
          } as any);
        }
      }

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

    const empresa = await this.findOne(empresaId);
    const existingSkus = new Map(empresa.productos.map(p => [p.sku, p]));
    let updatedCount = 0;
    let createdCount = 0;

    for (const productDto of validProducts) {
      const { foto1, foto2, foto3, foto4, foto5, presentacion, ...productData } = productDto;
      const fotos = [foto1, foto2, foto3, foto4, foto5].filter(Boolean);
      const productWithFotos: Partial<Producto> = { ...productData, fotos };

      if (presentacion) {
        try {
          const presentacionObj = JSON.parse(presentacion);
          const presentacionMap = new Map();
          for (const [name, pres] of Object.entries(presentacionObj)) {
            const newPres = {
              precioventa: (pres as any).precioventa,
              existencia: (pres as any).existencia ?? 0,
            };
            presentacionMap.set(name, newPres);
          }
          productWithFotos.presentacion = presentacionMap;
        } catch (e) {
          // This should not happen as we validated it before
        }
      }

      if (existingSkus.has(productDto.sku)) {
        // Actualizar producto existente
        const existingProduct = existingSkus.get(productDto.sku);
        Object.assign(existingProduct, productWithFotos);
        updatedCount++;
      } else {
        // Agregar nuevo producto
        empresa.productos.push(productWithFotos as Producto);
        createdCount++;
      }
    }

    await empresa.save();

    return {
      created: createdCount,
      updated: updatedCount,
      errors: [],
    };
  }

  async findAllProducts(empresaId: string): Promise<Producto[]> {
    const empresa = await this.findOne(empresaId);
    return empresa.productos;
  }

  async findProductCategories(empresaId: string): Promise<string[]> {
    const empresa = await this.findOne(empresaId);
    return empresa.categorias || [];
  }

  async findProductsByCategory(empresaId: string, categoria: string): Promise<Producto[]> {
    const empresa = await this.findOne(empresaId);
    return empresa.productos.filter(p => p.categoria === categoria);
  }

  async findProductBySku(empresaId: string, sku: string): Promise<Producto> {
    const empresa = await this.findOne(empresaId);
    const producto = empresa.productos.find(p => p.sku === sku);
    if (!producto) {
      throw new NotFoundException(`Producto con SKU "${sku}" no encontrado en la empresa.`);
    }
    return producto;
  }

  async updateProduct(empresaId: string, sku: string, updateDto: Partial<Producto>): Promise<EmpresaDocument> {
    const empresa = await this.findOne(empresaId);
    const productIndex = empresa.productos.findIndex(p => p.sku === sku);

    if (productIndex === -1) {
      throw new NotFoundException(`Producto con SKU "${sku}" no encontrado para actualizar.`);
    }

    // Evitar que se actualice el sku si se pasa accidentalmente
    const { sku: newSku, ...updateData } = updateDto;
    
    if (updateData.presentacion) {
      const presentacionMap = new Map();
      for (const [name, pres] of Object.entries(updateData.presentacion)) {
        const newPres = {
          precioventa: (pres as any).precioventa,
          existencia: (pres as any).existencia ?? 0,
        };
        presentacionMap.set(name, newPres);
      }
      updateData.presentacion = presentacionMap;
    }

    const product = empresa.productos[productIndex];
    Object.assign(product, updateData);
    
    empresa.markModified('productos');
    return empresa.save();
  }

  async removeProduct(empresaId: string, sku: string): Promise<EmpresaDocument> {
    const empresa = await this.findOne(empresaId);
    const initialLength = empresa.productos.length;
    
    empresa.productos = empresa.productos.filter(p => p.sku !== sku);

    if (empresa.productos.length === initialLength) {
      throw new NotFoundException(`Producto con SKU "${sku}" no encontrado para eliminar.`);
    }
    
    return empresa.save();
  }

  async decreaseStock(empresaId: string, sku: string, quantity: number, presentacionName?: string): Promise<void> {
    const empresa = await this.findOne(empresaId);
    const productIndex = empresa.productos.findIndex(p => p.sku === sku);

    if (productIndex === -1) {
      throw new NotFoundException(`Producto con SKU "${sku}" no encontrado para actualizar stock.`);
    }

    const product = empresa.productos[productIndex];

    if (presentacionName) {
      const presentacion = product.presentacion?.get(presentacionName);
      if (presentacion) {
        if (presentacion.existencia < quantity) {
          console.warn(`Stock issue: Presentation "${presentacionName}" for product ${sku} has stock ${presentacion.existencia}, but order is for ${quantity}. Setting stock to 0.`);
          presentacion.existencia = 0;
        } else {
          presentacion.existencia -= quantity;
        }
      } else {
        console.error(`Presentation "${presentacionName}" not found for product ${sku} during stock decrease.`);
        return; 
      }
    } else {
      if (product.existencia < quantity) {
          console.warn(`Stock issue: Product ${sku} has stock ${product.existencia}, but order is for ${quantity}. Setting stock to 0.`);
          product.existencia = 0;
      } else {
          product.existencia -= quantity;
      }
    }
    
    empresa.markModified('productos');
    await empresa.save();
  }
}