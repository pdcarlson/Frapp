import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_REPEAT_RULE_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  TASK_COMPLETION_NOTE_MAX,
  TASK_PHOTOS_MAX,
  TASK_AUDIENCES,
  TASK_GROUP_AUDIENCES,
  TASK_PEOPLE_MAX,
  TASK_PROOF_KINDS,
  TASK_PROOF_LINK_MAX,
  TASK_SEND_BACK_REASON_MAX,
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
  type TaskAudience,
  type TaskGroupAudience,
  type TaskProofKind,
} from '@repo/validation';
import {
  TaskStatus,
  type Task,
  type TaskGroupSummary,
  type TaskSeriesSummary,
  type TaskSubtask,
  type TaskPhoto,
  type TaskPhotoKind,
} from '#domain/entities/task.entity';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { IsRepeatRule } from '../decorators/is-repeat-rule.decorator';

/**
 * The scopes of an edit or delete: a repeating task's series (#5119), or
 * everyone's copy of a group task (#4295 step 3).
 */
const TASK_EDIT_SCOPES = ['instance', 'series', 'group'] as const;
export type TaskEditScope = (typeof TASK_EDIT_SCOPES)[number];

const TASK_RECURRENCE_RULE_DESCRIPTION =
  "Repeat on a schedule (#5119): the event rule format (`packages/validation/src/recurrence.ts`), `FREQ` DAILY, WEEKLY or MONTHLY, `INTERVAL` 1 to 30, `BYDAY` or `BYMONTHDAY`, a required `TZID` (the officer's zone), and `COUNT` (2 to 120), `UNTIL` (YYYYMMDD) or no end. Example: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York`. The task is the first copy; the next is made once it is due, on the same time of day in that zone.";
import {
  ISO_INSTANT_MESSAGE,
  ISO_INSTANT_PATTERN,
  ISO_INSTANT_REGEX,
} from '#domain/constants/iso-instant';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '#domain/constants/list-query-limits';
import type { AssertNever } from './drift-guard';

/**
 * `GET /v1/tasks` (#4037). Every parameter is optional, and a request with
 * none still gets the whole list, which is what shipped mobile builds send.
 */
export class ListTasksQueryDto {
  @ApiPropertyOptional({
    description:
      'Page size. Integers outside 1–200 are rejected. Sending `limit` or `before` pages the list (default 50); sending neither returns every task.',
    minimum: LIST_QUERY_LIMIT_MIN,
    maximum: LIST_QUERY_LIMIT_MAX,
    default: LIST_QUERY_LIMIT_DEFAULT,
    example: LIST_QUERY_LIMIT_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIST_QUERY_LIMIT_MIN)
  @Max(LIST_QUERY_LIMIT_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Cursor: the `created_at` of the last task of the previous page, fed back exactly as received. Tasks come newest first, by `created_at` then `id`. Requires `before_id`.',
    example: '2026-01-31T23:59:59.999999+00:00',
    pattern: ISO_INSTANT_PATTERN,
  })
  @ValidateIf((query: ListTasksQueryDto) => query.before_id !== undefined)
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  before?: string;

  @ApiPropertyOptional({
    description:
      'Cursor: the `id` of the last task of the previous page. Requires `before`.',
    format: 'uuid',
  })
  @ValidateIf((query: ListTasksQueryDto) => query.before !== undefined)
  @IsUUID()
  before_id?: string;
}

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'User ID of the assignee. Send exactly one of this, `assignee_ids` and `audience`.',
  })
  @ValidateIf(
    (dto: CreateTaskDto) => dto.audience == null && dto.assignee_ids == null,
  )
  @IsUUID()
  assignee_id?: string;

  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: TASK_PEOPLE_MAX,
    description:
      'Several people picked one by one (2026-11-18), in place of `assignee_id` and `audience`: each gets their own copy, as with `audience`, and reads carry `group` with `audience: "people"`. Each must be an active member of the chapter (alumni refused); duplicates count once, and a list of one makes that person’s task. The same limits as `audience` apply.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TASK_PEOPLE_MAX)
  @IsUUID(undefined, { each: true })
  assignee_ids?: string[];

  @ApiPropertyOptional({
    enum: TASK_AUDIENCES,
    description:
      'A task for a group instead of one person (#4295 step 3), in place of `assignee_id`. `everyone`: each active member (the chapter minus its alumni) gets their own copy with its own progress, proof and points, and reads carry `group` with how many are done. Narrow it with `audience_role_id` or `audience_group_id`. Such a task can’t repeat, carry `reference_photo_paths` or post a chat card yet. The response is the creator’s own copy when they have one, otherwise the first.',
  })
  @IsOptional()
  @IsIn(TASK_AUDIENCES)
  audience?: TaskAudience;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'With `audience: "everyone"` only (2026-11-18): just the active members holding this role get a copy. The chapter’s Everyone role means everyone; the Alumni role is refused, and a role nobody holds is a 400 ("Nobody holds that role yet"). Not with `audience_group_id`.',
  })
  @IsOptional()
  @IsUUID()
  audience_role_id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'With `audience: "everyone"` only (2026-11-18): just the active members of this chapter group (manual, pledge class or class year) get a copy. An empty group is a 400. Not with `audience_role_id`.',
  })
  @IsOptional()
  @IsUUID()
  audience_group_id?: string;

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
    description: `Reference photos, in order: each a \`storage_path\` from \`POST /v1/tasks/photo-upload-url\`, after the bytes were uploaded (#4635). At most ${TASK_PHOTOS_MAX}.`,
    type: [String],
    maxItems: TASK_PHOTOS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_PHOTOS_MAX)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  reference_photo_paths?: string[];

  @ApiPropertyOptional({
    enum: TASK_PROOF_KINDS,
    description:
      'What Mark done needs (#4635): `none` (default), `photo` (one or more proof photos) or `link`.',
  })
  @IsOptional()
  @IsIn(TASK_PROOF_KINDS)
  proof_kind?: TaskProofKind;

  @ApiPropertyOptional({
    description: TASK_RECURRENCE_RULE_DESCRIPTION,
    maxLength: MAX_REPEAT_RULE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPEAT_RULE_LENGTH)
  @IsRepeatRule({ task: true })
  recurrence_rule?: string;

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

/** A group task's progress, on task reads (#4295 step 3). */
export class TaskGroupSummaryDto implements TaskGroupSummary {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: TASK_GROUP_AUDIENCES,
    description:
      'Who it went to: `everyone` (the chapter), `people` (several picked one by one), `role` (a role’s holders) or `group` (a chapter group’s members). Each got their own copy.',
  })
  audience: TaskGroupAudience;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The role or chapter group it went to, for `role` and `group`; null otherwise.',
  })
  target_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'That role’s or group’s name: as it reads now, or as it was when the task was made once it’s deleted. Null for `everyone` and `people`. "Everyone in Recruitment Committee".',
  })
  target_name: string | null;

  @ApiProperty({ description: 'How many copies the group has.' })
  total: number;

  @ApiProperty({
    description:
      'How many copies are marked done, waiting on an officer or confirmed.',
  })
  done: number;

  @ApiProperty({
    description:
      'How many copies are confirmed, or needed no sign-off when marked done.',
  })
  confirmed: number;
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
 * `AssertNever<Exclude<…>>` aliases below for key drift. `card_posted` is the one
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

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When an officer last sent the completion back to the assignee; null if never. The assignee taking back their own completion doesn’t set it.',
  })
  sent_back_at: string | null;

  @ApiProperty({
    enum: TASK_PROOF_KINDS,
    description: 'What Mark done needs: nothing, a proof photo, or a link.',
  })
  proof_kind: TaskProofKind;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The assignee's link proof sent with Mark done, or null. Shown as its domain; never fetched by the server.",
  })
  proof_link: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Why an officer last sent the completion back, or null. Kept through the next Mark done; cleared when the task is handed to someone else.',
  })
  sent_back_reason: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The assignee's reply sent with Mark done, or null. Cleared with the completion.",
  })
  completion_note: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The repeating series this task is a copy of (#5119), or null for a task that doesn’t repeat.',
  })
  series_id: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'A copy’s day in its series’ pattern; null otherwise.',
  })
  occurrence_date: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The group task this is one member’s copy of (#4295 step 3), or null for a task given to one person.',
  })
  group_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The minutes this task was suggested from (#5562), or null. Read the meeting for its name, so a renamed meeting shows its new one; the reader may not be allowed to.',
  })
  meeting_id: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the task row committed and the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — drop it and warn, without implying the create failed. Absent means the server reported no outcome (a dashboard create, or a request that did not attempt a card) — leave the placeholder for the echo. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
  })
  card_posted?: boolean;

  @ApiProperty({
    type: () => [TaskPhotoDto],
    description:
      'The reference photos added with the task, in order. Task reads and status writes carry `photos` too.',
  })
  photos: TaskPhotoDto[];

  @ApiPropertyOptional({
    type: () => TaskGroupSummaryDto,
    description:
      'On a task for everyone: its group, as task reads carry it (#4295 step 3).',
  })
  group?: TaskGroupSummaryDto;
}

/** How a task repeats, on task reads (#5119). */
export class TaskSeriesSummaryDto implements TaskSeriesSummary {
  @ApiProperty({ description: 'The series’ rule, as on create.' })
  recurrence_rule: string;

  @ApiProperty({
    format: 'date',
    description:
      'The day of the next copy still to be made: "Every Monday · next Nov 24". Meaningless once `ended`.',
  })
  next_due_date: string;

  @ApiProperty({
    description:
      'Whether the series has stopped making copies: its rule ran out, an officer ended it, or its assignee left.',
  })
  ended: boolean;
}

export class TaskPhotoDto implements TaskPhoto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  task_id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ enum: ['reference', 'proof'] })
  kind: TaskPhotoKind;

  @ApiProperty({
    description:
      'Storage key in the private `tasks` bucket. Read it through `GET /v1/tasks/:id/photos/:photoId/url`.',
  })
  storage_path: string;

  @ApiProperty({ description: 'Order within its kind, 0 first.' })
  position: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  created_by: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
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

/**
 * An officer's edit of a task (#4296). Every field is optional and an omitted
 * one is left as it is. `null` clears `description`, `due_at` (the task is
 * then due by the end of `due_date`) and `point_reward`; the API refuses null
 * for the rest. Steps are edited through the subtask routes.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: TASK_TITLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'User ID of the new assignee. A new assignee starts the task over: it goes back to To do and they are notified.',
  })
  @IsOptional()
  @IsUUID()
  assignee_id?: string;

  @ApiPropertyOptional({ description: 'Due date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'The moment the task is due, or null to take its time off. Send it with `due_date`: the pair must agree, as on create.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  due_at?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POINTS_ADJUSTMENT_MAX)
  point_reward?: number | null;

  @ApiPropertyOptional({
    description: `The task's reference photos as they should stand, in order (#4635): paths it already holds stay, new \`storage_path\`s from \`POST /v1/tasks/photo-upload-url\` are added, and any it held that aren't listed are removed. \`[]\` removes them all. At most ${TASK_PHOTOS_MAX}.`,
    type: [String],
    maxItems: TASK_PHOTOS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TASK_PHOTOS_MAX)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  reference_photo_paths?: string[];

  @ApiPropertyOptional({
    enum: TASK_PROOF_KINDS,
    description:
      "What Mark done needs (#4635). Changing it doesn't touch a completion already waiting on an officer.",
  })
  @IsOptional()
  @IsIn(TASK_PROOF_KINDS)
  proof_kind?: TaskProofKind;

  @ApiPropertyOptional({
    enum: TASK_EDIT_SCOPES,
    description:
      'On a copy of a repeating task (#5119): `instance` (default) edits this task only; `series` ("All upcoming tasks") edits what the next copies are made from and the series’ open copy, while it is still to come and not marked done. Done and overdue copies never change, and a copy keeps its day: a `due_date` other than its own is a 400 (move one copy with `instance`). On a copy of a group task (#4295 step 3): `group` ("Everyone’s copy") makes the edit to every copy not yet confirmed; `assignee_id` and `reference_photo_paths` change one copy only, so they are a 400 with it.',
  })
  @IsOptional()
  @IsIn(TASK_EDIT_SCOPES)
  scope?: TaskEditScope;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_REPEAT_RULE_LENGTH,
    description: `With \`scope: series\` only: a new rule, counted from the open copy, or null to stop repeating after it. ${TASK_RECURRENCE_RULE_DESCRIPTION}`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPEAT_RULE_LENGTH)
  @IsRepeatRule({ task: true })
  recurrence_rule?: string | null;
}

/**
 * The most members one `POST /v1/tasks/:id/group/remove` takes out (#5492):
 * above any chapter's roster, so a whole chapter fits in one call.
 */
export const TASK_GROUP_REMOVE_MAX = 1000;

/** `POST /v1/tasks/:id/group/remove` (#5492). */
export class RemoveFromTaskGroupDto {
  @ApiProperty({
    description: `The members whose copy goes, 1 to ${TASK_GROUP_REMOVE_MAX}. A member with no copy is skipped; a confirmed copy, or every copy, is a 400.`,
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: TASK_GROUP_REMOVE_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TASK_GROUP_REMOVE_MAX)
  @IsUUID('all', { each: true })
  assignee_ids: string[];
}

/** The group after `POST /v1/tasks/:id/group/remove` (#5492). */
export class RemoveFromTaskGroupResponseDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'The members whose copy was deleted.',
  })
  removed: string[];

  @ApiProperty({ type: () => TaskGroupSummaryDto })
  group: TaskGroupSummaryDto;
}

/** `DELETE /v1/tasks/:id` (#5119). */
export class DeleteTaskQueryDto {
  @ApiPropertyOptional({
    enum: TASK_EDIT_SCOPES,
    description:
      'On a copy of a repeating task: `instance` (default) deletes this task only; `series` ("All upcoming tasks") stops the repeat and deletes the open copy if it is still to come and no one has started it. Done and overdue copies stay. On a copy of a group task: `group` deletes every member’s copy and the group (#4295 step 3).',
  })
  @IsOptional()
  @IsIn(TASK_EDIT_SCOPES)
  scope?: TaskEditScope;
}

export class UpdateTaskSubtaskDto {
  @ApiProperty({ description: 'True to check it off, false to uncheck it.' })
  @IsStrictBoolean()
  done: boolean;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  status: TaskStatus;

  @ApiPropertyOptional({
    description: `With \`status: COMPLETED\` only: proof photos, each a \`storage_path\` from \`POST /v1/tasks/photo-upload-url\` (#4635), 1 to ${TASK_PHOTOS_MAX}. Required when the task's \`proof_kind\` is \`photo\`; a completion without it is a 400 with the code \`task.proof_required\`.`,
    type: [String],
    maxItems: TASK_PHOTOS_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TASK_PHOTOS_MAX)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  proof_photo_paths?: string[];

  @ApiPropertyOptional({
    description:
      "With `status: COMPLETED` only: a link proof, http or https (#4635). Required when the task's `proof_kind` is `link` (400 `task.proof_required` without it).",
    maxLength: TASK_PROOF_LINK_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_PROOF_LINK_MAX)
  proof_link?: string;

  @ApiPropertyOptional({
    description:
      'With `status: COMPLETED` only: a reply to the officer (#4635). On a task an officer sent back, a completion with neither new proof nor this is a 400 with the code `task.resubmit_needs_change`.',
    maxLength: TASK_COMPLETION_NOTE_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_COMPLETION_NOTE_MAX)
  completion_note?: string;
}

export class RequestTaskPhotoUploadUrlDto {
  @ApiProperty({ description: 'Original filename (a JPEG, PNG, GIF or WebP)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/jpeg)' })
  @IsString()
  content_type: string;

  @ApiPropertyOptional({
    description:
      'File size in bytes, if known. Rejected against the upload size ceiling when present.',
  })
  // Omitted is "size unknown"; `null` is not a size (#2913).
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  size_bytes?: number;
}

export class TaskPhotoUploadUrlResponseDto {
  @ApiProperty({ description: 'Short-lived signed URL; PUT the bytes to it.' })
  upload_url: string;

  @ApiProperty({
    description:
      'Storage path to send in `reference_photo_paths` (create, edit) or `proof_photo_paths` (Mark done).',
  })
  storage_path: string;
}

export class TaskPhotoUrlResponseDto {
  @ApiProperty({ description: 'Short-lived signed URL to view the photo.' })
  url: string;
}

export class RejectTaskCompletionDto {
  // Required by the service, not the schema: shipped phone builds send
  // Reject with no body, and the contract they were built with must stand
  // (check:api-breaking:shipped). They get the 400's message instead.
  @ApiPropertyOptional({
    description:
      'Why it goes back, in one line (#4635). Required: a send-back without it is a 400. Stored on the task as `sent_back_reason` and shown to the assignee until they mark it done again.',
    maxLength: TASK_SEND_BACK_REASON_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_SEND_BACK_REASON_MAX)
  comment?: string;

  @ApiPropertyOptional({
    description:
      '"Ask for a photo next time": raises the task\'s `proof_kind` to `photo`, so the next Mark done needs one.',
  })
  @IsOptional()
  @IsStrictBoolean()
  require_photo?: boolean;
}

/**
 * Compile-time key-drift guards between {@link CreateTaskResponseDto} and the
 * task row it publishes. Each resolves to `never` while the two agree; when
 * they diverge the alias stops satisfying `AssertNever`'s constraint and the build
 * fails naming the field.
 */
/**
 * Task fields {@link CreateTaskResponseDto} forgot to declare. Must be `never`.
 * @driftguard
 */
export type CreateTaskResponseDtoMissingFields = AssertNever<
  Exclude<keyof Task, keyof CreateTaskResponseDto>
>;

/**
 * Fields {@link CreateTaskResponseDto} declares that the task row does not
 * carry. Must be `never`. `card_posted` is excluded because it is this route's
 * own outcome flag, not a column — the one deliberate addition.
 * @driftguard
 */
export type CreateTaskResponseDtoExtraFields = AssertNever<
  Exclude<
    keyof CreateTaskResponseDto,
    keyof Task | 'card_posted' | 'photos' | 'group'
  >
>;
