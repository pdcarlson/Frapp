import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  ISO_INSTANT_MESSAGE,
  ISO_INSTANT_PATTERN,
  ISO_INSTANT_REGEX,
} from '#domain/constants/iso-instant';
import { Type } from 'class-transformer';

export class ListChapterAuditLogQueryDto {
  @ApiPropertyOptional({
    description: 'Filter to entries written by a single actor',
    format: 'uuid',
  })
  @IsOptional()
  // Same rule as ListPointTransactionsQueryDto.user_id: this reaches
  // `.eq('actor_user_id', …)` on a uuid column, so an unvalidated string
  // fails in Postgres as a 500 rather than here as a 400. Note this also
  // means system-written rows (`actor_user_id is null`, e.g. the
  // `president_orphaned` entries rbac.service.ts writes) cannot be selected
  // by this filter — filtering by actor means filtering by a real actor.
  @IsUUID()
  actor_user_id?: string;

  @ApiPropertyOptional({
    description:
      'Filter to a single action verb, e.g. `member_removed`. Matched exactly; an unknown verb returns an empty list.',
    example: 'member_removed',
  })
  @IsOptional()
  // Free string, not an enum, and deliberately so: `chapter_audit_log.action`
  // is bare `text` with no CHECK, there is no action-name constant, and the
  // writers pass literals. An enum in the contract would reject any verb a
  // future writer adds. Bounded because the constraint-coverage lint requires
  // a real validator, and an unbounded query string is a free scan.
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on `created_at`. Full ISO 8601 timestamp with an explicit UTC offset — a bare date is rejected rather than read as midnight. Filters the range; pair with `before` to page within it.',
    example: '2026-01-01T00:00:00.000Z',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  start_date?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on `created_at`. Full ISO 8601 timestamp with an explicit UTC offset — send `…T23:59:59.999Z` for a whole final day rather than a bare date. Unlike `before`, this bounds the range rather than moving with pagination.',
    example: '2026-01-31T23:59:59.999Z',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  end_date?: string;

  // `before` is the pagination CURSOR, not the range's upper bound — that is
  // `end_date`. They both narrow `created_at` from above and compose as an
  // intersection, but only one of them moves as the caller pages: the range
  // stays fixed while `before` walks down it. Collapsing them would mean
  // paging mutates the filter.
  @ApiPropertyOptional({
    description:
      'Cursor — return audit entries created strictly before this timestamp. Full ISO 8601 with an explicit UTC offset; feed back the `created_at` of the oldest row you received.',
    example: '2026-01-31T23:59:59.999999+00:00',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  before?: string;

  @ApiPropertyOptional({
    description:
      'Max entries to return. Integers are clamped to 1–200 inclusive; omitted defaults to 50.',
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

/** Response shape for `GET /audit-log` — mirrors the `chapter_audit_log` entity. */
export class ChapterAuditLogEntryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty({ type: String, nullable: true })
  actor_user_id: string | null;

  @ApiProperty({ description: 'Verb, e.g. `member_removed`' })
  action: string;

  @ApiProperty()
  target_type: string;

  @ApiProperty({ type: String, nullable: true })
  target_id: string | null;

  @ApiProperty()
  scope: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Before/after payload for the change',
  })
  diff: Record<string, unknown>;

  @ApiProperty()
  member_visible: boolean;

  @ApiProperty()
  created_at: string;
}
