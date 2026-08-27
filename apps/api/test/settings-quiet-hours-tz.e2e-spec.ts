import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { NotificationController } from '../src/interface/controllers/notification.controller';
import { NotificationService } from '../src/application/services/notification.service';
import { AuthService } from '../src/application/services/auth.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { configureApp } from '../src/bootstrap';

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
    // Deliberately NOT AppModule: booting it would pull in every module's
    // Supabase providers and the global throttler (the one APP_GUARD) for a
    // route that needs neither, and a failure from that wiring would mask the
    // 400 this test exists to prove. NotificationController is guarded only by
    // SupabaseAuthGuard — there is no ChapterGuard on it, which is why its one
    // chapter-scoped route verifies membership by hand in the service — so the
    // stub below replaces exactly that guard and nothing else. Mounting the real
    // controller with the real ValidationPipe keeps both links under test: the
    // @Body() DTO binding and the pipe, which is what the DTO unit spec cannot
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
    configureApp(app);
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
  // unrelated fields included. That is the intended contract, pinned here
  // because it is what makes the client-side rules load-bearing.
  //
  // The consequence is real and accepted: a member whose stored zone is
  // unresolvable cannot save an unrelated preference until they fix or clear
  // the field. Web makes that recoverable rather than opaque — it blocks the
  // submit with a field-level message naming the problem, and blank is a clear
  // on every field, so clearing the zone is always a way out. Mobile repairs
  // only structurally-broken stored values (blank, over-length) and leaves the
  // rest to this endpoint, because a device's tzdata can be older than the
  // server's and "repairing" on that verdict would overwrite a valid zone.
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
