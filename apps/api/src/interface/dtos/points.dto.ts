import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
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

const TRANSACTION_CATEGORIES = [
  'ATTENDANCE',
  'ACADEMIC',
  'SERVICE',
  'FINE',
  'MANUAL',
  'STUDY',
] as const;

export class ListPointTransactionsQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single member' })
  @IsOptional()
  @IsString()
  user_id?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_CATEGORIES })
  @IsOptional()
  @IsEnum(TRANSACTION_CATEGORIES)
  category?: (typeof TRANSACTION_CATEGORIES)[number];

  @ApiPropertyOptional({
    description:
      "Only return transactions that were flagged by the anomaly threshold (`metadata.flagged === true`). Accepts 'true' or 'false'.",
  })
  @IsOptional()
  @IsBooleanString()
  flagged?: 'true' | 'false';

  @ApiPropertyOptional({
    description:
      'ISO8601 cursor — return transactions created before this timestamp',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({
    description:
      'Max transactions to return (1-200, defaults to 50). Values outside that range are rejected.',
    minimum: 1,
    maximum: 200,
    default: 50,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
