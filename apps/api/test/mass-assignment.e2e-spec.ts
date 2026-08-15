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
import { createSupabaseMock } from './helpers/supabase-mock.factory';

const V1 = '/v1';
const CHAPTER_ID = 'chapter-1';
const OTHER_CHAPTER_ID = 'chapter-victim';
const TARGET_USER_ID = '33333333-3333-4333-8333-333333333333';

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
    req.chapterId = CHAPTER_ID;
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
 * loosened during an unrelated debugging session with nothing to catch it —
 * these tests are what fails when it does.
 *
 * The second half is narrower and more interesting: the controllers build their
 * write payloads by spreading the DTO next to server-decided keys
 * (`chapter_id`, `created_by`, `uploader_id`). Whitelisting means a hostile
 * `chapter_id` never survives the pipe, but the *ordering* of that spread is
 * what decides the outcome if a DTO ever legitimately grows one of those
 * property names. These assert the server's value reaches the service, so the
 * defence does not rest on a single flag.
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
    // Mirrors apps/api/src/main.ts exactly. If these diverge, this suite stops
    // testing production's behaviour and silently starts testing its own.
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hostile extra properties are rejected, not ignored', () => {
    it('rejects a points adjustment carrying an unexpected privileged field', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
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

      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });

    it('rejects an invoice create carrying a client-supplied status', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 15000,
          due_date: '2026-09-01',
          // the paid/void transition is a server decision behind its own route
          status: 'PAID',
        })
        .expect(400);

      expect(invoiceServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects an event create that tries to name its own chapter', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/events`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          name: 'Chapter Meeting',
          start_time: '2026-09-01T18:00:00.000Z',
          end_time: '2026-09-01T19:00:00.000Z',
          chapter_id: OTHER_CHAPTER_ID,
          created_by: 'somebody-else',
        })
        .expect(400);

      expect(eventServiceMock.create).not.toHaveBeenCalled();
    });
  });

  describe('server-decided keys win the write payload', () => {
    it('scopes an event to the request chapter and the authenticated author', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/events`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          name: 'Chapter Meeting',
          start_time: '2026-09-01T18:00:00.000Z',
          end_time: '2026-09-01T19:00:00.000Z',
        })
        .expect(201);

      expect(eventServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER_ID,
          created_by: 'admin-1',
        }),
      );
    });

    it('scopes an invoice to the request chapter', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 15000,
          due_date: '2026-09-01',
        })
        .expect(201);

      expect(invoiceServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ chapter_id: CHAPTER_ID }),
      );
    });
  });

  describe('value bounds hold at the edge', () => {
    it('rejects a points award above the ceiling', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          target_user_id: TARGET_USER_ID,
          amount: 2_147_483_647,
          category: 'MANUAL',
          reason: 'unbounded',
        })
        .expect(400);

      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });

    it('rejects an invoice amount above the payable maximum', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          user_id: TARGET_USER_ID,
          title: 'Fall 2026 Dues',
          amount: 100_000_000,
          due_date: '2026-09-01',
        })
        .expect(400);

      expect(invoiceServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID points target instead of failing in Postgres', async () => {
      await request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('authorization', 'Bearer token')
        .set('x-chapter-id', CHAPTER_ID)
        .send({
          target_user_id: 'not-a-uuid',
          amount: 5,
          category: 'MANUAL',
          reason: 'great work',
        })
        .expect(400);

      expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
    });
  });
});
