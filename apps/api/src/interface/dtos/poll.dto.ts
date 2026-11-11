import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  POLL_OPTION_MAX_LENGTH,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX_LENGTH,
} from '@repo/validation';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanQueryString } from '../decorators/is-boolean-query-string.decorator';
import type { BooleanStringQueryValue } from '../utils/query-boolean';

/** A calendar date and time with a zone: what `Date` parses on every runtime. */
const EXPIRES_AT_FORMAT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class CreatePollDto {
  @ApiProperty({ description: 'Poll question' })
  @IsString()
  @MinLength(1)
  @MaxLength(POLL_QUESTION_MAX_LENGTH)
  question: string;

  @ApiProperty({
    description: `Poll options (${POLL_OPTIONS_MIN}-${POLL_OPTIONS_MAX})`,
    type: [String],
    example: ['Option A', 'Option B'],
  })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(POLL_OPTION_MAX_LENGTH, { each: true })
  options: string[];

  @ApiPropertyOptional({
    description: 'Expiration time (ISO 8601)',
  })
  @IsOptional()
  // A string the expiry sweep can't parse used to be stored, then logged as
  // `poll-expiry-sweep-unparseable-expires-at` every five minutes for a day
  // (#3498). Refused here instead. ISO 8601 alone isn't enough: week dates
  // (`2026-W46-4`), ordinal dates (`2026-316`) and the basic format
  // (`20261201`) are ISO 8601 that `Date` can't parse, so the value must be a
  // calendar date and time with a zone, and a real date (`strict` refuses
  // `2026-02-30`). `PollService` stores it in UTC, the form the sweep's text
  // comparison needs.
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(EXPIRES_AT_FORMAT, {
    message:
      'expires_at must be a date and time with a time zone, such as 2026-11-12T18:00:00Z',
  })
  expires_at?: string;

  @ApiPropertyOptional({ enum: ['single', 'multi'], default: 'single' })
  @IsOptional()
  @IsIn(['single', 'multi'])
  choice_mode?: 'single' | 'multi';
}

export class VoteDto {
  @ApiProperty({
    description:
      'Option index(es) to vote for. Single choice: [0]. Multi choice: [0, 1].',
    type: [Number],
    example: [0],
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(POLL_OPTIONS_MAX - 1, { each: true })
  option_indexes: number[];
}

export class ListPollsQueryDto {
  @ApiPropertyOptional({
    description: 'Scope results to a single channel.',
    format: 'uuid',
  })
  @IsOptional()
  // Reaches `.eq('channel_id', …)` on a uuid column; an unvalidated string
  // fails in Postgres as a 500 rather than here as a 400.
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      "Filter by expiration. Boolean string: `true`, `false`, `1`, or `0`. True values return only polls that haven't expired; false values return only expired polls.",
    enum: ['true', 'false', '1', '0'],
  })
  @IsOptional()
  @IsBooleanQueryString()
  active?: BooleanStringQueryValue;

  @ApiPropertyOptional({
    description:
      'Max polls to return. Integers are clamped to 1–200 inclusive; omitted defaults to 50.',
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
