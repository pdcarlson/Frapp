import { Test, TestingModule } from '@nestjs/testing';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageActionRepository,
  IChatMessageAttachmentRepository,
  IChatMessageRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '#domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import { memberFixture } from './entity-fixtures';
import { ChatService } from '../../src/application/services/chat.service';
import { CHAT_THREAD_REPOSITORY } from '#domain/repositories/chat-thread.repository.interface';
import { ChatMentionService } from '../../src/application/services/chat-mention.service';
import { ChatAttachmentService } from '../../src/application/services/chat-attachment.service';
import { ChatNotificationPreferenceService } from '../../src/application/services/chat-notification-preference.service';
import { ChatCategoryService } from '../../src/application/services/chat-category.service';
import { ChatReactionService } from '../../src/application/services/chat-reaction.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { ActivationService } from '../../src/application/services/activation.service';
import { RbacService } from '../../src/application/services/rbac.service';
import { ChannelAccessService } from '../../src/application/services/channel-access.service';
import { ChannelAccessListService } from '../../src/application/services/channel-access-list.service';
import { EMPTY_ACCESS_HOLDER } from '#domain/utils/channel-access';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import { ChatBlockService } from '../../src/application/services/chat-block.service';
import { CHAT_NOTIFICATION_PREFERENCE_REPOSITORY } from '#domain/repositories/chat-notification-preference.repository.interface';
import { ChannelCacheService } from '../../src/application/services/channel-cache.service';

/**
 * The shared fixture for the chat service specs (#1380): one Nest testing
 * module wiring `ChatService` and the services split out of it
 * (`ChatAttachmentService`, `ChatNotificationPreferenceService`,
 * `ChatCategoryService`, `ChatReactionService`) over the same mocked
 * repositories, so a case in any of their specs sees the services wired as
 * `ChatModule` wires them. `ChannelAccessService` is real, over the mocked channel, member
 * and RBAC reads, so the access rejections run the actual predicate.
 */
export const baseMember = memberFixture({
  id: 'mem-1',
  role_ids: ['role-1'],
  has_completed_onboarding: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

export const baseChannel: ChatChannel = {
  id: 'ch-chan-1',
  chapter_id: 'ch-1',
  name: 'general',
  description: null,
  type: 'PUBLIC',
  required_permissions: null,
  who_can_see: null,
  who_can_post: null,
  member_ids: null,
  category_id: null,
  is_read_only: false,
  created_at: '2026-01-01T00:00:00.000Z',
  archived_at: null,
  default_notification_level: null,
  is_default: false,
  is_audit_log: false,
  display_locked: false,
  created_by: null,
};

export const baseMessage: ChatMessage = {
  id: 'msg-1',
  channel_id: 'ch-chan-1',
  sender_id: 'user-1',
  content: 'Hello world',
  type: 'TEXT',
  reply_to_id: null,
  metadata: {},
  is_pinned: false,
  pinned_at: null,
  edited_at: null,
  is_deleted: false,
  created_at: '2026-01-01T12:00:00.000Z',
};

export async function createChatServiceFixture() {
  const mockChannelRepo: jest.Mocked<IChatChannelRepository> = {
    findById: jest.fn(),
    findByChapter: jest.fn(),
    findByIds: jest.fn(),
    findDm: jest.fn(),
    createDm: jest.fn(),
    findByName: jest.fn(),
    findAuditLog: jest.fn(),
    findPushRouting: jest.fn(),
    createMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    leaveGroupDm: jest.fn(),
    addPrivateChannelMember: jest.fn(),
    removePrivateChannelMember: jest.fn(),
    findRoleGates: jest.fn(),
    removeUserFromPrivateChannels: jest.fn(),
    setDefault: jest.fn(),
    reorder: jest.fn(),
  };

  const mockCategoryRepo: jest.Mocked<IChatCategoryRepository> = {
    findByChapter: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    reorder: jest.fn(),
    setAccess: jest.fn(),
  };

  const mockMessageRepo: jest.Mocked<IChatMessageRepository> = {
    findById: jest.fn(),
    findByChannel: jest.fn(),
    findLatestPerChannel: jest.fn().mockResolvedValue([]),
    findPinnedByChannel: jest.fn(),
    findImportantInChannel: jest.fn(),
    countPinnedByChannel: jest.fn(),
    findPollsByChapter: jest.fn(),
    findPollCardsByChapter: jest.fn(),
    findByClientMessageId: jest.fn(),
    findAuthorAvatarPaths: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    insertIdempotent: jest.fn(),
    compareAndSetFlag: jest.fn(),
    updateIfLive: jest.fn(),
    update: jest.fn(),
  };

  const mockActionRepo: jest.Mocked<IChatMessageActionRepository> = {
    create: jest.fn(),
    findOne: jest.fn(),
    updateForVote: jest.fn(),
    findActionsOnMessages: jest.fn(),
    claimSignupSlots: jest.fn(),
  };

  const mockAttachmentRepo: jest.Mocked<IChatMessageAttachmentRepository> = {
    createMany: jest.fn().mockResolvedValue([]),
    findByMessage: jest.fn().mockResolvedValue([]),
    findSharedObjects: jest.fn().mockResolvedValue([]),
  };

  const mockReactionRepo: jest.Mocked<IMessageReactionRepository> = {
    findByMessage: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };

  const mockReadReceiptRepo: jest.Mocked<IChannelReadReceiptRepository> = {
    upsert: jest.fn(),
    getUnreadCounts: jest.fn().mockResolvedValue([]),
    hideDirectMessage: jest.fn(),
    unhideChannel: jest.fn().mockResolvedValue(undefined),
    findHiddenChannelIds: jest.fn().mockResolvedValue(new Set()),
  };

  const mockStorageProvider: jest.Mocked<IStorageProvider> = {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    getSignedInlineAndAttachmentUrls: jest.fn(),
    getSignedDownloadUrls: jest.fn().mockResolvedValue({}),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    deleteFile: jest.fn(),
    listFiles: jest.fn(),
    listObjects: jest.fn().mockResolvedValue([]),
    listFolders: jest.fn().mockResolvedValue([]),
    deleteFiles: jest.fn(),
  };

  const mockNotificationService: jest.Mocked<
    Pick<
      NotificationService,
      | 'notifyUser'
      | 'notifyChapter'
      | 'markChatChannelNotificationsRead'
      | 'rewriteChatMessagePreview'
    >
  > = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyChapter: jest.fn().mockResolvedValue(undefined),
    markChatChannelNotificationsRead: jest.fn().mockResolvedValue(undefined),
    rewriteChatMessagePreview: jest.fn().mockResolvedValue(undefined),
  };

  const mockMemberRepo = {
    findByUserAndChapter: jest.fn(),
    findByChapter: jest.fn().mockResolvedValue([]),
    // Mention resolution reads the chapter roster through this one narrow
    // join (#986). Empty by default so the existing send tests resolve to no
    // mentions; the mention tests below seed it.
    findChapterMemberIdentities: jest.fn().mockResolvedValue([]),
  };

  const mockActivation: jest.Mocked<Pick<ActivationService, 'record'>> = {
    record: jest.fn().mockResolvedValue(true),
  };

  const mockChatNotificationPrefs = {
    findChannelPreferencesForUser: jest.fn().mockResolvedValue([]),
    upsertChannelLevel: jest.fn(),
    findKindPreferencesForUser: jest.fn().mockResolvedValue([]),
    upsertKindLevel: jest.fn(),
    deleteKindLevel: jest.fn(),
    findChapterPreferencesForUser: jest.fn().mockResolvedValue([]),
    upsertChapterLevel: jest.fn(),
    deleteChapterLevel: jest.fn(),
  };

  const mockChannelCache = {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  };

  // No open report holds anything unless a case says so (#2481).
  const mockReportRepo: { findHeldObjects: jest.Mock } = {
    findHeldObjects: jest.fn().mockResolvedValue([]),
  };

  // Nobody is blocked by default, so every case reads unmasked; the masking
  // tests seed it.
  const mockChatBlocks = {
    listBlockedUserIds: jest.fn().mockResolvedValue([]),
    // Nobody has blocked anybody: the audience passes through untouched.
    filterOutBlockers: jest.fn(
      (_chapterId: string, _senderId: string, ids: string[]) =>
        Promise.resolve(ids),
    ),
  };

  // Message threads (#3785): auto-follow and the read cursor on a thread send.
  const mockThreadRepo = {
    findReplies: jest.fn().mockResolvedValue([]),
    findFollow: jest.fn().mockResolvedValue(null),
    findFollowStates: jest.fn().mockResolvedValue(new Map()),
    ensureFollowing: jest.fn().mockResolvedValue(undefined),
    followOnReply: jest.fn().mockResolvedValue(undefined),
    setFollowState: jest.fn().mockResolvedValue(undefined),
    markRead: jest.fn().mockResolvedValue(undefined),
    findFollowedUnread: jest.fn().mockResolvedValue([]),
  };

  const mockRbac = {
    getEffectivePermissions: jest.fn(),
    // What the caller holds for a channel's lists (#3722). Nothing by
    // default; tests on a who-can-see list override it.
    getChannelAccessHolder: jest.fn().mockResolvedValue(EMPTY_ACCESS_HOLDER),
    // The chapter's roles, for `@`-role resolution (`ChatMentionService`).
    findByChapter: jest.fn().mockResolvedValue([]),
    // Active (non-alumni) member by default; alumni posting is covered in
    // channel-access.service.spec.ts.
    hasAlumniRole: jest.fn().mockResolvedValue(false),
    isAlumni: jest.fn().mockResolvedValue(false),
    // Every chapter member's access, for a channel's readers (an edit's
    // notification rewrite, #4418). Nobody by default.
    getChapterMemberAccess: jest.fn().mockResolvedValue([]),
  };

  // The chapter's roles and tiers, which a who-can-see or who-can-post list
  // names (`ChannelAccessListService`). None by default.
  const mockRoleRepo = { findByChapter: jest.fn().mockResolvedValue([]) };
  const mockTierRepo = { findByChapter: jest.fn().mockResolvedValue([]) };

  // Defaults: caller is a member of the chapter, channel resolves, no special
  // permissions. Individual tests override to exercise denial paths.
  mockChannelRepo.findById.mockResolvedValue(baseChannel);
  mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
  mockMessageRepo.findById.mockResolvedValue(baseMessage);
  mockRbac.getEffectivePermissions.mockResolvedValue([]);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      ChatMentionService,
      ChatAttachmentService,
      ChatNotificationPreferenceService,
      ChatCategoryService,
      ChatReactionService,
      { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
      { provide: CHAT_CATEGORY_REPOSITORY, useValue: mockCategoryRepo },
      { provide: CHAT_MESSAGE_REPOSITORY, useValue: mockMessageRepo },
      {
        provide: CHAT_MESSAGE_ACTION_REPOSITORY,
        useValue: mockActionRepo,
      },
      {
        provide: CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
        useValue: mockAttachmentRepo,
      },
      { provide: MESSAGE_REACTION_REPOSITORY, useValue: mockReactionRepo },
      {
        provide: CHANNEL_READ_RECEIPT_REPOSITORY,
        useValue: mockReadReceiptRepo,
      },
      { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
      { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: RbacService, useValue: mockRbac },
      { provide: ActivationService, useValue: mockActivation },
      // ChatService now authorizes through the shared ChannelAccessService;
      // wire a real one over the same mocked channel/member/rbac so the
      // existing PRIVATE / ROLE_GATED rejection tests still exercise the
      // predicate end-to-end.
      ChannelAccessService,
      ChannelAccessListService,
      { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
      { provide: ROLE_TIER_REPOSITORY, useValue: mockTierRepo },
      {
        provide: CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
        useValue: mockChatNotificationPrefs,
      },
      { provide: ChannelCacheService, useValue: mockChannelCache },
      { provide: ChatBlockService, useValue: mockChatBlocks },
      { provide: CHAT_MESSAGE_REPORT_REPOSITORY, useValue: mockReportRepo },
      { provide: CHAT_THREAD_REPOSITORY, useValue: mockThreadRepo },
    ],
  }).compile();

  return {
    service: module.get(ChatService),
    attachments: module.get(ChatAttachmentService),
    notificationPreferences: module.get(ChatNotificationPreferenceService),
    categories: module.get(ChatCategoryService),
    reactions: module.get(ChatReactionService),
    mockChannelRepo,
    mockCategoryRepo,
    mockMessageRepo,
    mockActionRepo,
    mockAttachmentRepo,
    mockReactionRepo,
    mockReadReceiptRepo,
    mockStorageProvider,
    mockNotificationService,
    mockMemberRepo,
    mockActivation,
    mockChatNotificationPrefs,
    mockChannelCache,
    mockRbac,
    mockRoleRepo,
    mockTierRepo,
    mockChatBlocks,
    mockReportRepo,
    mockThreadRepo,
  };
}

export type ChatServiceFixture = Awaited<
  ReturnType<typeof createChatServiceFixture>
>;
