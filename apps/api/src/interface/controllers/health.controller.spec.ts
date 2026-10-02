import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { HealthController, LIVENESS_PROBE_TTL_MS } from './health.controller';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { StripePriceConsistencyService } from '../../infrastructure/billing/stripe-price-consistency.service';
import { StripePriceAccountMismatchError } from '../../infrastructure/billing/stripe-price-consistency';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('HealthController', () => {
  let controller: HealthController;
  let dbError: { message: string } | null;
  let storageError: { message: string } | null;

  const supabase = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve({ error: dbError })),
      })),
    })),
    storage: {
      listBuckets: jest.fn(() => Promise.resolve({ error: storageError })),
    },
  };

  const stripePriceConsistency = {
    assertConfiguredPrice: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    dbError = null;
    storageError = null;
    supabase.from.mockClear();
    supabase.storage.listBuckets.mockClear();
    stripePriceConsistency.assertConfiguredPrice.mockReset();
    stripePriceConsistency.assertConfiguredPrice.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: SUPABASE_CLIENT, useValue: supabase },
        {
          provide: StripePriceConsistencyService,
          useValue: stripePriceConsistency,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check (/health, liveness)', () => {
    it('reports ok when the database and storage are reachable', async () => {
      const result = await controller.check();

      expect(result).toMatchObject({
        status: 'ok',
        database: 'connected',
        storage: 'connected',
      });
      expect(result).not.toHaveProperty('commit');
      expect(
        stripePriceConsistency.assertConfiguredPrice,
      ).not.toHaveBeenCalled();
    });

    it('includes commit when Render injected a git SHA', async () => {
      const previous = process.env.RENDER_GIT_COMMIT;
      process.env.RENDER_GIT_COMMIT =
        '0ca478e9105105ff7013834615eee81499813d0e';
      try {
        const result = await controller.check();
        expect(result.commit).toBe('0ca478e9105105ff7013834615eee81499813d0e');
      } finally {
        if (previous === undefined) {
          delete process.env.RENDER_GIT_COMMIT;
        } else {
          process.env.RENDER_GIT_COMMIT = previous;
        }
      }
    });

    it('omits commit when RENDER_GIT_COMMIT is not a git SHA', async () => {
      const previous = process.env.RENDER_GIT_COMMIT;
      process.env.RENDER_GIT_COMMIT = 'not-a-sha';
      try {
        const result = await controller.check();
        expect(result).not.toHaveProperty('commit');
      } finally {
        if (previous === undefined) {
          delete process.env.RENDER_GIT_COMMIT;
        } else {
          process.env.RENDER_GIT_COMMIT = previous;
        }
      }
    });

    it('reports degraded, but still resolves (never throws), when the database is unreachable', async () => {
      dbError = { message: 'connection refused' };

      const result = await controller.check();

      expect(result).toMatchObject({
        status: 'degraded',
        database: 'error',
        storage: 'connected',
      });
    });

    it('reports degraded when storage is unreachable', async () => {
      storageError = { message: 'bucket list failed' };

      const result = await controller.check();

      expect(result).toMatchObject({
        status: 'degraded',
        database: 'connected',
        storage: 'error',
      });
    });

    it('resolves within the probe timeout, as degraded, when a dependency hangs rather than rejects', async () => {
      jest.useFakeTimers();
      // A reachable-but-slow dependency: the promise never settles on its own.
      supabase.storage.listBuckets.mockReturnValueOnce(new Promise(() => {}));

      const resultPromise = controller.check();
      await jest.advanceTimersByTimeAsync(3000);
      const result = await resultPromise;

      expect(result).toMatchObject({
        status: 'degraded',
        database: 'connected',
        storage: 'error',
      });
      jest.useRealTimers();
    });

    describe('probe cache', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('reuses one probe for every call inside the TTL, with a fresh uptime', async () => {
        const first = await controller.check();
        jest.advanceTimersByTime(LIVENESS_PROBE_TTL_MS - 1000);
        dbError = { message: 'connection refused' };
        const second = await controller.check();

        expect(supabase.from).toHaveBeenCalledTimes(1);
        expect(supabase.storage.listBuckets).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ status: 'ok', database: 'connected' });
        expect(second.uptime).toBeGreaterThan(first.uptime);
      });

      it('probes again once the TTL has passed', async () => {
        await controller.check();
        jest.advanceTimersByTime(LIVENESS_PROBE_TTL_MS);
        dbError = { message: 'connection refused' };
        const result = await controller.check();

        expect(supabase.from).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status: 'degraded', database: 'error' });
      });

      it('shares an in-flight probe between concurrent callers', async () => {
        const results = await Promise.all([
          controller.check(),
          controller.check(),
          controller.check(),
        ]);

        expect(supabase.from).toHaveBeenCalledTimes(1);
        expect(supabase.storage.listBuckets).toHaveBeenCalledTimes(1);
        for (const result of results) {
          expect(result).toMatchObject({ status: 'ok' });
        }
      });

      it('keeps a timed-out probe as an error for the TTL rather than retrying per call', async () => {
        supabase.storage.listBuckets.mockReturnValueOnce(new Promise(() => {}));

        const pending = controller.check();
        await jest.advanceTimersByTimeAsync(3000);
        await pending;
        const again = await controller.check();

        expect(supabase.storage.listBuckets).toHaveBeenCalledTimes(1);
        expect(again).toMatchObject({ status: 'degraded', storage: 'error' });
      });
    });
  });

  describe('ready (/health/ready, readiness)', () => {
    it('returns ok when every dependency is reachable', async () => {
      const result = await controller.ready();

      expect(result).toMatchObject({
        status: 'ok',
        database: 'connected',
        storage: 'connected',
      });
      expect(result).not.toHaveProperty('commit');
      expect(stripePriceConsistency.assertConfiguredPrice).toHaveBeenCalled();
    });

    // The staging deploy gate (scripts/ci/verify-served-commit.mjs) passes only
    // on a /health/ready 2xx whose `commit` is the deployed SHA (#2505).
    // Trimming this payload would fail every staging deploy.
    it('includes commit when Render injected a git SHA', async () => {
      const previous = process.env.RENDER_GIT_COMMIT;
      process.env.RENDER_GIT_COMMIT =
        '0ca478e9105105ff7013834615eee81499813d0e';
      try {
        const result = await controller.ready();
        expect(result.commit).toBe('0ca478e9105105ff7013834615eee81499813d0e');
      } finally {
        if (previous === undefined) {
          delete process.env.RENDER_GIT_COMMIT;
        } else {
          process.env.RENDER_GIT_COMMIT = previous;
        }
      }
    });

    it('throws ServiceUnavailableException when the configured Stripe Price is missing', async () => {
      const mismatch = new StripePriceAccountMismatchError(
        'price_missing',
        'resource_missing: No such price',
      );
      stripePriceConsistency.assertConfiguredPrice.mockRejectedValue(mismatch);

      try {
        await controller.ready();
        throw new Error('expected ready() to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        // Sentry reads the mismatch off `cause` (#2131).
        expect((err as Error).cause).toBe(mismatch);
        const response = (err as ServiceUnavailableException).getResponse();
        expect(response).toMatchObject({
          code: 'DEGRADED',
        });
        expect(response).toMatchObject({
          message:
            'database: connected, storage: connected, billing: misconfigured',
        });
      }
    });

    // The route is public: Stripe's own text (a revoked key's type and last
    // four characters) and the configured Price id stay in the log and the
    // Sentry cause, never in the body (#2999).
    it('keeps Stripe error text and the Price id out of the public body', async () => {
      const mismatch = new StripePriceAccountMismatchError(
        'price_1SecretConfiguredId',
        'api_key_expired: Invalid API Key provided: sk_live_****abcd',
        {
          cause: Object.assign(
            new Error('Invalid API Key provided: sk_live_****abcd'),
            { code: 'api_key_expired', rawType: 'authentication_error' },
          ),
        },
      );
      stripePriceConsistency.assertConfiguredPrice.mockRejectedValue(mismatch);

      const err = await controller.ready().then(
        () => {
          throw new Error('expected ready() to throw');
        },
        (thrown: unknown) => thrown,
      );
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const body = JSON.stringify(
        (err as ServiceUnavailableException).getResponse(),
      );
      expect(body).not.toContain('price_1SecretConfiguredId');
      expect(body).not.toContain('sk_live');
      expect(body).not.toContain('abcd');
      expect(body).not.toContain('STRIPE_');
      // The Stripe code is a fixed enum: it says "rotate the key", not which.
      expect(body).toContain('billing: api_key_expired');
      expect((err as Error).cause).toBe(mismatch);
      expect(mismatch.message).toContain('sk_live_****abcd');
    });

    it("names the mismatch's own code when it has one", async () => {
      stripePriceConsistency.assertConfiguredPrice.mockRejectedValue(
        new StripePriceAccountMismatchError(
          'price_inactive_one',
          'configured Price is inactive',
          { code: 'price_inactive' },
        ),
      );

      await expect(controller.ready()).rejects.toMatchObject({
        response: {
          code: 'DEGRADED',
          message:
            'database: connected, storage: connected, billing: price_inactive',
        },
      });
    });

    it('throws ServiceUnavailableException when the database is unreachable', async () => {
      dbError = { message: 'connection refused' };

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    // The deploy gate reads this path, so a healthy /health result cached a
    // moment ago must not hide an outage that started since.
    it('probes on every call, ignoring a fresh /health result', async () => {
      await controller.check();
      dbError = { message: 'connection refused' };

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(supabase.from).toHaveBeenCalledTimes(2);
    });

    it('throws ServiceUnavailableException when storage is unreachable', async () => {
      storageError = { message: 'bucket list failed' };

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('carries a string `message` naming the degraded dependency, matching the exception-response shape the global filter reads', async () => {
      dbError = { message: 'connection refused' };

      try {
        await controller.ready();
        throw new Error('expected ready() to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const response = (err as ServiceUnavailableException).getResponse();
        // AllExceptionsFilter's extractMessage() only reads a `message` key
        // (string or string[]) off the exception response — see the
        // "goes through the real global filter" test below for the proof.
        expect(response).toMatchObject({
          code: 'DEGRADED',
          message: 'database: error, storage: connected',
        });
      }
    });

    // health.controller.ts's own comment records why this matters: throwing
    // ServiceUnavailableException({status, database, storage, uptime}) (an
    // earlier version of this route) reads fine from a unit test that inspects
    // getResponse() directly, but AllExceptionsFilter drops every key except
    // `message` — so the diagnostic payload silently never reached a real
    // client. This test goes through the actual filter to prove the wire body.
    it('goes through the real AllExceptionsFilter and produces a response body carrying the degraded detail', () => {
      dbError = { message: 'connection refused' };
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const filter = new AllExceptionsFilter();
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status }),
          getRequest: () => ({
            requestId: 'req-1',
            method: 'GET',
            url: '/health/ready',
          }),
        }),
      };

      return controller.ready().catch((exception) => {
        filter.catch(exception, host as never);

        expect(status).toHaveBeenCalledWith(503);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 503,
            message: 'database: error, storage: connected',
          }),
        );

        jest.restoreAllMocks();
      });
    });
  });
});
