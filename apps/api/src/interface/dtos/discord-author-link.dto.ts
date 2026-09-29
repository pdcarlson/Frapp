import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DiscordAuthorLinkDto {
  @ApiProperty({
    description:
      'Whether linking can be started in this environment: a Discord application is configured and Discord has not reported it misconfigured. The same answer as `GET /v1/discord/availability`, without its officer gate.',
  })
  available: boolean;

  @ApiProperty({
    description:
      'Whether the caller has linked a Discord account in this chapter. Linked, their imported Discord messages here are attributed to them.',
  })
  linked: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'What Discord called the linked account when it was linked. Display only.',
  })
  discord_username: string | null;

  @ApiProperty({ type: String, nullable: true })
  linked_at: string | null;
}

export class BeginDiscordAuthorLinkResponseDto {
  @ApiProperty({
    description:
      'Send the member here. Asks Discord for the `identify` scope only, with a single-use state bound to this member and chapter.',
  })
  authorize_url: string;

  @ApiProperty({ description: 'When the handshake stops being redeemable.' })
  expires_at: string;
}

export class ConfirmDiscordAuthorLinkDto {
  @ApiProperty({
    description:
      'The one-time token the OAuth callback put on the redirect to `/profile`. It links the Discord account only for the member who started the handshake, in the chapter it was started in.',
  })
  @IsUUID()
  handshake: string;
}

export class ConfirmDiscordAuthorLinkResponseDto extends DiscordAuthorLinkDto {
  @ApiProperty({
    description:
      'How many imported messages in this chapter the link attributed to the caller. Zero when none were imported under that account yet; later imports attach as they land.',
  })
  messages_linked: number;
}

export class UnlinkDiscordAuthorResponseDto {
  @ApiProperty({ description: 'False when there was no link to remove.' })
  unlinked: boolean;

  @ApiProperty({
    description:
      'How many imported messages went back to their Discord name. Messages the caller deleted stay deleted.',
  })
  messages_restored: number;
}

export class DiscordAuthorLinkEntryDto {
  @ApiProperty({
    description:
      'A Discord user id (a snowflake, always a string) that a member of this chapter has linked.',
  })
  discord_user_id: string;

  @ApiProperty({ description: 'The member it is linked to (`users.id`).' })
  user_id: string;
}
