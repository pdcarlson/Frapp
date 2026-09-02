import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
  ChatMessageDuplicateError,
} from '../src/domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageActionRepository,
  IChatMessageAttachmentRepository,
  IChatMessageRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '../src/domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../src/domain/adapters/storage.interface';
import type { IStorageProvider } from '../src/domain/adapters/storage.interface';
import { MEMBER_REPOSITORY } from '../src/domain/repositories/member.repository.interface';
import { SUPABASE_CLIENT } from '../src/infrastructure/supabase/supabase.provider';
import { NotificationService } from '../src/application/services/notification.service';
import { ActivationService } from '../src/application/services/activation.service';
import { RbacService } from '../src/application/services/rbac.service';
import { ChatNotificationPreferenceRepository } from '../src/modules/chat-push-worker/chat-notification-preference.repository';
import { ChannelCacheService } from '../src/modules/chat-push-worker/channel-cache.service';
import type {
  ChatChannel,
  ChatMessage,
} from '../src/domain/entities/chat.entity';

const V1 = '/v1';

class AuthGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest();
    httpRequest.supabaseUser = {
      id: 'auth-user-1',
      email: 'member@example.com',
    };
    return true;
  }
}

class ChapterGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest();
    httpRequest.appUser = { id: 'user-1' };
    httpRequest.member = { id: 'member-1', role_ids: ['role-member'] };
    httpRequest.chapterId = 'chapter-1';
    return true;
  }
}

class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * HTTP-level coverage for the NestJS chat hot path — `ChatController` wired to
 * the REAL `ChatService` and `ChannelAccessService` (only their repository /
 * collaborator dependencies are mocked, exactly as `chat.service.spec.ts`
 * does), so the authorization decisions this suite asserts on are the actual
 * production code path, not a stand-in. `attendance-points-flow.e2e-spec.ts`
 * is the harness pattern this follows; unlike that suite, the service under
 * test is not itself mocked, because the point here is the authz surface
 * (channel access, read-only-channel gating, cross-channel reply rejection),
 * which lives inside `ChatService`/`ChannelAccessService`, not the controller.
 */
describe('Chat hot path (e2e)', () => {
  let app: INestApplication;

  const generalChannel: ChatChannel = {
    id: 'chan-general',
    chapter_id: 'chapter-1',
    name: 'general',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };

  const announcementsChannel: ChatChannel = {
    ...generalChannel,
    id: 'chan-announcements',
    name: 'announcements',
    is_read_only: true,
  };

  const otherChannelMessage: ChatMessage = {
    id: 'msg-other-channel',
    channel_id: 'chan-other',
    sender_id: 'user-2',
    content: 'From a different channel',
    type: 'TEXT',
    reply_to_id: null,
    metadata: {},
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const baseMember = {
    id: 'mem-1',
    user_id: 'user-1',
    chapter_id: 'chapter-1',
    role_ids: ['role-member'],
    has_completed_onboarding: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const channelRepoMock: jest.Mocked<IChatChannelRepository> = {
    findById: jest.fn(),
    findByChapter: jest.fn(),
    findDm: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    leaveGroupDm: jest.fn(),
  };
  const categoryRepoMock: jest.Mocked<IChatCategoryRepository> = {
    findByChapter: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const messageRepoMock: jest.Mocked<IChatMessageRepository> = {
    findById: jest.fn(),
    findByChannel: jest.fn(),
    findPinnedByChannel: jest.fn(),
    countPinnedByChannel: jest.fn(),
    findPollsByChapter: jest.fn(),
    findByClientMessageId: jest.fn(),
    findAuthorAvatarPaths: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const actionRepoMock: jest.Mocked<IChatMessageActionRepository> = {
    create: jest.fn(),
    findOne: jest.fn(),
    updateForVote: jest.fn(),
  };
  const attachmentRepoMock: jest.Mocked<IChatMessageAttachmentRepository> = {
    createMany: jest.fn(),
    findByMessage: jest.fn(),
  };
  const reactionRepoMock: jest.Mocked<IMessageReactionRepository> = {
    findByMessage: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const readReceiptRepoMock: jest.Mocked<IChannelReadReceiptRepository> = {
    findByChannelAndUser: jest.fn(),
    upsert: jest.fn(),
    getUnreadCounts: jest.fn(),
  };
  const storageProviderMock: jest.Mocked<IStorageProvider> = {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    getSignedDownloadUrls: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    deleteFile: jest.fn(),
    listFiles: jest.fn(),
    listObjects: jest.fn(),
    listFolders: jest.fn(),
    deleteFiles: jest.fn(),
  };
  const notificationServiceMock = {
    notifyUser: jest.fn(),
    notifyChapter: jest.fn(),
  };
  const memberRepoMock = {
    findByUserAndChapter: jest.fn(),
    findByChapter: jest.fn(),
    findChapterMemberIdentities: jest.fn(),
  };
  const activationServiceMock = { record: jest.fn() };
  const chatNotificationPrefsMock = {
    findChannelPreferencesForUser: jest.fn(),
    upsertChannelLevel: jest.fn(),
  };
  const channelCacheMock = {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  };
  const rbacServiceMock = {
    getEffectivePermissions: jest.fn(),
    hasAlumniRole: jest.fn(),
    isAlumni: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUPABASE_CLIENT)
      .useValue(createSupabaseMock())
      .overrideProvider(CHAT_CHANNEL_REPOSITORY)
      .useValue(channelRepoMock)
      .overrideProvider(CHAT_CATEGORY_REPOSITORY)
      .useValue(categoryRepoMock)
      .overrideProvider(CHAT_MESSAGE_REPOSITORY)
      .useValue(messageRepoMock)
      .overrideProvider(CHAT_MESSAGE_ACTION_REPOSITORY)
      .useValue(actionRepoMock)
      .overrideProvider(CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
      .useValue(attachmentRepoMock)
      .overrideProvider(MESSAGE_REACTION_REPOSITORY)
      .useValue(reactionRepoMock)
      .overrideProvider(CHANNEL_READ_RECEIPT_REPOSITORY)
      .useValue(readReceiptRepoMock)
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(storageProviderMock)
      .overrideProvider(MEMBER_REPOSITORY)
      .useValue(memberRepoMock)
      .overrideProvider(NotificationService)
      .useValue(notificationServiceMock)
      .overrideProvider(RbacService)
      .useValue(rbacServiceMock)
      .overrideProvider(ActivationService)
      .useValue(activationServiceMock)
      .overrideProvider(ChatNotificationPreferenceRepository)
      .useValue(chatNotificationPrefsMock)
      .overrideProvider(ChannelCacheService)
      .useValue(channelCacheMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // `resetAllMocks` (not `clearAllMocks`) — this also drops any
  // `mockResolvedValue` a previous test installed, so a test that forgets to
  // set a mock fails loudly instead of silently inheriting another test's
  // fixture.
  beforeEach(() => {
    jest.resetAllMocks();
    channelRepoMock.findById.mockResolvedValue(generalChannel);
    memberRepoMock.findByUserAndChapter.mockResolvedValue(baseMember);
    memberRepoMock.findChapterMemberIdentities.mockResolvedValue([]);
    rbacServiceMock.getEffectivePermissions.mockResolvedValue([]);
    rbacServiceMock.hasAlumniRole.mockResolvedValue(false);
    rbacServiceMock.isAlumni.mockResolvedValue(false);
    attachmentRepoMock.createMany.mockResolvedValue([]);
    attachmentRepoMock.findByMessage.mockResolvedValue([]);
    readReceiptRepoMock.getUnreadCounts.mockResolvedValue([]);
    chatNotificationPrefsMock.findChannelPreferencesForUser.mockResolvedValue(
      [],
    );
    activationServiceMock.record.mockResolvedValue(true);
    notificationServiceMock.notifyUser.mockResolvedValue(undefined);
    notificationServiceMock.notifyChapter.mockResolvedValue(undefined);
  });

  it('sends a message on the happy path', async () => {
    const created: ChatMessage = {
      id: 'msg-new',
      channel_id: generalChannel.id,
      sender_id: 'user-1',
      content: 'Hello chapter',
      type: 'TEXT',
      reply_to_id: null,
      metadata: {},
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: '2026-01-01T12:00:00.000Z',
    };
    messageRepoMock.create.mockResolvedValue(created);

    const response = await request(app.getHttpServer())
      .post(`${V1}/channels/${generalChannel.id}/messages`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        client_message_id: '11111111-1111-4111-8111-111111111111',
        content: 'Hello chapter',
      })
      .expect(201);

    expect(response.body).toEqual({ message: created, deduplicated: false });
    expect(messageRepoMock.create).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on client_message_id: a retried send returns the existing row instead of inserting again', async () => {
    const clientMessageId = '22222222-2222-4222-8222-222222222222';
    const existing: ChatMessage = {
      id: 'msg-existing',
      channel_id: generalChannel.id,
      sender_id: 'user-1',
      content: 'Already sent',
      type: 'TEXT',
      reply_to_id: null,
      metadata: {},
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: '2026-01-01T12:00:00.000Z',
    };
    messageRepoMock.create.mockRejectedValue(
      new ChatMessageDuplicateError(
        generalChannel.id,
        'user-1',
        clientMessageId,
      ),
    );
    messageRepoMock.findByClientMessageId.mockResolvedValue(existing);

    const response = await request(app.getHttpServer())
      .post(`${V1}/channels/${generalChannel.id}/messages`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({ client_message_id: clientMessageId, content: 'Already sent' })
      .expect(201);

    expect(response.body).toEqual({ message: existing, deduplicated: true });
    expect(messageRepoMock.findByClientMessageId).toHaveBeenCalledWith(
      generalChannel.id,
      'user-1',
      clientMessageId,
    );
  });

  it('forbids a post to a read-only channel from a sender without announcements:post', async () => {
    channelRepoMock.findById.mockResolvedValue(announcementsChannel);
    rbacServiceMock.getEffectivePermissions.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post(`${V1}/channels/${announcementsChannel.id}/messages`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        client_message_id: '33333333-3333-4333-8333-333333333333',
        content: 'I do not hold announcements:post',
      })
      .expect(403);

    expect(messageRepoMock.create).not.toHaveBeenCalled();
  });

  it('allows a post to a read-only channel from a sender who holds announcements:post', async () => {
    channelRepoMock.findById.mockResolvedValue(announcementsChannel);
    rbacServiceMock.getEffectivePermissions.mockResolvedValue([
      'announcements:post',
    ]);
    const created: ChatMessage = {
      id: 'msg-announcement',
      channel_id: announcementsChannel.id,
      sender_id: 'user-1',
      content: 'Chapter meeting moved to 7pm',
      type: 'TEXT',
      reply_to_id: null,
      metadata: {},
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: '2026-01-01T12:00:00.000Z',
    };
    messageRepoMock.create.mockResolvedValue(created);

    await request(app.getHttpServer())
      .post(`${V1}/channels/${announcementsChannel.id}/messages`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        client_message_id: '55555555-5555-4555-8555-555555555555',
        content: 'Chapter meeting moved to 7pm',
      })
      .expect(201);

    expect(messageRepoMock.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reply_to_id pointing at a message in a different channel', async () => {
    messageRepoMock.findById.mockResolvedValue(otherChannelMessage);

    await request(app.getHttpServer())
      .post(`${V1}/channels/${generalChannel.id}/messages`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        client_message_id: '44444444-4444-4444-8444-444444444444',
        content: 'Threading across channels',
        reply_to_id: otherChannelMessage.id,
      })
      .expect(400);

    expect(messageRepoMock.create).not.toHaveBeenCalled();
  });

  it('toggles a reaction on a message in an accessible channel', async () => {
    const targetMessage: ChatMessage = {
      id: 'msg-react-target',
      channel_id: generalChannel.id,
      sender_id: 'user-2',
      content: 'React to me',
      type: 'TEXT',
      reply_to_id: null,
      metadata: {},
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: '2026-01-01T12:00:00.000Z',
    };
    messageRepoMock.findById.mockResolvedValue(targetMessage);
    reactionRepoMock.findOne.mockResolvedValue(null);
    reactionRepoMock.create.mockResolvedValue({
      id: 'reaction-1',
      message_id: targetMessage.id,
      user_id: 'user-1',
      emoji: '🎉',
      created_at: '2026-01-01T12:00:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .post(`${V1}/channels/messages/${targetMessage.id}/reactions`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({ emoji: '🎉' })
      .expect(201);

    expect(response.body.action).toBe('added');
    expect(reactionRepoMock.create).toHaveBeenCalledWith({
      message_id: targetMessage.id,
      user_id: 'user-1',
      emoji: '🎉',
    });
  });
});
