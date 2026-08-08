import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { NotificationController } from '../src/interface/controllers/notification.controller';
import { NotificationService } from '../src/application/services/notification.service';
import { AuthService } from '../src/application/services/auth.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';

const V1 = '/v1';

class AuthGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.supabaseUser = { id: 'auth-1', email: 'member@example.com' };
    req.appUser = { id: 'user-1' };
    return true;
  }
}

/**
 * #687 AC#3 — "PATCH /v1/settings rejects an unknown timezone with 400".
 *
 * The DTO unit spec proves the validator flags the property; it cannot prove a
 * 400, because the status depends on two things outside the DTO: the global
 * `ValidationPipe` and the controller's `@Body() dto: UpdateUserSettingsDto`
 * binding. Either could be changed without a single DTO test failing, which
 * would silently reopen this bug. This drives the real route instead, and
 * asserts the service is never reached — so a rejection can't be confused with
 * a write that happened to fail downstream.
 */
describe('PATCH /v1/settings — quiet_hours_tz validation (#687)', () => {
  let app: INestApplication;
  const notificationServiceMock = {
    updateSettings: jest.fn(),
    getSettings: jest.fn(),
  };

  beforeAll(async () => {
    // Deliberately NOT AppModule: the global ChapterGuard would demand chapter
    // context this user-scoped route does not use, and a 500 from that guard
    // would mask the 400 this test exists to prove. Mounting the real controller
    // with the real ValidationPipe keeps both links under test — the @Body()
    // DTO binding and the pipe — which is exactly what the DTO unit spec cannot
    // reach.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: notificationServiceMock },
        // The controller's AuthSyncInterceptor upserts the Supabase user into
        // `appUser`; here it just has to hand back the id @CurrentUser reads.
        {
          provide: AuthService,
          useValue: { syncUser: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    notificationServiceMock.updateSettings.mockResolvedValue({
      id: 'us-1',
      user_id: 'user-1',
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_tz: null,
      theme: 'system',
      updated_at: '2026-02-27T00:00:00.000Z',
    });
  });

  const patch = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`${V1}/settings`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send(body);

  it('rejects an unknown zone with 400 without reaching the service', async () => {
    await patch({ quiet_hours_tz: 'Mars/Olympus' }).expect(400);
    expect(notificationServiceMock.updateSettings).not.toHaveBeenCalled();
  });

  // DTO validation is all-or-nothing, so a bad zone rejects the whole payload,
  // unrelated fields included. That is the intended contract — pinning it here
  // because it is what makes the client-side rules load-bearing: nothing may
  // echo an unvalidated stored zone back on an unrelated save. Web validates
  // before submit and omits the field when the draft has not loaded, mobile
  // substitutes a known-good zone, and blank is a clear on every field — so a
  // member holding a bad row can still change their theme or switch quiet
  // hours off. If any of those regress, this 400 becomes the lockout.
  it('rejects the whole payload when a bad zone rides along with a theme change', async () => {
    await patch({ quiet_hours_tz: 'Mars/Olympus', theme: 'dark' }).expect(400);
    expect(notificationServiceMock.updateSettings).not.toHaveBeenCalled();
  });

  it('accepts a valid zone and passes it to the service', async () => {
    await patch({ quiet_hours_tz: 'America/New_York' }).expect(200);
    expect(notificationServiceMock.updateSettings).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ quiet_hours_tz: 'America/New_York' }),
    );
  });

  it('treats an empty string as a clear, so quiet hours can always be turned off', async () => {
    await patch({ quiet_hours_tz: '' }).expect(200);
    expect(notificationServiceMock.updateSettings).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ quiet_hours_tz: null }),
    );
  });

  it('accepts an explicit null', async () => {
    await patch({ quiet_hours_tz: null }).expect(200);
    expect(notificationServiceMock.updateSettings).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ quiet_hours_tz: null }),
    );
  });
});
