import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  MEMBER_NUDGE_DISMISS_REASONS,
  MEMBER_NUDGE_KINDS,
  type MemberNudgeDismissReason,
} from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

export class MemberNudgeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: `Why the card exists. One of ${MEMBER_NUDGE_KINDS.join(', ')} today; a client shows a kind it does not know as a plain card.`,
    example: 'task_due_soon',
  })
  kind: string;

  @ApiProperty({ description: 'A few words, plain text.' })
  title: string;

  @ApiProperty({ description: 'One or two sentences, plain text.' })
  body: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'A suggested place to start: one sentence, or null when the card has none.',
  })
  start_here: string | null;

  @ApiProperty({ format: 'uuid', description: 'The task the card is about.' })
  task_id: string;

  @ApiProperty({ description: "The task's own title." })
  task_title: string;

  @ApiProperty({
    description: 'False until the member has had the card on screen.',
  })
  seen: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: string;
}

export class MemberNudgeCurrentDto {
  @ApiProperty({
    type: MemberNudgeDto,
    nullable: true,
    description:
      'The one card to show, or null: nothing is worth a card right now, the member turned cards off, or AI is off for them.',
  })
  nudge: MemberNudgeDto | null;
}

export class DismissMemberNudgeDto {
  @ApiProperty({
    enum: MEMBER_NUDGE_DISMISS_REASONS,
    description:
      '`not_now` closes the card. `fewer` also keeps new cards away for two weeks. `thanks` closes a word of thanks.',
  })
  @IsIn(MEMBER_NUDGE_DISMISS_REASONS)
  reason: MemberNudgeDismissReason;
}

export class MemberNudgeSettingsDto {
  @ApiProperty({ description: "The member's own switch for these cards." })
  enabled: boolean;
}

export class UpdateMemberNudgeSettingsDto {
  @ApiProperty()
  @IsStrictBoolean()
  enabled: boolean;
}
