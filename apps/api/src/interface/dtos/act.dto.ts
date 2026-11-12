import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ACT_REQUEST_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from '@repo/validation';
import type { ActOutcome } from '../../application/services/act/act.service';
import { AiSuggestionDto } from './ai-suggestion.dto';

export class ActRequestDto {
  @ApiProperty({
    description: 'What to do, in the member’s own words.',
    example: 'Give 5 points to everyone who came to chapter tonight',
    maxLength: ACT_REQUEST_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACT_REQUEST_MAX_LENGTH)
  request: string;
}

export class ActEventAudienceDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The event whose attendees the points are for.',
  })
  @IsUUID()
  event_id: string;

  @ApiProperty({
    minimum: -POINTS_ADJUSTMENT_MAX,
    maximum: POINTS_ADJUSTMENT_MAX,
    description: 'As the `needs_event` answer carried it.',
  })
  @IsInt()
  @NotEquals(0)
  @Min(-POINTS_ADJUSTMENT_MAX)
  @Max(POINTS_ADJUSTMENT_MAX)
  amount: number;

  @ApiPropertyOptional({
    maxLength: POINTS_REASON_MAX_LENGTH,
    description:
      'As the `needs_event` answer carried it. Empty names the event instead.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(POINTS_REASON_MAX_LENGTH)
  reason?: string;
}

export class ActStatusDto {
  @ApiProperty({
    type: [String],
    description:
      'The actions the caller could be offered now: `give_points`, `create_task`, `create_event`. Open: a client ignores one it does not know.',
  })
  actions: string[];
}

export class ActNoteDto {
  @ApiProperty({
    description:
      'What the card says beside the proposal: `matched_name`, `unmatched_name`, `ambiguous_name`, `role_members`, `self_left_out`. Open.',
  })
  type: string;

  @ApiPropertyOptional({ description: 'The name as the member typed it.' })
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'The members a name was matched to, or could be.',
  })
  user_ids?: string[];

  @ApiPropertyOptional()
  count?: number;
}

export class ActEventChoiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'date-time' })
  start_time: string;
}

export class ActEventChoiceSetDto {
  @ApiProperty()
  amount: number;

  @ApiProperty({ description: 'Empty when no reason was said.' })
  reason: string;

  @ApiProperty({ type: [ActEventChoiceDto] })
  events: ActEventChoiceDto[];
}

export class ActResponseDto {
  @ApiProperty({
    description:
      '`proposed` (a card waits in `suggestion`), `needs_event`, `unclear`, `no_action`, `refused` or `unavailable`. Open.',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The action the request was read as, when one was.',
  })
  action: string | null;

  @ApiProperty({
    type: AiSuggestionDto,
    nullable: true,
    description:
      'The proposal, when `proposed`. Nothing has changed: confirm it with `POST /v1/ai/suggestions/{id}/accept`, or cancel it with `.../dismiss`.',
  })
  suggestion: AiSuggestionDto | null;

  @ApiProperty({ type: [ActNoteDto] })
  notes: ActNoteDto[];

  @ApiProperty({
    type: ActEventChoiceSetDto,
    nullable: true,
    description:
      'When `needs_event`: the events to pick from. Send the pick to `POST /v1/ai/act/event-audience`.',
  })
  event_choice: ActEventChoiceSetDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When `unclear`: what was not said. Open.',
  })
  missing: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When `unavailable`: why. Open.',
  })
  reason: string | null;

  @ApiProperty({
    type: [String],
    description: 'When `no_action`: what the caller could ask for instead.',
  })
  available_actions: string[];

  static from(outcome: ActOutcome): ActResponseDto {
    const base: ActResponseDto = {
      status: outcome.status,
      action: null,
      suggestion: null,
      notes: [],
      event_choice: null,
      missing: null,
      reason: null,
      available_actions: [],
    };
    switch (outcome.status) {
      case 'proposed':
        return {
          ...base,
          action: outcome.action,
          suggestion: AiSuggestionDto.from(outcome.suggestion),
          notes: outcome.notes.map((note) => ({ ...note })),
        };
      case 'needs_event':
        return {
          ...base,
          action: outcome.action,
          event_choice: {
            amount: outcome.amount,
            reason: outcome.reason,
            events: outcome.events,
          },
        };
      case 'unclear':
        return { ...base, action: outcome.action, missing: outcome.missing };
      case 'no_action':
        return { ...base, available_actions: outcome.available };
      case 'unavailable':
        return { ...base, reason: outcome.reason };
      default:
        return base;
    }
  }
}
