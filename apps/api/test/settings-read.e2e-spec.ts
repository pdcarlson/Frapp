import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { NotificationController } from '../src/interface/controllers/notification.controller';
import { NotificationService } from '../src/application/services/notification.service';
import { AuthService } from '../src/application/services/auth.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { configureApp } from '../src/bootstrap';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  NOTIFICATION_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  USER_SETTINGS_REPOSITORY,
} from '#domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '#domain/adapters/notification.interface';
import { AllowAllGuard, createGuardStubs } from './helpers/guard-stubs.factory';

const V1 = '/v1';

/**
 * #2885: `GET /v1/settings` for a member with no `user_settings` row.
 *
 * The service spec proves `getSettings` returns the defaults. It cannot show
 * what reached the wire, and the wire was the bug: the service returned `null`
 * and Nest sent that as a 200 with an empty body, which the SDK reads as
 * `data: undefined`. This runs the real `NotificationService` behind the real
 * controller, with only the repository layer mocked, and asserts a JSON body.
 *
 * Mounting one controller rather than `AppModule` has the same reasons as
 * `settings-quiet-hours-tz.e2e-spec.ts`. `appUser` comes from the class-level
 * `AuthSyncInterceptor` through the mocked `AuthService`, so the auth stub only
 * has to supply `supabaseUser`. `ChapterGuard` and `PermissionsGuard` guard
 * other routes on this controller, and Nest builds them anyway.
 */
describe('GET /v1/settings — a member with no settings row (#2885)', () => {
  let app: INestApplication;
  const settingsRepo = {
    findByUser: jest.fn(),
    findByUserIds: jest.fn(),
    upsert: jest.fn(),
  };

  const { AuthGuardStub } = createGuardStubs({
    authUserId: 'auth-1',
    email: 'member@example.com',
    appUserId: 'user-1',
    roleIds: [],
    chapterId: 'chapter-1',
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        NotificationService,
        { provide: USER_SETTINGS_REPOSITORY, useValue: settingsRepo },
        // The read touches none of these; the service needs them to construct.
        { provide: NOTIFICATION_REPOSITORY, useValue: {} },
        { provide: PUSH_TOKEN_REPOSITORY, useValue: {} },
        { provide: NOTIFICATION_PREFERENCE_REPOSITORY, useValue: {} },
        { provide: MEMBER_REPOSITORY, useValue: {} },
        { provide: NOTIFICATION_PROVIDER, useValue: {} },
        {
          provide: AuthService,
          useValue: { syncUser: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(AllowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(AllowAllGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const get = () =>
    request(app.getHttpServer())
      .get(`${V1}/settings`)
      .set('authorization', 'Bearer token');

  it('answers with the defaults as a JSON body, not an empty one', async () => {
    settingsRepo.findByUser.mockResolvedValue(null);

    const res = await get().expect(200);

    expect(settingsRepo.findByUser).toHaveBeenCalledWith('user-1');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toStrictEqual({
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_tz: null,
      theme: 'system',
    });
  });

  it('answers a stored row with the same four fields', async () => {
    settingsRepo.findByUser.mockResolvedValue({
      id: 'us-1',
      user_id: 'user-1',
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '08:00:00',
      quiet_hours_tz: 'America/New_York',
      theme: 'dark',
      updated_at: '2026-09-30T00:00:00.000Z',
    });

    const res = await get().expect(200);

    expect(res.body).toStrictEqual({
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '08:00:00',
      quiet_hours_tz: 'America/New_York',
      theme: 'dark',
    });
  });

  it('answers a failed read with an error, not the defaults', async () => {
    settingsRepo.findByUser.mockRejectedValue(new Error('read failed'));

    const res = await get();

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('theme');
  });
});
