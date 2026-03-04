import {
  CanActivate,
  ExecutionContext,
  INestApplication,
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

class AuthGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.supabaseUser = { id: 'auth-user-1', email: 'member@example.com' };
    return true;
  }
}

class ChapterGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.appUser = { id: 'user-1' };
    request.member = { id: 'member-1', role_ids: ['role-admin'] };
    request.chapterId = 'chapter-1';
    return true;
  }
}

class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('Task lifecycle (e2e)', () => {
  let app: INestApplication;
  const taskServiceMock = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn().mockResolvedValue({
      id: 'task-1',
      status: 'COMPLETED',
    }),
    confirmCompletion: jest.fn().mockResolvedValue({
      id: 'task-1',
      status: 'COMPLETED',
      points_awarded: true,
    }),
    rejectCompletion: jest.fn().mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      points_awarded: false,
    }),
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates task status for assignee/admin context', async () => {
    await request(app.getHttpServer())
      .patch(`${V1}/tasks/task-1/status`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({ status: 'COMPLETED' })
      .expect(200);

    expect(taskServiceMock.updateStatus).toHaveBeenCalledWith(
      'task-1',
      'chapter-1',
      'user-1',
      true,
      'COMPLETED',
    );
  });

  it('confirms completion and awards points', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/tasks/task-1/confirm`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({})
      .expect(201);

    expect(taskServiceMock.confirmCompletion).toHaveBeenCalledWith(
      'task-1',
      'chapter-1',
    );
  });

  it('rejects completion and returns task to in-progress', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/tasks/task-1/reject`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({ comment: 'Missing details' })
      .expect(201);

    expect(taskServiceMock.rejectCompletion).toHaveBeenCalledWith(
      'task-1',
      'chapter-1',
      'Missing details',
    );
  });
});
