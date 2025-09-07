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
}
