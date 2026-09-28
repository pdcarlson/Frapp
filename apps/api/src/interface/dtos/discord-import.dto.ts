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
      'Every channel and thread in the server, all recorded as `skip` until the admin says otherwise. Threads carry `parent_discord_channel_id` and are not mapped separately — they follow their parent. Each row carries `readable` (whether the bot can read its history; false rows can only be skipped) and `private_in_discord` (hidden from @everyone; such a row needs an explicit `new_channel_visibility` to be created).',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  channels: unknown[];

  @ApiProperty({ type: [DiscordDiscoveredRoleDto] })
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
    enum: ['chapter', 'restricted'],
    description:
      'Who can read the channel `create_new` makes: the whole chapter, or only members holding one of `new_channel_required_permissions` (a ROLE_GATED channel). Omitted means not chosen, which the bot path refuses for a channel that was private in Discord.',
  })
  @IsOptional()
  @IsIn(['chapter', 'restricted'])
  new_channel_visibility?: 'chapter' | 'restricted';

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
    description:
      'Frapp role key the admin intends for this Discord role. Informational only — nothing reads this to grant a permission, and the importer never assigns a role.',
  })
  @IsString()
  @MaxLength(64)
  signet_role_key: string;
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
