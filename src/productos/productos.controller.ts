import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductosService } from './productos.service';

@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

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
}
