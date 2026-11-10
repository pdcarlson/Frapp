import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CHAT_BACKGROUND_KEYS, type ChatBackgroundKey } from '@repo/validation';

export class ChatBackgroundPhotoUrlDto {
  @ApiProperty({ description: 'Original filename (e.g. house.jpg)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/jpeg)' })
  @IsString()
  content_type: string;
}

export class ChatBackgroundPhotoUrlResponseDto {
  @ApiProperty({ description: 'Short-lived signed URL; PUT the bytes to it.' })
  upload_url: string;

  @ApiProperty({
    description:
      'Storage path to send back as `storage_path` when setting the photo.',
  })
  storage_path: string;
}

export class SetChannelBackgroundDto {
  @ApiProperty({
    enum: CHAT_BACKGROUND_KEYS,
    type: String,
    nullable: true,
    description:
      "A built-in key, `photo` (with `storage_path`), or null to follow the chapter's default.",
  })
  @IsOptional()
  @IsIn(CHAT_BACKGROUND_KEYS)
  background: ChatBackgroundKey | null;

  @ApiPropertyOptional({
    description: 'Required with `photo`: the path the photo-url call returned.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  storage_path?: string;
}

export class SetChapterChatBackgroundDto {
  @ApiProperty({
    enum: CHAT_BACKGROUND_KEYS,
    type: String,
    description: 'A built-in key, or `photo` (with `storage_path`).',
  })
  @IsIn(CHAT_BACKGROUND_KEYS)
  background: ChatBackgroundKey;

  @ApiPropertyOptional({
    description: 'Required with `photo`: the path the photo-url call returned.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  storage_path?: string;
}

export class ChatBackgroundResponseDto {
  @ApiProperty({
    enum: CHAT_BACKGROUND_KEYS,
    type: String,
    description: 'What to draw behind the messages column.',
  })
  background: ChatBackgroundKey;

  @ApiProperty({
    enum: ['channel', 'chapter', 'none'],
    description:
      "Where it came from: the channel's own setting, the chapter default, or `none` for a DM (always plain).",
  })
  source: 'channel' | 'chapter' | 'none';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'A signed URL for the photo when `background` is `photo`; null otherwise, or when signing failed (draw plain).',
  })
  photo_url: string | null;
}

export class ChapterChatBackgroundResponseDto {
  @ApiProperty({ enum: CHAT_BACKGROUND_KEYS, type: String })
  background: ChatBackgroundKey;

  @ApiProperty({ type: String, nullable: true })
  photo_url: string | null;
}
