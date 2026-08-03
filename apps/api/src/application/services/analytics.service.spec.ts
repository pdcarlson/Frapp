import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import {
  ContentFreePropertyError,
  hashUserIdForAnalytics,
} from '@repo/validation';
import { AnalyticsService } from './analytics.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  ANALYTICS_PROVIDER,
  type IAnalyticsProvider,
} from '../../domain/adapters/analytics.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '../../domain/repositories/member.repository.interface';
import type { Member } from '../../domain/entities/member.entity';

const SALT = 'test-env-salt';
const USER_ID = 'user-123';

/** Builds a Supabase mock whose chapters lookup returns the given opt-out. */
function makeSupabaseMock(result: {
  data?: Record<string, unknown> | null;
  error?: unknown;
}) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as unknown, from, select, eq, maybeSingle };
}

/** A fully-stubbed member repository; tests wire only the methods they use. */
function makeMemberRepo(): jest.Mocked<IMemberRepository> {
  return {
    findById: jest.fn(),
    findByUser: jest.fn(),
    findByUserAndChapter: jest.fn(),
    findByChapter: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function makeMember(chapterId: string): Member {
  return {
    id: `m-${chapterId}`,
    user_id: USER_ID,
    chapter_id: chapterId,
    role_ids: [],
    has_completed_onboarding: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

async function buildService(opts: {
  salt?: string;
  supabase: unknown;
  provider: IAnalyticsProvider;
  members?: IMemberRepository;
}) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'ANALYTICS_HMAC_SALT' ? opts.salt : undefined,
    ),
  };
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      AnalyticsService,
      { provide: ConfigService, useValue: config },
      { provide: SUPABASE_CLIENT, useValue: opts.supabase },
      { provide: ANALYTICS_PROVIDER, useValue: opts.provider },
      {
        provide: MEMBER_REPOSITORY,
        useValue: opts.members ?? makeMemberRepo(),
      },
    ],
  }).compile();
  return moduleRef.get(AnalyticsService);
}

describe('AnalyticsService', () => {
  let provider: jest.Mocked<IAnalyticsProvider>;

  beforeEach(() => {
    provider = { capture: jest.fn(), forget: jest.fn() };
  });

  describe('getDistinctId', () => {
    it('returns the HMAC of the user id, never the raw id', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      const distinctId = service.getDistinctId(USER_ID);

      expect(distinctId).toBe(hashUserIdForAnalytics(SALT, USER_ID));
      expect(distinctId).not.toContain(USER_ID);
    });

    it('returns null when no salt is configured', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: '',
        supabase: client,
        provider,
      });

      expect(service.getDistinctId(USER_ID)).toBeNull();
    });
  });

  describe('track', () => {
    it('captures a pseudonymous event when not opted out', async () => {
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: false },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await service.track('opened-channel', USER_ID, {
        chapterId: 'chapter-1',
        properties: { channel_kind: 'general' },
      });

      expect(provider.capture).toHaveBeenCalledTimes(1);
      expect(provider.capture).toHaveBeenCalledWith({
        name: 'opened-channel',
        distinctId: hashUserIdForAnalytics(SALT, USER_ID),
        properties: { channel_kind: 'general' },
      });
    });

    it('suppresses events for an opted-out chapter (defense in depth)', async () => {
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: true },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await service.track('opened-channel', USER_ID, {
        chapterId: 'chapter-1',
      });

      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('does nothing when analytics is unconfigured (no salt)', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: '',
        supabase: client,
        provider,
      });

      await service.track('opened-channel', USER_ID);

      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('throws on a content/PII payload instead of leaking it', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await expect(
        service.track('sent-message', USER_ID, {
          properties: { body: 'private message text' },
        }),
      ).rejects.toThrow(/forbidden/i);
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('swallows a provider failure so product requests are unaffected', async () => {
      provider.capture.mockRejectedValueOnce(new Error('provider down'));
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await expect(
        service.track('opened-channel', USER_ID),
      ).resolves.toBeUndefined();
    });

    it('reads the opt-out fresh per event so a toggle takes effect immediately', async () => {
      // First read: enabled → event sent. Second read: opted out → suppressed.
      const maybeSingle = jest
        .fn()
        .mockResolvedValueOnce({
          data: { analytics_opt_out: false },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { analytics_opt_out: true },
          error: null,
        });
      const eq = jest.fn().mockReturnValue({ maybeSingle });
      const select = jest.fn().mockReturnValue({ eq });
      const client = { from: jest.fn().mockReturnValue({ select }) } as unknown;
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await service.track('a', USER_ID, { chapterId: 'chapter-1' });
      await service.track('b', USER_ID, { chapterId: 'chapter-1' });

      // No caching: both events trigger a fresh lookup, and the flip is honored.
      expect(maybeSingle).toHaveBeenCalledTimes(2);
      expect(provider.capture).toHaveBeenCalledTimes(1);
    });

    it('fails closed (suppresses) when the opt-out lookup errors', async () => {
      const { client } = makeSupabaseMock({
        data: null,
        error: { message: 'db down' },
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await service.track('opened-channel', USER_ID, {
        chapterId: 'chapter-1',
      });

      // Privacy-safe default: don't emit when opt-out state is unknown.
      expect(provider.capture).not.toHaveBeenCalled();
    });
  });

  describe('trackFromClient (HTTP boundary: membership + opt-out)', () => {
    it('rejects an event for a chapter the caller does not belong to (403)', async () => {
      const members = makeMemberRepo();
      members.findByUserAndChapter.mockResolvedValue(null);
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: false },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('opened-channel', USER_ID, {
          chapterId: 'chapter-b',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(members.findByUserAndChapter).toHaveBeenCalledWith(
        USER_ID,
        'chapter-b',
      );
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('captures when the caller is a member of an opted-in chapter', async () => {
      const members = makeMemberRepo();
      members.findByUserAndChapter.mockResolvedValue(makeMember('chapter-1'));
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: false },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await service.trackFromClient('opened-channel', USER_ID, {
        chapterId: 'chapter-1',
        properties: { channel_kind: 'general' },
      });

      expect(provider.capture).toHaveBeenCalledTimes(1);
      expect(provider.capture).toHaveBeenCalledWith({
        name: 'opened-channel',
        distinctId: hashUserIdForAnalytics(SALT, USER_ID),
        properties: { channel_kind: 'general' },
      });
      // The chapter_id path resolves a single membership; it must not run the
      // omit-path fan-out over all the caller's chapters.
      expect(members.findByUser).not.toHaveBeenCalled();
    });

    it('suppresses for a member of an opted-out chapter (with chapter_id)', async () => {
      const members = makeMemberRepo();
      members.findByUserAndChapter.mockResolvedValue(makeMember('chapter-1'));
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: true },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('opened-channel', USER_ID, {
          chapterId: 'chapter-1',
        }),
      ).resolves.toBeUndefined();
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('suppresses when chapter_id is omitted and every membership has opted out', async () => {
      const members = makeMemberRepo();
      members.findByUser.mockResolvedValue([
        makeMember('c1'),
        makeMember('c2'),
      ]);
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: true },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await service.trackFromClient('opened-channel', USER_ID, {});

      expect(members.findByUser).toHaveBeenCalledWith(USER_ID);
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('captures when chapter_id is omitted but at least one membership is opted in', async () => {
      const members = makeMemberRepo();
      members.findByUser.mockResolvedValue([
        makeMember('c1'),
        makeMember('c2'),
      ]);
      // One chapter opted out, one opted in → not every chapter is disabled.
      const maybeSingle = jest
        .fn()
        .mockResolvedValueOnce({
          data: { analytics_opt_out: true },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { analytics_opt_out: false },
          error: null,
        });
      const eq = jest.fn().mockReturnValue({ maybeSingle });
      const select = jest.fn().mockReturnValue({ eq });
      const from = jest.fn().mockReturnValue({ select });
      const client = { from } as unknown;
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await service.trackFromClient('opened-channel', USER_ID, {});

      expect(provider.capture).toHaveBeenCalledTimes(1);
      // Pin the query target so a future shape change in isChapterAnalyticsEnabled
      // (e.g. a renamed table) breaks this test instead of silently drifting.
      expect(from).toHaveBeenCalledWith('chapters');
    });

    it('captures a chapter-less event when the caller has no memberships', async () => {
      const members = makeMemberRepo();
      members.findByUser.mockResolvedValue([]);
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await service.trackFromClient('opened-app', USER_ID, {});

      expect(provider.capture).toHaveBeenCalledTimes(1);
    });

    it('suppresses (fails closed) when membership resolution errors on the omit path', async () => {
      const members = makeMemberRepo();
      members.findByUser.mockRejectedValue(new Error('db down'));
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('opened-channel', USER_ID, {}),
      ).resolves.toBeUndefined();
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('suppresses (fails closed) when the membership check errors on the chapter_id path', async () => {
      // Same fail-closed posture as the omit path: an infra blip can't verify
      // membership, so suppress rather than 500 the telemetry call (a clean
      // non-member still 403s — see the rejection test above).
      const members = makeMemberRepo();
      members.findByUserAndChapter.mockRejectedValue(new Error('db down'));
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('opened-channel', USER_ID, {
          chapterId: 'chapter-1',
        }),
      ).resolves.toBeUndefined();
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('is a no-op when analytics is unconfigured (no salt), without touching the DB', async () => {
      const members = makeMemberRepo();
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: '',
        supabase: client,
        provider,
        members,
      });

      await service.trackFromClient('opened-channel', USER_ID, {
        chapterId: 'chapter-1',
      });

      expect(members.findByUserAndChapter).not.toHaveBeenCalled();
      expect(members.findByUser).not.toHaveBeenCalled();
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('rejects a content/PII payload up front, even on a path that would suppress', async () => {
      const members = makeMemberRepo();
      members.findByUser.mockResolvedValue([makeMember('c1')]);
      const { client } = makeSupabaseMock({
        data: { analytics_opt_out: true },
        error: null,
      });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('sent-message', USER_ID, {
          properties: { body: 'private message text' },
        }),
      ).rejects.toThrow(ContentFreePropertyError);
      // Validation precedes the membership/opt-out resolution.
      expect(members.findByUser).not.toHaveBeenCalled();
      expect(provider.capture).not.toHaveBeenCalled();
    });

    it('validates the payload before the membership check (content/PII → 400, not 403)', async () => {
      const members = makeMemberRepo();
      // Would be a non-member 403 if reached — but validation throws first.
      members.findByUserAndChapter.mockResolvedValue(null);
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
        members,
      });

      await expect(
        service.trackFromClient('sent-message', USER_ID, {
          chapterId: 'foreign-chapter',
          properties: { body: 'secret' },
        }),
      ).rejects.toThrow(ContentFreePropertyError);
      expect(members.findByUserAndChapter).not.toHaveBeenCalled();
      expect(provider.capture).not.toHaveBeenCalled();
    });
  });

  describe('forgetUser', () => {
    it('forwards the pseudonymous id and reports the provider acknowledgement', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });
      provider.forget.mockResolvedValue(true);

      await expect(service.forgetUser(USER_ID)).resolves.toBe(true);

      expect(provider.forget).toHaveBeenCalledWith(
        hashUserIdForAnalytics(SALT, USER_ID),
      );
    });

    it('reports false when the provider does not acknowledge the forget', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });
      provider.forget.mockResolvedValue(false);

      await expect(service.forgetUser(USER_ID)).resolves.toBe(false);
    });

    it('reports false when the provider rejects, without throwing', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });
      provider.forget.mockRejectedValue(new Error('posthog down'));

      await expect(service.forgetUser(USER_ID)).resolves.toBe(false);
    });

    it('is a successful no-op when analytics is unconfigured (nothing was ever emitted)', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: '',
        supabase: client,
        provider,
      });

      await expect(service.forgetUser(USER_ID)).resolves.toBe(true);

      expect(provider.forget).not.toHaveBeenCalled();
    });
  });
});
