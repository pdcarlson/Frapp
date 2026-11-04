import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { ANALYTICS_PROVIDER } from '#domain/adapters/analytics.interface';
import {
  hashChapterIdForAnalytics,
  hashUserIdForAnalytics,
} from '#domain/utils/analytics-keying';
import { AppModule } from '../src/app.module';
import { TaskService } from '../src/application/services/task.service';
import { ChapterConfigService } from '../src/application/services/chapter-config.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';
import { createGuardStubs, AllowAllGuard } from './helpers/guard-stubs.factory';

/**
 * Feature events (#593) through the real `AppModule`: the global
 * `FeatureEventInterceptor` registration, `AnalyticsService.track` and its
 * opt-out read, down to the provider. The unit specs register their own copy
 * of the interceptor, so only this suite fails if the app stops wiring it.
 */

const SALT = 'e2e-feature-events-salt';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CHAPTER_ID = '55555555-5555-4555-8555-555555555555';

const { AuthGuardStub, ChapterGuardStub } = createGuardStubs({
  authUserId: 'auth-user-1',
  email: 'member@example.com',
  appUserId: USER_ID,
  roleIds: ['role-admin'],
  chapterId: CHAPTER_ID,
});

describe('Feature events (e2e)', () => {
  let app: INestApplication;
  let priorSalt: string | undefined;
  const capture = jest.fn<Promise<void>, unknown[]>();
  const isAnalyticsOptedOut = jest.fn<Promise<boolean>, [string]>();
  const updateStatus = jest.fn();
  const patchConfig = jest.fn();

  beforeAll(async () => {
    priorSalt = process.env.ANALYTICS_HMAC_SALT;
    process.env.ANALYTICS_HMAC_SALT = SALT;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(ANALYTICS_PROVIDER)
      .useValue({ capture, shutdown: jest.fn() })
      .overrideProvider(CHAPTER_REPOSITORY)
      .useValue({ isAnalyticsOptedOut })
      .overrideProvider(TaskService)
      .useValue({ updateStatus })
      .overrideProvider(ChapterConfigService)
      .useValue({ patchConfig })
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(AllowAllGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (priorSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = priorSalt;
  });

  beforeEach(() => {
    capture.mockReset().mockResolvedValue(undefined);
    isAnalyticsOptedOut.mockReset().mockResolvedValue(false);
    updateStatus.mockReset().mockResolvedValue({
      id: 'task-1',
      status: 'COMPLETED',
    });
  });

  /** Sends are not awaited by the request, so let them settle. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  const moveTask = () =>
    request(app.getHttpServer())
      .patch('/v1/tasks/task-1/status')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'COMPLETED' });

  it("sends a decorated route's event, pseudonymous and grouped by chapter", async () => {
    await moveTask().expect(200);
    await settle();

    expect(isAnalyticsOptedOut).toHaveBeenCalledWith(CHAPTER_ID);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'task-status-changed',
        distinctId: hashUserIdForAnalytics(SALT, USER_ID),
        groups: { chapter: hashChapterIdForAnalytics(SALT, CHAPTER_ID) },
        properties: expect.objectContaining({
          feature: 'tasks',
          status: 'COMPLETED',
          app: 'web',
        }),
      }),
    );
  });

  it('sends nothing for a chapter that has opted out', async () => {
    isAnalyticsOptedOut.mockResolvedValue(true);
    await moveTask().expect(200);
    await settle();
    expect(capture).not.toHaveBeenCalled();
  });

  it('sends nothing when the request fails', async () => {
    updateStatus.mockRejectedValue(new Error('boom'));
    await moveTask().expect(500);
    await settle();
    expect(capture).not.toHaveBeenCalled();
  });

  describe('a config PATCH that sets the opt-out', () => {
    // The stored flag: the service writes it, the opt-out lookup reads it.
    let optedOut: boolean;

    beforeEach(() => {
      optedOut = false;
      isAnalyticsOptedOut.mockImplementation(() => Promise.resolve(optedOut));
      patchConfig
        .mockReset()
        .mockImplementation(
          (
            _chapterId: string,
            _userId: string,
            dto: Record<string, unknown>,
          ) => {
            if (typeof dto.analytics_opt_out === 'boolean') {
              optedOut = dto.analytics_opt_out;
            }
            return Promise.resolve({});
          },
        );
    });

    const patch = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch(`/v1/chapters/${CHAPTER_ID}/config`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send(body);

    it('is not itself recorded when it opts the chapter out', async () => {
      await patch({ analytics_opt_out: true }).expect(200);
      await settle();
      expect(patchConfig).toHaveBeenCalled();
      expect(isAnalyticsOptedOut).toHaveBeenCalledWith(CHAPTER_ID);
      expect(capture).not.toHaveBeenCalled();
    });

    it('is recorded, with its section, when it leaves the chapter opted in', async () => {
      await patch({ analytics_opt_out: false }).expect(200);
      await settle();
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chapter-config-updated',
          properties: expect.objectContaining({
            feature: 'chapter-settings',
            section: 'analytics_opt_out',
          }),
        }),
      );
    });
  });
});
