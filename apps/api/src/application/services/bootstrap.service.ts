import { Injectable, Logger } from '@nestjs/common';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { ChapterDocumentService } from './chapter-document.service';
import { ChapterService } from './chapter.service';
import { ChatBackgroundService } from './chat-background.service';
import { ChatBlockService } from './chat-block.service';
import { ChatBookmarkService } from './chat-bookmark.service';
import { ChatCategoryService } from './chat-category.service';
import { ChatMentionService, toMentionRoleEntry } from './chat-mention.service';
import { ChatNotificationPreferenceService } from './chat-notification-preference.service';
import { ChatSidebarService } from './chat-sidebar.service';
import { ChatService } from './chat.service';
import { EventService } from './event.service';
import { GifService } from './gif.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { MemberService } from './member.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { StudyService } from './study.service';
import { UserService } from './user.service';

/** The page the inbox hooks ask for when they name no `limit`. */
export const BOOTSTRAP_NOTIFICATION_LIMIT = 50;

/** Who the sections are read for: the guarded caller and chapter. */
interface Caller {
  userId: string;
  chapterId: string;
}

/**
 * Builds the section table from the services each route uses. One entry per
 * route a section stands in for, named in its comment; each reads exactly
 * what that route's handler reads, with the same arguments, so the two can't
 * answer differently.
 *
 * Every route here needs at most `members:view` in the caller's chapter, which
 * `GET /v1/bootstrap` itself requires, and takes no path or query parameter
 * a client could vary (the inbox's is fixed at the clients' default page). A
 * new section must hold to both, or check its own permission.
 */
function sectionReaders(s: {
  users: UserService;
  rbac: RbacService;
  legalAcceptance: LegalAcceptanceService;
  chapters: ChapterService;
  notifications: NotificationService;
  chat: ChatService;
  categories: ChatCategoryService;
  chatPreferences: ChatNotificationPreferenceService;
  sidebar: ChatSidebarService;
  members: MemberService;
  mentions: ChatMentionService;
  gifs: GifService;
  backgrounds: ChatBackgroundService;
  blocks: ChatBlockService;
  bookmarks: ChatBookmarkService;
  events: EventService;
  geofences: StudyService;
  documents: ChapterDocumentService;
}) {
  return {
    /** `GET /v1/users/me` */
    user: ({ userId }: Caller) => s.users.findProfile(userId),
    /** `GET /v1/users/me/permissions` */
    permissions: async ({ userId, chapterId }: Caller) => ({
      permissions: await s.rbac.getEffectivePermissions(chapterId, userId),
    }),
    /** `GET /v1/users/me/legal-acceptance` */
    legal_acceptance: ({ userId }: Caller) => s.legalAcceptance.status(userId),
    /** `GET /v1/users/me/whats-new` */
    whats_new: async ({ userId }: Caller) => ({
      seen_version: await s.users.whatsNewSeen(userId),
    }),
    /** `GET /v1/chapters` */
    chapters: ({ userId }: Caller) => s.chapters.listForUser(userId),
    /** `GET /v1/chapters/current` */
    current_chapter: ({ chapterId }: Caller) =>
      s.chapters.findByIdWithLogoUrl(chapterId),
    /** `GET /v1/settings` */
    settings: ({ userId }: Caller) => s.notifications.getSettings(userId),
    /** `GET /v1/channels` */
    channels: ({ userId, chapterId }: Caller) =>
      s.chat.getChannelList(chapterId, userId),
    /** `GET /v1/channels/unread` */
    channel_unread: ({ userId, chapterId }: Caller) =>
      s.chat.getUnreadCounts(chapterId, userId),
    /** `GET /v1/channels/categories/list` */
    channel_categories: ({ chapterId }: Caller) =>
      s.categories.getCategories(chapterId),
    /** `GET /v1/channels/notification-preferences` */
    channel_notification_preferences: ({ userId, chapterId }: Caller) =>
      s.chatPreferences.getChannelNotificationPreferences(chapterId, userId),
    /** `GET /v1/channels/mention-roles` */
    mention_roles: async ({ userId, chapterId }: Caller) =>
      (await s.mentions.listMentionRoles(chapterId, userId)).map(
        toMentionRoleEntry,
      ),
    /** `GET /v1/chat-sidebar` */
    chat_sidebar: ({ userId, chapterId }: Caller) =>
      s.sidebar.getSidebar(chapterId, userId),
    /** `GET /v1/chat/blocks` */
    chat_blocks: async ({ userId, chapterId }: Caller) => ({
      blocked_user_ids: await s.blocks.listBlockedUserIds(chapterId, userId),
    }),
    /** `GET /v1/chat-backgrounds/default` */
    chat_background_default: ({ chapterId }: Caller) =>
      s.backgrounds.getChapterDefault(chapterId),
    /** `GET /v1/gifs/availability` */
    gif_availability: () => Promise.resolve(s.gifs.availability()),
    /** `GET /v1/bookmarks` */
    bookmarks: ({ userId, chapterId }: Caller) =>
      s.bookmarks.listBookmarks(chapterId, userId),
    /** `GET /v1/roles` */
    roles: ({ chapterId }: Caller) => s.rbac.findByChapter(chapterId),
    /** `GET /v1/events` */
    events: ({ userId, chapterId }: Caller) =>
      s.events.findByChapter(chapterId, userId),
    /** `GET /v1/geofences` */
    geofences: ({ chapterId }: Caller) => s.geofences.listGeofences(chapterId),
    /** `GET /v1/documents` with no folder or search */
    documents: ({ chapterId }: Caller) =>
      s.documents.findByChapter(chapterId, undefined),
    /** `GET /v1/members/roster` */
    member_roster: ({ chapterId }: Caller) =>
      s.members.findRosterByChapter(chapterId),
    /** `GET /v1/notifications` at the clients' default page (`limit` 50) */
    notifications: ({ userId, chapterId }: Caller) =>
      s.notifications.listNotifications(userId, chapterId, {
        limit: BOOTSTRAP_NOTIFICATION_LIMIT,
      }),
  };
}

type SectionReaders = ReturnType<typeof sectionReaders>;

/** The names a client may ask for in `include`. */
export type BootstrapSectionName = keyof SectionReaders;

/**
 * Every section name, in the order the response lists them, for the query
 * DTO to validate `include` against. The two checks below fail the build if
 * this list and the readers ever name different sections.
 */
export const BOOTSTRAP_SECTION_NAMES = [
  'user',
  'permissions',
  'legal_acceptance',
  'whats_new',
  'chapters',
  'current_chapter',
  'settings',
  'channels',
  'channel_unread',
  'channel_categories',
  'channel_notification_preferences',
  'mention_roles',
  'chat_sidebar',
  'chat_blocks',
  'chat_background_default',
  'gif_availability',
  'bookmarks',
  'roles',
  'events',
  'geofences',
  'documents',
  'member_roster',
  'notifications',
] as const satisfies readonly BootstrapSectionName[];
type ListedSection = (typeof BOOTSTRAP_SECTION_NAMES)[number];
const everyReaderIsListed: Record<
  Exclude<BootstrapSectionName, ListedSection>,
  never
> = {};
void everyReaderIsListed;

/**
 * The answer: each section asked for, as its own route answers it, or `null`
 * when its read failed (the client then reads it through its own route). A
 * section not asked for is absent.
 */
export type BootstrapSections = {
  [K in BootstrapSectionName]?: Awaited<ReturnType<SectionReaders[K]>> | null;
};

/**
 * `GET /v1/bootstrap`: the reads a client's first screen makes, in one request
 * (#4709).
 *
 * An app open used to send each of these as its own request, about 30 at
 * once on web and on mobile. Every request runs the whole guard chain (the
 * JWT check, `get_request_context`), so one open queued hundreds of PostgREST
 * and GoTrue calls behind PostgREST's 10-connection pool and stalled every
 * other client for seconds. Here the guard chain runs once and the sections
 * share its per-request reads. The guards are not cached across requests
 * (#3752); this only makes an open one request.
 *
 * The sections are independent and read at once: one that fails is `null`
 * and reported, and the rest still answer, because failing the whole open
 * over the inbox would blank the shell.
 */
@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);
  private readonly readers: SectionReaders;

  constructor(
    users: UserService,
    rbac: RbacService,
    legalAcceptance: LegalAcceptanceService,
    chapters: ChapterService,
    notifications: NotificationService,
    chat: ChatService,
    categories: ChatCategoryService,
    chatPreferences: ChatNotificationPreferenceService,
    sidebar: ChatSidebarService,
    members: MemberService,
    mentions: ChatMentionService,
    gifs: GifService,
    backgrounds: ChatBackgroundService,
    blocks: ChatBlockService,
    bookmarks: ChatBookmarkService,
    events: EventService,
    geofences: StudyService,
    documents: ChapterDocumentService,
  ) {
    this.readers = sectionReaders({
      users,
      rbac,
      legalAcceptance,
      chapters,
      notifications,
      chat,
      categories,
      chatPreferences,
      sidebar,
      members,
      mentions,
      gifs,
      backgrounds,
      blocks,
      bookmarks,
      events,
      geofences,
      documents,
    });
  }

  /**
   * Reads `include` for the caller: every section when it is omitted, none
   * when it names none this build knows (the DTO drops unknown names).
   */
  async load(
    userId: string,
    chapterId: string,
    include?: readonly BootstrapSectionName[],
  ): Promise<BootstrapSections> {
    const names =
      include === undefined
        ? [...BOOTSTRAP_SECTION_NAMES]
        : [...new Set(include)];
    const caller: Caller = { userId, chapterId };
    const values = await Promise.all(
      names.map((name) =>
        this.settle(name, () =>
          (this.readers[name] as (caller: Caller) => Promise<unknown>)(caller),
        ),
      ),
    );
    // Each value came from its own name's reader, so the entries are typed.
    const sections: BootstrapSections = Object.fromEntries(
      names.map((name, i) => [name, values[i]]),
    );
    return sections;
  }

  private async settle<T>(
    name: string,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: `bootstrap-${name.replace(/_/g, '-')}`,
        message: `Bootstrap section "${name}" failed; the client reads it on its own route`,
        error,
      });
      return null;
    }
  }
}
