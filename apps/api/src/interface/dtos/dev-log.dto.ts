import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { INT4_MAX } from '#domain/constants/field-limits';
import {
  DEV_LOG_EVENTS,
  type DevLogEvent,
} from '../../application/services/dev-log.service';

const TITLE_MAX = 300;
const ACTOR_MAX = 80;
const AREA_MAX = 40;
const AREAS_MAX = 10;
/** Enough for a busy day; the post is cut at the chat length cap anyway. */
const SUMMARY_ITEMS_MAX = 60;
const MERGED_BY_MAX = 30;
const MERGED_TOTAL_MAX = 10_000;
const ALSO_IN_AREA_MAX = 5;

const isOneOf =
  (...events: DevLogEvent[]) =>
  (dto: DevLogPostDto) =>
    events.includes(dto.event);

export class DevLogItemDto {
  @ApiProperty({ description: 'The issue or pull request number.' })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  number: number;

  @ApiProperty({ maxLength: TITLE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  title: string;

  @ApiPropertyOptional({ maxLength: ACTOR_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ACTOR_MAX)
  actor?: string;

  @ApiPropertyOptional({ type: [String], maxItems: AREAS_MAX })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AREAS_MAX)
  @IsString({ each: true })
  @MaxLength(AREA_MAX, { each: true })
  areas?: string[];
}

export class DevLogMergeCountDto {
  @ApiProperty({ maxLength: ACTOR_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ACTOR_MAX)
  actor: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(MERGED_TOTAL_MAX)
  count: number;
}

/**
 * One Dev log post (#4145). The caller sends facts, never the words or a link:
 * the API writes the sentence and builds every link from the number, so the
 * token cannot be used to post arbitrary text or a link to anywhere else.
 * Which fields an event reads is in each description; the rest are ignored.
 */
export class DevLogPostDto {
  @ApiProperty({ enum: DEV_LOG_EVENTS })
  @IsIn(DEV_LOG_EVENTS)
  event: DevLogEvent;

  @ApiPropertyOptional({
    description:
      'work_started: the issue number. pr_merged: the pull request number.',
  })
  @ValidateIf(isOneOf('work_started', 'pr_merged'))
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  number?: number;

  @ApiPropertyOptional({
    maxLength: TITLE_MAX,
    description: 'work_started, pr_merged: the issue or pull request title.',
  })
  @ValidateIf(isOneOf('work_started', 'pr_merged'))
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({
    maxLength: ACTOR_MAX,
    description: 'work_started, pr_merged: who did it, as a name or a login.',
  })
  @ValidateIf(isOneOf('work_started', 'pr_merged'))
  @IsString()
  @MinLength(1)
  @MaxLength(ACTOR_MAX)
  actor?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: AREAS_MAX,
    description: "work_started: the issue's area labels, without the prefix.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AREAS_MAX)
  @IsString({ each: true })
  @MaxLength(AREA_MAX, { each: true })
  areas?: string[];

  @ApiPropertyOptional({
    type: [DevLogItemDto],
    maxItems: ALSO_IN_AREA_MAX,
    description:
      'work_started: other issues in progress that share one of the areas.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALSO_IN_AREA_MAX)
  @ValidateNested({ each: true })
  @Type(() => DevLogItemDto)
  also_in_area?: DevLogItemDto[];

  @ApiPropertyOptional({
    example: '2026-11-11',
    description: 'daily_summary: the day it is posted. One post per day.',
  })
  @ValidateIf(isOneOf('daily_summary'))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({
    description:
      'daily_summary: how many pull requests merged in the last day.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MERGED_TOTAL_MAX)
  merged_total?: number;

  @ApiPropertyOptional({
    type: [DevLogMergeCountDto],
    maxItems: MERGED_BY_MAX,
    description: 'daily_summary: that total, per person.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MERGED_BY_MAX)
  @ValidateNested({ each: true })
  @Type(() => DevLogMergeCountDto)
  merged_by?: DevLogMergeCountDto[];

  @ApiPropertyOptional({
    type: [DevLogItemDto],
    maxItems: SUMMARY_ITEMS_MAX,
    description: 'daily_summary: issues in progress now.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUMMARY_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => DevLogItemDto)
  in_progress?: DevLogItemDto[];

  @ApiPropertyOptional({
    description:
      'update_pushed: the id of the Deploy production run that shipped. One post per run.',
  })
  @ValidateIf(isOneOf('update_pushed'))
  // Digits as a string: run ids are already past what an int4 holds, and
  // this one is only ever part of the post's dedupe key.
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  run_id?: string;

  @ApiPropertyOptional({
    description:
      'update_pushed: that run also uploaded a store build for testers.',
  })
  @IsOptional()
  @IsBoolean()
  store_build?: boolean;

  @ApiPropertyOptional({
    description:
      'update_pushed: that run also published an over-the-air update.',
  })
  @IsOptional()
  @IsBoolean()
  ota_update?: boolean;
}

export class DevLogPostResultDto {
  @ApiProperty({
    enum: ['posted', 'duplicate'],
    description:
      'duplicate: this event was already posted (the same issue, pull request, day or commit), so nothing was written.',
  })
  status: 'posted' | 'duplicate';
}
