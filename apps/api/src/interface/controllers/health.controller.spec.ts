import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

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

    it('carries the degraded payload on the thrown exception', async () => {
      dbError = { message: 'connection refused' };

      try {
        await controller.ready();
        throw new Error('expected ready() to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const response = (err as ServiceUnavailableException).getResponse();
        expect(response).toMatchObject({
          status: 'degraded',
          database: 'error',
          storage: 'connected',
        });
      }
    });
  });
});
