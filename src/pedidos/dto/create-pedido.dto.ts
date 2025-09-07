import { IsString, IsMongoId, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class PedidoItemDto {
  @IsString()
  sku: string;

  @IsNumber()
  cantidad: number;
}

export class CreatePedidoDto {
  @IsMongoId()
  empresaId: string;

  @IsMongoId()
  clienteId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PedidoItemDto)
  items: PedidoItemDto[];

  @IsNumber()
  totalPrecio: number;
}
