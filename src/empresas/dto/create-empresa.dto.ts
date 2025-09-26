import { IsString, IsNotEmpty, IsOptional, IsEmail, IsUrl, IsEnum, IsNumber, IsBoolean } from 'class-validator';
import { EmpresaTipo } from '../enums/empresa-tipo.enum';
import { PaisCodigo } from '../enums/pais-codigo.enum';
import { TipoWebPg } from '../enums/tipo-web-pg.enum';

export class CreateEmpresaDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsUrl()
  @IsOptional()
  logo?: string;

  @IsString()
  @IsOptional()
  leitmotiv?: string;

  @IsEnum(EmpresaTipo)
  @IsOptional()
  empresaTipo?: EmpresaTipo;

  @IsEnum(PaisCodigo)
  @IsNotEmpty()
  codigoPais: PaisCodigo;

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

  @IsNumber()
  @IsOptional()
  areaInfluencia?: number;

  @IsBoolean()
  @IsOptional()
  opcionIA?: boolean;

  @IsEnum(TipoWebPg)
  @IsOptional()
  tipoWebPg?: TipoWebPg;

  @IsString()
  @IsOptional()
  saludoBienvenida?: string;

  @IsString()
  @IsOptional()
  saludoDespedida?: string;

  @IsOptional()
  categorias?: string[];
}