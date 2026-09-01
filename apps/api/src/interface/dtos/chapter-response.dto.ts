import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ChapterMemberViewField } from '../../application/services/chapter-member-view';

/**
 * The response shape of `GET /v1/chapters/current` (#930).
 *
 * Before this existed the operation declared `content: never` in the generated
 * contract (`packages/api-sdk/src/types.ts`) — the route returned the whole
 * `chapters` row and the SDK typed it as nothing at all, which is the slice of
 * #1049 that applies to this endpoint. Declaring it does two jobs: clients get
 * a real type, and the fields a member may read become reviewable in the diff
 * instead of being an emergent property of `select('*')`.
 *
 * The runtime projection is `toChapterMemberView`; this class only describes
 * it. The two are pinned together by the compile-time guards at the bottom of
 * this file, so adding a column to one without the other does not compile.
 */
export class CurrentChapterResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  university: string;

  @ApiProperty({
    enum: ['incomplete', 'active', 'past_due', 'canceled'],
    description:
      'Read by the client subscription gate. Load-bearing — see `chapter-member-view.ts`.',
  })
  subscription_status: 'incomplete' | 'active' | 'past_due' | 'canceled';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Timestamp the chapter entered `past_due`, or null. Drives the 3-day client grace window; the grace predicate fails open without it.',
  })
  past_due_since: string | null;

  @ApiProperty({ type: String, nullable: true })
  accent_color: string | null;

  @ApiProperty({ type: String, nullable: true })
  logo_path: string | null;

  @ApiProperty({ type: String, nullable: true })
  donation_url: string | null;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiPropertyOptional()
  org_archetype?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  enabled_modules?: Record<string, boolean>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  vocabulary?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  branding?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  theme_palette?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Per-chapter opt-out for the pseudonymous analytics pipeline. Mobile reads it off this payload.',
  })
  analytics_opt_out?: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Signed URL for the chapter logo, or null when none is set or signing failed. Computed, not a column.',
  })
  logo_url: string | null;
}

/** One Signet §8 text-contrast check that came back below the 4.5:1 AA floor. */
export class FailedContrastCheckDto {
  @ApiProperty({
    description:
      'The Signet role that failed, e.g. `--signet-accent-text` or `--signet-accent-on-primary`.',
  })
  role: string;

  @ApiProperty({
    description:
      'What it was measured against — a hex background color, or another `--signet-*` role name.',
  })
  against: string;

  @ApiProperty({
    description: 'Measured contrast ratio. Below 4.5 to appear here.',
  })
  ratio: number;
}

/**
 * The response shape of `PATCH /v1/chapters/current` (#1183).
 *
 * Same member-safe projection as {@link CurrentChapterResponseDto} minus the
 * signed `logo_url` this route never computes, plus `failedContrastChecks` —
 * disclosure from the accent save this route triggers, not a `chapters`
 * column, so it sits outside `toChapterMemberView`'s allowlist rather than
 * being added to it.
 */
export class UpdateChapterResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  university: string;

  @ApiProperty({
    enum: ['incomplete', 'active', 'past_due', 'canceled'],
    description:
      'Read by the client subscription gate. Load-bearing — see `chapter-member-view.ts`.',
  })
  subscription_status: 'incomplete' | 'active' | 'past_due' | 'canceled';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Timestamp the chapter entered `past_due`, or null. Drives the 3-day client grace window; the grace predicate fails open without it.',
  })
  past_due_since: string | null;

  @ApiProperty({ type: String, nullable: true })
  accent_color: string | null;

  @ApiProperty({ type: String, nullable: true })
  logo_path: string | null;

  @ApiProperty({ type: String, nullable: true })
  donation_url: string | null;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiPropertyOptional()
  org_archetype?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  enabled_modules?: Record<string, boolean>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  vocabulary?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  branding?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  theme_palette?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Per-chapter opt-out for the pseudonymous analytics pipeline. Mobile reads it off this payload.',
  })
  analytics_opt_out?: boolean;

  @ApiProperty({
    type: [FailedContrastCheckDto],
    description:
      'Signet §8 contrast checks below AA for this save’s generated accent. Empty in the normal case; the save still succeeds when non-empty — this is disclosure, never a rejection.',
  })
  failedContrastChecks: FailedContrastCheckDto[];
}

/**
 * Compile-time drift guards between these DTOs and the runtime allowlist.
 *
 * Each resolves to `never` while the two agree. If they diverge, the alias
 * stops satisfying `Assert`'s constraint and the build fails naming the field
 * — which is the point: a column added to the projection but not documented
 * (or vice versa) is exactly the silent drift this issue is about.
 */
type Assert<T extends never> = T;

/** Allowlisted fields {@link CurrentChapterResponseDto} forgot to declare. Must be `never`. */
export type ChapterResponseDtoMissingFields = Assert<
  Exclude<ChapterMemberViewField, keyof CurrentChapterResponseDto>
>;

/** Fields {@link CurrentChapterResponseDto} declares that the projection does not emit. Must be `never`. */
export type ChapterResponseDtoExtraFields = Assert<
  Exclude<keyof CurrentChapterResponseDto, ChapterMemberViewField | 'logo_url'>
>;

/** Allowlisted fields {@link UpdateChapterResponseDto} forgot to declare. Must be `never`. */
export type UpdateChapterResponseDtoMissingFields = Assert<
  Exclude<ChapterMemberViewField, keyof UpdateChapterResponseDto>
>;

/** Fields {@link UpdateChapterResponseDto} declares that the projection does not emit. Must be `never`. */
export type UpdateChapterResponseDtoExtraFields = Assert<
  Exclude<
    keyof UpdateChapterResponseDto,
    ChapterMemberViewField | 'failedContrastChecks'
  >
>;
