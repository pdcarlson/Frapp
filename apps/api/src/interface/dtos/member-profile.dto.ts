import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberCustomFieldValueDto } from './custom-field.dto';

export class MemberProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty({ type: [String] })
  role_ids: string[];

  @ApiProperty({ type: [String] })
  custom_role_ids: string[];

  @ApiProperty()
  has_completed_onboarding: boolean;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiProperty()
  display_name: string;

  @ApiProperty({ type: String, nullable: true })
  avatar_url: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty({ type: Number, nullable: true })
  graduation_year: number | null;

  @ApiProperty({ type: String, nullable: true })
  current_city: string | null;

  @ApiProperty({ type: String, nullable: true })
  current_company: string | null;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({
    type: MemberCustomFieldValueDto,
    isArray: true,
    description:
      'Custom-field values, present only on single-member reads and ' +
      'already filtered to the fields the requesting viewer may see.',
  })
  custom_fields?: MemberCustomFieldValueDto[];
}

/**
 * The chapter roster projected to display fields only — `GET /v1/members/roster`.
 *
 * Deliberately three fields wide. Chat resolves message authors and DM titles
 * on the client by `users.id`, and {@link MemberProfileDto} would put the whole
 * chapter's `email`/`bio`/`graduation_year`/`current_city`/`current_company` on
 * every member's device to render a name (#1000, #986).
 *
 * Carrying a real response DTO is load-bearing rather than tidy: without one the
 * exporter records a bare `200` with no schema and `openapi-typescript` infers
 * the body as `never`, which is exactly why the mobile channel selectors
 * hand-parse `unknown` today. This route ships typed.
 */
export class MemberRosterEntryDto {
  @ApiProperty({ description: 'users.id — the id chat carries as sender_id' })
  user_id: string;

  @ApiProperty({
    description:
      "May be an empty string: the column is NOT NULL DEFAULT '', so clients " +
      'treat empty as unresolved rather than rendering a blank name.',
  })
  display_name: string;

  /**
   * Served but not yet read by either client: both chat surfaces draw initials of
   * the resolved name, which is what `components.md` specifies. Kept because it
   * is part of a display identity and an image avatar would otherwise need a
   * contract change — but it is the one field here with no consumer today.
   */
  @ApiProperty({ type: String, nullable: true })
  avatar_url: string | null;
}
