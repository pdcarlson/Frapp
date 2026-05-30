import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackEventDto {
  @ApiProperty({
    description:
      'Behavioral event name in kebab-case, e.g. "opened-channel", "ran-slash-command". Must describe behavior, never content.',
    example: 'opened-channel',
  })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'name must be kebab-case (lowercase letters, digits, hyphens)',
  })
  name: string;

  @ApiPropertyOptional({
    description:
      'Chapter the event is attributed to (enables the opt-out gate)',
  })
  @IsOptional()
  @IsUUID()
  chapter_id?: string;

  @ApiPropertyOptional({
    description:
      'Behavioral, content-free properties. Keys that look like content/PII (content, body, email, name, …) are rejected.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  properties?: Record<string, string | number | boolean | null>;
}
