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
import { POINTS_WINDOWS, type PointsWindow } from '#domain/utils/points-window';
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from '@repo/validation';
import type { PointTransaction } from '#domain/entities/point-transaction.entity';

/**
 * The only two categories `POST /v1/points/adjust` can write. Shared by the
 * request and the response DTOs because they are necessarily the same set — the
 * service stores `input.category` unchanged — so the published response contract
 * cannot drift into advertising categories this route never produces.
 *
 * Deliberately NOT the full `PointCategory` union: `ATTENDANCE`, `ACADEMIC`,
 * `SERVICE` and `STUDY` rows are written by other flows, never by this one.
 */
const ADJUSTABLE_CATEGORIES = ['MANUAL', 'FINE'] as const;

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

  @ApiProperty({ enum: ADJUSTABLE_CATEGORIES })
  @IsEnum(ADJUSTABLE_CATEGORIES)
  category: (typeof ADJUSTABLE_CATEGORIES)[number];

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
      'Client-generated idempotency key (UUIDv4) for this adjustment. It dedupes the ledger row as well as the chat card: replaying it returns the original transaction rather than granting again, so a request whose response was lost is safe to retry **verbatim** — reusing this id, not a fresh one. Reusing it for a different adjustment answers 409. Required alongside `channel_id`; omit both for dashboard adjustments. Full contract: `spec/behavior/points.md` § Anti-Fraud.',
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
 * flattened at the top level exactly as the route already returned them.
 *
 * Drift between this class and the ledger row is caught by two mechanisms that
 * catch different things, so both are kept:
 *   - `implements PointTransaction` catches **type** drift — a field whose type
 *     changed under us stops being assignable and fails to compile. It does NOT
 *     catch key drift: an extra member is always legal, and `implements` cannot
 *     require an **optional** one.
 *   - the `Assert<Exclude<…>>` aliases at the bottom of this file catch **key**
 *     drift in both directions, and name the offending field in the error. Same
 *     device as `chapter-response.dto.ts`, for the same reason.
 *
 * The optional-field hole is why they are here rather than in a follow-up. #1719
 * added `client_message_id?: string | null` to `PointTransaction` while this
 * branch was open and every gate stayed green with the field missing from this
 * class. `check:api-contract` cannot see that class of drift even in principle:
 * it regenerates the artifacts and diffs them, and `PointTransaction` carries no
 * Swagger decorators, so a field added there cannot change what is emitted. It
 * was caught by hand, once, during a merge.
 *
 * A narrower `category` still satisfies the interface — `keyof` is indifferent
 * to value types — which is what makes the honest two-value enum below
 * compatible with the domain's six-value union.
 */
export class AdjustPointsResponseDto implements PointTransaction {
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

  // Only the two this route can write — see ADJUSTABLE_CATEGORIES. Publishing
  // the full six-value union would tell every SDK consumer to write four
  // unreachable branches, and would contradict `spec/behavior/points.md`
  // § Admin Adjustments, which says manual adjustments are MANUAL or FINE only.
  // (Not § Chapter-wide transaction list, a few screens down, which lists all
  // six because it describes the ledger rather than this route.)
  @ApiProperty({ enum: ADJUSTABLE_CATEGORIES })
  category: (typeof ADJUSTABLE_CATEGORIES)[number];

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

  // Echoed back so a caller can match the row it got to the key it sent — which
  // is the whole point of a replay returning the ORIGINAL transaction rather
  // than a new one (#1719). `null` for dashboard adjustments, which send no key.
  // `type: String` AND `format: 'uuid'` must BOTH be explicit. With only
  // `format` + `nullable`, Swagger's reflection cannot pick a primitive for
  // `string | null` and publishes `type: "object"`, which openapi-typescript
  // renders as `Record<string, never> | null` — a uuid the SDK types as an
  // empty object. `tsc` cannot see it; only regenerating the artifacts
  // (`npm run check:api-contract`) can. `UpdateChannelDto.category_id` in
  // `chat.dto.ts` carries the same pair and documents the mirror image of this
  // quirk: there `type` was present and `format` was the missing half.
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The idempotency key this row was written under, echoed back. `null` for dashboard adjustments, which send no key and are not deduplicated.',
  })
  client_message_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the ledger row committed and the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — drop it and warn, without implying the adjustment failed. Absent means the server reported no outcome (a dashboard adjustment, or a deduplicated replay) — leave the placeholder for the echo. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
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

/**
 * Compile-time key-drift guards between {@link AdjustPointsResponseDto} and the
 * ledger row it publishes. Each resolves to `never` while the two agree; when
 * they diverge the alias stops satisfying `Assert`'s constraint and the build
 * fails naming the field.
 */
type Assert<T extends never> = T;

/** Ledger fields {@link AdjustPointsResponseDto} forgot to declare. Must be `never`. */
export type AdjustPointsResponseDtoMissingFields = Assert<
  Exclude<keyof PointTransaction, keyof AdjustPointsResponseDto>
>;

/**
 * Fields {@link AdjustPointsResponseDto} declares that the ledger row does not
 * carry. Must be `never`. `card_posted` is excluded because it is this route's
 * own outcome flag, not a column — the one deliberate addition.
 */
export type AdjustPointsResponseDtoExtraFields = Assert<
  Exclude<keyof AdjustPointsResponseDto, keyof PointTransaction | 'card_posted'>
>;
