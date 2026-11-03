import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/services/chat.service';
import { ChatAttachmentService } from '../../application/services/chat-attachment.service';
import { ChatNotificationPreferenceService } from '../../application/services/chat-notification-preference.service';
import { ChatCategoryService } from '../../application/services/chat-category.service';
import { ChatReactionService } from '../../application/services/chat-reaction.service';
import type { MaskedChatMessage } from '../../application/services/chat-block-mask';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('ChatController', () => {
  let controller: ChatController;
  let service: jest.Mocked<
    Pick<
      ChatService,
      | 'deleteMessage'
      | 'editMessage'
      | 'pinMessage'
      | 'unpinMessage'
      | 'getChannelList'
      | 'getChannel'
      | 'createChannel'
      | 'getMessages'
      | 'addPrivateChannelMember'
      | 'removePrivateChannelMember'
      | 'sendMessage'
    >
  >;
  let attachments: jest.Mocked<
    Pick<ChatAttachmentService, 'requestChatUploadUrl'>
  >;
  let categories: jest.Mocked<
    Pick<ChatCategoryService, 'updateCategory' | 'deleteCategory'>
  >;
  let reactions: jest.Mocked<Pick<ChatReactionService, 'recordMessageAction'>>;
  let rbacService: jest.Mocked<Pick<RbacService, 'memberHasAnyPermission'>>;

  beforeEach(async () => {
    rbacService = { memberHasAnyPermission: jest.fn() };
    attachments = { requestChatUploadUrl: jest.fn() };
    categories = { updateCategory: jest.fn(), deleteCategory: jest.fn() };
    reactions = { recordMessageAction: jest.fn() };
    service = {
      deleteMessage: jest.fn(),
      editMessage: jest.fn(),
      pinMessage: jest.fn(),
      unpinMessage: jest.fn(),
      getChannelList: jest.fn(),
      getChannel: jest.fn(),
      createChannel: jest.fn(),
      getMessages: jest.fn(),
      addPrivateChannelMember: jest.fn(),
      removePrivateChannelMember: jest.fn(),
      sendMessage: jest.fn(),
    };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        { provide: ChatAttachmentService, useValue: attachments },
        { provide: ChatNotificationPreferenceService, useValue: {} },
        { provide: ChatCategoryService, useValue: categories },
        { provide: ChatReactionService, useValue: reactions },
        { provide: RbacService, useValue: rbacService },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  // The delete route used to hardcode `hasManagePermission = false`, so the
  // moderation path in spec/behavior/chat/README.md could never fire.
  describe('deleteMessage', () => {
    it('grants the moderation path to a channels:manage holder', async () => {
      rbacService.memberHasAnyPermission.mockResolvedValue(true);

      await controller.deleteMessage('msg-1', 'ch-1', 'user-1');

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
        [SystemPermissions.CHANNELS_MANAGE],
      );
      expect(service.deleteMessage).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
        true,
      );
    });

    it('leaves an ordinary member on the own-message path', async () => {
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      await controller.deleteMessage('msg-1', 'ch-1', 'user-1');

      expect(service.deleteMessage).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
        false,
      );
    });
  });

  // The channel-list leak (#1001) was structural: the handler took no user id,
  // so the service had nothing to filter on no matter what it did. These assert
  // at the layer where that defect actually lived.
  describe('channel reads carry the caller', () => {
    it('passes the caller’s user id to getChannelList', async () => {
      await controller.listChannels('ch-1', 'user-1');

      expect(service.getChannelList).toHaveBeenCalledWith('ch-1', 'user-1');
    });

    it('passes the caller’s user id to getChannel', async () => {
      await controller.getChannel('ch-1', 'chan-1', 'user-1');

      expect(service.getChannel).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'user-1',
      );
    });

    // #1008 is the same shape one route over: the create handler took no user
    // id, so the service had nobody to seed a PRIVATE channel's `member_ids`
    // with and the row landed readable by no one.
    it('passes the caller’s user id to createChannel', async () => {
      await controller.createChannel('ch-1', 'user-1', {
        name: 'exec-private',
        type: 'PRIVATE',
      });

      expect(service.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ chapter_id: 'ch-1', type: 'PRIVATE' }),
        'user-1',
      );
    });
  });

  // Every by-id chat mutation must carry the active chapter through to the
  // service, which re-checks it before touching the row.
  describe('active-chapter threading', () => {
    it('passes the chapter to editMessage', async () => {
      await controller.editMessage('msg-1', 'ch-1', 'user-1', {
        content: 'Updated',
      });

      expect(service.editMessage).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
        'Updated',
      );
    });

    it('passes the chapter to pin and unpin', async () => {
      await controller.pinMessage('msg-1', 'ch-1', 'user-1');
      await controller.unpinMessage('msg-1', 'ch-1', 'user-1');

      expect(service.pinMessage).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
      );
      expect(service.unpinMessage).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
      );
    });

    it('passes the chapter to category update and delete', async () => {
      await controller.updateCategory('cat-1', 'ch-1', { name: 'Renamed' });
      await controller.deleteCategory('cat-1', 'ch-1');

      expect(categories.updateCategory).toHaveBeenCalledWith('cat-1', 'ch-1', {
        name: 'Renamed',
      });
      expect(categories.deleteCategory).toHaveBeenCalledWith('cat-1', 'ch-1');
    });
  });

  describe('private channel membership (#1302)', () => {
    // `PermissionsGuard` enforces whatever the metadata says; what can
    // silently regress is the metadata. Without `channels:manage` here, any
    // member holding the class floor (`members:view`, which every seeded role
    // has) could add themselves to any private channel and read it.
    it.each(['addChannelMember', 'removeChannelMember'] as const)(
      '%s requires channels:manage on top of the class floor',
      (handler) => {
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, controller[handler] as object),
        ).toEqual([SystemPermissions.CHANNELS_MANAGE]);
      },
    );

    it('threads the chapter, channel and user to the add', async () => {
      await controller.addChannelMember('ch-1', 'chan-1', {
        user_id: 'user-2',
      });

      expect(service.addPrivateChannelMember).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'user-2',
      );
    });

    it('threads the chapter, channel and user to the removal', async () => {
      await controller.removeChannelMember('ch-1', 'chan-1', 'user-2');

      expect(service.removePrivateChannelMember).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'user-2',
      );
    });
  });

  // A poll is written through the chat send route and voted on through the
  // actions route, neither of which carries `@RequireModule`, so the service
  // gates them from the chapter's `enabled_modules` (#2993). These pin that
  // the handlers read it off the request and hand it on.
  describe('module gate threading (#2993)', () => {
    const enabledModules = { polls: false };

    /** What each handler's decorated parameters resolve to for one request. */
    const resolveParams = (handler: keyof ChatController) => {
      const request = { enabledModules, chapterId: 'ch-1' };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        ChatController,
        handler,
      ) as Record<
        string,
        { factory?: (data: unknown, ctx: ExecutionContext) => unknown }
      >;
      return Object.values(args)
        .filter((arg) => typeof arg.factory === 'function')
        .map((arg) => arg.factory!(undefined, ctx));
    };

    it('reads enabled_modules off the request on send and on actions', () => {
      expect(resolveParams('sendMessage')).toContain(enabledModules);
      expect(resolveParams('recordMessageAction')).toContain(enabledModules);
    });

    it('hands enabled_modules to sendMessage', async () => {
      await controller.sendMessage('chan-1', 'ch-1', 'user-1', enabledModules, {
        content: 'Formal venue?',
        client_message_id: '11111111-1111-1111-1111-111111111111',
        kind: 'poll',
      });

      expect(service.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'poll',
          enabled_modules: enabledModules,
        }),
      );
    });

    it('hands enabled_modules to recordMessageAction', async () => {
      await controller.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        enabledModules,
        { action_type: 'vote', payload: { option_id: 'opt-a' } },
      );

      expect(reactions.recordMessageAction).toHaveBeenCalledWith(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'vote', payload: { option_id: 'opt-a' } },
        enabledModules,
      );
    });
  });

  describe('getMessages', () => {
    it('forwards limit, before, and since from the query DTO', async () => {
      const messages = [{ id: 'm1' }] as MaskedChatMessage[];
      service.getMessages.mockResolvedValue(messages);

      await expect(
        controller.getMessages('chan-1', 'ch-1', 'user-1', {
          limit: 25,
          before: '2026-04-01T12:00:00.000Z',
          since: '44444444-4444-4444-8444-444444444444',
        }),
      ).resolves.toEqual(messages);

      expect(service.getMessages).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'user-1',
        {
          limit: 25,
          before: '2026-04-01T12:00:00.000Z',
          since: '44444444-4444-4444-8444-444444444444',
        },
      );
    });
  });

  // #2130 — this 201 used to pass the camelCase service ticket straight
  // through with no response DTO, so OpenAPI documented it as empty and the
  // composer read it through an `as unknown as` cast. These pin the mapping.
  describe('requestUploadUrl', () => {
    const dto = { filename: 'photo.png', content_type: 'image/png' };

    it('maps the camelCase service ticket onto the snake_case wire contract', async () => {
      (attachments.requestChatUploadUrl as jest.Mock).mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: 'chapters/ch-1/chat/chan-1/msg-1/photo.png',
        messageId: 'msg-1',
      });

      const result = await controller.requestUploadUrl(
        'chan-1',
        'ch-1',
        'user-1',
        dto,
      );

      expect(attachments.requestChatUploadUrl).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'user-1',
        dto.filename,
        dto.content_type,
        undefined,
      );
      expect(result).toEqual({
        upload_url: 'https://storage.example/put',
        storage_path: 'chapters/ch-1/chat/chan-1/msg-1/photo.png',
        message_id: 'msg-1',
      });
    });

    it('fails closed when the service omits the signed URL', async () => {
      (attachments.requestChatUploadUrl as jest.Mock).mockResolvedValue({
        signedUrl: '',
        storagePath: 'chapters/ch-1/chat/chan-1/msg-1/photo.png',
        messageId: 'msg-1',
      });

      await expect(
        controller.requestUploadUrl('chan-1', 'ch-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('fails closed when the service omits the storage path', async () => {
      (attachments.requestChatUploadUrl as jest.Mock).mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: '',
        messageId: 'msg-1',
      });

      await expect(
        controller.requestUploadUrl('chan-1', 'ch-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
