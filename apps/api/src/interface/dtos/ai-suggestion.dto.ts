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
  TASK_PEOPLE_MAX,
  TASK_SUGGESTION_AUDIENCES,
  TASK_TITLE_MAX_LENGTH,
  type TaskSuggestionAudience,
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
import type { MeetingNextAgendaItem } from '#domain/entities/meeting-next-agenda-item.entity';
import { AI_SUGGESTION_DECIDE_MAX } from '../../application/services/ai-suggestion.service';
import type {
  AiSuggestionDecideOutcome,
  AiSuggestionDecisionResult,
} from '../../application/services/ai-suggestion.service';
import { readEventPayload } from '../../application/services/ai-suggestion-event-kind';
import {
  readTaskPayload,
  TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
} from '../../application/services/ai-suggestion-task-kind';
import {
  POINTS_SUGGESTION_MAX_MEMBERS,
  readPointsPayload,
} from '../../application/services/ai-suggestion-points-kind';
import { readNewEventPayload } from '../../application/services/ai-suggestion-new-event-kind';

function eventOf(row: AiSuggestion): EventSuggestionDto {
  const { name, last_year_at, times } = readEventPayload(row.payload);
  return { name, last_year_at, times };
}

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
      'Who the task is for. Required to accept when none was suggested, unless `assignee_ids` or `audience` is set. "Who" is one answer: an edit that sends any of `assignee_id`, `assignee_ids`, `audience`, `audience_role_id` and `audience_group_id` replaces it with what those say, so setting this alone clears the rest.',
  })
  @IsOptional()
  @IsUUID()
  assignee_id?: string | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: TASK_PEOPLE_MAX,
    description:
      'Several people (2026-11-18): with no `audience`, accepting gives each their own copy; with `audience: "someone"`, it posts one task up for grabs that one of them claims. A list of one is that person.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_PEOPLE_MAX)
  @IsUUID(undefined, { each: true })
  assignee_ids?: string[] | null;

  @ApiPropertyOptional({
    type: String,
    enum: TASK_SUGGESTION_AUDIENCES,
    nullable: true,
    description:
      'A task for a group instead of one person: `everyone` gives each member of it their own copy (#4295 step 3); `someone` (2026-11-18) posts one task up for grabs that one of them claims, and the accept’s result id is then the posting’s. The group is the chapter, narrowed by `audience_role_id` or `audience_group_id`, or for `someone` by `assignee_ids`.',
  })
  @IsOptional()
  @IsIn(TASK_SUGGESTION_AUDIENCES)
  audience?: TaskSuggestionAudience | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'With `audience`: only this role’s holders (2026-11-18).',
  })
  @IsOptional()
  @IsUUID()
  audience_role_id?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'With `audience`: only this chapter group’s members (2026-11-18).',
  })
  @IsOptional()
  @IsUUID()
  audience_group_id?: string | null;

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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A task the chapter already has that this suggestion is (#5562, "Already a task"). When set, nothing is made and every other field is ignored: the accept records that task as the suggestion\'s, so the action item it came from follows that task. It must be a task in the chapter.',
  })
  @IsOptional()
  @IsUUID()
  existing_task_id?: string;
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

/**
 * How a suggested event is accepted (#3930): the officer adds the event
 * through the ordinary event form and route, then names it here. The accept
 * records it; it never makes an event.
 */
export class EventSuggestionAcceptDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The event the caller added from this suggestion. It must be in the chapter and made by the caller.',
  })
  @IsUUID()
  event_id: string;
}

/**
 * How a proposed event is accepted after the member changed it in the
 * ordinary event form (the card's Edit, #5117): the form made the event
 * through its own route, and the accept records it instead of making one.
 */
export class NewEventSuggestionAcceptDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The event the caller added from this proposal in the event form. It must be in the chapter and made by the caller. When set, nothing else is read.',
  })
  @IsOptional()
  @IsUUID()
  event_id?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: POINTS_ADJUSTMENT_MAX,
    description:
      'Points for coming, typed on the card: needed when the proposal has none.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;
}

/** Why a suggestion was dismissed, for the analytics event only. Never stored. */
const AI_SUGGESTION_DISMISS_REASONS = ['already_doing'] as const;
export type AiSuggestionDismissReason =
  (typeof AI_SUGGESTION_DISMISS_REASONS)[number];

export class DismissAiSuggestionDto {
  @ApiPropertyOptional({
    enum: AI_SUGGESTION_DISMISS_REASONS,
    description:
      '`already_doing`: the chapter is already doing what was suggested. Left out for a plain dismissal.',
  })
  @IsOptional()
  @IsIn(AI_SUGGESTION_DISMISS_REASONS)
  reason?: AiSuggestionDismissReason;
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

  @ApiPropertyOptional({
    type: EventSuggestionAcceptDto,
    description: 'Required to accept a suggested event.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EventSuggestionAcceptDto)
  event?: EventSuggestionAcceptDto;

  @ApiPropertyOptional({
    type: NewEventSuggestionAcceptDto,
    description:
      'For a proposed event the caller already added in the event form: records it instead of making one.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewEventSuggestionAcceptDto)
  new_event?: NewEventSuggestionAcceptDto;
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
      'Null when no name or role was said for it, or when it is for a group or several people: the screen shows "Who?" or who it is for.',
  })
  assignee_id: string | null;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Several people (2026-11-18): a copy each, or with `audience: "someone"` one task that one of them claims.',
  })
  assignee_ids: string[] | null;

  @ApiProperty({
    type: String,
    enum: TASK_SUGGESTION_AUDIENCES,
    nullable: true,
    description:
      '`everyone`: accepting gives each member of the group their own copy (#4295 step 3). `someone`: accepting posts one task up for grabs (2026-11-18). The group is the chapter unless `audience_role_id`, `audience_group_id` or (for `someone`) `assignee_ids` narrows it.',
  })
  audience: TaskSuggestionAudience | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  audience_role_id: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  audience_group_id: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  due_date: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  due_at: string | null;

  @ApiProperty({ type: [String] })
  subtasks: string[];

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description:
      'Present on a "this time last year" suggestion: the day last year\'s task, its source, was due.',
  })
  last_year_on?: string;
}

export class EventSuggestionDto {
  @ApiProperty()
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'When the source event started, last year.',
  })
  last_year_at: string | null;

  @ApiProperty({
    description: 'How many times it was held around then (a weekly series).',
  })
  times: number;
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

export class NewEventPointsFromDto {
  @ApiProperty({
    enum: ['type', 'event'],
    description:
      '`type`: the chapter event type of that name. `event`: its latest event of that name.',
  })
  kind: 'type' | 'event';

  @ApiProperty()
  name: string;
}

/** An event the acting agent proposes to create (#718). */
export class NewEventSuggestionDto {
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
    description:
      'Points for coming. Null when the caller did not say and nothing could be copied: accepting then needs `new_event.point_value`.',
  })
  point_value: number | null;

  @ApiProperty({
    type: NewEventPointsFromDto,
    nullable: true,
    description:
      'Where points the caller did not say were copied from. Null when they were said, typed, or are missing.',
  })
  points_from: NewEventPointsFromDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The chapter event type the event is one of, when one matched.',
  })
  event_type_id: string | null;

  @ApiProperty()
  is_mandatory: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The repeat the series is made with (the `recurrence_rule` format of `POST /v1/events`), or null for one event.',
  })
  recurrence_rule: string | null;
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

  @ApiPropertyOptional({
    type: EventSuggestionDto,
    nullable: true,
    description:
      'The suggested event, while it waits. Null for another kind, and once decided or expired.',
  })
  event?: EventSuggestionDto | null;

  @ApiProperty({
    type: PointsSuggestionDto,
    nullable: true,
    description:
      'The proposed points change, while it waits. Null for another kind, and once decided or expired.',
  })
  points: PointsSuggestionDto | null;

  @ApiProperty({
    type: NewEventSuggestionDto,
    nullable: true,
    description:
      'The event the acting agent proposes to create, while it waits. Null for another kind, and once decided or expired.',
  })
  new_event: NewEventSuggestionDto | null;

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
      event: waiting && row.kind === 'event' ? eventOf(row) : null,
      new_event:
        waiting && row.kind === 'new_event'
          ? readNewEventPayload(row.payload)
          : null,
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

/**
 * What Add to next meeting's agenda returns (#5790): the item as the next
 * meetings with the same audience will offer it.
 */
export class NextAgendaItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The posted minutes it was sent from.',
  })
  meeting_id: string;

  @ApiProperty({ description: 'The words, as the agenda will hold them.' })
  text: string;

  static from(row: MeetingNextAgendaItem): NextAgendaItemDto {
    return { id: row.id, meeting_id: row.meeting_id, text: row.text };
  }
}

export class SendToNextAgendaResponseDto {
  @ApiProperty({ type: NextAgendaItemDto })
  item: NextAgendaItemDto;
}
