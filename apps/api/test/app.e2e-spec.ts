import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue({
        auth: { getUser: jest.fn() },
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null }),
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).not.toHaveProperty('commit');
  });

  it('/health (GET) exposes x-request-id to an allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'e2e-health-req')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(response.headers['x-request-id']).toBe('e2e-health-req');
    const exposed = String(
      response.headers['access-control-expose-headers'] ?? '',
    )
      .split(',')
      .map((item) => item.trim().toLowerCase());
    expect(exposed).toEqual(
      expect.arrayContaining(['x-request-id', 'sentry-trace', 'baggage']),
    );
  });
});
