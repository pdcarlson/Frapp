import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanQueryString } from '../decorators/is-boolean-query-string.decorator';
import type { BooleanStringQueryValue } from '../utils/query-boolean';
import {
  POINTS_WINDOWS,
  type PointsWindow,
} from '../../domain/utils/points-window';
import { POINTS_ADJUSTMENT_MAX } from '../../domain/constants/field-limits';

export class AdjustPointsDto {
  // UUID-validated for the reason UpdateMemberRolesDto.custom_role_ids is: the
  // ledger insert puts this straight into a uuid FK, so a malformed id fails in
  // Postgres and surfaces as a 500 instead of the 400 it is.
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  target_user_id: string;

  // Bounded on both sides. The service only *flags* large adjustments against
  // the anomaly threshold (points.service.ts) — it never rejects them — so
  // without a ceiling the negative bound below was the only real limit and a
  // single call could write an arbitrarily large balance.
  @ApiProperty({
    minimum: -POINTS_ADJUSTMENT_MAX,
    maximum: POINTS_ADJUSTMENT_MAX,
  })
  @IsInt()
  @Min(-POINTS_ADJUSTMENT_MAX)
  @Max(POINTS_ADJUSTMENT_MAX)
  amount: number;

  @ApiProperty({ enum: ['MANUAL', 'FINE'] })
  @IsEnum(['MANUAL', 'FINE'])
  category: 'MANUAL' | 'FINE';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts an append-only points card to this chat channel after the ledger write (the `/points` slash command). Omit for dashboard adjustments.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

export class PointsWindowQueryDto {
  @ApiPropertyOptional({ enum: [...POINTS_WINDOWS], default: 'all' })
  @IsOptional()
  @IsEnum(POINTS_WINDOWS)
  window?: PointsWindow;
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
  @ApiPropertyOptional({
    description: 'Filter to a single member',
    format: 'uuid',
  })
  @IsOptional()
  // Same rule as AdjustPointsDto.target_user_id: this reaches
  // `.eq('user_id', …)` on a uuid column, so an unvalidated string fails in
  // Postgres as a 500 rather than here as a 400.
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_CATEGORIES })
  @IsOptional()
  @IsEnum(TRANSACTION_CATEGORIES)
  category?: (typeof TRANSACTION_CATEGORIES)[number];

  @ApiPropertyOptional({
    description:
      'Only return transactions flagged by the anomaly threshold. Boolean string: `true`, `false`, `1`, or `0`.',
    enum: ['true', 'false', '1', '0'],
  })
  @IsOptional()
  @IsBooleanQueryString()
  flagged?: BooleanStringQueryValue;

  @ApiPropertyOptional({
    description:
      'ISO8601 cursor — return transactions created before this timestamp',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({
    description:
      'Max transactions to return. Integers are clamped to 1–200 inclusive; omitted defaults to 50.',
    minimum: 1,
    maximum: 200,
    default: 50,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
