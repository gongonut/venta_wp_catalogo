import { IsString, IsNumber, IsOptional } from 'class-validator';

export class ProductoImportDto {
  @IsString()
  sku: string;

  @IsString()
  nombreCorto: string;

  @IsString()
  @IsOptional()
  nombreLargo?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumber()
  precioVenta: number;

  @IsString()
  @IsOptional()
  categoria?: string;

  @IsString()
  @IsOptional()
  foto1?: string;

  @IsString()
  @IsOptional()
  foto2?: string;

  @IsString()
  @IsOptional()
  foto3?: string;

  @IsString()
  @IsOptional()
  foto4?: string;

  @IsString()
  @IsOptional()
  foto5?: string;
}
