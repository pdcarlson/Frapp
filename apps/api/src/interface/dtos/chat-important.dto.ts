import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { IMPORTANT_CANDIDATE_LIMIT } from '../../application/services/chat-important.service';

/** One unseen Important message, as the strip needs it (#4186). */
export class ImportantMessageRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  flagged_at: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The sender, or null for an imported Discord row.',
  })
  sender_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "An imported row's Discord name; null for a member's message.",
  })
  author_name: string | null;

  @ApiProperty({
    description:
      "The message's first words on one line, at most 140 characters, for the strip's preview.",
  })
  excerpt: string;
}

/** A channel's "1 important message" strip for the caller. */
export class ImportantMessagesDto {
  @ApiProperty({
    type: ImportantMessageRefDto,
    isArray: true,
    description:
      'Unseen Important messages flagged in the last 14 days, oldest first, at most 50.',
  })
  messages: ImportantMessageRefDto[];

  @ApiProperty({ description: 'How many unseen Important messages there are.' })
  total: number;
}

export class MarkImportantSeenDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    isArray: true,
    minItems: 1,
    maxItems: IMPORTANT_CANDIDATE_LIMIT,
    description:
      'Messages the caller jumped to or scrolled onto their screen. Ids the strip does not count are ignored.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORTANT_CANDIDATE_LIMIT)
  @IsUUID('all', { each: true })
  message_ids: string[];
}
