import {
  Controller, Get, Post, Body, Patch, Param, Delete, Query,
  UseInterceptors, UploadedFile, UploadedFiles, BadRequestException
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { EmpresasService } from './empresas.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { Producto } from './schemas/producto.schema';

// Multer configuration for file uploads
const multerStorage = diskStorage({
  destination: './public/uploads/productos',
  filename: (req, file, cb) => {
    const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
    cb(null, `${randomName}${extname(file.originalname)}`);
  },
});

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  // --- Rutas CRUD para Empresas ---
  @Post()
  create(@Body() createEmpresaDto: CreateEmpresaDto) {
    return this.empresasService.create(createEmpresaDto);
  }

  @Get()
  findAll() {
    return this.empresasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.empresasService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateEmpresaDto: UpdateEmpresaDto) {
    return this.empresasService.update(id, updateEmpresaDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.empresasService.delete(id);
  }

  // --- Rutas para Productos anidados ---

  @Post(':empresaId/productos')
  @UseInterceptors(FilesInterceptor('fotos', 5, { storage: multerStorage }))
  async addProductWithImages(
    @Param('empresaId') empresaId: string,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body('data') data: string,
  ) {
    if (!data) {
      throw new BadRequestException('No se han enviado datos del producto (campo "data").');
    }
    const productoDto = JSON.parse(data);
    return this.empresasService.addProductWithImages(empresaId, productoDto, files);
  }

  @Get(':empresaId/productos')
  async findAllProducts(
    @Param('empresaId') empresaId: string,
    @Query('categoria') categoria?: string,
  ) {
    if (categoria) {
      return this.empresasService.findProductsByCategory(empresaId, categoria);
    }
    return this.empresasService.findAllProducts(empresaId);
  }

  @Get(':empresaId/productos/categories')
  async findProductCategories(@Param('empresaId') empresaId: string) {
    return this.empresasService.findProductCategories(empresaId);
  }

  @Get(':empresaId/productos/:sku')
  async findProductBySku(
    @Param('empresaId') empresaId: string,
    @Param('sku') sku: string,
  ) {
    return this.empresasService.findProductBySku(empresaId, sku);
  }

  @Patch(':empresaId/productos/:sku')
  async updateProduct(
    @Param('empresaId') empresaId: string,
    @Param('sku') sku: string,
    @Body() updateDto: Partial<Producto>,
  ) {
    return this.empresasService.updateProduct(empresaId, sku, updateDto);
  }

  @Delete(':empresaId/productos/:sku')
  async removeProduct(
    @Param('empresaId') empresaId: string,
    @Param('sku') sku: string,
  ) {
    return this.empresasService.removeProduct(empresaId, sku);
  }

  // --- Rutas de Importación y Utilidades ---

  @Post(':empresaId/productos/import')
  @UseInterceptors(FileInterceptor('file'))
  async importProductos(
    @Param('empresaId') empresaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('fileType') fileType: 'excel' | 'json',
  ) {
    if (!file) {
      throw new BadRequestException('No se ha subido ningún archivo.');
    }
    if (!fileType) {
      throw new BadRequestException('El tipo de archivo (fileType) es requerido.');
    }

    const result = await this.empresasService.importProductsForEmpresa(empresaId, file.buffer, fileType);
    return {
      message: `Importación exitosa. ${result.created} productos creados, ${result.updated} productos actualizados.`,
      ...result,
    };
  }

  @Post('productos/upload-assets')
  @UseInterceptors(FilesInterceptor('images', 50, { storage: multerStorage }))
  async uploadAssets(@UploadedFiles() files: Array<Express.Multer.File>) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No se han subido imágenes.');
    }
    return this.empresasService.registerUploadedAssets(files);
  }
}