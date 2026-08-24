import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BeginDiscordConnectDto {
  @ApiPropertyOptional({
    description:
      'Dashboard path to return the browser to once Discord is done, e.g. `/discord-import`. Must be a site-relative path; anything else is replaced with the default. It is stored with the handshake rather than read off the callback, because the callback carries no session to re-authorise against.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  return_path?: string;
}

export class ConfirmDiscordConnectDto {
  @ApiProperty({
    description:
      'The one-time confirmation token the OAuth callback put on the redirect. It is delivered to exactly one place — the browser that completed the authorization — and activates only against a session whose active chapter matches the one that started the handshake.',
  })
  @IsUUID()
  handshake: string;
}

export class DiscordConnectionDto {
  @ApiProperty({
    description: 'Whether this chapter has a Discord server linked.',
  })
  connected: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The linked Discord server id. Always a string — a snowflake exceeds 2^53 and a JSON round trip through a number would name a different server.',
  })
  guild_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  guild_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  connected_at: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The Discord account that authorized the install.',
  })
  connected_discord_username: string | null;
}

export class BeginDiscordConnectResponseDto {
  @ApiProperty({
    description:
      'Send the admin here. Includes the fixed permission bitfield (View Channels + Read Message History) and a single-use state.',
  })
  authorize_url: string;

  @ApiProperty({ description: 'When the handshake stops being redeemable.' })
  expires_at: string;
}

export class DiscordAvailabilityDto {
  @ApiProperty({
    description:
      'False when this environment has no Discord application configured. The DiscordChatExporter upload flow is unaffected either way — it is a separate path, not a fallback that switches on.',
  })
  available: boolean;
}
