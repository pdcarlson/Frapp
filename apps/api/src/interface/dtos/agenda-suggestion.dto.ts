import { ApiProperty } from '@nestjs/swagger';
import {
  AGENDA_SUGGESTION_KINDS,
  type AgendaSuggestion,
  type AgendaSuggestionFromMinutes,
  type AgendaSuggestionKind,
  type AgendaSuggestionList,
} from '@repo/validation';
import { EventAgendaItemDto, EventAgendaTabledFromDto } from './event.dto';

/** The minutes a `minutes` suggestion was sent from (#5790). */
export class AgendaSuggestionFromMinutesDto implements AgendaSuggestionFromMinutes {
  @ApiProperty({ format: 'uuid' })
  meeting_id: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When that meeting started.',
  })
  start_time: string;
}

/** One suggestion under an event's agenda (#5534). */
export class AgendaSuggestionDto implements AgendaSuggestion {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: AGENDA_SUGGESTION_KINDS,
    description:
      '`tabled`: a matter earlier minutes of a meeting with the same audience tabled. `minutes`: an action item those minutes sent to the next meeting’s agenda instead of making it a task. `ai`: an item the model suggested.',
  })
  kind: AgendaSuggestionKind;

  @ApiProperty({ description: 'The item as it would go on the agenda.' })
  text: string;

  @ApiProperty({
    type: EventAgendaTabledFromDto,
    nullable: true,
    description:
      'Where a tabled matter was first tabled; null for any other kind.',
  })
  tabled_from: EventAgendaTabledFromDto | null;

  @ApiProperty({
    type: AgendaSuggestionFromMinutesDto,
    nullable: true,
    description:
      'The minutes a `minutes` item was sent from, for “From the minutes of {day}”; null for any other kind.',
  })
  from_minutes: AgendaSuggestionFromMinutesDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The posted minutes it was drawn from (for a tabled matter, the minutes that tabled it most recently), for the link under it.',
  })
  source_meeting_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Why the model suggested it, in a few words; null for `tabled`.',
  })
  reason: string | null;
}

/** An event's Suggested list (#5534). */
export class AgendaSuggestionListDto implements AgendaSuggestionList {
  @ApiProperty({
    type: [AgendaSuggestionDto],
    description: 'Open suggestions, tabled matters first.',
  })
  suggestions: AgendaSuggestionDto[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the model last wrote suggestions for this event; null when it never has, so a client asks for them once (`POST …/refresh`).',
  })
  generated_at: string | null;

  @ApiProperty({
    description:
      'Whether the model can write suggestions for this member: AI on, the chapter’s meeting-notes switch on and the member’s own yes. Tabled matters are listed either way.',
  })
  ai_available: boolean;
}

/** What Add returns: the event's agenda as saved. */
export class AddAgendaSuggestionResponseDto {
  @ApiProperty({ type: [EventAgendaItemDto] })
  agenda: EventAgendaItemDto[];
}
