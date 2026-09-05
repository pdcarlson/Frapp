import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
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
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from '@repo/validation';

// Declared above its first use so `AdjustPointsResponseDto`'s decorator can read
// it — decorators evaluate at class-definition time, so a `const` declared
// further down the file would be in the temporal dead zone.
const TRANSACTION_CATEGORIES = [
  'ATTENDANCE',
  'ACADEMIC',
  'SERVICE',
  'FINE',
  'MANUAL',
  'STUDY',
] as const;

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

  // Capped because this is interpolated into the points chat card's content
  // and posted through PointsService directly, bypassing SendMessageDto's cap.
  @ApiProperty({ maxLength: POINTS_REASON_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(POINTS_REASON_MAX_LENGTH)
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

/**
 * Response contract for `POST /v1/points/adjust`.
 *
 * This route previously declared no response schema, which openapi-typescript
 * renders as `content?: never` — so `data` reached the SDK typed `never` and no
 * client could read a response field without an unchecked cast. Declaring it is
 * what lets `/points` see `card_posted` (#544); the transaction fields are
 * flattened at the top level exactly as the route already returned them, so
 * this documents the existing body rather than changing it.
 */
export class AdjustPointsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  /** The member the points were awarded to or deducted from. */
  @ApiProperty({ format: 'uuid' })
  user_id: string;

  /** Signed: positive for a grant, negative for a fine. */
  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: TRANSACTION_CATEGORIES })
  category: (typeof TRANSACTION_CATEGORIES)[number];

  /** The adjustment reason, stored as the ledger row's description. */
  @ApiProperty()
  description: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Adjustment metadata — `adjusted_by`, `reason`, and `flagged` when the amount met the chapter anomaly threshold.',
  })
  metadata: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Present ONLY when `channel_id` + `client_message_id` were supplied. `false` means the ledger row committed but the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — the caller should drop it and warn. Absent for dashboard adjustments, which post no card.',
  })
  card_posted?: boolean;
}

export class PointsWindowQueryDto {
  @ApiPropertyOptional({ enum: [...POINTS_WINDOWS], default: 'all' })
  @IsOptional()
  @IsEnum(POINTS_WINDOWS)
  window?: PointsWindow;

  @ApiPropertyOptional({
    description:
      'Select one specific archived semester by id (from GET /v1/semesters), overriding `window` entirely. 404s if the id does not belong to this chapter.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  semester_archive_id?: string;
}

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
