import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  AiChapterSettingsController,
  AiConsentController,
} from '../src/interface/controllers/ai-consent.controller';
import { AiConsentService } from '../src/application/services/ai/ai-consent.service';
import { AuthService } from '../src/application/services/auth.service';
import { TimeZoneSyncService } from '../src/application/services/time-zone-sync.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { configureApp } from '../src/bootstrap';
import { AllowAllGuard, createGuardStubs } from './helpers/guard-stubs.factory';

const V1 = '/v1';

/**
 * #4308: `GET` and `PUT /v1/ai/consent` answered 500 for everyone.
 *
 * The sheet's routes are person-level, so they carry no `ChapterGuard`, which
 * is what sets `request.appUser` on chapter routes. `@CurrentUser('id')` was
 * undefined, and Postgres refused it (`22P02` on the read, `23502` on the
 * write). The controller spec called the handlers with a user id directly, so
 * it could not see that.
 *
 * This mounts the real controller with its real class-level guard order
 * (`AiEnabledGuard`, then auth) and its real `AuthSyncInterceptor`. Only the
 * Supabase JWT check is stubbed, and the stub writes `supabaseUser` alone, as
 * the real guard does: the Frapp user id has to come from the interceptor,
 * through the mocked `AuthService`, the way it does in production.
 *
 * The chapter's switches (`GET /v1/ai/settings`) sit on their own controller
 * behind `ChapterGuard`, mounted here too: whether the president's switches
 * can be changed at all rests on the caller's roles reaching the service, so
 * that is asserted as well.
 */
describe('/v1/ai/consent resolves the caller without a chapter (#4308)', () => {
  let app: INestApplication;
  const consent = {
    getConsentState: jest.fn(),
    answer: jest.fn(),
    getChapterSettings: jest.fn(),
  };
  const state = {
    sheet: { version: 1, providers: [], data: [] },
    answer: null,
    answered_at: null,
    sheet_changed: false,
  };

  const { AuthGuardStub, ChapterGuardStub } = createGuardStubs({
    authUserId: 'auth-1',
    email: 'member@example.com',
    // Only `ChapterGuard` writes this, so the consent routes, which have none,
    // must get `user-1` from the interceptor instead.
    appUserId: 'set-only-by-chapter-guard',
    roleIds: ['role-president'],
    chapterId: 'chapter-1',
  });

  const previous = process.env.AI_ENABLED;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AiConsentController, AiChapterSettingsController],
      providers: [
        { provide: AiConsentService, useValue: consent },
        {
          provide: AuthService,
          useValue: { syncUser: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        },
        { provide: TimeZoneSyncService, useValue: { record: jest.fn() } },
      ],
    })
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
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_ENABLED = 'true';
    consent.getConsentState.mockResolvedValue(state);
    consent.answer.mockResolvedValue({ ...state, answer: 'no' });
  });

  it('reads the sheet for the signed-in person', async () => {
    const res = await request(app.getHttpServer())
      .get(`${V1}/ai/consent`)
      .set('authorization', 'Bearer token')
      .expect(200);

    expect(consent.getConsentState).toHaveBeenCalledWith('user-1');
    expect(res.body).toMatchObject({ answer: null, sheet_changed: false });
  });

  it('records the answer against the signed-in person', async () => {
    await request(app.getHttpServer())
      .put(`${V1}/ai/consent`)
      .set('authorization', 'Bearer token')
      .send({ sheet_version: 1, answer: 'no' })
      .expect(200);

    expect(consent.answer).toHaveBeenCalledWith('user-1', 1, false);
  });

  it('answers ai.not_available, before anything else, with AI off', async () => {
    process.env.AI_ENABLED = 'false';
    const res = await request(app.getHttpServer())
      .get(`${V1}/ai/consent`)
      .set('authorization', 'Bearer token')
      .expect(404);

    expect(res.body).toMatchObject({ code: 'ai.not_available' });
    expect(consent.getConsentState).not.toHaveBeenCalled();
  });

  it("passes the caller's roles to the chapter switches, which decide can_change", async () => {
    consent.getChapterSettings.mockResolvedValue({
      ask: false,
      meeting_notes: false,
      chat_source: false,
      updated_at: null,
      can_change: true,
    });
    const res = await request(app.getHttpServer())
      .get(`${V1}/ai/settings`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .expect(200);

    expect(consent.getChapterSettings).toHaveBeenCalledWith('chapter-1', [
      'role-president',
    ]);
    expect(res.body).toMatchObject({ can_change: true });
  });
});
