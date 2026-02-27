import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdjustPointsDto {
  @ApiProperty()
  @IsString()
  target_user_id: string;

  @ApiProperty()
  @IsInt()
  @Min(-100000)
  amount: number;

  @ApiProperty({ enum: ['MANUAL', 'FINE'] })
  @IsEnum(['MANUAL', 'FINE'])
  category: 'MANUAL' | 'FINE';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class PointsWindowQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'semester', 'month'], default: 'all' })
  @IsOptional()
  @IsEnum(['all', 'semester', 'month'])
  window?: 'all' | 'semester' | 'month';
}
