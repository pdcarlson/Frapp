import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Rejects analytics properties whose values are not scalars. `@IsObject` only
 * guards the top level, so a nested object/array (`{ meta: { body: "…" } }`)
 * would otherwise slip content past the forbidden-key check.
 */
@ValidatorConstraint({ name: 'analyticsScalarsOnly', async: false })
export class ScalarsOnlyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every(
      (entry) =>
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean',
    );
  }

  defaultMessage(): string {
    return 'properties values must be scalars (string, number, boolean, or null)';
  }
}

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
      'Behavioral, content-free properties. Values must be scalars (string/number/boolean/null); keys that look like content/PII (content, body, email, name, …) are rejected.',
    type: 'object',
    additionalProperties: {
      nullable: true,
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
  })
  @IsOptional()
  @IsObject()
  @Validate(ScalarsOnlyConstraint)
  properties?: Record<string, string | number | boolean | null>;
}

export class IdentityResponseDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Pseudonymous analytics id (HMAC of the user id), or null when analytics is unconfigured.',
  })
  distinct_id: string | null;

  @ApiProperty({ description: 'Whether analytics is enabled for this caller.' })
  enabled: boolean;
}

export class TrackEventResponseDto {
  @ApiProperty()
  success: boolean;
}
