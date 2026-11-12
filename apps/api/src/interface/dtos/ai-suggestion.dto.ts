import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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

export class AcceptAiSuggestionDto {
  @ApiPropertyOptional({
    type: TaskSuggestionEditsDto,
    description: 'Changes to a suggested task, for edit-then-accept.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskSuggestionEditsDto)
  task?: TaskSuggestionEditsDto;
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

export class AiSuggestionResultDto {
  @ApiProperty({ enum: AI_SUGGESTION_KINDS })
  kind: AiSuggestionKind;

  @ApiProperty({ format: 'uuid' })
  id: string;
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
