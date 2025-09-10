import { IsString, IsNotEmpty, IsOptional, IsEmail, IsMongoId } from 'class-validator';

export class CreateEmpresaDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsNotEmpty()
  whatsApp: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  direccion?: string;

  // geoUbicacion, saludoBienvenida, and saludoDespedida can be optional
  @IsOptional()
  geoUbicacion?: {
    type: string;
    coordinates: number[];
  };

  @IsString()
  @IsOptional()
  saludoBienvenida?: string;

  @IsString()
  @IsOptional()
  saludoDespedida?: string;

  @IsOptional()
  categorias?: string[];
}