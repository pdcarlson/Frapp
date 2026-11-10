import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { NotificationService } from './notification.service';
import { ChatBlockService } from './chat-block.service';
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
import { memberFixture } from '#test/helpers/entity-fixtures';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);

describe('NotificationService', () => {
  let service: NotificationService;
  let mockNotificationRepo: jest.Mocked<INotificationRepository>;
  let mockPushTokenRepo: jest.Mocked<IPushTokenRepository>;
  let mockPreferenceRepo: jest.Mocked<INotificationPreferenceRepository>;
  let mockSettingsRepo: jest.Mocked<IUserSettingsRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockPushProvider: jest.Mocked<INotificationProvider>;
  let listBlockedUserIds: jest.Mock;

  beforeEach(async () => {
    captureException.mockClear();
    mockNotificationRepo = {
      create: jest.fn(),
      createMany: jest.fn(),
      findByUser: jest.fn(),
      findById: jest.fn(),
      markRead: jest.fn(),
      markChatChannelRead: jest.fn(),
      markAllRead: jest.fn(),
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
      setTimeZone: jest.fn(),
    };
    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByUser: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
    };
    mockPushProvider = {
      sendToUser: jest.fn().mockResolvedValue({ invalidTokens: [] }),
    };
    // Default: the caller has blocked nobody.
    listBlockedUserIds = jest.fn().mockResolvedValue([]);

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
        { provide: ChatBlockService, useValue: { listBlockedUserIds } },
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
    category: 'events',
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
  ): Member =>
    memberFixture({
      id: `m-${userId}`,
      user_id: userId,
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
        category: 'events',
      });

      expect(mockNotificationRepo.create).not.toHaveBeenCalled();
      expect(mockPushProvider.sendToUser).not.toHaveBeenCalled();
    });

    // 2026-11-06: the Chat switch was dropped from both surfaces in favour of
    // per-channel and per-DM levels. A `chat` row an older build wrote must not
    // keep a member muted with no control left to undo it, so a preference is
    // only read for a category a member can still switch.
    it('delivers chat even when an old chat preference row says off', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue({
        ...basePreference,
        category: 'chat',
        is_enabled: false,
      });
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
      mockPushProvider.sendToUser.mockResolvedValue({ invalidTokens: [] });

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Alex in #general',
        body: 'Hello',
        category: 'chat',
      });

      expect(
        mockPreferenceRepo.findByUserChapterCategory,
      ).not.toHaveBeenCalled();
      expect(mockNotificationRepo.create).toHaveBeenCalled();
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(1);
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

    it('forwards threadId to the push and keeps it off the in-app row', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(null);
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);

      await service.notifyUser('u-1', 'ch-1', {
        title: 'Shawn in #academics',
        body: 'hi',
        category: 'chat',
        threadId: 'chat:channel-1',
      });

      expect(mockNotificationRepo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ threadId: expect.anything() }),
      );
      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({ threadId: 'chat:channel-1' }),
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
        category: 'events',
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

    describe('Do Not Disturb (#3845)', () => {
      const noWindow = {
        ...baseSettings,
        quiet_hours_start: null,
        quiet_hours_end: null,
      };

      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-09T18:00:00Z'));
        mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(
          basePreference,
        );
        mockNotificationRepo.create.mockResolvedValue(baseNotification);
        mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('downgrades NORMAL to SILENT while DND is on', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...noWindow,
          status: 'dnd',
          status_expires_at: null,
        });

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Alex in #general',
          body: 'Hello',
          category: 'chat',
          priority: 'NORMAL',
        });

        expectSilentPush();
      });

      it('still rings URGENT while DND is on', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...noWindow,
          status: 'dnd',
        });

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Urgent',
          body: 'Emergency',
          priority: 'URGENT',
        });

        expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
          [basePushToken.token],
          expect.objectContaining({ priority: 'URGENT' }),
        );
      });

      it('rings again once DND has ended', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...noWindow,
          status: 'dnd',
          status_expires_at: '2026-11-09T17:59:00.000Z',
        });

        await service.notifyUser('u-1', 'ch-1', {
          title: 'Test',
          body: 'Body',
          priority: 'NORMAL',
        });

        expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
          [basePushToken.token],
          expect.objectContaining({ priority: 'NORMAL' }),
        );
      });

      it.each(['idle', 'invisible'] as const)(
        'does not quiet a member who is only %s',
        async (status) => {
          mockSettingsRepo.findByUser.mockResolvedValue({
            ...noWindow,
            status,
          });

          await service.notifyUser('u-1', 'ch-1', {
            title: 'Test',
            body: 'Body',
            priority: 'NORMAL',
          });

          expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
            [basePushToken.token],
            expect.objectContaining({ priority: 'NORMAL' }),
          );
        },
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
          category: 'events',
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
          category: 'events',
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
            category: 'events',
          }),
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to prune invalid push token'),
        );
        expect(
          warnSpy.mock.calls.every((args) =>
            String(args[0]).includes('Failed to prune invalid push token')
              ? args.length === 1
              : true,
          ),
        ).toBe(true);
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Push delivery failed'),
          expect.anything(),
        );
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Push delivery failed'),
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

  // Pushes name times in the reader's own zone (notifications.md § What a
  // push says), so the per-recipient copy has to reach both the in-app row and
  // the push, with that recipient's zone.
  describe('personalized copy', () => {
    const personalize = jest.fn(
      ({ userId, timeZone }: { userId: string; timeZone: string | null }) => ({
        title: `for ${userId}`,
        body: `zone ${timeZone ?? 'none'}`,
      }),
    );

    beforeEach(() => personalize.mockClear());

    it('writes each member their own copy, in their reported zone, on the batched path', async () => {
      stubChapterNotify({
        userIds: ['u-1', 'u-2'],
        settings: [
          {
            ...baseSettings,
            user_id: 'u-1',
            quiet_hours_start: null,
            quiet_hours_end: null,
            time_zone: 'America/Chicago',
          },
          {
            ...baseSettings,
            user_id: 'u-2',
            quiet_hours_start: null,
            quiet_hours_end: null,
            quiet_hours_tz: 'Europe/London',
          },
        ],
        createManyImpl: echoCreateMany,
      });
      mockPushProvider.sendToUser.mockResolvedValue({ invalidTokens: [] });

      await service.notifyMembers('ch-1', ['u-1', 'u-2'], {
        title: 'fallback',
        body: 'fallback',
        priority: 'SILENT',
        category: 'events',
        personalize,
      });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'u-1',
          title: 'for u-1',
          body: 'zone America/Chicago',
        }),
        expect.objectContaining({
          user_id: 'u-2',
          title: 'for u-2',
          // No reported zone: quiet hours' zone is the next best.
          body: 'zone Europe/London',
        }),
      ]);
      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({
          title: 'for u-1',
          body: 'zone America/Chicago',
        }),
      );
    });

    it('reads settings for zones even for an URGENT personalized send', async () => {
      stubChapterNotify({ userIds: ['u-1'], createManyImpl: echoCreateMany });
      mockPushProvider.sendToUser.mockResolvedValue({ invalidTokens: [] });

      await service.notifyMembers('ch-1', ['u-1'], {
        title: 'fallback',
        body: 'fallback',
        priority: 'URGENT',
        personalize,
      });

      expect(mockSettingsRepo.findByUserIds).toHaveBeenCalled();
      expect(personalize).toHaveBeenCalledWith({
        userId: 'u-1',
        timeZone: null,
      });
    });

    it('notifies only the members it is given', async () => {
      stubChapterNotify({ userIds: ['u-2'], createManyImpl: echoCreateMany });

      await service.notifyMembers('ch-1', ['u-2', 'u-2'], {
        title: 'Hi',
        body: 'There',
      });

      expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-2' }),
      ]);
    });

    it('personalizes a single send too', async () => {
      mockPreferenceRepo.findByUserChapterCategory.mockResolvedValue(null);
      mockSettingsRepo.findByUser.mockResolvedValue({
        ...baseSettings,
        quiet_hours_start: null,
        quiet_hours_end: null,
        time_zone: 'Not/AZone',
      });
      mockNotificationRepo.create.mockResolvedValue(baseNotification);
      mockPushTokenRepo.findByUser.mockResolvedValue([basePushToken]);
      mockPushProvider.sendToUser.mockResolvedValue({ invalidTokens: [] });

      await service.notifyUser('u-1', 'ch-1', {
        title: 'fallback',
        body: 'fallback',
        personalize,
      });

      // An unresolvable reported zone falls back to quiet hours' zone.
      expect(mockNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'for u-1',
          body: 'zone America/New_York',
        }),
      );
      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({ body: 'zone America/New_York' }),
      );
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
        category: 'events',
      });

      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-2' }),
      ]);
      expect(mockPushProvider.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('reads no preference for a category without a member switch', async () => {
      stubChapterNotify({
        userIds: ['u-1', 'u-2'],
        prefs: [
          {
            ...basePreference,
            user_id: 'u-1',
            category: 'chat',
            is_enabled: false,
          },
        ],
      });

      await service.notifyChapter('ch-1', {
        title: 'New message',
        body: 'Hello',
        category: 'chat',
      });

      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).not.toHaveBeenCalled();
      expect(mockNotificationRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'u-1' }),
        expect.objectContaining({ user_id: 'u-2' }),
      ]);
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

    it('downgrades NORMAL to SILENT for a member with DND on, on the batched path (#3845)', async () => {
      stubChapterNotify({
        settings: [
          {
            ...baseSettings,
            quiet_hours_start: null,
            quiet_hours_end: null,
            status: 'dnd',
          },
        ],
      });

      await service.notifyChapter('ch-1', {
        title: 'Test',
        body: 'Body',
        priority: 'NORMAL',
      });

      expectSilentPush();
    });

    it('still rings URGENT for a member with DND on, on the batched path (#3845)', async () => {
      stubChapterNotify({
        settings: [
          {
            ...baseSettings,
            quiet_hours_start: null,
            quiet_hours_end: null,
            status: 'dnd',
          },
        ],
      });

      await service.notifyChapter('ch-1', {
        title: 'Urgent',
        body: 'Emergency',
        priority: 'URGENT',
      });

      expect(mockPushProvider.sendToUser).toHaveBeenCalledWith(
        [basePushToken.token],
        expect.objectContaining({ priority: 'URGENT' }),
      );
    });

    it('reports a failed insert chunk once and still delivers the surviving chunk', async () => {
      const warn = spyWarn();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
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
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Chapter notify insert failed for 100 recipients in ch-1',
        ),
        expect.any(String),
      );
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'insert failed' }),
        expect.objectContaining({
          level: 'error',
          tags: { caught_at: 'chapter-notify-insert-failed' },
          fingerprint: [
            'caught-failure',
            'chapter-notify-insert-failed',
            'Error',
          ],
        }),
      );

      warn.mockRestore();
      error.mockRestore();
    });

    it('skips a failed preference chunk and still delivers the rest', async () => {
      const warn = spyWarn();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
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
        category: 'events',
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
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'prefs failed' }),
        expect.objectContaining({
          level: 'error',
          tags: {
            lookup: 'preference lookup',
            caught_at: 'chapter-notify-chunk-lookup-failed',
          },
          fingerprint: [
            'caught-failure',
            'chapter-notify-chunk-lookup-failed',
            'Error',
          ],
        }),
      );

      warn.mockRestore();
      error.mockRestore();
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
        category: 'events',
      });

      expect(mockMemberRepo.findByChapter).toHaveBeenCalledTimes(1);
      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockPreferenceRepo.findByUsersChapterCategory,
      ).toHaveBeenCalledWith(users.slice(0, 100), 'ch-1', 'events');
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

    describe('a chat row the list withholds (#2715)', () => {
      const chatRow = (data: Record<string, unknown>): Notification => ({
        ...baseNotification,
        title: 'Blocked Member',
        body: 'something unkind',
        data,
        read_at: '2026-02-27T01:00:00.000Z',
      });
      const target = { screen: 'chat', channelId: 'c-1' };

      async function markReadAs(data: Record<string, unknown>) {
        listBlockedUserIds.mockResolvedValue(['b-1']);
        mockNotificationRepo.findById.mockResolvedValue(chatRow(data));
        mockNotificationRepo.markRead.mockResolvedValue(chatRow(data));
        const result = await service.markNotificationRead('n-1', 'u-1', 'ch-1');
        expect(mockNotificationRepo.markRead).toHaveBeenCalled();
        expect(result.read_at).toBe('2026-02-27T01:00:00.000Z');
        return result;
      }

      it('marks a blocked member chat row read without handing its text back', async () => {
        const result = await markReadAs({ target, senderId: 'b-1' });

        expect(result).toMatchObject({ id: 'n-1', title: '', body: '' });
      });

      it('marks a chat row that records no sender read without handing its text back', async () => {
        const result = await markReadAs({ target });

        expect(result).toMatchObject({ id: 'n-1', title: '', body: '' });
      });

      it('returns a chat row from anyone else, and any non-chat row, as it is', async () => {
        listBlockedUserIds.mockResolvedValue(['b-1']);
        for (const data of [
          { target, senderId: 'other' },
          { target: { screen: 'tasks', taskId: 't-1' } },
          {},
        ]) {
          mockNotificationRepo.findById.mockResolvedValue(chatRow(data));
          mockNotificationRepo.markRead.mockResolvedValue(chatRow(data));

          const result = await service.markNotificationRead(
            'n-1',
            'u-1',
            'ch-1',
          );

          expect(result.body).toBe('something unkind');
        }
      });

      it('changes nothing when the block list cannot be read', async () => {
        listBlockedUserIds.mockRejectedValue(new Error('blocks unreadable'));
        mockNotificationRepo.findById.mockResolvedValue(
          chatRow({ target, senderId: 'b-1' }),
        );

        await expect(
          service.markNotificationRead('n-1', 'u-1', 'ch-1'),
        ).rejects.toThrow('blocks unreadable');
        expect(mockNotificationRepo.markRead).not.toHaveBeenCalled();
      });
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

  describe('markChatChannelNotificationsRead (#3788)', () => {
    it('clears the channel rows the read covers, for this member in this chapter', async () => {
      mockNotificationRepo.markChatChannelRead.mockResolvedValue(undefined);

      await service.markChatChannelNotificationsRead(
        'user-1',
        'chapter-1',
        'channel-1',
        '2026-11-09T05:00:00.000Z',
      );

      expect(mockNotificationRepo.markChatChannelRead).toHaveBeenCalledWith(
        'user-1',
        'chapter-1',
        'channel-1',
        '2026-11-09T05:00:00.000Z',
      );
    });
  });

  describe('markNotificationsRead (#3929)', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-09T22:00:00.000Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks every unread row read through now and answers with the stamp', async () => {
      mockNotificationRepo.markAllRead.mockResolvedValue(20);

      const result = await service.markNotificationsRead('user-1', 'chapter-1');

      expect(mockNotificationRepo.markAllRead).toHaveBeenCalledWith(
        'user-1',
        'chapter-1',
        '2026-11-09T22:00:00.000Z',
        undefined,
      );
      expect(result).toEqual({
        read_at: '2026-11-09T22:00:00.000Z',
        updated: 20,
      });
    });

    it('narrows to the named screens, once each', async () => {
      mockNotificationRepo.markAllRead.mockResolvedValue(2);

      await service.markNotificationsRead('user-1', 'chapter-1', {
        screens: ['tasks', 'points', 'tasks'],
      });

      expect(mockNotificationRepo.markAllRead).toHaveBeenCalledWith(
        'user-1',
        'chapter-1',
        '2026-11-09T22:00:00.000Z',
        ['tasks', 'points'],
      );
    });

    it('treats an empty screen list as every row, never as none', async () => {
      mockNotificationRepo.markAllRead.mockResolvedValue(0);

      await service.markNotificationsRead('user-1', 'chapter-1', {
        screens: [],
      });

      expect(mockNotificationRepo.markAllRead).toHaveBeenCalledWith(
        'user-1',
        'chapter-1',
        '2026-11-09T22:00:00.000Z',
        undefined,
      );
    });
  });

  describe('notification preferences', () => {
    const baseMember = memberFixture({
      id: 'm-1',
      user_id: 'u-1',
      has_completed_onboarding: true,
      created_at: '',
      updated_at: '',
    });

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
    /** The status fields of a member who never picked one (#3845). */
    const NO_STATUS = {
      status: 'online',
      status_expires_at: null,
      custom_status: null,
      custom_status_expires_at: null,
    } as const;

    // `toStrictEqual`, not `toEqual`: the response is the editable
    // fields, and a row's `id`, `user_id` and `updated_at` must not leak
    // through, because a member with no row has none of them to send.
    it('should get user settings as the editable fields of the row', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

      const result = await service.getSettings('u-1');

      expect(mockSettingsRepo.findByUser).toHaveBeenCalledWith('u-1');
      expect(result).toStrictEqual({
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_tz: 'America/New_York',
        theme: 'system',
        ...NO_STATUS,
      });
    });

    // #2885. This used to return `null`, which Nest sends as an empty body.
    // The SDK read that as `data: undefined`, TanStack Query refused it, and
    // both clients showed their error state to every member who had never
    // saved settings, which is every new member.
    it('should return the defaults when the member has no settings row', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(null);

      const result = await service.getSettings('u-1');

      expect(result).toStrictEqual({
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
        theme: 'system',
        ...NO_STATUS,
      });
    });

    it('should hand each caller its own defaults object', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(null);

      const first = await service.getSettings('u-1');
      first.theme = 'dark';
      const second = await service.getSettings('u-2');

      expect(second.theme).toBe('system');
    });

    // The defaults stand for "no row", never for "the read failed": serving
    // them on an outage would tell a member who has a window that they have
    // none.
    it('should propagate a failed read rather than answer with the defaults', async () => {
      mockSettingsRepo.findByUser.mockRejectedValue(new Error('read failed'));

      await expect(service.getSettings('u-1')).rejects.toThrow('read failed');
    });

    it('should update user settings', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);
      mockSettingsRepo.upsert.mockResolvedValue({
        ...baseSettings,
        theme: 'dark',
        ...NO_STATUS,
      });

      const result = await service.updateSettings('u-1', { theme: 'dark' });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'u-1',
          theme: 'dark',
        }),
      );
      // The same fields `getSettings` answers with, so the two routes
      // share one response schema.
      expect(result).toStrictEqual({
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_tz: 'America/New_York',
        theme: 'dark',
        ...NO_STATUS,
      });
    });

    it('should create the row from the defaults on a first save', async () => {
      mockSettingsRepo.findByUser.mockResolvedValue(null);
      mockSettingsRepo.upsert.mockResolvedValue({
        ...baseSettings,
        quiet_hours_tz: null,
      });

      await service.updateSettings('u-1', {
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
      });

      // Only the named fields: a new row takes the column defaults for the rest.
      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
      });
    });

    // Omitted fields are left out of the write, so the upsert keeps what is
    // stored, including a value another device saved after this request began
    // (#3924). Writing back an earlier read would undo that change.
    it('should leave omitted quiet-hour fields out of the write', async () => {
      mockSettingsRepo.upsert.mockResolvedValue(baseSettings);

      await service.updateSettings('u-1', { theme: 'dark' });

      expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
        user_id: 'u-1',
        theme: 'dark',
      });
      expect(mockSettingsRepo.findByUser).not.toHaveBeenCalled();
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
        quiet_hours_tz: null,
      });
    });

    describe('member status (#3845)', () => {
      const NOW = new Date('2026-11-09T18:00:00Z');
      const LATER = '2026-11-09T19:00:00.000Z';
      const EARLIER = '2026-11-09T17:00:00.000Z';

      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        mockSettingsRepo.upsert.mockImplementation((row) =>
          Promise.resolve({
            ...baseSettings,
            ...row,
          }),
        );
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('reads a status and custom line that have not ended', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          status: 'dnd',
          status_expires_at: LATER,
          custom_status: 'At practice till 6',
          custom_status_expires_at: LATER,
        });

        const result = await service.getSettings('u-1');

        expect(result).toMatchObject({
          status: 'dnd',
          status_expires_at: LATER,
          custom_status: 'At practice till 6',
          custom_status_expires_at: LATER,
        });
      });

      it('reads an ended status as online and an ended line as none', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          status: 'dnd',
          status_expires_at: EARLIER,
          custom_status: 'At practice till 6',
          custom_status_expires_at: EARLIER,
        });

        const result = await service.getSettings('u-1');

        expect(result).toMatchObject(NO_STATUS);
      });

      it('replaces the end time when a new status is picked', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          status: 'dnd',
          status_expires_at: LATER,
        });

        await service.updateSettings('u-1', { status: 'invisible' });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'invisible',
            status_expires_at: null,
          }),
        );
      });

      it('saves a status with its end time', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(null);

        const result = await service.updateSettings('u-1', {
          status: 'dnd',
          status_expires_at: LATER,
        });

        expect(result).toMatchObject({
          status: 'dnd',
          status_expires_at: LATER,
        });
      });

      it('never gives online an end time', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

        await service.updateSettings('u-1', {
          status: 'online',
          status_expires_at: LATER,
        });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'online',
            status_expires_at: null,
          }),
        );
      });

      it('rejects an end time in the past', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

        await expect(
          service.updateSettings('u-1', {
            status: 'dnd',
            status_expires_at: EARLIER,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.updateSettings('u-1', {
            custom_status: 'Studying',
            custom_status_expires_at: EARLIER,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockSettingsRepo.upsert).not.toHaveBeenCalled();
      });

      it('rejects an end time sent without its status', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

        await expect(
          service.updateSettings('u-1', { status_expires_at: LATER }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.updateSettings('u-1', { custom_status_expires_at: LATER }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('clears the custom line and its end time together', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          custom_status: 'At practice till 6',
          custom_status_expires_at: LATER,
        });

        await service.updateSettings('u-1', { custom_status: null });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            custom_status: null,
            custom_status_expires_at: null,
          }),
        );
      });

      // An unrelated save must not write the status back: a value read before
      // another device switched DND on would undo it.
      it('leaves the status and line out of an unrelated save', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          status: 'idle',
          custom_status: 'Studying',
          custom_status_expires_at: LATER,
        });

        await service.updateSettings('u-1', { theme: 'dark' });

        const written = mockSettingsRepo.upsert.mock.calls[0][0];
        expect(written).not.toHaveProperty('status');
        expect(written).not.toHaveProperty('status_expires_at');
        expect(written).not.toHaveProperty('custom_status');
        expect(written).not.toHaveProperty('custom_status_expires_at');
      });

      it('clears the end time with the line even when one is sent', async () => {
        await service.updateSettings('u-1', {
          custom_status: null,
          custom_status_expires_at: LATER,
        });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            custom_status: null,
            custom_status_expires_at: null,
          }),
        );
      });

      it('treats theme: null as not supplied, since the column is NOT NULL', async () => {
        await service.updateSettings('u-1', { theme: null as never });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
          user_id: 'u-1',
        });
      });

      // A null end time on its own asks for nothing, so it must not fail the
      // save and take the member's other edits with it.
      it('ignores a null end time sent without its status', async () => {
        await service.updateSettings('u-1', {
          theme: 'dark',
          status_expires_at: null,
          custom_status_expires_at: null,
        });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith({
          user_id: 'u-1',
          theme: 'dark',
        });
      });

      it('gives a new custom line its own end time, not the old one', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue({
          ...baseSettings,
          custom_status: 'At practice',
          custom_status_expires_at: LATER,
        });

        await service.updateSettings('u-1', { custom_status: 'Studying' });

        expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            custom_status: 'Studying',
            custom_status_expires_at: null,
          }),
        );
      });

      it('rejects an end time on a day that does not exist', async () => {
        mockSettingsRepo.findByUser.mockResolvedValue(baseSettings);

        await expect(
          service.updateSettings('u-1', {
            status: 'dnd',
            status_expires_at: '2027-02-30T10:00:00Z',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
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

    it('reads the block list as the caller, in the caller chapter', async () => {
      mockNotificationRepo.findByUser.mockResolvedValue([]);

      await service.listNotifications('u-1', 'ch-1');

      expect(listBlockedUserIds).toHaveBeenCalledWith('ch-1', 'u-1');
    });

    it('withholds the chat rows of a member the caller has blocked, including ones written before the block', async () => {
      // #2715: the push worker drops a blocker from the audience of every
      // message sent after the block, but a row written before it carries the
      // blocked member's text. The list asks the query to leave those out.
      listBlockedUserIds.mockResolvedValue(['blocked-1', 'blocked-2']);
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      const result = await service.listNotifications('u-1', 'ch-1', {
        limit: 20,
      });

      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        { limit: 20, withholdChatFrom: ['blocked-1', 'blocked-2'] },
      );
      expect(result).toEqual([baseNotification]);
    });

    it('serves the history unfiltered to the blocked member and to other recipients, whose own lists are empty', async () => {
      // A block hides the blocked member from the blocker, not the other way
      // round: only the caller's own list decides what is withheld.
      mockNotificationRepo.findByUser.mockResolvedValue([baseNotification]);

      await service.listNotifications('blocked-1', 'ch-1');

      expect(listBlockedUserIds).toHaveBeenCalledWith('ch-1', 'blocked-1');
      expect(mockNotificationRepo.findByUser).toHaveBeenCalledWith(
        'blocked-1',
        'ch-1',
        { limit: LIST_QUERY_LIMIT_DEFAULT },
      );
    });

    it('fails closed when the block list cannot be read', async () => {
      // A list that can't be read is not an empty list: serving the history
      // unfiltered would hand back the text the block hides.
      listBlockedUserIds.mockRejectedValue(new Error('blocks unreadable'));

      await expect(service.listNotifications('u-1', 'ch-1')).rejects.toThrow(
        'blocks unreadable',
      );
      expect(mockNotificationRepo.findByUser).not.toHaveBeenCalled();
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
