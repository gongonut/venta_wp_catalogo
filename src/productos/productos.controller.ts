import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException, UploadedFiles } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ProductosService } from './productos.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  @Post('upload-from-excel')
  @UseInterceptors(FilesInterceptor('fotos', 5, { // 'fotos' es el key, 5 es el max de archivos
    storage: diskStorage({
      destination: './public/uploads/productos', // Guardar directamente en la carpeta final
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
  }))
  async uploadFromExcel(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body('data') data: string,
  ) {
    if (!data) {
      throw new BadRequestException('No se han enviado datos del producto.');
    }
    const productoDto = JSON.parse(data);
    return this.productosService.createWithImages(productoDto, files);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importProductos(
    @UploadedFile() file: Express.Multer.File,
    @Body('empresaId') empresaId: string,
    @Body('fileType') fileType: 'excel' | 'json',
  ) {
    if (!file) {
      throw new BadRequestException('No se ha subido ningún archivo.');
    }
    if (!empresaId) {
      throw new BadRequestException('El ID de la empresa es requerido.');
    }
    if (!fileType) {
      throw new BadRequestException('El tipo de archivo (fileType) es requerido.');
    }

    try {
      const result = await this.productosService.importProducts(file.buffer, empresaId, fileType);
      return {
        message: `Importación exitosa. ${result.created} productos creados, ${result.updated} productos actualizados.`,
        ...result,
      };
    } catch (error) {
      // Errores de validación o de base de datos serán atrapados aquí
      throw new BadRequestException(error.message);
    }
  }

  @Post('upload-assets')
  @UseInterceptors(FilesInterceptor('images', 50, {
    storage: diskStorage({
      destination: './public/uploads/productos',
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
  }))
  async uploadAssets(@UploadedFiles() files: Array<Express.Multer.File>) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No se han subido imágenes.');
    }
    return this.productosService.registerUploadedAssets(files);
  }
}
