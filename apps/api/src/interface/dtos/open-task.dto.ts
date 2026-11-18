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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OPEN_TASK_SCOPES,
  POINTS_ADJUSTMENT_MAX,
  TASK_PEOPLE_MAX,
  TASK_PROOF_KINDS,
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
  type OpenTaskScope,
  type TaskProofKind,
} from '@repo/validation';
import type {
  OpenTaskStatus,
  OpenTaskView,
} from '#domain/entities/open-task.entity';
import type { AssertNever } from './drift-guard';

const OPEN_TASK_STATUSES = ['open', 'claimed'] as const;

/**
 * `POST /v1/open-tasks` (2026-11-18): a task up for grabs. The task's own
 * fields are a task's; who may claim it is `role_id`, `group_id` or
 * `user_ids`, at most one, or none for anyone in the chapter.
 */
export class CreateOpenTaskDto {
  @ApiProperty({ maxLength: TASK_TITLE_MAX_LENGTH })
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Due date (YYYY-MM-DD)' })
  @IsDateString()
  due_date: string;

  @ApiPropertyOptional({
    description:
      'The moment it is due, when it has a time of day (ISO 8601 with an offset), on `due_date` as the creator sees it.',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  due_at?: string;

  @ApiPropertyOptional({
    description: 'Points the claimed task awards when an officer confirms it.',
    minimum: 0,
    maximum: POINTS_ADJUSTMENT_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POINTS_ADJUSTMENT_MAX)
  point_reward?: number;

  @ApiPropertyOptional({
    enum: TASK_PROOF_KINDS,
    description: 'What Mark done needs on the claimed task. Default `none`.',
  })
  @IsOptional()
  @IsIn(TASK_PROOF_KINDS)
  proof_kind?: TaskProofKind;

  @ApiPropertyOptional({
    description:
      'The checklist the claimed task starts with, in order. Blank lines are dropped.',
    type: [String],
    maxItems: TASK_SUBTASKS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_SUBTASKS_MAX)
  @IsString({ each: true })
  @MaxLength(TASK_SUBTASK_TITLE_MAX_LENGTH, { each: true })
  subtasks?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only this role’s active holders may claim it. The chapter’s Everyone role means anyone; the Alumni role is refused; a role nobody holds is a 400 ("Nobody holds that role yet").',
  })
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only this chapter group’s active members (manual, pledge class or class year) may claim it. An empty group is a 400.',
  })
  @IsOptional()
  @IsUUID()
  group_id?: string;

  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: TASK_PEOPLE_MAX,
    description:
      'Only these people may claim it. Each must be an active member of the chapter (alumni refused).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TASK_PEOPLE_MAX)
  @IsUUID(undefined, { each: true })
  user_ids?: string[];
}

/**
 * `PATCH /v1/open-tasks/:id`: an officer's edit while it is open. Omitted
 * fields stay; `null` clears `description`, `due_at` and `point_reward`. Who
 * may claim it doesn't change here: delete the posting and post it again.
 */
export class UpdateOpenTaskDto {
  @ApiPropertyOptional({ maxLength: TASK_TITLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Due date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'The moment it is due, or null to take its time off. Send it with `due_date`: the pair must agree.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  due_at?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: POINTS_ADJUSTMENT_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POINTS_ADJUSTMENT_MAX)
  point_reward?: number | null;

  @ApiPropertyOptional({ enum: TASK_PROOF_KINDS })
  @IsOptional()
  @IsIn(TASK_PROOF_KINDS)
  proof_kind?: TaskProofKind;

  @ApiPropertyOptional({
    description: 'The whole checklist as it should stand, in order.',
    type: [String],
    maxItems: TASK_SUBTASKS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_SUBTASKS_MAX)
  @IsString({ each: true })
  @MaxLength(TASK_SUBTASK_TITLE_MAX_LENGTH, { each: true })
  subtasks?: string[];
}

/** `POST /v1/open-tasks/:id/assign`. */
export class AssignOpenTaskDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Who gets it: any active member of the chapter, eligible to claim it or not.',
  })
  @IsUUID()
  assignee_id: string;
}

/** A task up for grabs as its reads return it. */
export class OpenTaskDto implements OpenTaskView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The officer who posted it. The claimed task names them as its creator, so they review it.',
  })
  created_by: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ format: 'date' })
  due_date: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  due_at: string | null;

  @ApiProperty({ type: Number, nullable: true })
  point_reward: number | null;

  @ApiProperty({ enum: TASK_PROOF_KINDS })
  proof_kind: TaskProofKind;

  @ApiProperty({
    type: [String],
    description: 'The checklist the claimed task starts with, in order.',
  })
  subtask_titles: string[];

  @ApiProperty({
    enum: OPEN_TASK_SCOPES,
    description:
      'Who may claim it: `chapter` (anyone), `role` (its holders), `group` (its members) or `people` (`scope_user_ids`). Alumni never may.',
  })
  scope: OpenTaskScope;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The role or group, for `role` and `group`.',
  })
  scope_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'That role’s or group’s name as it reads now, or as it was when posted once it’s deleted. "Someone in Philanthropy Chair".',
  })
  scope_name: string | null;

  @ApiProperty({
    type: [String],
    nullable: true,
    description: 'The people who may claim it, for `people`.',
  })
  scope_user_ids: string[] | null;

  @ApiProperty({ enum: OPEN_TASK_STATUSES })
  status: OpenTaskStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  claimed_task_id: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  claimed_by: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  claimed_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({
    description: 'How many active members may claim it now.',
  })
  eligible_count: number;

  @ApiProperty({ description: 'Whether the reader may claim it now.' })
  viewer_can_claim: boolean;
}

/**
 * Fields of a task up for grabs that {@link OpenTaskDto} forgot to declare.
 * Must be `never`.
 * @driftguard
 */
export type OpenTaskDtoMissingFields = AssertNever<
  Exclude<keyof OpenTaskView, keyof OpenTaskDto>
>;

/**
 * Fields {@link OpenTaskDto} declares that the read doesn't carry. Must be
 * `never`.
 * @driftguard
 */
export type OpenTaskDtoExtraFields = AssertNever<
  Exclude<keyof OpenTaskDto, keyof OpenTaskView>
>;
