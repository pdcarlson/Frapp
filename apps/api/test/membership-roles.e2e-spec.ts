import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RbacService } from '../src/application/services/rbac.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';
import {
  createGuardStubs,
  PermissionsGuardStub,
} from './helpers/guard-stubs.factory';

const V1 = '/v1';
const TARGET_MEMBER_ID = '44444444-4444-4444-8444-444444444444';

const { AuthGuardStub, ChapterGuardStub } = createGuardStubs({
  authUserId: 'auth-user-1',
  email: 'member@example.com',
  appUserId: 'user-1',
  roleIds: ['role-president'],
  chapterId: 'chapter-1',
});

describe('Membership + roles (e2e)', () => {
  let app: INestApplication;
  const rbacServiceMock = {
    findByChapter: jest.fn().mockResolvedValue([
      {
        id: 'role-president',
        chapter_id: 'chapter-1',
        name: 'President',
      },
    ]),
    getPermissionsCatalog: jest
      .fn()
      .mockReturnValue([{ key: 'ROLES_MANAGE', permission: 'roles:manage' }]),
    create: jest.fn().mockResolvedValue({
      id: 'role-scholarship',
      chapter_id: 'chapter-1',
      name: 'Scholarship',
    }),
    update: jest.fn(),
    delete: jest.fn(),
    transferPresidency: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
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
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists chapter roles with chapter-scoped context', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/roles`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .expect(200);

    expect(rbacServiceMock.findByChapter).toHaveBeenCalledWith('chapter-1');
  });

  it('transfers presidency using current chapter + member context', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/roles/transfer-presidency`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({ target_member_id: TARGET_MEMBER_ID })
      .expect(201)
      .expect({ success: true });

    expect(rbacServiceMock.transferPresidency).toHaveBeenCalledWith(
      'chapter-1',
      'member-1',
      TARGET_MEMBER_ID,
    );
  });
});
