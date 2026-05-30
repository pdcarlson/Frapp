import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { hashUserIdForAnalytics } from '@repo/validation';
import { AnalyticsService } from './analytics.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  ANALYTICS_PROVIDER,
  type IAnalyticsProvider,
} from '../../domain/adapters/analytics.interface';

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

async function buildService(opts: {
  salt?: string;
  supabase: unknown;
  provider: IAnalyticsProvider;
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

  describe('forgetUser', () => {
    it('forwards the pseudonymous id to the provider deleted-users list', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: SALT,
        supabase: client,
        provider,
      });

      await service.forgetUser(USER_ID);

      expect(provider.forget).toHaveBeenCalledWith(
        hashUserIdForAnalytics(SALT, USER_ID),
      );
    });

    it('is a no-op when analytics is unconfigured', async () => {
      const { client } = makeSupabaseMock({ data: null, error: null });
      const service = await buildService({
        salt: '',
        supabase: client,
        provider,
      });

      await service.forgetUser(USER_ID);

      expect(provider.forget).not.toHaveBeenCalled();
    });
  });
});
