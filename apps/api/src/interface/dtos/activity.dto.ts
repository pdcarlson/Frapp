import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CHAT_LINK_MEMBER_STATES } from '#domain/entities/chat.entity';
import type { ChatLinkMemberStateValue } from '#domain/entities/chat.entity';
import type { ActivityLink } from '../../application/services/activity-link.service';
import { ChatMessageDto } from './chat.dto';
import { TaskStatus } from '#domain/entities/task.entity';
import type { ChannelType } from '#domain/entities/chat.entity';
import { ACTIVITY_SECTIONS } from '../../application/services/activity.service';
import type {
  ActivityEvent,
  ActivityFile,
  ActivityHoursEntry,
  ActivityPoll,
  ActivitySection,
  ActivityTask,
  ActivityView,
} from '../../application/services/activity.service';

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

  @ApiProperty({ format: 'date-time' })
  created_at: string;
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
    description: 'Set when its creator closed it early.',
  })
  closed_at: string | null;

  @ApiProperty()
  is_closed: boolean;

  @ApiProperty()
  has_voted: boolean;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({
    type: ChatMessageDto,
    description:
      'The poll’s chat message, as `GET /v1/channels/{id}/messages` serves it, for chat’s own poll card. Its votes are read from `chat_message_actions`, as chat reads them.',
  })
  message: ActivityPoll['message'];
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
    type: Boolean,
    nullable: true,
    description:
      'Whether the caller has an attendance row for it. Read only while check-in is open; null otherwise, and when that read failed.',
  })
  checked_in: boolean | null;
}

const ACTIVITY_FILE_SOURCES: ActivityFile['source'][] = [
  'document',
  'backwork',
];

export class ActivityFileDto implements ActivityFile {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: ACTIVITY_FILE_SOURCES,
    description:
      'Which module holds it: a chapter document or a backwork resource.',
  })
  source: ActivityFile['source'];

  @ApiProperty({ description: 'Empty for a backwork resource with no title.' })
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
    format: 'uuid',
    description: 'The chat message it was posted in, for “Open in chat”.',
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
}

export class ActivityMadeByYouDto {
  @ApiProperty({
    type: [ActivityPollDto],
    description: 'Poll cards the caller posted, newest first.',
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
    description: 'Documents and backwork the caller uploaded, newest first.',
  })
  files: ActivityFileDto[];

  @ApiProperty({
    type: [ActivityEventDto],
    description:
      'Events the caller made that invite them and whose check-in has not closed, soonest first; a recurring series is one row, its next meeting. Events made before creators were recorded (#3897) are never here.',
  })
  events: ActivityEventDto[];
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
      'How many things wait on the caller: every `needs_you` row, counted before the 25-row cap on each list, plus events the caller can check in to now and hasn’t.',
  })
  needs_you_count: number;

  @ApiProperty({
    enum: ACTIVITY_SECTIONS,
    isArray: true,
    description:
      'Sections that could not be read this time. Each is served empty; the others are unaffected.',
  })
  unavailable: ActivitySection[];
}
