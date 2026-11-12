import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
} from '@repo/validation';
import {
  AI_SUGGESTION_KINDS,
  AI_SUGGESTION_SOURCE_TYPES,
  AI_SUGGESTION_STATUSES,
  type AiSuggestion,
  type AiSuggestionKind,
  type AiSuggestionSourceType,
  type AiSuggestionStatus,
} from '#domain/entities/ai-suggestion.entity';
import { AI_SUGGESTION_DECIDE_MAX } from '../../application/services/ai-suggestion.service';
import type {
  AiSuggestionDecideOutcome,
  AiSuggestionDecisionResult,
} from '../../application/services/ai-suggestion.service';
import {
  readTaskPayload,
  TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
} from '../../application/services/ai-suggestion-task-kind';
import {
  POINTS_SUGGESTION_MAX_MEMBERS,
  readPointsPayload,
} from '../../application/services/ai-suggestion-points-kind';
import { readEventPayload } from '../../application/services/ai-suggestion-event-kind';

export class ListAiSuggestionsQueryDto {
  @ApiPropertyOptional({
    enum: AI_SUGGESTION_SOURCE_TYPES,
    description:
      'Only suggestions drawn from this source. Send with `source_id`.',
  })
  @IsOptional()
  @IsIn(AI_SUGGESTION_SOURCE_TYPES)
  source_type?: AiSuggestionSourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  source_id?: string;
}

/**
 * An officer's changes to a suggested task before accepting it. Omitted
 * fields stay as suggested. There is no points field: a suggested task never
 * carries points, and the officer adds them on the task afterwards.
 */
export class TaskSuggestionEditsDto {
  @ApiPropertyOptional({ maxLength: TASK_TITLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'Who the task is for. Required to accept when none was suggested.',
  })
  @IsOptional()
  @IsUUID()
  assignee_id?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Due date (YYYY-MM-DD). Required to accept when none was suggested.',
  })
  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'The moment it is due, or null for no time. A new `due_date` sent without it clears the time.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  due_at?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: TASK_SUBTASKS_MAX })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_SUBTASKS_MAX)
  @IsString({ each: true })
  @MaxLength(TASK_SUBTASK_TITLE_MAX_LENGTH, { each: true })
  subtasks?: string[];
}

/**
 * An officer's changes to a proposed points change before confirming it
 * (#718). Omitted fields stay as proposed.
 */
export class PointsSuggestionEditsDto {
  @ApiPropertyOptional({
    minimum: -POINTS_ADJUSTMENT_MAX,
    maximum: POINTS_ADJUSTMENT_MAX,
    description: 'Points for each member. Negative takes points away. Not 0.',
  })
  @IsOptional()
  @IsInt()
  @NotEquals(0)
  @Min(-POINTS_ADJUSTMENT_MAX)
  @Max(POINTS_ADJUSTMENT_MAX)
  amount?: number;

  @ApiPropertyOptional({ maxLength: POINTS_REASON_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(POINTS_REASON_MAX_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: POINTS_SUGGESTION_MAX_MEMBERS,
    description:
      'The whole list of members it is for, replacing the proposed one. Each must be in the chapter when it is confirmed; one who is not is left out and counted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POINTS_SUGGESTION_MAX_MEMBERS)
  @IsUUID(undefined, { each: true })
  target_user_ids?: string[];
}

export class AcceptAiSuggestionDto {
  @ApiPropertyOptional({
    type: TaskSuggestionEditsDto,
    description: 'Changes to a suggested task, for edit-then-accept.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskSuggestionEditsDto)
  task?: TaskSuggestionEditsDto;

  @ApiPropertyOptional({
    type: PointsSuggestionEditsDto,
    description: 'Changes to a proposed points change, for edit-then-accept.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PointsSuggestionEditsDto)
  points?: PointsSuggestionEditsDto;
}

export class AiSuggestionDecideItemDto extends AcceptAiSuggestionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: ['accept', 'dismiss'] })
  @IsIn(['accept', 'dismiss'])
  action: 'accept' | 'dismiss';
}

export class DecideAiSuggestionsDto {
  @ApiProperty({
    type: [AiSuggestionDecideItemDto],
    maxItems: AI_SUGGESTION_DECIDE_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_SUGGESTION_DECIDE_MAX)
  @ValidateNested({ each: true })
  @Type(() => AiSuggestionDecideItemDto)
  items: AiSuggestionDecideItemDto[];
}

export class TaskSuggestionDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'Null when no name or role was said for it: the screen shows "Who?".',
  })
  assignee_id: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  due_date: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  due_at: string | null;

  @ApiProperty({ type: [String] })
  subtasks: string[];
}

export class PointsSuggestionDto {
  @ApiProperty({ description: 'Points for each member. Negative takes away.' })
  amount: number;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: [String], description: 'The members it is for.' })
  target_user_ids: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'The event whose attendance the members were read from, when it was.',
  })
  event_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "That event's name, for the card to say whose attendance it is.",
  })
  event_name: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'When that event started.',
  })
  event_start_time: string | null;
}

export class EventSuggestionDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ format: 'date-time' })
  start_time: string;

  @ApiProperty({ format: 'date-time' })
  end_time: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null leaves the chapter’s usual amount.',
  })
  point_value: number | null;

  @ApiProperty()
  is_mandatory: boolean;
}

export class AiSuggestionSourceDto {
  @ApiProperty({ enum: AI_SUGGESTION_SOURCE_TYPES })
  type: AiSuggestionSourceType;

  @ApiProperty({ format: 'uuid' })
  id: string;
}

export class AiSuggestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: AI_SUGGESTION_KINDS })
  kind: AiSuggestionKind;

  @ApiProperty({ enum: AI_SUGGESTION_STATUSES })
  status: AiSuggestionStatus;

  @ApiProperty({ type: AiSuggestionSourceDto })
  source: AiSuggestionSourceDto;

  @ApiProperty({
    format: 'uuid',
    description: 'Suggestions made together (one push) share it.',
  })
  batch_id: string;

  @ApiProperty({
    type: TaskSuggestionDto,
    nullable: true,
    description:
      'The suggested task, while it waits. Null for another kind, and once decided or expired (a decided suggestion keeps no text).',
  })
  task: TaskSuggestionDto | null;

  @ApiProperty({
    type: PointsSuggestionDto,
    nullable: true,
    description:
      'The proposed points change, while it waits. Null for another kind, and once decided or expired.',
  })
  points: PointsSuggestionDto | null;

  @ApiProperty({
    type: EventSuggestionDto,
    nullable: true,
    description:
      'The proposed event, while it waits. Null for another kind, and once decided or expired.',
  })
  event: EventSuggestionDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The words it came from, exactly as they appear in the source. Null when there are none to show.',
  })
  quote: string | null;

  @ApiProperty({ description: 'Accepted with changes.' })
  edited: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'What accepting made (a task id), once accepted.',
  })
  result_id: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;

  static from(row: AiSuggestion): AiSuggestionDto {
    const waiting = row.status === 'pending';
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      source: { type: row.source_type, id: row.source_id },
      batch_id: row.batch_id,
      task:
        waiting && row.kind === 'task' ? readTaskPayload(row.payload) : null,
      points:
        waiting && row.kind === 'points'
          ? readPointsPayload(row.payload)
          : null,
      event:
        waiting && row.kind === 'event' ? readEventPayload(row.payload) : null,
      quote: waiting ? row.quote : null,
      edited: row.edited,
      result_id: row.result_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  }
}

export class AiSuggestionListDto {
  @ApiProperty({ type: [AiSuggestionDto] })
  items: AiSuggestionDto[];

  @ApiProperty({
    description: 'More waiting suggestions exist than one list returns.',
  })
  has_more: boolean;
}

export class AiSuggestionOutcomeDto {
  @ApiPropertyOptional({
    description: 'A points change: how many members’ points were changed.',
  })
  adjusted?: number;

  @ApiPropertyOptional({
    description:
      'A points change: how many members were left out (no longer in the chapter).',
  })
  skipped?: number;
}

export class AiSuggestionResultDto {
  @ApiProperty({ enum: AI_SUGGESTION_KINDS })
  kind: AiSuggestionKind;

  @ApiProperty({
    format: 'uuid',
    description: 'What was made (the first one, when it made several).',
  })
  id: string;

  @ApiPropertyOptional({
    type: AiSuggestionOutcomeDto,
    description: 'Counts, when accepting made more than one change.',
  })
  outcome?: AiSuggestionOutcomeDto;
}

export class AiSuggestionDecisionDto {
  @ApiProperty({ type: AiSuggestionDto })
  suggestion: AiSuggestionDto;

  @ApiProperty({
    type: AiSuggestionResultDto,
    nullable: true,
    description: 'What accepting made. Null for a dismissal.',
  })
  result: AiSuggestionResultDto | null;

  static from(decided: AiSuggestionDecisionResult): AiSuggestionDecisionDto {
    return {
      suggestion: AiSuggestionDto.from(decided.suggestion),
      result: decided.result,
    };
  }
}

export class AiSuggestionDecideOutcomeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  ok: boolean;

  @ApiPropertyOptional({ type: AiSuggestionDecisionDto })
  decision?: AiSuggestionDecisionDto;

  @ApiPropertyOptional({
    description: 'The HTTP status the single-item route would have answered.',
  })
  status?: number;

  @ApiPropertyOptional({
    description: 'Why it was refused, e.g. ai.suggestion.decided.',
  })
  code?: string;

  @ApiPropertyOptional()
  message?: string;

  static from(
    outcome: AiSuggestionDecideOutcome,
  ): AiSuggestionDecideOutcomeDto {
    if (outcome.ok) {
      return {
        id: outcome.id,
        ok: true,
        decision: AiSuggestionDecisionDto.from(outcome),
      };
    }
    return {
      id: outcome.id,
      ok: false,
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
    };
  }
}

export class AiSuggestionDecideResponseDto {
  @ApiProperty({ type: [AiSuggestionDecideOutcomeDto] })
  outcomes: AiSuggestionDecideOutcomeDto[];
}
