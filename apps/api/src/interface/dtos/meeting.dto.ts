import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MEETING_DRAFT_FAILURES,
  MEETING_DRAFT_STATUSES,
  MEETING_ITEM_TEXT_MAX_LENGTH,
  MEETING_LIST_MAX_ITEMS,
  MEETING_NOTES_MAX_LENGTH,
  MAX_MEETING_RECORDING_BYTES,
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_RECORDING_FAILURES,
  MEETING_RECORDING_STATUSES,
  MEETING_SECTION_KEYS,
  MEETING_STATUSES,
  MEETING_TEXT_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_VOTE_MAX,
  STANDARDS_MEETING_TYPE,
} from '@repo/validation';

/** What a request may name as a type: the four, plus Standards to refuse it. */
const REQUESTABLE_TYPES = [...MEETING_TYPES, STANDARDS_MEETING_TYPE];
const EVENT_NAME_MAX_LENGTH = 200;
const ROLE_IDS_MAX = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MeetingVoteDto {
  @ApiProperty({ minimum: 0, maximum: MEETING_VOTE_MAX })
  @IsInt()
  @Min(0)
  @Max(MEETING_VOTE_MAX)
  for: number;

  @ApiProperty({ minimum: 0, maximum: MEETING_VOTE_MAX })
  @IsInt()
  @Min(0)
  @Max(MEETING_VOTE_MAX)
  against: number;

  @ApiProperty({ minimum: 0, maximum: MEETING_VOTE_MAX })
  @IsInt()
  @Min(0)
  @Max(MEETING_VOTE_MAX)
  abstain: number;
}

export class MeetingDecisionDto {
  @ApiProperty({ maxLength: MEETING_ITEM_TEXT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MEETING_ITEM_TEXT_MAX_LENGTH)
  text: string;

  @ApiProperty({
    type: MeetingVoteDto,
    nullable: true,
    description: 'The count, when the meeting recorded one. Never a guess.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => MeetingVoteDto)
  vote: MeetingVoteDto | null;
}

export class MeetingActionItemDto {
  @ApiProperty({ maxLength: MEETING_ITEM_TEXT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MEETING_ITEM_TEXT_MAX_LENGTH)
  text: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Only when someone was named for it.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  owner_user_id: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'A calendar day, YYYY-MM-DD.',
  })
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_PATTERN)
  @IsDateString({ strict: true })
  due_date: string | null;
}

/** Every section of the minutes, as a read returns them. */
export class MeetingContentDto {
  @ApiProperty() summary: string;
  @ApiProperty() announcements: string;
  @ApiProperty({ type: [MeetingDecisionDto] }) decisions: MeetingDecisionDto[];
  @ApiProperty({ type: [MeetingActionItemDto] })
  action_items: MeetingActionItemDto[];
  @ApiProperty() officer_reports: string;
  @ApiProperty() old_business: string;
  @ApiProperty() new_business: string;
  @ApiProperty() discussion_log: string;
}

/** A change to the minutes; a section left out keeps what is stored. */
export class MeetingContentPatchDto {
  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  summary?: string;

  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  announcements?: string;

  @ApiPropertyOptional({
    type: [MeetingDecisionDto],
    maxItems: MEETING_LIST_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MEETING_LIST_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => MeetingDecisionDto)
  decisions?: MeetingDecisionDto[];

  @ApiPropertyOptional({
    type: [MeetingActionItemDto],
    maxItems: MEETING_LIST_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MEETING_LIST_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => MeetingActionItemDto)
  action_items?: MeetingActionItemDto[];

  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  officer_reports?: string;

  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  old_business?: string;

  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  new_business?: string;

  @ApiPropertyOptional({ maxLength: MEETING_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEETING_TEXT_MAX_LENGTH)
  discussion_log?: string;
}

export class NewMeetingEventDto {
  @ApiProperty({ maxLength: EVENT_NAME_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(EVENT_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  start_time: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  end_time: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: ROLE_IDS_MAX,
    description:
      'Only members holding one of these roles are invited, and so read the minutes. Empty or omitted: everyone.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ROLE_IDS_MAX)
  @IsUUID('all', { each: true })
  role_ids?: string[];
}

export class StartMeetingDto {
  @ApiProperty({
    enum: REQUESTABLE_TYPES,
    description:
      'The meeting type. `standards` is refused with a 400: a Standards meeting is never kept in Frapp.',
  })
  @IsIn(REQUESTABLE_TYPES)
  meeting_type: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MEETING_OTHER_LABEL_MAX_LENGTH,
    description: 'A name for an Other meeting.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MEETING_OTHER_LABEL_MAX_LENGTH)
  other_label?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The meeting’s event. Send this or new_event.',
  })
  @IsOptional()
  @IsUUID()
  event_id?: string;

  @ApiPropertyOptional({
    type: NewMeetingEventDto,
    description:
      'Make an event for a meeting that has none: nobody required, no points, and no new-event push.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NewMeetingEventDto)
  new_event?: NewMeetingEventDto;
}

export class UpdateMeetingDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'The `updated_at` the editor loaded. A save over newer minutes answers 409 `meeting.stale`.',
  })
  @IsDateString()
  expected_updated_at: string;

  @ApiPropertyOptional({ enum: REQUESTABLE_TYPES })
  @IsOptional()
  @IsIn(REQUESTABLE_TYPES)
  meeting_type?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MEETING_OTHER_LABEL_MAX_LENGTH,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MEETING_OTHER_LABEL_MAX_LENGTH)
  other_label?: string | null;

  @ApiPropertyOptional({ type: MeetingContentPatchDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MeetingContentPatchDto)
  content?: MeetingContentPatchDto;
}

export class PostMeetingDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  expected_updated_at: string;
}

export class ListMeetingsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only the minutes of this event.',
  })
  @IsOptional()
  @IsUUID()
  event_id?: string;
}

export class MeetingTemplateDto {
  @ApiProperty({
    enum: MEETING_SECTION_KEYS,
    isArray: true,
    description: 'The sections the chapter’s minutes show, in order.',
  })
  @IsArray()
  @ArrayMaxSize(MEETING_SECTION_KEYS.length)
  @IsIn(MEETING_SECTION_KEYS, { each: true })
  sections: string[];
}

export class MeetingAttendeesDto {
  @ApiProperty({ type: [String] }) present: string[];
  @ApiProperty({ type: [String] }) late: string[];
  @ApiProperty({ type: [String] }) excused: string[];
}

/** One row of `GET /v1/meetings`. */
export class MeetingSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  event_id: string | null;
  @ApiProperty() event_name: string;
  @ApiProperty({ format: 'date-time' }) event_start_time: string;
  @ApiProperty({ enum: MEETING_TYPES }) meeting_type: string;
  @ApiProperty({ type: String, nullable: true }) other_label: string | null;
  @ApiProperty({ enum: MEETING_STATUSES }) status: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  created_by: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  posted_at: string | null;
  @ApiProperty({ format: 'date-time' }) updated_at: string;
}

/** A meeting's minutes, as `GET /v1/meetings/:id` and every write return them. */
export class MeetingDto extends MeetingSummaryDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  event_end_time: string | null;
  @ApiProperty({ type: MeetingContentDto }) content: MeetingContentDto;
  @ApiProperty({
    enum: MEETING_SECTION_KEYS,
    isArray: true,
    description: 'The chapter’s template, in order.',
  })
  sections: string[];
  @ApiProperty({
    type: MeetingAttendeesDto,
    nullable: true,
    description: 'The event’s check-ins; null when the event is gone.',
  })
  attendees: MeetingAttendeesDto | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  updated_by: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  posted_by: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
  @ApiProperty() can_edit: boolean;
  @ApiProperty() can_delete: boolean;
}

// ── Drafting from notes (#4312) ──────────────────────────────────────────────

export class RequestMeetingDraftDto {
  @ApiProperty({
    maxLength: MEETING_NOTES_MAX_LENGTH,
    description:
      'The officer’s notes, as typed or pasted. Sent to the AI provider the catalog names for the task, and stored only while the minutes are a draft.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MEETING_NOTES_MAX_LENGTH)
  notes: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'The minutes’ `updated_at` the editor has. The draft is put into the minutes only while they are still at this version.',
  })
  @IsDateString()
  expected_updated_at: string;

  @ApiPropertyOptional({
    example: '2026-11-09',
    description:
      'The meeting’s calendar day where the officer is, so "by Friday" in the notes becomes the right date.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  meeting_date?: string;
}

export class UseMeetingDraftDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'The minutes’ `updated_at` the editor has. The waiting draft is put in only while they are still at this version.',
  })
  @IsDateString()
  expected_updated_at: string;
}

export class MeetingDraftSourceDto {
  @ApiProperty({ enum: ['decision', 'action_item'] })
  kind: 'decision' | 'action_item';
  @ApiProperty({
    description: 'The drafted text, as it went into the minutes.',
  })
  text: string;
  @ApiProperty({
    description: 'The line of the notes it came from, word for word.',
  })
  quote: string;
}

export class MeetingDraftReviewDto {
  @ApiProperty({
    type: [String],
    description: 'What the notes leave unsaid, for the officer to fill in.',
  })
  gaps: string[];
  @ApiProperty({ type: [MeetingDraftSourceDto] })
  sources: MeetingDraftSourceDto[];
  @ApiProperty({
    description:
      'Drafted lines left out because the line they named is not in the notes.',
  })
  left_out: number;
}

export class MeetingDraftDto {
  @ApiProperty({ enum: MEETING_DRAFT_STATUSES })
  status: (typeof MEETING_DRAFT_STATUSES)[number];
  @ApiProperty({ description: 'The notes the draft was asked from, or "".' })
  notes: string;
  @ApiProperty({ enum: MEETING_DRAFT_FAILURES, nullable: true })
  failure: (typeof MEETING_DRAFT_FAILURES)[number] | null;
  @ApiProperty({ type: String, nullable: true })
  failure_message: string | null;
  @ApiProperty({
    type: MeetingContentPatchDto,
    nullable: true,
    description:
      'The drafted sections, only while `ready`: the minutes changed while the draft was written, so the officer chooses to use it.',
  })
  content: MeetingContentPatchDto | null;
  @ApiProperty({ type: MeetingDraftReviewDto })
  review: MeetingDraftReviewDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  requested_at: string | null;
  @ApiProperty({
    enum: ['chapter_off', 'consent_required'],
    nullable: true,
    description:
      'Why the caller can’t ask for a draft now: the chapter has meeting notes off, or they have not said yes on the AI sheet.',
  })
  blocked: 'chapter_off' | 'consent_required' | null;
}

// ── Uploading a recording (#712) ─────────────────────────────────────────────

export class StartMeetingRecordingDto {
  @ApiProperty({
    maxLength: 200,
    description: 'The file’s own name, shown back to the officer.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  file_name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'The browser’s name for the file’s type. May be empty; the file’s extension decides then.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mime_type?: string | null;

  @ApiProperty({
    maximum: MAX_MEETING_RECORDING_BYTES,
    description: 'The file’s size in bytes.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_MEETING_RECORDING_BYTES)
  size_bytes: number;

  @ApiProperty({
    description: 'The recording’s length in seconds, as the browser read it.',
  })
  @IsNumber()
  @Min(0)
  @Max(360000)
  duration_seconds: number;

  @ApiProperty({
    description:
      'The officer confirmed everyone in the room was told the meeting was being recorded. An upload without it is refused.',
  })
  @IsStrictBoolean()
  notice_confirmed: boolean;
}

export class ConfirmMeetingRecordingDto {
  @ApiProperty({ format: 'uuid', description: 'The upload that finished.' })
  @IsUUID()
  upload_id: string;
}

export class MeetingRecordingUploadDto {
  @ApiProperty({ format: 'uuid' })
  upload_id: string;
  @ApiProperty({ description: 'The private bucket the file goes to.' })
  bucket: string;
  @ApiProperty({ description: 'Where in the bucket the file goes.' })
  path: string;
  @ApiProperty({
    description:
      'Signs this one resumable upload (`x-signature`). Good for two hours.',
  })
  token: string;
  @ApiProperty({ description: 'The type to store the file under.' })
  content_type: string;
}

export class MeetingRecordingDto {
  @ApiProperty({ enum: MEETING_RECORDING_STATUSES })
  status: (typeof MEETING_RECORDING_STATUSES)[number];
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  upload_id: string | null;
  @ApiProperty({ type: String, nullable: true })
  file_name: string | null;
  @ApiProperty({ type: Number, nullable: true })
  size_bytes: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds: what the browser read while uploading and transcribing, what the provider measured once `ready`.',
  })
  duration_seconds: number | null;
  @ApiProperty({ enum: MEETING_RECORDING_FAILURES, nullable: true })
  failure: (typeof MEETING_RECORDING_FAILURES)[number] | null;
  @ApiProperty({ type: String, nullable: true })
  failure_message: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The transcript, one line per speaker turn, only while `ready`. The officer puts it into their notes.',
  })
  transcript: string | null;
  @ApiProperty({ type: Number, nullable: true })
  speaker_count: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  uploaded_at: string | null;
  @ApiProperty({
    description:
      'False when this server has no transcription provider set up: the upload step is not offered.',
  })
  available: boolean;
  @ApiProperty({
    enum: ['chapter_off', 'consent_required'],
    nullable: true,
    description:
      'Why the caller can’t upload now: the chapter has meeting notes off, or they have not said yes on the AI sheet.',
  })
  blocked: 'chapter_off' | 'consent_required' | null;
  @ApiProperty({ description: 'The largest file this server takes, in bytes.' })
  max_bytes: number;
  @ApiProperty({
    description: 'The longest recording this server takes, in seconds.',
  })
  max_seconds: number;
  @ApiProperty({
    type: MeetingRecordingUploadDto,
    nullable: true,
    description: 'Only in the answer to starting an upload.',
  })
  upload: MeetingRecordingUploadDto | null;
}
