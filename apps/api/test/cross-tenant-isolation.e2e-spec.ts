/**
 * Cross-tenant isolation (#847).
 *
 * Frapp is multi-tenant by chapter, and a request names its chapter in a place
 * the caller controls — the `x-chapter-id` header, a `?chapterId=` query, or a
 * raw resource id in the path. This spec is the regression test for the
 * question "does swapping that id get me another chapter's data?".
 *
 * Two things make it different from the rest of `test/`:
 *
 * 1. **`ChapterGuard` is NOT stubbed.** Every other e2e spec replaces it with a
 *    stub that hands out `chapterId: 'chapter-1'`, which means none of them can
 *    catch a tenancy regression. Here the real guard runs against a table-aware
 *    Supabase fake, so deleting its membership re-read fails these tests.
 * 2. **`PermissionsGuard` IS stubbed** to always allow. RBAC is a separate
 *    control with its own specs (`permissions.guard.spec.ts`); stubbing it keeps
 *    each assertion here about *tenancy* and stops a permission denial from
 *    masking a missing chapter check with a coincidentally-identical 403.
 *
 * The layers under test are documented in
 * `docs/internal/security/AUTHORIZATION_MODEL.md` §1.
 */
import {
  CanActivate,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import {
  createTableAwareSupabaseMock,
  type SeededTables,
} from './helpers/supabase-mock.factory';

const V1 = '/v1';

// Real UUIDs, not readable slugs: several DTOs validate ids with `@IsUUID()`
// (e.g. `UpdateNotificationPreferenceDto.chapter_id`), so a slug would be
// rejected by the ValidationPipe with a 400 and the request would never reach
// the tenancy check this spec exists to exercise — passing for the wrong reason.
//
// Chapter A — the victim tenant. Chapter B — the caller's own chapter.
const CHAPTER_A = '11111111-1111-4111-8111-111111111111';
const CHAPTER_B = '22222222-2222-4222-8222-222222222222';

const AUTH_B = 'auth-bob';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';
const MEMBER_B = '55555555-5555-4555-8555-555555555555';

const MEMBER_A = '66666666-6666-4666-8666-666666666666';
const ROLE_A = '77777777-7777-4777-8777-777777777777';
const INVITE_A = '88888888-8888-4888-8888-888888888888';
const TASK_A = '99999999-9999-4999-8999-999999999999';
const TASK_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVOICE_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INVOICE_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

class AllowPermissionsGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** Fresh rows per test — the fake mutates its seed on writes. */
function seed(): SeededTables {
  return {
    users: [{ id: USER_B, supabase_auth_id: AUTH_B, email: 'bob@example.com' }],
    members: [
      {
        id: MEMBER_B,
        user_id: USER_B,
        chapter_id: CHAPTER_B,
        role_ids: [],
        custom_role_ids: [],
      },
      // Alice's membership row. Bob must never resolve through it.
      {
        id: MEMBER_A,
        user_id: USER_A,
        chapter_id: CHAPTER_A,
        role_ids: [],
        custom_role_ids: [],
      },
    ],
    chapters: [
      {
        id: CHAPTER_A,
        subscription_status: 'active',
        past_due_since: null,
        enabled_modules: null,
      },
      {
        id: CHAPTER_B,
        subscription_status: 'active',
        past_due_since: null,
        enabled_modules: null,
      },
    ],
    roles: [{ id: ROLE_A, chapter_id: CHAPTER_A, name: 'Treasurer' }],
    invites: [
      { id: INVITE_A, chapter_id: CHAPTER_A, used_at: null, code: 'AAA' },
    ],
    tasks: [
      { id: TASK_A, chapter_id: CHAPTER_A, title: "Alice's task" },
      // Assigned to Bob: `GET /tasks/:id` layers a per-row assignee ACL on top
      // of chapter scoping, so the positive control needs to clear both.
      {
        id: TASK_B,
        chapter_id: CHAPTER_B,
        title: "Bob's task",
        assignee_id: USER_B,
      },
    ],
    events: [
      { id: EVENT_A, chapter_id: CHAPTER_A, title: "Alice's event" },
      { id: EVENT_B, chapter_id: CHAPTER_B, title: "Bob's event" },
    ],
    financial_invoices: [
      { id: INVOICE_A, chapter_id: CHAPTER_A, amount_cents: 5000 },
      // Billed to Bob: like tasks, `GET /invoices/:id` layers a per-row ACL
      // (own invoice, or `billing:view`) on top of chapter scoping.
      {
        id: INVOICE_B,
        chapter_id: CHAPTER_B,
        user_id: USER_B,
        amount_cents: 5000,
      },
    ],
    notification_preferences: [
      {
        user_id: USER_A,
        chapter_id: CHAPTER_A,
        category: 'chat',
        is_enabled: true,
      },
    ],
  };
}

describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  /** Boots the app with Bob authenticated and the given JWT claims. */
  async function boot(claims: Record<string, unknown> | null) {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(
        createTableAwareSupabaseMock({
          authUser: { id: AUTH_B, email: 'bob@example.com' },
          claims,
          tables: seed(),
        }),
      )
      .overrideGuard(PermissionsGuard)
      .useClass(AllowPermissionsGuard)
      .compile();

    const instance = moduleFixture.createNestApplication();
    instance.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await instance.init();
    return instance;
  }

  const asBob = (req: request.Test, chapterId = CHAPTER_B) =>
    req.set('authorization', 'Bearer token-bob').set('x-chapter-id', chapterId);

  afterEach(async () => {
    await app?.close();
  });

  describe('chapter context resolution (ChapterGuard)', () => {
    it('rejects an x-chapter-id for a chapter the caller is not a member of', async () => {
      app = await boot(null);

      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/tasks`),
        CHAPTER_A,
      );

      expect(res.status).toBe(403);
      expect(res.body.message?.code ?? res.body.code).toBe(
        'chapter.context.invalid',
      );
    });

    it('rejects an x-chapter-id that disagrees with the JWT active-chapter claim', async () => {
      // Bob's token says chapter B; the header claims chapter A. The header must
      // never win — even though Bob is a genuine member of chapter B.
      app = await boot({ active_chapter_id: CHAPTER_B });

      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/tasks`),
        CHAPTER_A,
      );

      expect(res.status).toBe(403);
      expect(res.body.message?.code ?? res.body.code).toBe(
        'chapter.context.mismatch',
      );
    });

    it('allows the caller into their own chapter (positive control)', async () => {
      // Without this, every assertion above would still pass if the fake simply
      // failed every lookup.
      app = await boot({ active_chapter_id: CHAPTER_B });

      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/tasks/${TASK_B}`),
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(TASK_B);
    });

    it('returns the caller’s own event and invoice (positive control)', async () => {
      // Pins the negative event/invoice cases below to *tenancy*. Without this,
      // a 404 there could equally mean a disabled module, a mis-typed path, or a
      // seed the fake never matched — and the test would look like it passed.
      app = await boot({ active_chapter_id: CHAPTER_B });

      const event = await asBob(
        request(app.getHttpServer()).get(`${V1}/events/${EVENT_B}`),
      );
      expect(event.status).toBe(200);
      expect(event.body.id).toBe(EVENT_B);

      const invoice = await asBob(
        request(app.getHttpServer()).get(`${V1}/invoices/${INVOICE_B}`),
      );
      expect(invoice.status).toBe(200);
      expect(invoice.body.id).toBe(INVOICE_B);
    });
  });

  describe('resource ids from another chapter', () => {
    beforeEach(async () => {
      app = await boot({ active_chapter_id: CHAPTER_B });
    });

    it('does not return another chapter’s member by raw id', async () => {
      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/members/${MEMBER_A}`),
      );

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(CHAPTER_A);
    });

    it('does not return another chapter’s task by raw id', async () => {
      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/tasks/${TASK_A}`),
      );

      expect(res.status).toBe(404);
    });

    it('does not let a caller edit another chapter’s role', async () => {
      const res = await asBob(
        request(app.getHttpServer())
          .patch(`${V1}/roles/${ROLE_A}`)
          .send({ name: 'Pwned' }),
      );

      expect([403, 404]).toContain(res.status);
    });

    it('does not return another chapter’s event by raw id', async () => {
      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/events/${EVENT_A}`),
      );

      expect(res.status).toBe(404);
    });

    it('does not return another chapter’s invoice by raw id', async () => {
      const res = await asBob(
        request(app.getHttpServer()).get(`${V1}/invoices/${INVOICE_A}`),
      );

      expect(res.status).toBe(404);
    });

    it('does not let a caller revoke another chapter’s invite', async () => {
      const res = await asBob(
        request(app.getHttpServer()).delete(`${V1}/invites/${INVITE_A}`),
      );

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('client-supplied chapter id outside ChapterGuard', () => {
    // `/notifications/preferences` carries no ChapterGuard — it takes the chapter
    // straight off the query string, so `assertChapterMembership` in
    // NotificationService is the only thing standing between Bob and chapter A.
    it('does not return another chapter’s notification preferences', async () => {
      app = await boot({ active_chapter_id: CHAPTER_B });

      const res = await request(app.getHttpServer())
        .get(`${V1}/notifications/preferences`)
        .query({ chapterId: CHAPTER_A })
        .set('authorization', 'Bearer token-bob');

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('is_enabled');
    });

    it('does not let a caller write notification preferences for another chapter', async () => {
      app = await boot({ active_chapter_id: CHAPTER_B });

      const res = await request(app.getHttpServer())
        .patch(`${V1}/notifications/preferences`)
        .set('authorization', 'Bearer token-bob')
        .send({ chapter_id: CHAPTER_A, category: 'chat', is_enabled: false });

      expect(res.status).toBe(403);
    });
  });
});
