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

// Chapter A — the victim tenant. Chapter B — the caller's own chapter.
const CHAPTER_A = 'chapter-aaaa';
const CHAPTER_B = 'chapter-bbbb';

const AUTH_B = 'auth-bob';
const USER_B = 'user-bob';
const MEMBER_B = 'member-bob';

const MEMBER_A = 'member-alice';
const ROLE_A = 'role-alice';
const INVITE_A = 'invite-alice';
const TASK_A = 'task-alice';
const TASK_B = 'task-bob';

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
        user_id: 'user-alice',
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
    notification_preferences: [
      {
        user_id: 'user-alice',
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
  });
});
