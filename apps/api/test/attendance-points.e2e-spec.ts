import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const V1 = '/v1';

describe('Attendance & Points (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue({
        auth: {
          getUser: jest
            .fn()
            .mockResolvedValue({ data: { user: null }, error: null }),
        },
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      })
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

  afterAll(async () => {
    await app.close();
  });

  describe('Attendance routes', () => {
    it('POST /v1/events/:eventId/attendance/check-in returns 401 without auth', () => {
      return request(app.getHttpServer())
        .post(`${V1}/events/evt-1/attendance/check-in`)
        .set('x-chapter-id', 'ch-1')
        .send({})
        .expect(401);
    });

    it('GET /v1/events/:eventId/attendance returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/events/evt-1/attendance`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });

    it('PATCH /v1/events/:eventId/attendance/:userId returns 401 without auth', () => {
      return request(app.getHttpServer())
        .patch(`${V1}/events/evt-1/attendance/user-1`)
        .set('x-chapter-id', 'ch-1')
        .send({ status: 'EXCUSED' })
        .expect(401);
    });
  });

  describe('Points routes', () => {
    it('GET /v1/points/me returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/points/me`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });

    it('GET /v1/points/leaderboard returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/points/leaderboard`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });

    it('GET /v1/points/members/:userId returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/points/members/user-1`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });

    it('POST /v1/points/adjust returns 401 without auth', () => {
      return request(app.getHttpServer())
        .post(`${V1}/points/adjust`)
        .set('x-chapter-id', 'ch-1')
        .send({
          target_user_id: 'user-1',
          amount: 10,
          category: 'MANUAL',
          reason: 'Test',
        })
        .expect(401);
    });
  });

  describe('Events routes (Phase 2 surface)', () => {
    it('GET /v1/events returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/events`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });

    it('GET /v1/events/:id returns 401 without auth', () => {
      return request(app.getHttpServer())
        .get(`${V1}/events/evt-1`)
        .set('x-chapter-id', 'ch-1')
        .expect(401);
    });
  });
});
