import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ListChapterAuditLogQueryDto {
  @ApiPropertyOptional({
    description:
      'ISO8601 cursor — return audit entries created before this timestamp',
  })
  @IsOptional()
  @IsISO8601()
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
