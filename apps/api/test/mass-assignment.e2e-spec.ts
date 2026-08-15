import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PointsService } from '../src/application/services/points.service';
import { EventService } from '../src/application/services/event.service';
import { FinancialInvoiceService } from '../src/application/services/financial-invoice.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { VALIDATION_PIPE_OPTIONS } from '../src/interface/pipes/validation-pipe.options';
import { createSupabaseMock } from './helpers/supabase-mock.factory';

const V1 = '/v1';

/**
 * The chapter the (stubbed) ChapterGuard resolves from the caller's membership,
 * and the different value the client puts on the wire. They must not be equal:
 * if they were, an assertion that the service saw "the chapter" could not tell
 * a guard-resolved chapter from an attacker-supplied header.
 */
const GUARD_CHAPTER_ID = 'chapter-from-guard';
const CLIENT_CHAPTER_HEADER = 'chapter-attacker-claims';
const OTHER_CHAPTER_ID = 'chapter-victim';
const TARGET_USER_ID = '33333333-3333-4333-8333-333333333333';

/** Joins the pipe's message array so a test can assert *why* a 400 happened. */
function reasons(body: unknown): string {
  const message = (body as { message?: string | string[] })?.message;
  return Array.isArray(message) ? message.join(' | ') : String(message ?? '');
}

class AuthGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.supabaseUser = { id: 'auth-admin-1', email: 'admin@example.com' };
    return true;
  }
}

class ChapterGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.appUser = { id: 'admin-1' };
    req.member = { id: 'member-1', role_ids: ['role-exec'] };
    // Deliberately NOT the x-chapter-id header the tests send. The real guard
    // sets this only after confirming a membership row, and @CurrentChapterId()
    // reads it rather than the header — this asymmetry is what makes the
    // "scoped to the request chapter" assertions below meaningful.
    req.chapterId = GUARD_CHAPTER_ID;
    return true;
  }
}

class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * "Never trust the client" as an executable contract (#849).
 *
 * The global pipe runs `whitelist: true` + `forbidNonWhitelisted: true`, so an
 * unexpected property is rejected outright rather than reaching a DB write.
 * That is a config flag, and a config flag is exactly the thing that gets
 * loosened during an unrelated debugging session with nothing to catch it.
 * This suite imports `VALIDATION_PIPE_OPTIONS` from the same module `main.ts`
 * uses, so loosening a flag there fails these tests rather than sailing past
 * a local copy of the config.
 *
 * Scope, stated plainly so nobody over-reads a green run: every assertion here
 * is about the pipe and the payload the controller hands the service. The
 * guards are stubs, so this file proves nothing about *who* may call these
 * routes. The spread *ordering* in those controllers cannot be reached through
 * HTTP at all — whitelisting rejects a colliding key before the controller
 * runs — so it is covered by `write-payload-ordering.spec.ts`, which drives the
 * controller methods directly.
 */
describe('Mass assignment — privileged fields never come from the client (e2e)', () => {
  let app: INestApplication;

  const pointsServiceMock = {
    getUserSummary: jest.fn(),
    getLeaderboard: jest.fn(),
    listTransactions: jest.fn(),
    adjustPoints: jest.fn().mockResolvedValue({ id: 'pt-1', amount: 5 }),
  };

  const eventServiceMock = {
    create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    findByChapter: jest.fn().mockResolvedValue([]),
  };

  const invoiceServiceMock = {
    create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    findByChapter: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(PointsService)
      .useValue(pointsServiceMock)
      .overrideProvider(EventService)
      .useValue(eventServiceMock)
      .overrideProvider(FinancialInvoiceService)
      .useValue(invoiceServiceMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // Production's own options object, not a copy of its values.
    app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hostile extra properties are rejected, not ignored', () => {
    it('rejects a points adjustment carrying an unexpected privileged field', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          target_user_id: TARGET_USER_ID,
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
          // none of these exist on AdjustPointsDto
          chapter_id: OTHER_CHAPTER_ID,
          role: 'PRESIDENT',
          is_admin: true,
        })
        .expect(400);

      // Without this the test would still pass if the DTO grew a required
      // field and every payload here started 400-ing for the wrong reason.
      expect(reasons(res.body)).toContain('chapter_id should not exist');
      expect(reasons(res.body)).toContain('role should not exist');
      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });

    it('rejects an invoice create carrying a client-supplied status', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 15000,
          due_date: '2026-09-01',
          // the paid/void transition is a server decision behind its own route
          status: 'PAID',
        })
        .expect(400);

      expect(reasons(res.body)).toContain('status should not exist');
      expect(invoiceServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects an event create that tries to name its own chapter', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/events`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          name: 'Chapter Meeting',
          start_time: '2026-09-01T18:00:00.000Z',
          end_time: '2026-09-01T19:00:00.000Z',
          chapter_id: OTHER_CHAPTER_ID,
          created_by: 'somebody-else',
        })
        .expect(400);

      expect(reasons(res.body)).toContain('chapter_id should not exist');
      expect(reasons(res.body)).toContain('created_by should not exist');
      expect(eventServiceMock.create).not.toHaveBeenCalled();
    });
  });

  describe('server-decided keys reach the service', () => {
    it('scopes an event to the guard-resolved chapter, not the request header', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/events`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          name: 'Chapter Meeting',
          start_time: '2026-09-01T18:00:00.000Z',
          end_time: '2026-09-01T19:00:00.000Z',
        })
        .expect(201);

      expect(eventServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: GUARD_CHAPTER_ID,
          created_by: 'admin-1',
        }),
      );
    });

    it('scopes an invoice to the guard-resolved chapter, not the request header', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 15000,
          due_date: '2026-09-01',
        })
        .expect(201);

      expect(invoiceServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ chapter_id: GUARD_CHAPTER_ID }),
      );
    });
  });

  describe('value bounds hold at the edge', () => {
    it('rejects a points award above the ceiling', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          target_user_id: TARGET_USER_ID,
          amount: 2_147_483_647,
          category: 'MANUAL',
          reason: 'unbounded',
        })
        .expect(400);

      expect(reasons(res.body)).toContain('amount must not be greater than');
      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });

    it('rejects an invoice amount above the payable maximum', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 100_000_000,
          due_date: '2026-09-01',
        })
        .expect(400);

      expect(reasons(res.body)).toContain('amount must not be greater than');
      expect(invoiceServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID points target instead of failing in Postgres', async () => {
      const res = await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CLIENT_CHAPTER_HEADER)
        .send({
          target_user_id: 'not-a-uuid',
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
        })
        .expect(400);

      expect(reasons(res.body)).toContain('target_user_id must be a UUID');
      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });
  });
});
