import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: jest.fn((callback: (scope: unknown) => void) =>
    callback({
      setLevel: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }),
  ),
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

  beforeEach(async () => {
    dbError = null;
    storageError = null;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: SUPABASE_CLIENT, useValue: supabase }],
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
  });

  describe('ready (/health/ready, readiness)', () => {
    it('returns ok when every dependency is reachable', async () => {
      const result = await controller.ready();

      expect(result).toMatchObject({
        status: 'ok',
        database: 'connected',
        storage: 'connected',
      });
    });

    it('throws ServiceUnavailableException when the database is unreachable', async () => {
      dbError = { message: 'connection refused' };

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
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
