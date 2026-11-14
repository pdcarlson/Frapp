import { ApiPropertyOptional } from '@nestjs/swagger';
import { INBOX_FIRST_PAGE_SIZE } from '@repo/validation';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator';
import {
  BOOTSTRAP_SECTION_NAMES,
  type BootstrapSectionName,
} from '../../application/services/bootstrap.service';
import { CurrentChapterResponseDto } from './chapter-response.dto';
import { ChapterChatBackgroundResponseDto } from './chat-background.dto';
import { ChatBlockListDto } from './chat-moderation.dto';
import { ChapterDocumentDto } from './chapter-document.dto';
import {
  BookmarkDto,
  ChannelNotificationPreferenceDto,
  ChannelUnreadCountDto,
  MentionRoleDto,
} from './chat.dto';
import { ChatSidebarDto } from './chat-sidebar.dto';
import { GifAvailabilityDto } from './gif.dto';
import { MemberRosterEntryDto } from './member-profile.dto';
import { UserSettingsDto } from './notification.dto';
import {
  LegalAcceptanceDto,
  MyPermissionsDto,
  WhatsNewSeenDto,
} from './user.dto';

const KNOWN_SECTIONS: ReadonlySet<unknown> = new Set(BOOTSTRAP_SECTION_NAMES);

/**
 * One comma-separated value, or the key repeated: both arrive as a list.
 * A name this build doesn't know is dropped, not refused: an installed app
 * asks for the sections it knew when it shipped, and a section a later API
 * renamed or removed must cost that app only that section (which it then
 * reads from its own route), not every batch it sends. `include` is a plain
 * string in the contract, so the breaking-change check can't see a section
 * go.
 */
function splitNames(value: unknown): unknown[] {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      parts
        .flatMap((part) =>
          typeof part === 'string' ? part.split(',') : [part],
        )
        .map((part) => (typeof part === 'string' ? part.trim() : part))
        .filter((part) => part !== '' && KNOWN_SECTIONS.has(part)),
    ),
  ];
}

export class BootstrapQueryDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated sections to read; every section when omitted. A client batching its first-screen reads asks for the ones it is about to read. A name the API does not know is ignored, so a section a later API drops costs an older client only that section.',
    type: String,
    example: 'user,channels,channel_unread',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => splitNames(value))
  @IsArray()
  @ArrayMaxSize(BOOTSTRAP_SECTION_NAMES.length)
  @IsIn(BOOTSTRAP_SECTION_NAMES, { each: true })
  include?: BootstrapSectionName[];
}

const object = { type: 'object', additionalProperties: true } as const;

/**
 * `GET /v1/bootstrap` (#4709): what a client's first screen reads, one section
 * per route it replaces, each the exact body that route answers. A section is
 * `null` when its read failed on the server, and absent when `include` left
 * it out; either way the client reads it through its own route.
 *
 * Sections whose own route documents no response schema are typed as plain
 * objects here too, so this DTO claims no more about them than the route
 * does.
 */
export class BootstrapDto {
  @ApiPropertyOptional({
    ...object,
    nullable: true,
    description: 'As `GET /v1/users/me`.',
  })
  user?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: MyPermissionsDto,
    nullable: true,
    description: 'As `GET /v1/users/me/permissions`.',
  })
  permissions?: MyPermissionsDto | null;

  @ApiPropertyOptional({
    type: LegalAcceptanceDto,
    nullable: true,
    description: 'As `GET /v1/users/me/legal-acceptance`.',
  })
  legal_acceptance?: LegalAcceptanceDto | null;

  @ApiPropertyOptional({
    type: WhatsNewSeenDto,
    nullable: true,
    description: 'As `GET /v1/users/me/whats-new`.',
  })
  whats_new?: WhatsNewSeenDto | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/chapters`.',
  })
  chapters?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: CurrentChapterResponseDto,
    nullable: true,
    description: 'As `GET /v1/chapters/current`.',
  })
  current_chapter?: CurrentChapterResponseDto | null;

  @ApiPropertyOptional({
    type: UserSettingsDto,
    nullable: true,
    description: 'As `GET /v1/settings`.',
  })
  settings?: UserSettingsDto | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/channels`.',
  })
  channels?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: ChannelUnreadCountDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/channels/unread`.',
  })
  channel_unread?: ChannelUnreadCountDto[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/channels/categories/list`.',
  })
  channel_categories?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: ChannelNotificationPreferenceDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/channels/notification-preferences`.',
  })
  channel_notification_preferences?: ChannelNotificationPreferenceDto[] | null;

  @ApiPropertyOptional({
    type: MentionRoleDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/channels/mention-roles`.',
  })
  mention_roles?: MentionRoleDto[] | null;

  @ApiPropertyOptional({
    type: ChatSidebarDto,
    nullable: true,
    description: 'As `GET /v1/chat-sidebar`.',
  })
  chat_sidebar?: ChatSidebarDto | null;

  @ApiPropertyOptional({
    type: ChatBlockListDto,
    nullable: true,
    description: 'As `GET /v1/chat/blocks`.',
  })
  chat_blocks?: ChatBlockListDto | null;

  @ApiPropertyOptional({
    type: ChapterChatBackgroundResponseDto,
    nullable: true,
    description: 'As `GET /v1/chat-backgrounds/default`.',
  })
  chat_background_default?: ChapterChatBackgroundResponseDto | null;

  @ApiPropertyOptional({
    type: GifAvailabilityDto,
    nullable: true,
    description: 'As `GET /v1/gifs/availability`.',
  })
  gif_availability?: GifAvailabilityDto | null;

  @ApiPropertyOptional({
    type: BookmarkDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/bookmarks`.',
  })
  bookmarks?: BookmarkDto[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/roles`.',
  })
  roles?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/events`.',
  })
  events?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: 'As `GET /v1/geofences`.',
  })
  geofences?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    type: ChapterDocumentDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/documents` with no folder or search.',
  })
  documents?: ChapterDocumentDto[] | null;

  @ApiPropertyOptional({
    type: MemberRosterEntryDto,
    isArray: true,
    nullable: true,
    description: 'As `GET /v1/members/roster`.',
  })
  member_roster?: MemberRosterEntryDto[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: object,
    nullable: true,
    description: `As \`GET /v1/notifications?limit=${INBOX_FIRST_PAGE_SIZE}\`.`,
  })
  notifications?: Record<string, unknown>[] | null;
}
