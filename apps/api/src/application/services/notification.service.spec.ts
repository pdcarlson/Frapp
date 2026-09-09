import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import {
  NOTIFICATION_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  NOTIFICATION_PREFERENCE_REPOSITORY,
  USER_SETTINGS_REPOSITORY,
} from '#domain/repositories/notification.repository.interface';
import type {
  INotificationRepository,
  IPushTokenRepository,
  INotificationPreferenceRepository,
  IUserSettingsRepository,
} from '#domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '#domain/adapters/notification.interface';
import type { INotificationProvider } from '#domain/adapters/notification.interface';
import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '#domain/entities/notification.entity';
import type { Member } from '#domain/entities/member.entity';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '#domain/constants/list-query-limits';

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
      createMany: jest.fn(),
      findByUser: jest.fn(),
      findById: jest.fn(),
      markRead: jest.fn(),
    };
    mockPushTokenRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByUserIds: jest.fn(),
      findById: jest.fn(),
      findByToken: jest.fn(),
      delete: jest.fn(),
      deleteByToken: jest.fn(),
    };
    mockPreferenceRepo = {
      findByUserAndChapter: jest.fn(),
      upsert: jest.fn(),
      findByUserChapterCategory: jest.fn(),
      findByUsersChapterCategory: jest.fn(),
    };
    mockSettingsRepo = {
      findByUser: jest.fn(),
      findByUserIds: jest.fn(),
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
      sendToUser: jest.fn().mockResolvedValue({ invalidTokens: [] }),
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

  const chapterMember = (
    userId: string,
    overrides: Partial<Member> = {},
  ): Member => ({
    id: `m-${userId}`,
    user_id: userId,
    chapter_id: 'ch-1',
    role_ids: [],
    custom_role_ids: [],
    has_completed_onboarding: false,
    dismissed_ops_nudges: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  });

  const notificationsFor = (userIds: string[]): Notification[] =>
    userIds.map((userId, index) => ({
      ...baseNotification,
      id: index === 0 && userId === 'u-1' ? baseNotification.id : `n-${userId}`,
      user_id: userId,
    }));

  const tokensFor = (userIds: string[]): PushToken[] =>
    userIds.map((userId, index) =>
      index === 0 && userId === 'u-1'
        ? basePushToken
        : { ...basePushToken, id: `pt-${userId}`, user_id: userId },
    );

  const echoCreateMany = async (
    rows: Partial<Notification>[],
  ): Promise<Notification[]> =>
    rows.map((row, index) => ({
      ...baseNotification,
      id: `n-${row.user_id ?? index}`,
      user_id: row.user_id ?? `missing-${index}`,
    }));

  const spyWarn = () =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const expectSilentPush = () => {
    expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
      [basePushToken.token],
      expect.objectContaining({ priority: 'SILENT' }),
    );
  };

  const stubChapterNotify = ({
    userIds = ['u-1'],
    members,
    prefs = [],
    settings = [],
    created,
    tokens,
    createManyImpl,
  }: {
    userIds?: string[];
    members?: Member[];
    prefs?: NotificationPreference[];
    settings?: UserSettings[];
    created?: Notification[];
    tokens?: PushToken[];
    createManyImpl?: (rows: Partial<Notification>[]) => Promise<Notification[]>;
  } = {}): string[] => {
    mockMemberRepo.findByChapter.mockResolvedValue(
      members ?? userIds.map((id) => chapterMember(id)),
    );
    mockPreferenceRepo.findByUsersChapterCategory.mockResolvedValue(prefs);
    mockSettingsRepo.findByUserIds.mockResolvedValue(settings);
    if (createManyImpl) {
      mockNotificationRepo.createMany.mockImplementation(createManyImpl);
    } else {
      mockNotificationRepo.createMany.mockResolvedValue(
        created ?? notificationsFor(userIds),
      );
    }
    mockPushTokenRepo.findByUserIds.mockResolvedValue(
      tokens ?? tokensFor(userIds),
    );
    return userIds;
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

    // #1041: the category gate used to run *before* the priority check, so
    // switching a category off also muted URGENT traffic in it — chapter
    // emergency announcements and the president's subscription-status alert
    // among them. A member must not be able to mute an emergency from a
    // settings screen.
    it('should deliver URGENT even when the category preference is disabled', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue({
        ...basePreference,
        category: 'announcements',
        is_enabled: false,
      });
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'New Announcement',
        body: 'Chapter meeting moved to 6pm',
        priority: 'URGENT',
        category: 'announcements',
      });

      // The in-app row as well as the push: suppressing the row would leave a
      // member who muted the category with no trace of the broadcast anywhere.
      expect(mockNotificationRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'u-1',
        title: 'New Announcement',
        body: 'Chapter meeting moved to 6pm',
        data: {},
      });
      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({ priority: 'URGENT' }),
      );
    });

    // The exemption is implemented by gating the lookup rather than reordering
    // it, so an URGENT payload never reads the preference at all. Pinned
    // because a later refactor back to "read, then check priority" would be
    // behaviourally identical but cost every emergency broadcast one query per
    // recipient on `notifyUser` — `notifyChapter` skips the batched preference
    // read entirely for URGENT.
    it('should not read the category preference at all for URGENT', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'New Announcement',
        body: 'Body',
        priority: 'URGENT',
        category: 'announcements',
      });

      expect(
        mockPreferenceRepo.findByUserChapterCategory,
      ).not.toHaveBeenCalled();
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

      expectSilentPush();

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

    describe('pruning invalid tokens', () => {
      it('deletes a token the provider reports as invalid', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(null);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
        mockPushProvider.sendToUser.mockResolvedValue({
          invalidTokens: [basePushToken.token],
        });

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
          category: 'chat',
        });

        expect(mockPushTokenRepo.deleteByToken).toHaveBeenCalledWith(
          basePushToken.token,
        );
      });

      it('deletes nothing when the provider reports no invalid tokens', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(null);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
        mockPushProvider.sendToUser.mockResolvedValue({ invalidTokens: [] });

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
          category: 'chat',
        });

        expect(mockPushTokenRepo.deleteByToken).not.toHaveBeenCalled();
      });

      it('does not let a pruning failure read as a push delivery failure', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(null);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
        mockPushProvider.sendToUser.mockResolvedValue({
          invalidTokens: [basePushToken.token],
        });
        mockPushTokenRepo.deleteByToken.mockRejectedValue(
          new Error('db unavailable'),
        );
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        await expect(
          service.notifyUser('u-1', 'ch-1', {
            title: 'Test',
            body: 'Body',
            category: 'chat',
          }),
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to prune invalid push token',
          expect.any(Error),
        );
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Push delivery failed'),
          expect.anything(),
        );
        warnSpy.mockRestore();
      });
    });

    // #687: `quiet_hours_tz` predates server-side validation, so stored rows can
    // still hold a zone `Intl.DateTimeFormat` throws on. That throw happened
    // before `notificationRepo.create`, so the member silently lost the push AND
    // the in-app row. The chapter-wide path used to hide that throw behind
    // `Promise.allSettled`; it now evaluates the same helper in memory.
    describe('invalid quiet_hours_tz', () => {
      const invalidSettings: UserSettings = {
        ...baseSettings,
        quiet_hours_tz: 'Mars/Olympus',
      };

      it('still creates the notification row and attempts push', async () => {
        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue(invalidSettings);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await expect(
          service.notifyUser('u-1', 'ch-1', { title: 'Test', body: 'Body' }),
        ).resolves.toBeUndefined();

        expect(mockNotificationRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ user_id: 'u-1', title: 'Test' }),
        );
        expect(mockPushProvider.sendToUser).toHaveBeenCalled();
      });

      it('logs a warning naming the user and the offending zone', async () => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue(invalidSettings);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
        });

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Mars/Olympus'),
        );
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('u-1'));

        warn.mockRestore();
      });

      // Discriminates the two possible fallbacks: UTC keeps enforcing the
      // window, skipping quiet hours entirely would leave this NORMAL.
      it('falls back to UTC rather than skipping quiet hours', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-06-15T15:00:00Z'));

        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...invalidSettings,
          quiet_hours_start: '14:00:00',
          quiet_hours_end: '16:00:00',
        });
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
          priority: 'NORMAL',
        });

        expectSilentPush();

        jest.useRealTimers();
      });

      // Pins `||` over `??` at the tz resolution. A blank stored zone means
      // "unset", not "invalid" — rows predating validation hold `''`, and `??`
      // would push that into the formatter to throw and warn on every delivery.
      it('treats a blank stored zone as unset rather than invalid', async () => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          quiet_hours_tz: '',
        });
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
        });

        expect(warn).not.toHaveBeenCalled();
        expect(mockPushProvider.sendToUser).toHaveBeenCalled();

        warn.mockRestore();
      });

      // The dedupe is specified in spec/behavior/notifications.md ("warns once
      // per member and zone per process"). Without it a chapter-wide send emits
      // one line per affected member per delivery, which is how a real signal
      // turns into the noise that hides the next problem.
      it('warns once per member and zone, not once per delivery', async () => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue(invalidSettings);
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await service.notifyUser('u-1', 'ch-1', { title: 'A', body: 'B' });
        await service.notifyUser('u-1', 'ch-1', { title: 'C', body: 'D' });
        await service.notifyUser('u-1', 'ch-1', { title: 'E', body: 'F' });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(mockNotificationRepo.create).toHaveBeenCalledTimes(3);

        warn.mockRestore();
      });

      // The zone is legacy free text, so it can carry newlines that would forge
      // a second log line out of a quoted field.
      it('escapes control characters in the logged zone', async () => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          quiet_hours_tz: 'Bad\nERROR [Auth] forged line',
        });
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
        });

        const logged = warn.mock.calls[0]?.[0] as string;
        expect(logged).not.toContain('\n');
        expect(logged).toContain('\\n');

        warn.mockRestore();
      });

      it('does not drop the member from a chapter-wide notify', async () => {
        stubChapterNotify({
          prefs: [basePreference],
          settings: [invalidSettings],
        });

        await service.notifyChapter('ch-1', { title: 'Test', body: 'Body' });

        expect(mockNotificationRepo.createMany).toHaveBeenCalledTimes(1);
        expect(mockNotificationRepo.create).not.toHaveBeenCalled();
      });
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
    const roster = (n: number) => Array.from({ length: n }, (_, i) => `u-${i}`);

    it('should notify all chapter members', async () => {
      stubChapterNotify({ userIds: ['u-1', 'u-2'] });

      await service.notifyChapter('ch-1', {
        title: 'Chapter Announcement',
        body: 'Hello everyone',
      });

      expect(mockMemberRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(mockNotificationRepo.createMany).toHaveBeenCalledTimes(1);
      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-1' }),
        expect.objectContaining({ user_id: 'u-2' }),
      ]);
      expect(mockNotificationRepo.create).not.toHaveBeenCalled();
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(2);
    });

    it('skips members who disabled the category and still delivers the rest', async () => {
      stubChapterNotify({
        userIds: ['u-1', 'u-2'],
        prefs: [{ ...basePreference, user_id: 'u-1', is_enabled: false }],
        created: notificationsFor(['u-2']),
        tokens: tokensFor(['u-2']),
      });

      await service.notifyChapter('ch-1', {
        title: 'Chapter Announcement',
        body: 'Hello everyone',
        category: 'chat',
      });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-2' }),
      ]);
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('does not read category preferences for an URGENT chapter broadcast', async () => {
      stubChapterNotify();

      await service.notifyChapter('ch-1', {
        title: 'Emergency',
        body: 'Evacuate',
        priority: 'URGENT',
        category: 'announcements',
      });

      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).not.toHaveBeenCalled();
      expect(mockSettingsRepo.findByUserIds).not.toHaveBeenCalled();
      expect(mockNotificationRepo.createMany).toHaveBeenCalled();
    });

    it('deduplicates roster rows that share a user_id', async () => {
      stubChapterNotify({
        members: [chapterMember('u-1'), chapterMember('u-1', { id: 'm-dup' })],
      });

      await service.notifyChapter('ch-1', { title: 'Test', body: 'Body' });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-1' }),
      ]);
    });

    it('downgrades NORMAL to SILENT during quiet hours on the batched path', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T15:00:00Z'));

      stubChapterNotify({
        settings: [
          {
            ...baseSettings,
            quiet_hours_start: '00:00:00',
            quiet_hours_end: '23:59:00',
          },
        ],
      });

      await service.notifyChapter('ch-1', {
        title: 'Test',
        body: 'Body',
        priority: 'NORMAL',
      });

      expectSilentPush();

      jest.useRealTimers();
    });

    it('logs aggregate insert failures and still delivers the surviving chunk', async () => {
      const warn = spyWarn();
      const users = roster(150);
      stubChapterNotify({
        userIds: users,
        createManyImpl: echoCreateMany,
        tokens: tokensFor(users.slice(100)),
      });
      mockNotificationRepo.createMany.mockRejectedValueOnce(
        new Error('insert failed'),
      );

      await service.notifyChapter('ch-1', { title: 'Test', body: 'Body' });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledTimes(2);
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(50);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('insert failed for 100 of 150'),
      );

      warn.mockRestore();
    });

    it('skips a failed preference chunk and still delivers the rest', async () => {
      const warn = spyWarn();
      const users = roster(150);
      stubChapterNotify({
        userIds: users,
        createManyImpl: echoCreateMany,
        tokens: tokensFor(users.slice(100)),
      });
      mockPreferenceRepo.findByUsersChapterCategory
        .mockRejectedValueOnce(new Error('prefs failed'))
        .mockResolvedValue([]);

      await service.notifyChapter('ch-1', {
        title: 'Test',
        body: 'Body',
        category: 'chat',
      });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith(
        users
          .slice(100)
          .map((userId) => expect.objectContaining({ user_id: userId })),
      );
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(50);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('preference lookup failed for 100 of 150'),
      );

      warn.mockRestore();
    });

    it('keeps query count bounded for a 200-member chapter', async () => {
      const users = roster(200);
      stubChapterNotify({
        userIds: users,
        createManyImpl: echoCreateMany,
        tokens: tokensFor(users),
      });

      await service.notifyChapter('ch-1', {
        title: 'Chapter Announcement',
        body: 'Hello everyone',
        category: 'chat',
      });

      expect(mockMemberRepo.findByChapter).toHaveBeenCalledTimes(1);
      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).toHaveBeenCalledWith(users.slice(0, 100), 'ch-1', 'chat');
      expect(mockSettingsRepo.findByUserIds).toHaveBeenCalledTimes(2);
      expect(mockNotificationRepo.createMany).toHaveBeenCalledTimes(2);
      expect(mockPushTokenRepo.findByUserIds).toHaveBeenCalledTimes(2);
      expect(mockNotificationRepo.create).not.toHaveBeenCalled();
      expect(
        mockPreferenceRepo.findByUserChapterCategory,
      ).not.toHaveBeenCalled();
      expect(mockSettingsRepo.findByUser).not.toHaveBeenCalled();
      expect(mockPushTokenRepo.findByUser).not.toHaveBeenCalled();
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

      const result = await service.markNotificationRead('n-1', 'u-1', 'ch-1');

      expect(mockNotificationRepo.findById).toHaveBeenCalledWith('n-1', 'ch-1');
      expect(mockNotificationRepo.markRead).toHaveBeenCalledWith(
        'n-1',
        'u-1',
        'ch-1',
      );
      expect(result.read_at).toBe('2026-02-27T01:00:00.000Z');
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockNotificationRepo.findById.mockResolvedValue(null);

      await expect(
        service.markNotificationRead('n-999', 'u-1', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockNotificationRepo.markRead).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when notification belongs to another user', async () => {
      mockNotificationRepo.findById.mockResolvedValue({
        ...baseNotification,
        user_id: 'u-2',
      });

      await expect(
        service.markNotificationRead('n-1', 'u-1', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockNotificationRepo.markRead).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the row is in another chapter', async () => {
      mockNotificationRepo.findById.mockResolvedValue(null);

      await expect(
        service.markNotificationRead('n-1', 'u-1', 'ch-other'),
      ).rejects.toThrow(NotFoundException);
      expect(mockNotificationRepo.findById).toHaveBeenCalledWith(
        'n-1',
        'ch-other',
      );
      expect(mockNotificationRepo.markRead).not.toHaveBeenCalled();
    });
  });

  describe('notification preferences', () => {
    const baseMember = {
      id: 'm-1',
      user_id: 'u-1',
      chapter_id: 'ch-1',
      role_ids: [],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '',
      updated_at: '',
    };

    it('should get preferences for user and chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockPreferenceRepo.findByUserAndChapter.mockResolvedValue([
        basePreference,
      ]);

      const result = await service.getPreferences('u-1', 'ch-1');

      expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
      );
      expect(mockPreferenceRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
      );
      expect(result).toEqual([basePreference]);
    });

    it('should update preference', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
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

      expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
      );
      expect(mockPreferenceRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        chapter_id: 'ch-1',
        category: 'chat',
        is_enabled: false,
      });
      expect(result.is_enabled).toBe(false);
    });

    it('should reject reading preferences for a chapter the user is not in', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(service.getPreferences('u-1', 'ch-other')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPreferenceRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('should reject updating preferences for a chapter the user is not in', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.updatePreference('u-1', 'ch-other', 'chat', false),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPreferenceRepo.upsert).not.toHaveBeenCalled();
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

    it('should preserve existing quiet-hour fields when omitted from update', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue(baseSettings);

      await service.updateSettings('u-1', { theme: 'dark' });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_tz: 'America/New_York',
        theme: 'dark',
      });
    });

    // The test above passes a plain object literal, which is NOT what the
    // controller hands this method: class-transformer materializes every
    // declared DTO property as an own key (undefined when the caller omitted
    // it). Under a `field in data` check that reads as an explicit clear, so a
    // theme-only PATCH wiped the member's whole quiet-hours window while the
    // literal-based test stayed green. Reproduce the real shape.
    it('preserves the window when a DTO instance omits the quiet-hour fields', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue(baseSettings);

      const dtoShaped = Object.assign(Object.create(null), {
        quiet_hours_start: undefined,
        quiet_hours_end: undefined,
        quiet_hours_tz: undefined,
        theme: 'dark' as const,
      });

      await service.updateSettings('u-1', dtoShaped);

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_tz: 'America/New_York',
        theme: 'dark',
      });
    });

    it('should clear quiet-hour fields when null is passed explicitly', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue({
        ...baseSettings,
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });

      const result = await service.updateSettings('u-1', {
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
        theme: 'system',
      });
      expect(result.quiet_hours_start).toBeNull();
      expect(result.quiet_hours_end).toBeNull();
      expect(result.quiet_hours_tz).toBeNull();
    });

    it('should clear only the fields explicitly set to null', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue(baseSettings);

      await service.updateSettings('u-1', { quiet_hours_tz: null });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_tz: null,
        theme: 'system',
      });
    });
  });

  describe('listNotifications', () => {
    it('should clamp an omitted limit to the default page rather than an unbounded read', async () => {
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      const result = await service.listNotifications('u-1', 'ch-1');

      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        {
          limit: LIST_QUERY_LIMIT_DEFAULT,
        },
      );
      expect(result).toEqual([baseNotification]);
    });

    it('should list notifications for user in the given chapter', async () => {
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      const result = await service.listNotifications('u-1', 'ch-1', {
        limit: 20,
      });

      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        {
          limit: 20,
        },
      );
      expect(result).toEqual([baseNotification]);
    });

    it('should clamp a zero or oversized limit before the repository', async () => {
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      await service.listNotifications('u-1', 'ch-1', { limit: 0 });
      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        {
          limit: LIST_QUERY_LIMIT_MIN,
        },
      );

      await service.listNotifications('u-1', 'ch-1', { limit: 999 });
      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        {
          limit: LIST_QUERY_LIMIT_MAX,
        },
      );
    });
  });
});
