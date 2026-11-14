import { ApiProperty } from '@nestjs/swagger';
import { TASK_PROOF_KINDS, type TaskProofKind } from '@repo/validation';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ACTIVITY_ITEM_KINDS } from '#domain/entities/activity-item-read.entity';
import type { ActivityItemKind } from '#domain/entities/activity-item-read.entity';
import type { ActivityItemRef } from '#domain/repositories/activity-item-read.repository.interface';
import { CHAT_LINK_MEMBER_STATES } from '#domain/entities/chat.entity';
import type { ChatLinkMemberStateValue } from '#domain/entities/chat.entity';
import type { ActivityLink } from '../../application/services/activity-link.service';
import { ChatMessageDto } from './chat.dto';
import { TaskStatus } from '#domain/entities/task.entity';
import type { ChannelType } from '#domain/entities/chat.entity';
import {
  ACTIVITY_SECTIONS,
  ACTIVITY_WEEK_PARTS,
} from '../../application/services/activity.service';
import { STANDING_SECTIONS } from '../../application/services/activity-standing.service';
import { RECAP_PARTS } from '../../application/services/activity-recap.service';
import type {
  ActivityRecap,
  RecapPart,
} from '../../application/services/activity-recap.service';
import type {
  ActivityStanding,
  StandingPoints,
  StandingRequiredEvents,
  StandingSection,
  StandingService,
  StandingStudy,
} from '../../application/services/activity-standing.service';
import type {
  ActivityCard,
  ActivityEvent,
  ActivityHoursEntry,
  ActivityPoll,
  ActivitySection,
  ActivityTask,
  ActivityView,
  ActivityWeek,
  ActivityWeekCount,
  ActivityWeekPart,
} from '../../application/services/activity.service';

/**
 * Items one `POST /v1/activity/reads` may carry: every row Activity serves
 * that can be unread is at most 135, so a client marking a whole page read
 * sends two.
 */
const ACTIVITY_READ_BATCH_LIMIT = 100;

/** Every channel type, direct messages included: a poll can be posted in any. */
const ACTIVITY_EVENT_ATTENDANCE: ActivityEvent['attendance'][] = [
  'required',
  'optional',
];

const ACTIVITY_CHANNEL_TYPES: ChannelType[] = [
  'PUBLIC',
  'PRIVATE',
  'ROLE_GATED',
  'DM',
  'GROUP_DM',
];

export class ActivityTaskDto implements ActivityTask {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date', example: '2026-11-20' })
  due_date: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'The moment it is due, when it has a time of day.',
  })
  due_at: string | null;

  @ApiProperty({
    enum: TaskStatus,
    description: 'Display status: OVERDUE for an open task past its due date.',
  })
  status: TaskStatus;

  @ApiProperty({
    enum: TaskStatus,
    description:
      'The status actually stored, which the next transition is checked against.',
  })
  stored_status: TaskStatus;

  @ApiProperty({ format: 'uuid' })
  assignee_id: string;

  @ApiProperty({
    description: 'Empty when the member cannot be resolved (they have left).',
  })
  assignee_name: string;

  @ApiProperty({ format: 'uuid' })
  created_by: string;

  @ApiProperty({
    description: 'Empty when the member cannot be resolved (they have left).',
  })
  created_by_name: string;

  @ApiProperty({ type: Number, nullable: true })
  point_reward: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completed_at: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When an officer confirmed the completion; null until then. A completed task with no confirmation is still waiting on one.',
  })
  confirmed_at: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When an officer last sent the completion back to the assignee; null if never.',
  })
  sent_back_at: string | null;

  @ApiProperty({
    enum: TASK_PROOF_KINDS,
    description:
      'What Mark done needs (#4635). A completed task with no `point_reward` and `none` needed no sign-off: it reads Done.',
  })
  proof_kind: TaskProofKind;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it started waiting on them: since it was assigned or last sent back, or for a confirmation since it was completed (`POST /v1/activity/reads`). Always false while `unread_since` is null, in `made_by_you`, and for a task the caller assigned to themselves that was never sent back.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;
}

export class ActivityHoursEntryDto implements ActivityHoursEntry {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty({
    description: 'Empty when the member cannot be resolved (they have left).',
  })
  member_name: string;

  @ApiProperty({ format: 'date', example: '2026-11-08' })
  date: string;

  @ApiProperty()
  duration_minutes: number;

  @ApiProperty()
  description: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it was submitted (`POST /v1/activity/reads`). Always false while `unread_since` is null.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;
}

export class ActivityPollDto implements ActivityPoll {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chat message that is the poll card. It is served whole in `message`; this row carries no tallies.',
  })
  message_id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    description:
      'The channel’s name. A direct message’s is server-generated, so label those from `channel_type`.',
  })
  channel_name: string;

  @ApiProperty({ enum: ACTIVITY_CHANNEL_TYPES })
  channel_type: ChannelType;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sender_id: string | null;

  @ApiProperty()
  question: string;

  @ApiProperty()
  option_count: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When voting stops. Null for a card posted with no usable deadline, which stays open.',
  })
  closes_at: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Set when it was closed early, by its creator or a channels:manage holder.',
  })
  closed_at: string | null;

  @ApiProperty()
  is_closed: boolean;

  @ApiProperty()
  has_voted: boolean;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it was posted (`POST /v1/activity/reads`). Always false while `unread_since` is null, and in `made_by_you`.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;

  @ApiProperty({
    type: ChatMessageDto,
    description:
      'The poll’s chat message, as `GET /v1/channels/{id}/messages` serves it, for chat’s own poll card. Its votes are read from `chat_message_actions`, as chat reads them.',
  })
  message: ActivityPoll['message'];
}

export class ActivityCardDto implements ActivityCard {
  @ApiProperty({
    enum: ['signup', 'headcount', 'form'],
    description:
      '`signup` for a sign-up sheet of slots, `headcount` for a Going / Can’t make it sign-up, `form` for a form card. Its read is recorded as `signup` for the first two and `form` for a form.',
  })
  kind: ActivityCard['kind'];

  @ApiProperty({
    format: 'uuid',
    description:
      'The chat message that is the card. A client opens it in chat, where it is answered.',
  })
  message_id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    description:
      'The channel’s name. A direct message’s is server-generated, so label those from `channel_type`.',
  })
  channel_name: string;

  @ApiProperty({ enum: ACTIVITY_CHANNEL_TYPES })
  channel_type: ChannelType;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sender_id: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({
    description:
      'How many slots a sign-up sheet has, or questions a form asks; 2 for a headcount.',
  })
  item_count: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When it stops taking answers. Null for a card with no end time.',
  })
  closes_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it was posted (`POST /v1/activity/reads`). Always false while `unread_since` is null.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;
}

export class ActivityEventDto implements ActivityEvent {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ format: 'date-time' })
  start_time: string;

  @ApiProperty({ format: 'date-time' })
  end_time: string;

  @ApiProperty({
    enum: ACTIVITY_EVENT_ATTENDANCE,
    description:
      'What the event asks of the caller, not the event’s default: a role of theirs the event lists decides it, and an alumnus the default alone would require is optional.',
  })
  attendance: ActivityEvent['attendance'];

  @ApiProperty()
  point_value: number;

  @ApiProperty()
  check_in_opens_minutes: number;

  @ApiProperty({
    description:
      'Whether the caller can check in right now: the window is open and check-in would not refuse them.',
  })
  check_in_open: boolean;

  @ApiProperty({
    description:
      'Whether checking in needs the caller’s location: the event has a check-in zone. A surface that can’t supply one says to use the phone app instead of offering a check-in the server refuses.',
  })
  check_in_needs_location: boolean;

  @ApiProperty({
    description:
      'Whether checking in needs the code on an officer’s check-in screen: one has shown it and check-in is still open. A surface that can’t scan says to point the phone’s camera at the code instead of offering a check-in the server refuses. Read only while check-in is open; false otherwise.',
  })
  check_in_needs_code: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Whether the caller has an attendance row for it. Read only while check-in is open; null otherwise, and when that read failed.',
  })
  checked_in: boolean | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Who made it. Null for an event made before makers were recorded (2026-11-11).',
  })
  created_by: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it was made (`POST /v1/activity/reads`). Always false while `unread_since` is null, in `made_by_you`, and for an event the caller made.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;
}

/** A file the caller uploaded. Never served since #4291; see `ActivityMadeByYouDto.files`. */
export class ActivityFileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['document', 'backwork'] })
  source: 'document' | 'backwork';

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export class ActivityLinkDto implements ActivityLink {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'The link as posted. Opens outside Frapp.' })
  url: string;

  @ApiProperty({
    description: 'The link’s host, lower-cased and without `www.`.',
    example: 'docs.google.com',
  })
  host: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The linked page’s own name (a form’s or sheet’s title), read in the background after the link was posted. Null when the page had none worth showing (a private file’s sign-in page, or a page that names only the product) or has not been read yet: title the row by its kind instead.',
    example: '5K volunteer shifts',
  })
  title: string | null;

  @ApiProperty({
    format: 'uuid',
    description: 'The chat message it was posted in, for “Open in chat”.',
  })
  message_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Set when the message is a thread reply, which the channel’s timeline doesn’t show: “Open in chat” opens this thread.',
  })
  thread_root_id: string | null;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    description:
      'The channel’s name. A direct message’s is server-generated, so label those from `channel_type`.',
  })
  channel_name: string;

  @ApiProperty({ enum: ACTIVITY_CHANNEL_TYPES })
  channel_type: ChannelType;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null for an imported author with no Frapp account.',
  })
  posted_by: string | null;

  @ApiProperty({
    description: 'Empty when the poster cannot be resolved.',
  })
  posted_by_name: string;

  @ApiProperty({ format: 'date-time' })
  posted_at: string;

  @ApiProperty({
    description:
      'Whether the caller hasn’t opened it from Activity since it was posted (`POST /v1/activity/reads`). Always false while `unread_since` is null.',
  })
  unread: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Until when the caller snoozed it (`PUT /v1/activity/snoozes`), while the snooze lasts; null when it isn’t snoozed. A snoozed row is not counted in `needs_you_count`; a client lists it apart and brings it back at that time, unread unless opened since. Always null in `made_by_you`.',
  })
  snoozed_until: string | null;
}

/** `PUT /v1/activity/links/{id}/state`. */
export class SetActivityLinkStateDto {
  @ApiProperty({
    enum: CHAT_LINK_MEMBER_STATES,
    description:
      '`done`: the caller filled it in. `hidden`: not chapter business for them. Either takes it off their own list only.',
  })
  @IsIn(CHAT_LINK_MEMBER_STATES)
  state: ChatLinkMemberStateValue;
}

/** One item in `POST /v1/activity/reads`. */
export class ActivityItemRefDto implements ActivityItemRef {
  @ApiProperty({
    enum: ACTIVITY_ITEM_KINDS,
    description:
      'Which module’s id `item_id` is. `task` for a row in `tasks` or `task_confirmations`, `hours_entry` for `hours_approvals`, `poll` for a poll (its `message_id`), `event` for `coming_up`, `link` for `links`, `signup` for a sign-up or headcount card and `form` for a form card in `cards` (its `message_id`).',
  })
  @IsIn(ACTIVITY_ITEM_KINDS)
  kind: ActivityItemKind;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  item_id: string;
}

/** `PUT /v1/activity/snoozes`. */
export class SnoozeActivityItemDto extends ActivityItemRefDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'When the row comes back. In the future and at most 90 days away.',
  })
  @IsISO8601({ strict: true })
  until: string;
}

/** `POST /v1/activity/reads`. */
export class MarkActivityReadDto {
  @ApiProperty({
    type: [ActivityItemRefDto],
    minItems: 1,
    maxItems: ACTIVITY_READ_BATCH_LIMIT,
    description: `The items the caller opened. At most ${ACTIVITY_READ_BATCH_LIMIT}.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ACTIVITY_READ_BATCH_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => ActivityItemRefDto)
  items: ActivityItemRefDto[];
}

export class ActivityNeedsYouDto {
  @ApiProperty({
    type: [ActivityTaskDto],
    description: 'Open tasks assigned to the caller, soonest due first.',
  })
  tasks: ActivityTaskDto[];

  @ApiProperty({
    type: [ActivityTaskDto],
    description:
      'Finished tasks the caller can confirm (`tasks:manage`, never their own), longest waiting first.',
  })
  task_confirmations: ActivityTaskDto[];

  @ApiProperty({
    type: [ActivityHoursEntryDto],
    description:
      'Pending service entries the caller can approve (`service:approve`, never their own), oldest first.',
  })
  hours_approvals: ActivityHoursEntryDto[];

  @ApiProperty({
    type: [ActivityPollDto],
    description:
      'Open polls from other members, in channels the caller can read, that the caller hasn’t voted on. Soonest closing first.',
  })
  polls: ActivityPollDto[];

  @ApiProperty({
    type: [ActivityCardDto],
    description:
      'Open sign-up sheets, headcounts and forms from other members, in channels the caller can read, that the caller hasn’t answered: no slot held on a sheet, neither answer on a headcount, no saved form response. Soonest closing first, then newest; one with no end time last.',
  })
  cards: ActivityCardDto[];
}

export class ActivityMadeByYouDto {
  @ApiProperty({
    type: [ActivityPollDto],
    description:
      'Poll cards the caller posted, newest first: up to 25 open and the 25 most recently posted closed ones, so closed polls never push an open one out. A client lists the open ones and keeps the closed ones behind an archive (#4258).',
  })
  polls: ActivityPollDto[];

  @ApiProperty({
    type: [ActivityTaskDto],
    description:
      'Tasks the caller assigned, newest first. Empty unless the caller still holds `tasks:manage`.',
  })
  tasks: ActivityTaskDto[];

  @ApiProperty({
    type: [ActivityFileDto],
    deprecated: true,
    description:
      'Always empty: uploads left Activity (#4291). Served only so a client built before that does not fail on its absence; to be removed.',
  })
  files: ActivityFileDto[];

  @ApiProperty({
    type: [ActivityEventDto],
    description:
      'Events the caller made that invite them and whose check-in has not closed, soonest first; a recurring series is one row, its next meeting. Events made before creators were recorded (#3897) are never here.',
  })
  events: ActivityEventDto[];
}

export class ActivityWeekCountDto implements ActivityWeekCount {
  @ApiProperty({ description: 'How many the caller has done this week.' })
  done: number;

  @ApiProperty({
    description: '`done` plus what is still open; never less than `done`.',
  })
  total: number;
}

export class ActivityWeekDto implements ActivityWeek {
  @ApiProperty({
    format: 'date-time',
    description:
      'Where the week begins: the `week_start` the client named, or last Sunday at midnight UTC when it named none or one out of range.',
  })
  start: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Seven days after `start`.',
  })
  end: string;

  @ApiProperty({
    type: ActivityWeekCountDto,
    nullable: true,
    description:
      'Events that start this week and invite the caller. Done: marked present or late. Still open: a required event not attended (ahead or missed), and an optional one whose check-in has not closed. An excused event, and an optional one the caller skipped, is left out. Null when Events is off or couldn’t be read.',
  })
  events: ActivityWeekCountDto | null;

  @ApiProperty({
    type: ActivityWeekCountDto,
    nullable: true,
    description:
      'The caller’s own tasks. Done: marked done since the week began, confirmed or not. Still open: not done and due before the week ends, overdue ones included. Null when Tasks is off or couldn’t be read.',
  })
  tasks: ActivityWeekCountDto | null;

  @ApiProperty({
    type: ActivityWeekCountDto,
    nullable: true,
    description:
      'Other members’ polls the caller can read. Done: first voted on since the week began. Still open: every `needs_you.polls` row, counted before its cap. Null when Polls is off or couldn’t be read.',
  })
  polls: ActivityWeekCountDto | null;

  @ApiProperty({
    type: ActivityWeekCountDto,
    nullable: true,
    description:
      'Other members’ sign-up sheets, headcounts and forms. Done: first answered since the week began. Still open: every `needs_you.cards` row, counted before its cap. Null when the read failed.',
  })
  cards: ActivityWeekCountDto | null;

  @ApiProperty({
    enum: ACTIVITY_WEEK_PARTS,
    isArray: true,
    description:
      'Parts that could not be read this time. Each is served null, as a part whose module is off is; this list tells the two apart.',
  })
  unavailable: ActivityWeekPart[];
}

export class ActivityDto implements ActivityView {
  @ApiProperty({ type: ActivityNeedsYouDto })
  needs_you: ActivityNeedsYouDto;

  @ApiProperty({
    type: [ActivityEventDto],
    description:
      'Events that invite the caller and start within 14 days, or whose check-in is still open, soonest first. At most 10.',
  })
  coming_up: ActivityEventDto[];

  @ApiProperty({
    type: [ActivityLinkDto],
    description:
      'Sign-up links (forms, sheets, booking pages) posted in the last 30 days in channels the caller can read and an officer has not left out of Activity. Never the caller’s own, a blocked member’s, one an officer removed, or one the caller marked Done or Hidden. Newest first, at most 25. Not counted in `needs_you_count`.',
  })
  links: ActivityLinkDto[];

  @ApiProperty({ type: ActivityMadeByYouDto })
  made_by_you: ActivityMadeByYouDto;

  @ApiProperty({
    description:
      'How many things wait on the caller: every `needs_you` row, counted before the 25-row cap on each list, plus events the caller can check in to now and hasn’t, less what the caller snoozed (`snoozed_until`).',
  })
  needs_you_count: number;

  @ApiProperty({
    enum: ACTIVITY_SECTIONS,
    isArray: true,
    description:
      'Sections that could not be read this time. Each is served empty; the others are unaffected.',
  })
  unavailable: ActivitySection[];

  @ApiProperty({
    type: ActivityWeekDto,
    description:
      'How the caller’s week is going, for the ring at the top of the page (`spec/behavior/activity.md` § Week): what they finished since the week began and what is still theirs to do in it, by kind. Their own things only; what waits on their review is not counted.',
  })
  week: ActivityWeekDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the caller’s unread dots began in this chapter. Null until a client that draws dots calls `PUT /v1/activity/unread-since`, and every `unread` is false until then. Nothing that appeared before it is unread. Also served null, with every row read, when the caller’s unread state couldn’t be loaded.',
  })
  unread_since: string | null;
}

/** The query of both Activity reads: where the caller's week begins. */
export class ActivityWeekQueryDto {
  @ApiProperty({
    required: false,
    format: 'date-time',
    description:
      'Where the caller’s week begins, in their own time zone (the Study screen’s week: Sunday at midnight). Between eight days ago and a day from now: outside that, the standing answers 400 and `GET /v1/activity` counts the default week. Omitted: last Sunday at midnight UTC.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  week_start?: string;
}

/**
 * The recap's week, named by the client's clock (#4983). Only `week_start`
 * is the standing's; the two below let the client say where its last week
 * began and on which day, which the server can't work out across a clock
 * change or east of UTC+12.
 */
export class ActivityRecapQueryDto extends ActivityWeekQueryDto {
  @ApiProperty({
    required: false,
    format: 'date-time',
    description:
      'Where the caller’s last week began, in their own time zone (the Sunday before `week_start`, at midnight). Used when it is within three hours of seven days before `week_start` (a clock change moves it by an hour); otherwise, or omitted, seven days before `week_start`.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  last_week_start?: string;

  @ApiProperty({
    required: false,
    example: '2026-11-08',
    description:
      'The calendar date of the last week’s first day in the caller’s time zone, for service entries, which are dated by day. Used when it is within a day of the day the server works out; otherwise, or omitted, the server’s day.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  first_day?: string;
}

export class StandingPointsDto implements StandingPoints {
  @ApiProperty({ description: 'Points earned this semester.' })
  total: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Place on this semester’s board, equal totals sharing a place. Null when the caller is not on the board.',
  })
  rank: number | null;

  @ApiProperty({ description: 'How many members the board ranks.' })
  ranked: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The caller’s points goal this semester (#1062), or null when the chapter sets none for them.',
  })
  goal: number | null;
}

export class StandingRequiredEventsDto implements StandingRequiredEvents {
  @ApiProperty({
    description:
      'Required events since the semester began (or the caller joined), excused ones left out. An event counts once its check-in closes, or as soon as the caller checks in.',
  })
  required: number;

  @ApiProperty({ description: 'Of `required`, those marked present or late.' })
  attended: number;

  @ApiProperty({ description: 'Required events the caller was excused from.' })
  excused: number;
}

export class StandingServiceDto implements StandingService {
  @ApiProperty({ description: 'Approved service minutes this semester.' })
  approved_minutes: number;

  @ApiProperty({ description: 'Service minutes waiting for approval.' })
  pending_minutes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The caller’s service goal this semester in minutes (#1062), or null for none.',
  })
  goal_minutes: number | null;
}

export class StandingStudyDto implements StandingStudy {
  @ApiProperty({
    description:
      'Minutes from study sessions that started this week and have ended.',
  })
  minutes: number;

  @ApiProperty({ format: 'date-time' })
  week_start: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The caller’s study goal for the week in minutes (#1062), or null for none.',
  })
  goal_minutes: number | null;
}

export class ActivityStandingDto implements ActivityStanding {
  @ApiProperty({
    type: StandingPointsDto,
    nullable: true,
    description: 'Null when Points is off or couldn’t be read.',
  })
  points: StandingPointsDto | null;

  @ApiProperty({
    type: StandingRequiredEventsDto,
    nullable: true,
    description: 'Null when Events is off or couldn’t be read.',
  })
  required_events: StandingRequiredEventsDto | null;

  @ApiProperty({
    type: StandingServiceDto,
    nullable: true,
    description: 'Null when Hours is off or couldn’t be read.',
  })
  service: StandingServiceDto | null;

  @ApiProperty({
    type: StandingStudyDto,
    nullable: true,
    description: 'Null when Hours is off or couldn’t be read.',
  })
  study: StandingStudyDto | null;

  @ApiProperty({
    enum: STANDING_SECTIONS,
    isArray: true,
    description:
      'Parts that could not be read this time. Each is served null; the others are unaffected.',
  })
  unavailable: StandingSection[];
}

export class ActivityRecapDto implements ActivityRecap {
  @ApiProperty({
    format: 'date-time',
    description:
      'Where last week began: seven days before the `week_start` sent (the start of the caller’s current week).',
  })
  start: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Where last week ended: the `week_start` sent.',
  })
  end: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Events that started last week, among those the caller can see, where they were marked present or late. Null when Events is off or couldn’t be read.',
  })
  events_attended: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The caller’s own tasks they marked done last week, confirmed or not; one sent back since is not counted. Null when Tasks is off or couldn’t be read.',
  })
  tasks_done: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Points awarded to the caller last week less points taken, from the ledger. Null when Points is off or couldn’t be read.',
  })
  points: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Service minutes the caller logged for last week’s days, approved or waiting. Null when Hours is off or couldn’t be read.',
  })
  service_minutes: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Minutes from the caller’s study sessions that started last week and have ended. Null when Hours is off or couldn’t be read.',
  })
  study_minutes: number | null;

  @ApiProperty({
    enum: RECAP_PARTS,
    isArray: true,
    description:
      'Parts that could not be read this time. Each is served null; the others are unaffected.',
  })
  unavailable: RecapPart[];
}
