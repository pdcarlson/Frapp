import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { isPseudonymHex } from '@repo/observability';
import {
  hashChapterIdForAnalytics,
  hashUserIdForAnalytics,
} from '@repo/validation';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/application/services/auth.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';

const SALT = 'e2e-identity-salt';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAPTER_A = '11111111-1111-4111-8111-111111111111';
const CHAPTER_B = '22222222-2222-4222-8222-222222222222';

describe('Analytics identity (e2e)', () => {
  let app: INestApplication;
  let priorSalt: string | undefined;
  const authGuard = {
    jwtChapterId: undefined as string | undefined,
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      req.supabaseUser = { id: 'auth-user-1', email: 'a@example.com' };
      if (this.jwtChapterId) {
        req.jwtClaims = { active_chapter_id: this.jwtChapterId };
      }
      return true;
    },
  } satisfies CanActivate & { jwtChapterId?: string };

  beforeAll(async () => {
    priorSalt = process.env.ANALYTICS_HMAC_SALT;
    process.env.ANALYTICS_HMAC_SALT = SALT;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(AuthService)
      .useValue({
        syncUser: jest.fn().mockResolvedValue({ id: USER_ID }),
      })
      .overrideGuard(SupabaseAuthGuard)
      .useValue(authGuard)
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
    authGuard.jwtChapterId = undefined;
  });

  it('returns HMAC distinct_id and chapter_group_id when x-chapter-id is set', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_A)
      .expect(200);

    expect(isPseudonymHex(response.body.distinct_id)).toBe(true);
    expect(isPseudonymHex(response.body.chapter_group_id)).toBe(true);
    expect(response.body.distinct_id).toBe(
      hashUserIdForAnalytics(SALT, USER_ID),
    );
    expect(response.body.chapter_group_id).toBe(
      hashChapterIdForAnalytics(SALT, CHAPTER_A),
    );
    expect(response.body.enabled).toBe(true);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain(USER_ID);
    expect(raw).not.toContain(CHAPTER_A);
    expect(raw).not.toContain(SALT);
  });

  it('returns a different chapter_group_id when the chapter changes', async () => {
    const a = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_A)
      .expect(200);
    const b = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_B)
      .expect(200);

    expect(a.body.distinct_id).toBe(b.body.distinct_id);
    expect(a.body.chapter_group_id).not.toBe(b.body.chapter_group_id);
    expect(b.body.chapter_group_id).toBe(
      hashChapterIdForAnalytics(SALT, CHAPTER_B),
    );
  });

  it('omits the chapter group when no chapter is in context', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .expect(200);

    expect(response.body.distinct_id).toBe(
      hashUserIdForAnalytics(SALT, USER_ID),
    );
    expect(response.body.chapter_group_id).toBeNull();
  });

  it('omits the chapter group for a malformed x-chapter-id', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'not-a-uuid')
      .expect(200);

    expect(response.body.chapter_group_id).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('not-a-uuid');
  });

  it('prefers the JWT active_chapter_id claim over the header', async () => {
    authGuard.jwtChapterId = CHAPTER_A;
    const response = await request(app.getHttpServer())
      .get('/v1/analytics/identity')
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', CHAPTER_B)
      .expect(200);

    expect(response.body.chapter_group_id).toBe(
      hashChapterIdForAnalytics(SALT, CHAPTER_A),
    );
  });
});
