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

/**
 * Compile-time drift guards between this DTO and the runtime allowlist.
 *
 * Each resolves to `never` while the two agree. If they diverge, the alias
 * stops satisfying `Assert`'s constraint and the build fails naming the field
 * — which is the point: a column added to the projection but not documented
 * (or vice versa) is exactly the silent drift this issue is about.
 */
type Assert<T extends never> = T;

/** Allowlisted fields this DTO forgot to declare. Must be `never`. */
export type ChapterResponseDtoMissingFields = Assert<
  Exclude<ChapterMemberViewField, keyof CurrentChapterResponseDto>
>;

/** Fields this DTO declares that the projection does not emit. Must be `never`. */
export type ChapterResponseDtoExtraFields = Assert<
  Exclude<keyof CurrentChapterResponseDto, ChapterMemberViewField | 'logo_url'>
>;
