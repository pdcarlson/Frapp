import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '@repo/validation';
import type { ServiceEntry } from '#domain/entities/service-entry.entity';

export class CreateServiceEntryDto {
  @ApiProperty({ description: 'Date of service (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiProperty({
    description: 'Duration in minutes',
    minimum: 1,
    example: 60,
  })
  @IsInt()
  @Min(1)
  // Bounds the SERVICE ledger row, and does so provably: the award is
  // `floor(duration_minutes / minutesPerPoint)` and minutesPerPoint is @Min(1),
  // so the row can never exceed this number. Submitting a service entry needs
  // no special grant, which makes this the widest-open ledger input of all.
  // 100,000 minutes is ~69 days for a single entry — far beyond any real one.
  @Max(POINTS_ADJUSTMENT_MAX)
  duration_minutes: number;

  @ApiProperty({ description: 'Description of the service performed' })
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({
    description: 'Storage path to proof file (e.g. from upload)',
  })
  @IsOptional()
  @IsString()
  proof_path?: string;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts a read-only hours card to this chat channel after the entry is created (the `/hours log` slash command). Omit for dashboard creates. Chat cannot attach proof — when `wf_hours_receipt` is on, this route still 400s without `proof_path`.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`. Not a server-side dedupe key — a replay creates a duplicate entry.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

/**
 * Response contract for `POST /v1/service-entries`.
 *
 * This route previously declared no response schema, which openapi-typescript
 * renders as `content?: never` — so `data` reached the SDK typed `never` and
 * `/hours` could not read `card_posted` without an unchecked cast (same
 * defect as `/task`, #1717). The entry fields are flattened at the top level
 * exactly as the route already returned them.
 *
 * Drift between this class and the service-entry row is caught the same way
 * as `CreateTaskResponseDto`: `implements ServiceEntry` for type drift, and
 * the `Assert<Exclude<…>>` aliases below for key drift. `card_posted` is the
 * one deliberate extra field.
 */
export class CreateServiceEntryResponseDto implements ServiceEntry {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty({ format: 'date' })
  date: string;

  @ApiProperty()
  duration_minutes: number;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: String, nullable: true })
  proof_path: string | null;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reviewed_by: string | null;

  @ApiProperty({ type: String, nullable: true })
  review_comment: string | null;

  @ApiProperty()
  points_awarded: boolean;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the entry row committed and the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — drop it and warn, without implying the create failed. Absent means the server reported no outcome (a dashboard create, or a request that did not attempt a card) — leave the placeholder for the echo. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
  })
  card_posted?: boolean;
}

export class RequestProofUploadUrlDto {
  @ApiProperty({ description: 'Original filename (image or PDF)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. application/pdf)' })
  @IsString()
  content_type: string;

  @ApiPropertyOptional({
    description:
      'File size in bytes, if known. Rejected server-side against the upload size ceiling when present.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  size_bytes?: number;
}

export class ProofUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description: 'Storage path to send as proof_path on the create call.',
  })
  storage_path: string;

  @ApiProperty({
    description: 'Server-allocated proof id embedded in storage_path.',
  })
  proof_id: string;
}

/**
 * Filters for the admin service-entry queue. Every field is optional; the
 * unfiltered call is the previous behavior.
 *
 * Non-admins never reach these — the controller narrows their read to their
 * own entries before any filter is applied — so a member cannot use
 * `userId` to read someone else's history.
 */
export class ListServiceEntriesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on the service date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on the service date (YYYY-MM-DD)',
    example: '2026-05-31',
  })
  @IsOptional()
  @IsString()
  end_date?: string;

  @ApiPropertyOptional({
    description: 'Filter by member (admins with service:approve only)',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

/** Optional date window for the service leaderboard; omitted means all-time. */
export class ServiceLeaderboardQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive lower bound on the service date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on the service date (YYYY-MM-DD)',
    example: '2026-05-31',
  })
  @IsOptional()
  @IsString()
  end_date?: string;
}

export class ReviewServiceEntryDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Optional comment for the member (especially on rejection)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  review_comment?: string;
}

/**
 * Compile-time key-drift guards between {@link CreateServiceEntryResponseDto}
 * and the service-entry row it publishes. Each resolves to `never` while the
 * two agree; when they diverge the alias stops satisfying `Assert`'s
 * constraint and the build fails naming the field.
 */
type Assert<T extends never> = T;

/** Entry fields {@link CreateServiceEntryResponseDto} forgot to declare. Must be `never`. */
export type CreateServiceEntryResponseDtoMissingFields = Assert<
  Exclude<keyof ServiceEntry, keyof CreateServiceEntryResponseDto>
>;

/**
 * Fields {@link CreateServiceEntryResponseDto} declares that the entry row
 * does not carry. Must be `never`. `card_posted` is excluded because it is
 * this route's own outcome flag, not a column — the one deliberate addition.
 */
export type CreateServiceEntryResponseDtoExtraFields = Assert<
  Exclude<
    keyof CreateServiceEntryResponseDto,
    keyof ServiceEntry | 'card_posted'
  >
>;
