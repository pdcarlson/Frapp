import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for a `chapter_custom_fields` row (definition). Write CRUD for
 * these lands with the Settings → Fields tab (#539); this contract is the
 * read model the member directory consumes.
 */
export class CustomFieldDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty({
    enum: ['text', 'number', 'decimal', 'phone', 'select', 'boolean'],
  })
  type: string;

  @ApiProperty()
  required: boolean;

  @ApiProperty({ enum: ['self', 'chapter', 'exec', 'president'] })
  visibility: string;

  @ApiProperty()
  sensitive: boolean;

  @ApiProperty({ type: [String], nullable: true })
  options: string[] | null;

  @ApiProperty()
  sort: number;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

/**
 * A member's value for a custom field, already filtered server-side to the
 * fields the requesting viewer may see. `value` is null when the member has no
 * value set for an (otherwise visible) field.
 */
export class MemberCustomFieldValueDto {
  @ApiProperty()
  field_id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty({
    enum: ['text', 'number', 'decimal', 'phone', 'select', 'boolean'],
  })
  type: string;

  @ApiProperty({ enum: ['self', 'chapter', 'exec', 'president'] })
  visibility: string;

  @ApiProperty({ type: String, nullable: true })
  value: string | null;
}
