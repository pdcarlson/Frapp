import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PointsService } from '../src/application/services/points.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';

const V1 = '/v1';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
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
    req.chapterId = 'chapter-1';
    return true;
  }
}

class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * Verifies the `/points` slash command's server entry point: the controller
 * forwards `channel_id` / `client_message_id` into `PointsService.adjustPoints`
 * (which posts the server-originated card), and the new UUID fields are
 * validated by the global pipe. The card-posting + forgery-guard behaviour
 * itself is unit-tested in `points.service.spec.ts` / `chat.service.spec.ts`.
 */
describe('Points chat card — adjust endpoint wiring (e2e)', () => {
  let app: INestApplication;

  const pointsServiceMock = {
    getUserSummary: jest.fn(),
    getLeaderboard: jest.fn(),
    listTransactions: jest.fn(),
    adjustPoints: jest.fn().mockResolvedValue({
      id: 'pt-1',
      chapter_id: 'chapter-1',
      user_id: TARGET_USER_ID,
      amount: 5,
      category: 'MANUAL',
      description: 'great work',
      metadata: { adjusted_by: 'admin-1', reason: 'great work' },
      created_at: '2026-05-30T18:00:00.000Z',
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(PointsService)
      .useValue(pointsServiceMock)
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
    pointsServiceMock.adjustPoints.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('forwards channel_id + client_message_id so the service can post the card', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/points/adjust`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        target_user_id: TARGET_USER_ID,
        amount: 5,
        category: 'MANUAL',
        reason: 'great work',
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(201);

    expect(pointsServiceMock.adjustPoints).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: 'chapter-1',
        targetUserId: TARGET_USER_ID,
        adminUserId: 'admin-1',
        amount: 5,
        category: 'MANUAL',
        reason: 'great work',
        channelId: CHANNEL_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    );
  });

  it('omits the chat fields for a dashboard adjustment', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/points/adjust`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        target_user_id: TARGET_USER_ID,
        amount: 5,
        category: 'MANUAL',
        reason: 'dashboard reward',
      })
      .expect(201);

    expect(pointsServiceMock.adjustPoints).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: undefined,
        clientMessageId: undefined,
      }),
    );
  });

  it('rejects a non-UUID channel_id (400) without calling the service', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/points/adjust`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        target_user_id: TARGET_USER_ID,
        amount: 5,
        category: 'MANUAL',
        reason: 'great work',
        channel_id: 'not-a-uuid',
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(400);

    expect(pointsServiceMock.adjustPoints).not.toHaveBeenCalled();
  });
});
