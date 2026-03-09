import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import {
  NOTIFICATION_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  NOTIFICATION_PREFERENCE_REPOSITORY,
  USER_SETTINGS_REPOSITORY,
} from '../../domain/repositories/notification.repository.interface';
import type {
  INotificationRepository,
  IPushTokenRepository,
  INotificationPreferenceRepository,
  IUserSettingsRepository,
} from '../../domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import type { INotificationProvider } from '../../domain/adapters/notification.interface';
import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '../../domain/entities/notification.entity';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockNotificationRepo: jest.Mocked<INotificationRepository>;
  let mockPushTokenRepo: jest.Mocked<IPushTokenRepository>;
  let mockPreferenceRepo: jest.Mocked<INotificationPreferenceRepository>;
  let mockSettingsRepo: jest.Mocked<IUserSettingsRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockPushProvider: jest.Mocked<INotificationProvider>;

  beforeEach(async () => {
    mockNotificationRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findById: jest.fn(),
      markRead: jest.fn(),
    };
    mockPushTokenRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findById: jest.fn(),
      findByToken: jest.fn(),
      delete: jest.fn(),
      deleteByToken: jest.fn(),
    };
    mockPreferenceRepo = {
      findByUserAndChapter: jest.fn(),
      upsert: jest.fn(),
      findByUserChapterCategory: jest.fn(),
    };
    mockSettingsRepo = {
      findByUser: jest.fn(),
      upsert: jest.fn(),
    };
    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    mockPushProvider = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: NOTIFICATION_REPOSITORY, useValue: mockNotificationRepo },
        { provide: PUSH_TOKEN_REPOSITORY, useValue: mockPushTokenRepo },
        {
          provide: NOTIFICATION_PREFERENCE_REPOSITORY,
          useValue: mockPreferenceRepo,
        },
        { provide: USER_SETTINGS_REPOSITORY, useValue: mockSettingsRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: NOTIFICATION_PROVIDER, useValue: mockPushProvider },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  const baseNotification: Notification = {
    id: 'n-1',
    chapter_id: 'ch-1',
    user_id: 'u-1',
    title: 'Test',
    body: 'Body',
    data: {},
    read_at: null,
    created_at: '2026-02-27T00:00:00.000Z',
  };

  const basePushToken: PushToken = {
    id: 'pt-1',
    user_id: 'u-1',
    token: 'ExponentPushToken[xxx]',
    device_name: 'iPhone',
    created_at: '2026-02-27T00:00:00.000Z',
  };

  const basePreference: NotificationPreference = {
    id: 'np-1',
    user_id: 'u-1',
    chapter_id: 'ch-1',
    category: 'chat',
    is_enabled: true,
    updated_at: '2026-02-27T00:00:00.000Z',
  };

  const baseSettings: UserSettings = {
    id: 'us-1',
    user_id: 'u-1',
    quiet_hours_start: '22:00:00',
    quiet_hours_end: '08:00:00',
    quiet_hours_tz: 'America/New_York',
    theme: 'system',
    updated_at: '2026-02-27T00:00:00.000Z',
  };

  describe('notifyUser', () => {
    it('should skip when preference is disabled for category', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue({
        ...basePreference,
        is_enabled: false,
      });
      mockSettingsRepo.findByUser.mockResolvedValue(null);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Test',
        body: 'Body',
        category: 'chat',
      });

      expect(mockNotificationRepo.create).not.toHaveBeenCalled();
      expect(mockPushProvider.sendToUser).not.toHaveBeenCalled();
    });

    it('should deliver when preference is enabled', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Test',
        body: 'Body',
        category: 'chat',
      });

      expect(mockNotificationRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'u-1',
        title: 'Test',
        body: 'Body',
        data: {},
      });
      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({
          title: 'Test',
          body: 'Body',
          priority: 'NORMAL',
        }),
      );
    });

    it('should downgrade to SILENT during quiet hours for NORMAL priority', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T15:00:00Z'));

      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue({
        ...baseSettings,
        quiet_hours_start: '00:00:00',
        quiet_hours_end: '23:59:00',
      });
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Test',
        body: 'Body',
        priority: 'NORMAL',
      });

      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({
          priority: 'SILENT',
        }),
      );

      jest.useRealTimers();
    });

    it('should NOT downgrade URGENT during quiet hours', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Urgent',
        body: 'Emergency',
        priority: 'URGENT',
      });

      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({
          priority: 'URGENT',
        }),
      );
    });

    it('should normalize Intl hour 24 to midnight for quiet-hours checks', async () => {
      const formatToPartsSpy = jest
        .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
        .mockReturnValue([
          { type: 'hour', value: '24' },
          { type: 'literal', value: ':' },
          { type: 'minute', value: '15' },
          { type: 'literal', value: ':' },
          { type: 'second', value: '00' },
        ]);

      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      try {
        await service.notifyUser('u-1', 'ch-1', {
          title: 'Midnight',
          body: 'Body',
          priority: 'NORMAL',
        });

        expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
          [basePushToken.token],
          expect.objectContaining({
            priority: 'SILENT',
          }),
        );
      } finally {
        formatToPartsSpy.mockRestore();
      }
    });

    it('should continue when push provider delivery fails', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
      mockPushProvider.sendToUser.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
        }),
      ).resolves.toBeUndefined();

      expect(mockNotificationRepo.create).toHaveBeenCalled();
    });

    it('should use default category when category is omitted', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(null);
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Test',
        body: 'Body',
      });

      expect(mockPreferenceRepo.findByUserChapterCategory).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        'default',
      );
    });

    it('should not send push when user has no push tokens', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Test',
        body: 'Body',
      });

      expect(mockNotificationRepo.create).toHaveBeenCalled();
      expect(mockPushProvider.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('notifyChapter', () => {
    it('should notify all chapter members', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        {
          id: 'm-1',
          user_id: 'u-1',
          chapter_id: 'ch-1',
          role_ids: [],
          has_completed_onboarding: false,
          created_at: '',
          updated_at: '',
        },
        {
          id: 'm-2',
          user_id: 'u-2',
          chapter_id: 'ch-1',
          role_ids: [],
          has_completed_onboarding: false,
          created_at: '',
          updated_at: '',
        },
      ]);
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
        basePreference,
      );
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create
        .mockResolvedValueOnce({ ...baseNotification, user_id: 'u-1' })
        .mockResolvedValueOnce({ ...baseNotification, user_id: 'u-2' });
      mockPushTokenRepo.findByUser
        .mockResolvedValueOnce([basePushToken])
        .mockResolvedValueOnce([
          { ...basePushToken, id: 'pt-2', user_id: 'u-2' },
        ]);

      await service.notifyChapter('ch-1', {
        title: 'Chapter Announcement',
        body: 'Hello everyone',
      });

      expect(mockMemberRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(mockNotificationRepo.create).toHaveBeenCalledTimes(2);
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('push token management', () => {
    it('should register new push token', async () => {
      mockPushTokenRepo.findByToken.mockResolvedValue(null);
      mockPushTokenRepo.create.mockResolvedValue(basePushToken);

      const result = await service.registerPushToken(
        'u-1',
        'ExponentPushToken[xxx]',
        'iPhone',
      );

      expect(mockPushTokenRepo.create).toHaveBeenCalledWith({
        user_id: 'u-1',
        token: 'ExponentPushToken[xxx]',
        device_name: 'iPhone',
      });
      expect(result).toEqual(basePushToken);
    });

    it('should return existing token when same user re-registers', async () => {
      mockPushTokenRepo.findByToken.mockResolvedValue(basePushToken);

      const result = await service.registerPushToken(
        'u-1',
        'ExponentPushToken[xxx]',
      );

      expect(mockPushTokenRepo.create).not.toHaveBeenCalled();
      expect(result).toEqual(basePushToken);
    });

    it('should remove push token', async () => {
      mockPushTokenRepo.findById.mockResolvedValue(basePushToken);
      mockPushTokenRepo.delete.mockResolvedValue();

      await service.removePushToken('pt-1', 'u-1');

      expect(mockPushTokenRepo.delete).toHaveBeenCalledWith('pt-1', 'u-1');
    });

    it('should throw NotFoundException when removing token not owned by user', async () => {
      mockPushTokenRepo.findById.mockResolvedValue({
        ...basePushToken,
        user_id: 'u-2',
      });

      await expect(service.removePushToken('pt-1', 'u-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.removePushToken('pt-1', 'u-1')).rejects.toThrow(
        'Push token not found',
      );
    });
  });

  describe('mark notification as read', () => {
    it('should mark notification as read', async () => {
      mockNotificationRepo.findById.mockResolvedValue(baseNotification);
      mockNotificationRepo.markRead.mockResolvedValue({
        ...baseNotification,
        read_at: '2026-02-27T01:00:00.000Z',
      });

      const result = await service.markNotificationRead('n-1', 'u-1');

      expect(mockNotificationRepo.markRead).toHaveBeenCalledWith('n-1', 'u-1');
      expect(result.read_at).toBe('2026-02-27T01:00:00.000Z');
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepo.findById.mockResolvedValue(null);

      await expect(
        service.markNotificationRead('n-999', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when notification belongs to another user', async () => {
      mockNotificationRepo.findById.mockResolvedValue({
        ...baseNotification,
        user_id: 'u-2',
      });

      await expect(service.markNotificationRead('n-1', 'u-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('notification preferences', () => {
    it('should get preferences for user and chapter', async () => {
      mockPreferenceRepo.findByUserAndChapter.mockResolvedValue([
        basePreference,
      ]);

      const result = await service.getPreferences('u-1', 'ch-1');

      expect(mockPreferenceRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
      );
      expect(result).toEqual([basePreference]);
    });

    it('should update preference', async () => {
      mockPreferenceRepo.upsert.mockResolvedValue({
        ...basePreference,
        is_enabled: false,
      });

      const result = await service.updatePreference(
        'u-1',
        'ch-1',
        'chat',
        false,
      );

      expect(mockPreferenceRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        chapter_id: 'ch-1',
        category: 'chat',
        is_enabled: false,
      });
      expect(result.is_enabled).toBe(false);
    });
  });

  describe('user settings', () => {
    it('should get user settings', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

      const result = await service.getSettings('u-1');

      expect(mockSettingsRepo.findByUser).toHaveBeenCalledWith('u-1');
      expect(result).toEqual(baseSettings);
    });

    it('should return null when no settings exist', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(null);

      const result = await service.getSettings('u-1');

      expect(result).toBeNull();
    });

    it('should update user settings', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue({
        ...baseSettings,
        theme: 'dark',
      });

      const result = await service.updateSettings('u-1', { theme: 'dark' });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'u-1',
          theme: 'dark',
        }),
      );
      expect(result.theme).toBe('dark');
    });
  });

  describe('listNotifications', () => {
    it('should list notifications for user', async () => {
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      const result = await service.listNotifications('u-1', { limit: 20 });

      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith('u-1', {
        limit: 20,
      });
      expect(result).toEqual([baseNotification]);
    });
  });
});
