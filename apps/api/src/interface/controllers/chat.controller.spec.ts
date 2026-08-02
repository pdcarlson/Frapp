import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/services/chat.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';

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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        { provide: RbacService, useValue: rbacService },
        { provide: 'SUPABASE_CLIENT', useValue: {} },
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
