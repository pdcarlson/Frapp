import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { MEMBER_NUDGE_KINDS, type MemberNudgeKind } from '@repo/validation';

const TARGET_TYPES = [
  'task',
  'event',
  'message',
  'channel',
  'review',
  'meeting',
  'study',
] as const;

export class ActivityNudgeItemDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The showing card's id, for `seen`; null for a tray item, which is only drawn.",
  })
  id: string | null;

  @ApiProperty({
    description: `Why the card exists. One of ${MEMBER_NUDGE_KINDS.join(', ')} today; a client draws a kind it does not know with a neutral icon.`,
    example: 'event_soon',
  })
  kind: string;

  @ApiProperty({
    description:
      'What the card is about, opaque to the client. Sent back with `kind` to dismiss it.',
  })
  subject_key: string;

  @ApiProperty({
    description:
      "The thing's own name: an event, a channel, a sign-up's title.",
    example: 'Chapter Meeting',
  })
  headline: string;

  @ApiProperty({
    description:
      "When, where or how many, written out in the caller's time zone (`X-Time-Zone`).",
    example: 'Tonight 7:00 PM · Chapter House · Required',
  })
  meta: string;

  @ApiProperty({
    description:
      'Whether the time or count is pressing enough to draw in colour.',
  })
  urgent: boolean;

  @ApiProperty({
    description: "The tray chip's few characters: a count, Tonight, Due Fri.",
    example: 'Tonight',
  })
  chip: string;

  @ApiProperty({ description: "The button's label.", example: 'Open event' })
  action: string;

  @ApiProperty({
    enum: TARGET_TYPES,
    description:
      'What the button opens: a task, an event, a chat message (a sign-up), a channel, the review queue, minutes, or study.',
  })
  target_type: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The id of what it opens: a task, event, message, channel, meeting, or the oldest item in the review queue; null for study.',
  })
  target_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The channel a message or channel target is in.',
  })
  channel_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The task a task card is about.',
  })
  task_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'One sentence Frapp AI wrote for the card, or null: a plain card, because AI is off for the caller or the server, or the kind is never written.',
  })
  line: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "A task card's suggested place to start, when AI wrote one.",
  })
  start_here: string | null;

  @ApiProperty({
    description: 'False until the caller has had the card on screen.',
  })
  seen: boolean;
}

export class ActivityNudgeCardDto {
  @ApiProperty({
    type: ActivityNudgeItemDto,
    nullable: true,
    description:
      'The one most useful thing waiting on the caller, or null when nothing is, or they turned these cards off.',
  })
  card: ActivityNudgeItemDto | null;

  @ApiProperty({
    type: [ActivityNudgeItemDto],
    description: 'Up to three more, in order, for the tray under the card.',
  })
  tray: ActivityNudgeItemDto[];
}

export class ActivityNudgeSeenDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

export class ActivityNudgeDismissDto {
  @ApiProperty({ enum: MEMBER_NUDGE_KINDS })
  @IsIn(MEMBER_NUDGE_KINDS)
  kind: MemberNudgeKind;

  @ApiProperty({
    description: 'The `subject_key` the card or tray item carried.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject_key: string;
}
