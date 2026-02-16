/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ClerkAuthGuard } from '../src/interface/guards/clerk-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { RbacService } from '../src/application/services/rbac.service';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let rbacService: RbacService;

  const mockClerkGuard = {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = { sub: 'clerk_1' };
      return true;
    },
  };

  const mockChapterGuard = {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.internalUserId = 'u1';
      return true;
    },
  };

  beforeEach(async () => {
    // Mock environment variables
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.CLERK_SECRET_KEY = 'test_key';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    process.env.STRIPE_SUCCESS_URL = 'http://success';
    process.env.STRIPE_CANCEL_URL = 'http://cancel';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_S3_BUCKET_NAME = 'test-bucket';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue(mockClerkGuard)
      .overrideGuard(ChapterGuard)
      .useValue(mockChapterGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    rbacService = moduleFixture.get<RbacService>(RbacService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /rbac/permissions should be accessible to any authenticated user in chapter', () => {
    return request(app.getHttpServer())
      .get('/rbac/permissions')
      .set('x-chapter-id', 'c1')
      .expect(200);
  });

  it('POST /rbac/roles should return 403 if user lacks roles:manage', async () => {
    jest
      .spyOn(rbacService, 'getPermissionsForUser')
      .mockResolvedValue(new Set(['other:permission']));

    return request(app.getHttpServer())
      .post('/rbac/roles')
      .set('x-chapter-id', 'c1')
      .send({ name: 'Test Role', permissions: [] })
      .expect(403);
  });

  it('POST /rbac/roles should return 201 if user has roles:manage', async () => {
    jest
      .spyOn(rbacService, 'getPermissionsForUser')
      .mockResolvedValue(new Set(['roles:manage']));
    jest
      .spyOn(rbacService, 'createRole')
      .mockResolvedValue({ id: 'r1' } as any);

    return request(app.getHttpServer())
      .post('/rbac/roles')
      .set('x-chapter-id', 'c1')
      .send({ name: 'Test Role', permissions: [] })
      .expect(201);
  });
});
