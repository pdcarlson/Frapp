import { ApiProperty } from '@nestjs/swagger';

// ── Meetings marked "No minutes" (Paul, 2026-11-20) ─────────────────────────

export class MeetingNoMinutesListDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Events this officer can see that an officer marked "No minutes", so the Meetings list stops asking for them.',
  })
  event_ids: string[];
}
