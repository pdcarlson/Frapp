import { AuthSyncGuard } from '../guards/auth-sync.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from '../../application/services/notification.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { BadRequestException } from '@nestjs/common';
import {
  RegisterPushTokenDto,
  UpdateNotificationPreferenceDto,
  UpdateUserSettingsDto,
} from '../dtos/notification.dto';

describe('NotificationController', () => {
  let controller: NotificationController;
  let notificationService: jest.Mocked<Partial<NotificationService>>;

  beforeEach(async () => {
    notificationService = {
      registerPushToken: jest.fn(),
      removePushToken: jest.fn(),
      listNotifications: jest.fn(),
      markNotificationRead: jest.fn(),
      getPreferences: jest.fn(),
      updatePreference: jest.fn(),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: notificationService,
        },
      ],
    })
      .overrideGuard(AuthSyncGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationController>(NotificationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('registerPushToken', () => {
    it('should call notificationService.registerPushToken with correct parameters', async () => {
      const userId = 'user-1';
      const dto: RegisterPushTokenDto = {
        token: 'token-123',
        device_name: 'My iPhone',
      };
      const expectedResult = { id: 'push-1', ...dto, user_id: userId };

      notificationService.registerPushToken!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.registerPushToken(userId, dto);

      expect(notificationService.registerPushToken).toHaveBeenCalledWith(
        userId,
        dto.token,
        dto.device_name,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('removePushToken', () => {
    it('should call notificationService.removePushToken and return success', async () => {
      const userId = 'user-1';
      const id = 'push-1';

      notificationService.removePushToken!.mockResolvedValue(undefined);

      const result = await controller.removePushToken(userId, id);

      expect(notificationService.removePushToken).toHaveBeenCalledWith(
        id,
        userId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('listNotifications', () => {
    it('should call notificationService.listNotifications with no options when limit is not provided', async () => {
      const userId = 'user-1';
      const expectedResult = [{ id: 'notif-1' }];

      notificationService.listNotifications!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.listNotifications(userId);

      expect(notificationService.listNotifications).toHaveBeenCalledWith(
        userId,
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should call notificationService.listNotifications with limit option when limit is provided', async () => {
      const userId = 'user-1';
      const expectedResult = [{ id: 'notif-1' }];

      notificationService.listNotifications!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.listNotifications(userId, '10');

      expect(notificationService.listNotifications).toHaveBeenCalledWith(
        userId,
        { limit: 10 },
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('markRead', () => {
    it('should call notificationService.markNotificationRead with correct parameters', async () => {
      const userId = 'user-1';
      const id = 'notif-1';
      const expectedResult = { id, is_read: true };

      notificationService.markNotificationRead!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.markRead(userId, id);

      expect(notificationService.markNotificationRead).toHaveBeenCalledWith(
        id,
        userId,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getPreferences', () => {
    it('should call notificationService.getPreferences with correct parameters', async () => {
      const userId = 'user-1';
      const chapterId = 'chapter-1';
      const expectedResult = [{ id: 'pref-1' }];

      notificationService.getPreferences!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.getPreferences(userId, chapterId);

      expect(notificationService.getPreferences).toHaveBeenCalledWith(
        userId,
        chapterId,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should throw BadRequestException if chapterId is not provided', async () => {
      const userId = 'user-1';

      await expect(controller.getPreferences(userId, '')).rejects.toThrow(
        BadRequestException,
      );
      expect(notificationService.getPreferences).not.toHaveBeenCalled();
    });
  });

  describe('updatePreference', () => {
    it('should call notificationService.updatePreference with correct parameters', async () => {
      const userId = 'user-1';
      const dto: UpdateNotificationPreferenceDto = {
        chapter_id: 'chapter-1',
        category: 'chat',
        is_enabled: true,
      };
      const expectedResult = { id: 'pref-1', ...dto, user_id: userId };

      notificationService.updatePreference!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.updatePreference(userId, dto);

      expect(notificationService.updatePreference).toHaveBeenCalledWith(
        userId,
        dto.chapter_id,
        dto.category,
        dto.is_enabled,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getSettings', () => {
    it('should call notificationService.getSettings with correct parameters', async () => {
      const userId = 'user-1';
      const expectedResult = { id: 'settings-1', user_id: userId };

      notificationService.getSettings!.mockResolvedValue(expectedResult as any);

      const result = await controller.getSettings(userId);

      expect(notificationService.getSettings).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateSettings', () => {
    it('should call notificationService.updateSettings with correct parameters', async () => {
      const userId = 'user-1';
      const dto: UpdateUserSettingsDto = {
        theme: 'dark',
      };
      const expectedResult = {
        id: 'settings-1',
        user_id: userId,
        theme: 'dark',
      };

      notificationService.updateSettings!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.updateSettings(userId, dto);

      expect(notificationService.updateSettings).toHaveBeenCalledWith(
        userId,
        dto,
      );
      expect(result).toEqual(expectedResult);
    });
  });
});
