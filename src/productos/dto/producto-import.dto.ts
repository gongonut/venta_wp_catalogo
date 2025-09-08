import { IsString, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class ProductoImportDto {
  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsNotEmpty()
  nombreCorto: string;

  @IsString()
  @IsOptional()
  nombreLargo?: string;

  @IsString()
  @IsOptional()
  categoria?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  existencia?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  costo?: number;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  precioVenta: number;

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
