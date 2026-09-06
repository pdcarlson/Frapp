import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/services/chat.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '#domain/constants/permissions';

describe('ChatController', () => {
  let controller: ChatController;
  let service: jest.Mocked<Partial<ChatService>>;
  let rbacService: jest.Mocked<Pick<RbacService, 'memberHasAnyPermission'>>;

  beforeEach(async () => {
    rbacService = { memberHasAnyPermission: jest.fn() };
    service = {
      deleteMessage: jest.fn(),
      editMessage: jest.fn(),
      pinMessage: jest.fn(),
      unpinMessage: jest.fn(),
      updateCategory: jest.fn(),
      deleteCategory: jest.fn(),
      getChannels: jest.fn(),
      getChannel: jest.fn(),
      createChannel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        { provide: RbacService, useValue: rbacService },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

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
    it('passes the caller’s user id to getChannels', async () => {
      await controller.listChannels('ch-1', 'user-1');

      expect(service.getChannels).toHaveBeenCalledWith('ch-1', 'user-1');
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

      expect(service.updateCategory).toHaveBeenCalledWith('cat-1', 'ch-1', {
        name: 'Renamed',
      });
      expect(service.deleteCategory).toHaveBeenCalledWith('cat-1', 'ch-1');
    });
  });
});
