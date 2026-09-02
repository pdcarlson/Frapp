import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/application/services/chat.service';
import { MemberService } from '../src/application/services/member.service';
import { ServiceEntryService } from '../src/application/services/service-entry.service';
import { ChapterDocumentService } from '../src/application/services/chapter-document.service';
import { FinancialInvoiceService } from '../src/application/services/financial-invoice.service';
import { BackworkService } from '../src/application/services/backwork.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';

const V1 = '/v1';
const CHAPTER_ID = 'chapter-1';

/**
 * Nest matches routes in declaration order (#990). A single-segment literal
 * route declared BELOW `@Get(':id')` on the same controller is swallowed by
 * it — the request still 200s, just against the wrong handler, answering
 * `getOne('unread')` instead of the route that exists. A unit test that
 * calls the handler method directly can never catch this: it bypasses the
 * router entirely, so the assertion would pass regardless of source order
 * (see the NOTE in `member.controller.spec.ts`). This suite drives real HTTP
 * requests through the real router, so a future reorder — an alphabetical
 * sort of the handlers, a merge, a refactor — fails loudly here instead of
 * silently 404ing (or worse, 200ing with the wrong payload) in production.
 *
 * One `it` per literal route that currently sits above a `:id` route on its
 * controller — covers every instance in the codebase at the time this
 * suite was written (#990's acceptance criterion 3), not just chat's.
 */
describe('Route declaration order — a literal route must not be swallowed by :id (e2e)', () => {
  let app: INestApplication;

  class AuthGuardStub implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      req.supabaseUser = { id: 'auth-1', email: 'member@example.com' };
      return true;
    }
  }

  class ChapterGuardStub implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      req.appUser = { id: 'member-1' };
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

  const chatServiceMock = {
    getUnreadCounts: jest.fn().mockResolvedValue([]),
    getChannelNotificationPreferences: jest.fn().mockResolvedValue([]),
    getKindNotificationPreferences: jest.fn().mockResolvedValue([]),
    getChannel: jest.fn().mockResolvedValue({ id: 'wrong-handler' }),
  };

  const memberServiceMock = {
    searchByChapterAndName: jest.fn().mockResolvedValue([]),
    findRosterByChapter: jest.fn().mockResolvedValue([]),
    findProfileById: jest.fn().mockResolvedValue({ id: 'wrong-handler' }),
  };

  const serviceEntryServiceMock = {
    leaderboard: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'wrong-handler' }),
  };

  const chapterDocumentServiceMock = {
    listFolders: jest.fn().mockResolvedValue([]),
    // The `:id` route's handler is named `getOne`, but it delegates to
    // `findById` on the service — that's the call this mock must intercept
    // for the "wrong handler" assertion below to mean anything.
    findById: jest.fn().mockResolvedValue({ id: 'wrong-handler' }),
  };

  const financialInvoiceServiceMock = {
    findOverdue: jest.fn().mockResolvedValue([]),
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'wrong-handler', user_id: 'member-1' }),
  };

  const backworkServiceMock = {
    getDepartments: jest.fn().mockResolvedValue([]),
    getProfessors: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'wrong-handler' }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(ChatService)
      .useValue(chatServiceMock)
      .overrideProvider(MemberService)
      .useValue(memberServiceMock)
      .overrideProvider(ServiceEntryService)
      .useValue(serviceEntryServiceMock)
      .overrideProvider(ChapterDocumentService)
      .useValue(chapterDocumentServiceMock)
      .overrideProvider(FinancialInvoiceService)
      .useValue(financialInvoiceServiceMock)
      .overrideProvider(BackworkService)
      .useValue(backworkServiceMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── chat.controller.ts (`/channels`) — the instance #990 was filed for ──

  it('GET /v1/channels/unread reaches getUnreadCounts, not getChannel', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/channels/unread`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(chatServiceMock.getUnreadCounts).toHaveBeenCalledWith(
      CHAPTER_ID,
      'member-1',
    );
    expect(chatServiceMock.getChannel).not.toHaveBeenCalled();
  });

  it('GET /v1/channels/notification-preferences reaches getChannelNotificationPreferences, not getChannel', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/channels/notification-preferences`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(
      chatServiceMock.getChannelNotificationPreferences,
    ).toHaveBeenCalledWith(CHAPTER_ID, 'member-1');
    expect(chatServiceMock.getChannel).not.toHaveBeenCalled();
  });

  /**
   * Two segments, so `@Get(':id')` cannot swallow this one the way it could a
   * bare literal — but it is pinned anyway, because the thing that WOULD
   * swallow it is a future `@Get(':id/:something')` on this controller, and
   * that is exactly the kind of addition nobody would connect to this route.
   */
  it('GET /v1/channels/notification-preferences/kinds reaches getKindNotificationPreferences, not getChannel', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/channels/notification-preferences/kinds`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(chatServiceMock.getKindNotificationPreferences).toHaveBeenCalledWith(
      CHAPTER_ID,
      'member-1',
    );
    expect(chatServiceMock.getChannel).not.toHaveBeenCalled();
    expect(
      chatServiceMock.getChannelNotificationPreferences,
    ).not.toHaveBeenCalled();
  });

  // ── member.controller.ts (`/members`) ──

  it('GET /v1/members/search reaches searchByChapterAndName, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/members/search?q=marcus`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(memberServiceMock.searchByChapterAndName).toHaveBeenCalledWith(
      CHAPTER_ID,
      'marcus',
      'member-1',
    );
    expect(memberServiceMock.findProfileById).not.toHaveBeenCalled();
  });

  it('GET /v1/members/roster reaches findRosterByChapter, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/members/roster`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(memberServiceMock.findRosterByChapter).toHaveBeenCalledWith(
      CHAPTER_ID,
    );
    expect(memberServiceMock.findProfileById).not.toHaveBeenCalled();
  });

  // ── service-entry.controller.ts (`/service-entries`) ──

  it('GET /v1/service-entries/leaderboard reaches leaderboard, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/service-entries/leaderboard`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(serviceEntryServiceMock.leaderboard).toHaveBeenCalledWith(
      CHAPTER_ID,
      expect.anything(),
    );
    expect(serviceEntryServiceMock.findById).not.toHaveBeenCalled();
  });

  // ── chapter-document.controller.ts (`/documents`) ──

  it('GET /v1/documents/folders reaches listFolders, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/documents/folders`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(chapterDocumentServiceMock.listFolders).toHaveBeenCalledWith(
      CHAPTER_ID,
    );
    expect(chapterDocumentServiceMock.findById).not.toHaveBeenCalled();
  });

  // ── financial-invoice.controller.ts (`/invoices`) ──
  // Undocumented until now: `overdue` had no "MUST stay above" comment at all.

  it('GET /v1/invoices/overdue reaches findOverdue, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/invoices/overdue`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(financialInvoiceServiceMock.findOverdue).toHaveBeenCalledWith(
      CHAPTER_ID,
    );
    expect(financialInvoiceServiceMock.findById).not.toHaveBeenCalled();
  });

  // ── backwork.controller.ts (`/backwork`) — also undocumented until now ──

  it('GET /v1/backwork/departments reaches getDepartments, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/backwork/departments`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(backworkServiceMock.getDepartments).toHaveBeenCalledWith(CHAPTER_ID);
    expect(backworkServiceMock.findById).not.toHaveBeenCalled();
  });

  it('GET /v1/backwork/professors reaches getProfessors, not getOne', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/backwork/professors`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_ID)
      .expect(200);

    expect(backworkServiceMock.getProfessors).toHaveBeenCalledWith(CHAPTER_ID);
    expect(backworkServiceMock.findById).not.toHaveBeenCalled();
  });
});
