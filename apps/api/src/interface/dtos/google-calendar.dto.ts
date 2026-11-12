import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** A member's Google Calendar connection in the active chapter (#3322). */
export class GoogleCalendarStatusDto {
  @ApiProperty({
    description:
      'Whether this server offers Google Calendar. False until its Google settings are set; clients then hide the option.',
  })
  available: boolean;

  @ApiProperty({ description: 'Whether the caller has connected Google.' })
  connected: boolean;

  @ApiProperty({
    enum: ['active', 'needs_reconnect'],
    nullable: true,
    type: String,
    description:
      '`needs_reconnect` once Google refused the sign-in (access removed in Google, or a password change); nothing syncs until the member connects again. Null when not connected.',
  })
  status: 'active' | 'needs_reconnect' | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The Google account connected, when Google shared it.',
    example: 'member@gmail.com',
  })
  google_email: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'When the calendar last finished syncing. Null before the first.',
  })
  last_synced_at: string | null;
}

export class StartGoogleCalendarConnectDto {
  @ApiProperty({
    enum: ['web', 'mobile'],
    description:
      'Where the sign-in finishes: the web Events page, or the phone app at `return_url`.',
  })
  @IsIn(['web', 'mobile'])
  client: 'web' | 'mobile';

  @ApiPropertyOptional({
    description:
      'For `mobile`: the app address Google sends the member back to, in the app’s own `frapp://` scheme.',
    example: 'frapp://google-calendar',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  return_url?: string;
}

export class GoogleCalendarConnectDto {
  @ApiProperty({
    description:
      'Google’s consent page for this sign-in. Good for ten minutes.',
  })
  authorize_url: string;
}

export class ConfirmGoogleCalendarConnectDto {
  @ApiProperty({
    description: 'The `gcal_state` the sign-in returned with.',
  })
  @IsString()
  @MaxLength(64)
  state: string;

  @ApiProperty({ description: 'The `gcal_code` the sign-in returned with.' })
  @IsString()
  @MaxLength(2048)
  code: string;
}
