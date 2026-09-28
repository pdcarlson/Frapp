import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ROLE_NAME_MAX_LENGTH } from '@repo/validation';
import { MAX_UPLOAD_URL_BATCH } from '../../application/services/discord-import.service';
import { RawValue } from './raw-value.transform';

export class CreateDiscordImportDto {
  @ApiProperty({
    description:
      'The admin confirms they have posted an in-channel notice in their Discord server telling members the history is being archived into Frapp. Required — the API refuses without it, and the column is NOT NULL, so no import can exist that was not preceded by this.',
  })
  @RawValue()
  @IsBoolean()
  consent_acknowledged: boolean;

  @ApiPropertyOptional({
    description: 'Discord server name, for display only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  guild_name?: string;

  @ApiPropertyOptional({
    enum: ['upload', 'bot'],
    default: 'upload',
    description:
      "`upload` (the default) imports a DiscordChatExporter export the admin uploads. `bot` reads the chapter's connected Discord server directly and requires a connection to exist first. Both run the same consent gate, the same channel mapping, and the same purge.",
  })
  @IsOptional()
  @IsIn(['upload', 'bot'])
  source?: 'upload' | 'bot';
}

export class DiscordDiscoveredRoleDto {
  @ApiProperty()
  discord_role_id: string;

  @ApiProperty()
  discord_role_name: string;
}

export class DiscordDiscoveryResponseDto {
  @ApiProperty({
    description:
      'Every channel in the server, and the threads of each channel the bot can read, all recorded as `skip` until the admin says otherwise. Threads carry `parent_discord_channel_id` and are not mapped separately — they follow their parent. Each row carries `readable` (whether the bot can read its history; false rows can only be skipped, null means the scan could not tell) and `private_in_discord` (some member could not read its history in Discord, or for a thread a private thread; null means the scan could not tell). A channel that is private, holds a private thread, or whose privacy is null needs an explicit `new_channel_visibility` to be created. A top-level channel that was private also carries `discord_reader_role_ids`: the Discord roles (from `roles`) that could read it, each on its own, which is what `new_channel_visibility: discord` copies. Empty when `@everyone` alone could read it (a deny hid it from someone); null when unknown.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  channels: unknown[];

  @ApiProperty({
    type: [DiscordDiscoveredRoleDto],
    description:
      'The roles the chapter can map, highest first as Discord lists them: every role except `@everyone` and the managed roles Discord gives bots and boosters. Empty when they could not be read, which `warnings` says.',
  })
  roles: DiscordDiscoveredRoleDto[];

  @ApiProperty({
    type: [String],
    description:
      'What could not be enumerated, in the admin’s words — most often private archived threads, which Discord gates behind a Manage Threads permission this read-only bot deliberately does not request.',
  })
  warnings: string[];
}

export class DiscordImportUploadFileDto {
  @ApiProperty({
    enum: ['export', 'media'],
    description:
      '`export` is a DiscordChatExporter JSON partition; `media` is a file from its `_Files` folder.',
  })
  @IsIn(['export', 'media'])
  kind: 'export' | 'media';

  @ApiProperty({
    description:
      'The path as the export names it, relative to the export folder. This is the join key: the importer resolves an attachment by looking this string up, never by rebuilding a storage key.',
  })
  @IsString()
  @MaxLength(1024)
  relative_path: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  content_type: string;

  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  byte_size: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Order of this JSON partition. Ignored for media.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  part_index?: number;
}

export class RequestDiscordUploadUrlsDto {
  @ApiProperty({ type: [DiscordImportUploadFileDto] })
  @IsArray()
  @ArrayMaxSize(MAX_UPLOAD_URL_BATCH)
  @ValidateNested({ each: true })
  @Type(() => DiscordImportUploadFileDto)
  files: DiscordImportUploadFileDto[];
}

export class ConfirmDiscordUploadsDto {
  @ApiProperty({
    type: [String],
    description: 'Storage paths whose PUT completed.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  storage_paths: string[];
}

export class DiscordChannelMappingDto {
  @ApiProperty({ description: 'Discord channel snowflake.' })
  @IsString()
  @MaxLength(64)
  discord_channel_id: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  discord_channel_name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  discord_category?: string;

  @ApiProperty({
    enum: ['create_new', 'use_existing', 'skip'],
    description:
      'What to do with this Discord channel. Always explicit — `chat_channels` has no unique constraint on (chapter_id, name), so a same-name match is never treated as an answer.',
  })
  @IsIn(['create_new', 'use_existing', 'skip'])
  mapping_action: 'create_new' | 'use_existing' | 'skip';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  target_channel_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  new_channel_name?: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  new_channel_is_read_only?: boolean;

  @ApiPropertyOptional({
    enum: ['chapter', 'restricted', 'discord'],
    description:
      'Who can read the channel `create_new` makes: the whole chapter, only members holding one of `new_channel_required_permissions` (a ROLE_GATED channel), or `discord` ("Same as Discord"): ROLE_GATED on the read permissions of the Frapp roles mapped (on the roles route) from the Discord roles that could read it. `discord` is for a bot channel the scan saw was private, with at least one of its reader roles mapped; the API works out its permissions and ignores any sent. Omitted or null means not chosen, which is refused unless this is a bot import whose scan saw the channel was public in Discord and holding no private thread. An uploaded export always needs it, and cannot use `discord`.',
  })
  @IsOptional()
  @IsIn(['chapter', 'restricted', 'discord'])
  new_channel_visibility?: 'chapter' | 'restricted' | 'discord' | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Permission strings that can read a `restricted` new channel; a member needs any one. Required and non-empty when `new_channel_visibility` is `restricted`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  new_channel_required_permissions?: string[];

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  message_count?: number;
}

export class SetDiscordChannelMappingDto {
  @ApiProperty({ type: [DiscordChannelMappingDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => DiscordChannelMappingDto)
  channels: DiscordChannelMappingDto[];
}

export class DiscordRoleMappingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  discord_role_id: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  discord_role_name: string;

  @ApiProperty({
    enum: ['existing', 'new', 'ignore'],
    description:
      'What this Discord role becomes in Frapp: one of the chapter\'s roles (`frapp_role_id`), a new role created when the import starts (`new_role_name`), or nothing. It decides who reads the channels imported "Same as Discord"; it never assigns anyone to a role.',
  })
  @IsIn(['existing', 'new', 'ignore'])
  action: 'existing' | 'new' | 'ignore';

  @ApiPropertyOptional({
    type: String,
    description: "Required for `existing`: one of this chapter's roles.",
  })
  @IsOptional()
  @IsUUID()
  frapp_role_id?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: ROLE_NAME_MAX_LENGTH,
    description:
      'Required for `new`: the name to create the role with. It must not match an existing role, ignoring case.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  new_role_name?: string | null;
}

export class SetDiscordRoleMappingDto {
  @ApiProperty({ type: [DiscordRoleMappingDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DiscordRoleMappingDto)
  roles: DiscordRoleMappingDto[];
}

export class DiscordUploadTicketDto {
  @ApiProperty()
  relative_path: string;

  @ApiProperty()
  storage_path: string;

  @ApiProperty({ description: 'Short-lived signed URL; PUT the bytes to it.' })
  upload_url: string;

  @ApiProperty({
    description:
      'The content type the API validated. Send exactly this on the PUT — the bucket allowlist judges what the uploader sends, and a browser reports an empty type for several formats a Discord archive carries.',
  })
  content_type: string;
}
