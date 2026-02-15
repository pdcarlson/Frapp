import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustPointsDto {
  @ApiProperty({ example: 'u1-uuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'SERVICE' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: 'Helped with kitchen cleaning' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ required: false })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
