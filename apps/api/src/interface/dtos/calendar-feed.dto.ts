import { ApiProperty } from '@nestjs/swagger';

/** A member's calendar subscription link (#3322). */
export class CalendarFeedLinkDto {
  @ApiProperty({
    description:
      'The private link, as https. Google Calendar and Outlook subscribe to it by URL; anyone holding it can read the calendar it serves, so it is shown only to its member.',
    example:
      'https://api.frapp.live/v1/calendar-feed/feed.ics?token=3q2-7wLx9Vb0mH1e8nYkC4oPq5rS6tU7vW8xY9zA0bC',
  })
  url: string;

  @ApiProperty({
    description:
      'The same link as webcal://, which Apple Calendar (and most desktop calendar apps) open as a new subscription.',
    example:
      'webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=3q2-7wLx9Vb0mH1e8nYkC4oPq5rS6tU7vW8xY9zA0bC',
  })
  webcal_url: string;
}
