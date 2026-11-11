import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POINTS_ADJUSTMENT_MAX,
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
} from '@repo/validation';
import {
  TaskStatus,
  type Task,
  type TaskSubtask,
} from '#domain/entities/task.entity';

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'User ID of the assignee' })
  @IsUUID()
  assignee_id: string;

  @ApiProperty({ description: 'Due date (YYYY-MM-DD)' })
  @IsDateString()
  due_date: string;

  @ApiPropertyOptional({
    description:
      'The moment the task is due, when it has a time of day (ISO 8601 with an offset). `due_date` must be the calendar day of this moment as the creator sees it. Omit for a task due on `due_date` with no time.',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  due_at?: string;

  @ApiPropertyOptional({
    description:
      'Subtasks, in order: a checklist of steps the assignee ticks off (#4003). Blank lines are dropped.',
    type: [String],
    maxItems: TASK_SUBTASKS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_SUBTASKS_MAX)
  @IsString({ each: true })
  @MaxLength(TASK_SUBTASK_TITLE_MAX_LENGTH, { each: true })
  subtasks?: string[];

  @ApiPropertyOptional({ description: 'Points to award on completion' })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Awarded to the ledger on completion — same ceiling as a manual adjustment.
  @Max(POINTS_ADJUSTMENT_MAX)
  point_reward?: number;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts an interactive task card to this chat channel after the task is created (the `/task` slash command). Omit for dashboard creates.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

/**
 * Response contract for `POST /v1/tasks`.
 *
 * This route previously declared no response schema, which openapi-typescript
 * renders as `content?: never` — so `data` reached the SDK typed `never` and
 * `/task` could not read `card_posted` without an unchecked cast (#1717). The
 * task fields are flattened at the top level exactly as the route already
 * returned them (the raw row, not `TaskView` — create does not rewrite status).
 *
 * Drift between this class and the task row is caught the same way as
 * `AdjustPointsResponseDto`: `implements Task` for type drift, and the
 * `Assert<Exclude<…>>` aliases below for key drift. `card_posted` is the one
 * deliberate extra field.
 */
export class CreateTaskResponseDto implements Task {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ format: 'uuid' })
  assignee_id: string;

  @ApiProperty({ format: 'uuid' })
  created_by: string;

  @ApiProperty({ format: 'date' })
  due_date: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  due_at: string | null;

  @ApiProperty({ enum: TaskStatus })
  status: TaskStatus;

  @ApiProperty({ type: Number, nullable: true })
  point_reward: number | null;

  @ApiProperty()
  points_awarded: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completed_at: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmed_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the task row committed and the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — drop it and warn, without implying the create failed. Absent means the server reported no outcome (a dashboard create, or a request that did not attempt a card) — leave the placeholder for the echo. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
  })
  card_posted?: boolean;
}

export class TaskSubtaskDto implements TaskSubtask {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  task_id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: 'Order under the task, 0 first.' })
  position: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When it was checked off; null while it is still to do.',
  })
  done_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export class CreateTaskSubtaskDto {
  @ApiProperty({ maxLength: TASK_SUBTASK_TITLE_MAX_LENGTH })
  @IsString()
  @MaxLength(TASK_SUBTASK_TITLE_MAX_LENGTH)
  title: string;
}

export class UpdateTaskSubtaskDto {
  @ApiProperty({ description: 'True to check it off, false to uncheck it.' })
  @IsBoolean()
  done: boolean;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

export class RejectTaskCompletionDto {
  @ApiPropertyOptional({ description: 'Optional comment for rejection' })
  @IsOptional()
  @IsString()
  comment?: string;
}

/**
 * Compile-time key-drift guards between {@link CreateTaskResponseDto} and the
 * task row it publishes. Each resolves to `never` while the two agree; when
 * they diverge the alias stops satisfying `Assert`'s constraint and the build
 * fails naming the field.
 */
type Assert<T extends never> = T;

/** Task fields {@link CreateTaskResponseDto} forgot to declare. Must be `never`. */
export type CreateTaskResponseDtoMissingFields = Assert<
  Exclude<keyof Task, keyof CreateTaskResponseDto>
>;

/**
 * Fields {@link CreateTaskResponseDto} declares that the task row does not
 * carry. Must be `never`. `card_posted` is excluded because it is this route's
 * own outcome flag, not a column — the one deliberate addition.
 */
export type CreateTaskResponseDtoExtraFields = Assert<
  Exclude<keyof CreateTaskResponseDto, keyof Task | 'card_posted'>
>;
