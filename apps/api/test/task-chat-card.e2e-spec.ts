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
import { TaskService } from '../src/application/services/task.service';
import { RbacService } from '../src/application/services/rbac.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';

const V1 = '/v1';
const CHANNEL_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-2222-2222-222222222222';
const ASSIGNEE_ID = '33333333-3333-3333-3333-333333333333';

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
 * Verifies the `/task` slash command's server entry point: the controller
 * forwards `channel_id` / `client_message_id` into `TaskService.create` (which
 * posts the server-originated card), and the new UUID fields are validated by
 * the global pipe. The card-posting + forgery-guard behaviour itself is
 * unit-tested in `task.service.spec.ts` / `chat.service.spec.ts`.
 */
describe('Task chat card — create endpoint wiring (e2e)', () => {
  let app: INestApplication;

  const taskServiceMock = {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn().mockResolvedValue({
      id: 'task-1',
      chapter_id: 'chapter-1',
      title: 'Clean the house',
      description: null,
      assignee_id: ASSIGNEE_ID,
      created_by: 'admin-1',
      due_date: '2026-06-15',
      status: 'TODO',
      point_reward: 10,
      points_awarded: false,
      completed_at: null,
      confirmed_at: null,
      created_at: '2026-05-31T00:00:00.000Z',
    }),
    updateStatus: jest.fn(),
    confirmCompletion: jest.fn(),
    rejectCompletion: jest.fn(),
    delete: jest.fn(),
  };

  const rbacServiceMock = {
    memberHasAnyPermission: jest.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(TaskService)
      .useValue(taskServiceMock)
      .overrideProvider(RbacService)
      .useValue(rbacServiceMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
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

  afterEach(() => {
    taskServiceMock.create.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('forwards channel_id + client_message_id so the service can post the card', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/tasks`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        title: 'Clean the house',
        assignee_id: ASSIGNEE_ID,
        due_date: '2026-06-15',
        point_reward: 10,
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(201);

    expect(taskServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'chapter-1',
        created_by: 'admin-1',
        assignee_id: ASSIGNEE_ID,
        due_date: '2026-06-15',
        point_reward: 10,
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      }),
    );
  });

  it('omits the chat fields for a dashboard create', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/tasks`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        title: 'Dashboard task',
        assignee_id: ASSIGNEE_ID,
        due_date: '2026-06-15',
      })
      .expect(201);

    expect(taskServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: undefined,
        client_message_id: undefined,
      }),
    );
  });

  it('rejects a non-UUID channel_id (400) without calling the service', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/tasks`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        title: 'Bad channel',
        assignee_id: ASSIGNEE_ID,
        due_date: '2026-06-15',
        channel_id: 'not-a-uuid',
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(400);

    expect(taskServiceMock.create).not.toHaveBeenCalled();
  });
});
