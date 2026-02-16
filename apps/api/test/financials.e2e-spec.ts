import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Financials (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Mock environment
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.CLERK_SECRET_KEY = 'sk_clerk_123';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should compile', () => {
    expect(app).toBeDefined();
  });
});
