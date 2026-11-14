import { Logger } from '@nestjs/common';
import {
  BOOTSTRAP_NOTIFICATION_LIMIT,
  BOOTSTRAP_SECTION_NAMES,
  BootstrapService,
} from './bootstrap.service';
import type { ChapterDocumentService } from './chapter-document.service';
import type { ChapterService } from './chapter.service';
import type { ChatBackgroundService } from './chat-background.service';
import type { ChatBlockService } from './chat-block.service';
import type { ChatBookmarkService } from './chat-bookmark.service';
import type { ChatCategoryService } from './chat-category.service';
import type { ChatMentionService } from './chat-mention.service';
import type { ChatNotificationPreferenceService } from './chat-notification-preference.service';
import type { ChatSidebarService } from './chat-sidebar.service';
import type { ChatService } from './chat.service';
import type { EventService } from './event.service';
import type { GifService } from './gif.service';
import type { LegalAcceptanceService } from './legal-acceptance.service';
import type { MemberService } from './member.service';
import type { NotificationService } from './notification.service';
import type { RbacService } from './rbac.service';
import type { StudyService } from './study.service';
import type { UserService } from './user.service';

const USER = 'user-1';
const CHAPTER = 'chapter-1';

function build() {
  const users = {
    findProfile: jest.fn().mockResolvedValue({ id: USER }),
    whatsNewSeen: jest.fn().mockResolvedValue('2026.11.12'),
  };
  const rbac = {
    getEffectivePermissions: jest.fn().mockResolvedValue(['members:view']),
    findByChapter: jest.fn().mockResolvedValue([{ id: 'role-1' }]),
  };
  const legalAcceptance = {
    status: jest.fn().mockResolvedValue({ accepted: true }),
  };
  const chapters = {
    listForUser: jest.fn().mockResolvedValue([{ chapter_id: CHAPTER }]),
    findByIdWithLogoUrl: jest
      .fn()
      .mockResolvedValue({ id: CHAPTER, logo_url: null }),
  };
  const notifications = {
    getSettings: jest.fn().mockResolvedValue({ theme: 'dark' }),
    listNotifications: jest.fn().mockResolvedValue([{ id: 'n-1' }]),
  };
  const chat = {
    getChannelList: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
    getUnreadCounts: jest
      .fn()
      .mockResolvedValue([
        { channel_id: 'c-1', unread_count: 2, mention_count: 0 },
      ]),
  };
  const categories = {
    getCategories: jest.fn().mockResolvedValue([{ id: 'cat-1' }]),
  };
  const chatPreferences = {
    getChannelNotificationPreferences: jest.fn().mockResolvedValue([]),
  };
  const sidebar = {
    getSidebar: jest.fn().mockResolvedValue({ pinned_channel_ids: [] }),
  };
  const members = {
    findRosterByChapter: jest.fn().mockResolvedValue([{ user_id: USER }]),
  };
  const mentions = {
    listMentionRoles: jest.fn().mockResolvedValue([
      {
        role_id: 'r-1',
        kind: 'role',
        name: 'Exec',
        color: null,
        mentionable: true,
        open_to_all: false,
      },
    ]),
  };
  const gifs = {
    availability: jest
      .fn()
      .mockReturnValue({ available: false, provider: 'none' }),
  };
  const backgrounds = {
    getChapterDefault: jest
      .fn()
      .mockResolvedValue({ background: 'plain', photo_url: null }),
  };
  const blocks = {
    listBlockedUserIds: jest.fn().mockResolvedValue(['u-9']),
  };
  const bookmarks = {
    listBookmarks: jest.fn().mockResolvedValue([{ message_id: 'm-1' }]),
  };
  const events = {
    findByChapter: jest.fn().mockResolvedValue([{ id: 'e-1' }]),
  };
  const geofences = {
    listGeofences: jest.fn().mockResolvedValue([{ id: 'g-1' }]),
  };
  const documents = {
    findByChapter: jest.fn().mockResolvedValue([{ id: 'd-1' }]),
  };
  const service = new BootstrapService(
    users as unknown as UserService,
    rbac as unknown as RbacService,
    legalAcceptance as unknown as LegalAcceptanceService,
    chapters as unknown as ChapterService,
    notifications as unknown as NotificationService,
    chat as unknown as ChatService,
    categories as unknown as ChatCategoryService,
    chatPreferences as unknown as ChatNotificationPreferenceService,
    sidebar as unknown as ChatSidebarService,
    members as unknown as MemberService,
    mentions as unknown as ChatMentionService,
    gifs as unknown as GifService,
    backgrounds as unknown as ChatBackgroundService,
    blocks as unknown as ChatBlockService,
    bookmarks as unknown as ChatBookmarkService,
    events as unknown as EventService,
    geofences as unknown as StudyService,
    documents as unknown as ChapterDocumentService,
  );
  return {
    service,
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
  };
}

describe('BootstrapService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers every section with what its own route answers', async () => {
    const { service } = build();

    const sections = await service.load(USER, CHAPTER);

    expect(Object.keys(sections)).toEqual([...BOOTSTRAP_SECTION_NAMES]);
    expect(sections).toEqual({
      user: { id: USER },
      permissions: { permissions: ['members:view'] },
      legal_acceptance: { accepted: true },
      whats_new: { seen_version: '2026.11.12' },
      chapters: [{ chapter_id: CHAPTER }],
      current_chapter: { id: CHAPTER, logo_url: null },
      settings: { theme: 'dark' },
      channels: [{ id: 'c-1' }],
      channel_unread: [
        { channel_id: 'c-1', unread_count: 2, mention_count: 0 },
      ],
      channel_categories: [{ id: 'cat-1' }],
      channel_notification_preferences: [],
      // The route's projection: no `open_to_all`.
      mention_roles: [
        {
          role_id: 'r-1',
          kind: 'role',
          name: 'Exec',
          color: null,
          mentionable: true,
        },
      ],
      chat_sidebar: { pinned_channel_ids: [] },
      chat_blocks: { blocked_user_ids: ['u-9'] },
      chat_background_default: { background: 'plain', photo_url: null },
      gif_availability: { available: false, provider: 'none' },
      bookmarks: [{ message_id: 'm-1' }],
      roles: [{ id: 'role-1' }],
      events: [{ id: 'e-1' }],
      geofences: [{ id: 'g-1' }],
      documents: [{ id: 'd-1' }],
      member_roster: [{ user_id: USER }],
      notifications: [{ id: 'n-1' }],
    });
  });

  // Parity with the routes: each section calls the method its route calls,
  // with the same caller and chapter, so the two can't disagree.
  it('reads each section for the caller and the guarded chapter', async () => {
    const m = build();

    await m.service.load(USER, CHAPTER);

    expect(m.users.findProfile).toHaveBeenCalledWith(USER);
    expect(m.users.whatsNewSeen).toHaveBeenCalledWith(USER);
    expect(m.rbac.getEffectivePermissions).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.legalAcceptance.status).toHaveBeenCalledWith(USER);
    expect(m.chapters.listForUser).toHaveBeenCalledWith(USER);
    expect(m.chapters.findByIdWithLogoUrl).toHaveBeenCalledWith(CHAPTER);
    expect(m.notifications.getSettings).toHaveBeenCalledWith(USER);
    expect(m.notifications.listNotifications).toHaveBeenCalledWith(
      USER,
      CHAPTER,
      { limit: BOOTSTRAP_NOTIFICATION_LIMIT },
    );
    expect(m.chat.getChannelList).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.chat.getUnreadCounts).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.categories.getCategories).toHaveBeenCalledWith(CHAPTER);
    expect(
      m.chatPreferences.getChannelNotificationPreferences,
    ).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.sidebar.getSidebar).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.mentions.listMentionRoles).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.blocks.listBlockedUserIds).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.backgrounds.getChapterDefault).toHaveBeenCalledWith(CHAPTER);
    expect(m.members.findRosterByChapter).toHaveBeenCalledWith(CHAPTER);
    expect(m.bookmarks.listBookmarks).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.rbac.findByChapter).toHaveBeenCalledWith(CHAPTER);
    expect(m.events.findByChapter).toHaveBeenCalledWith(CHAPTER, USER);
    expect(m.geofences.listGeofences).toHaveBeenCalledWith(CHAPTER);
    // The route's no-filter read: no folder, no search.
    expect(m.documents.findByChapter).toHaveBeenCalledWith(CHAPTER, undefined);
  });

  it('reads the inbox at the page the clients ask for by default', () => {
    expect(BOOTSTRAP_NOTIFICATION_LIMIT).toBe(50);
  });

  it('reads only the sections `include` names', async () => {
    const m = build();

    const sections = await m.service.load(USER, CHAPTER, [
      'channel_unread',
      'user',
      'channel_unread',
    ]);

    expect(sections).toEqual({
      channel_unread: [
        { channel_id: 'c-1', unread_count: 2, mention_count: 0 },
      ],
      user: { id: USER },
    });
    expect(m.chat.getChannelList).not.toHaveBeenCalled();
    expect(m.notifications.listNotifications).not.toHaveBeenCalled();
  });

  it('reads nothing for an include that named no known section', async () => {
    const m = build();

    await expect(m.service.load(USER, CHAPTER, [])).resolves.toEqual({});
    expect(m.users.findProfile).not.toHaveBeenCalled();
  });

  it('answers null for a section whose read failed, and the rest as usual', async () => {
    const m = build();
    m.chat.getUnreadCounts.mockRejectedValue(new Error('pool timeout'));
    m.notifications.listNotifications.mockRejectedValue(new Error('boom'));

    const sections = await m.service.load(USER, CHAPTER);

    expect(sections.channel_unread).toBeNull();
    expect(sections.notifications).toBeNull();
    expect(sections.channels).toEqual([{ id: 'c-1' }]);
    expect(sections.user).toEqual({ id: USER });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('starts every section at once rather than one after another', async () => {
    const m = build();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    m.users.findProfile.mockImplementation(async () => {
      await gate;
      return { id: USER };
    });

    const pending = m.service.load(USER, CHAPTER);
    await Promise.resolve();

    // The first section is still waiting, and the last one has started.
    expect(m.notifications.listNotifications).toHaveBeenCalled();
    release();
    await pending;
  });
});
