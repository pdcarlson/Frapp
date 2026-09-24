import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { ClientPolicyModule } from '../../modules/client-policy/client-policy.module';
import { DEFAULT_UPDATE_URLS } from '../../application/services/client-policy.service';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

/**
 * Through the real module and `configureApp`, so the assertions cover what a
 * binary will actually depend on: the `/v1` path, no auth guard, the header
 * name, and the response keys.
 */
describe('GET /v1/client-policy', () => {
  let app: INestApplication;
  const saved = process.env.MOBILE_MIN_VERSION_IOS;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClientPolicyModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.MOBILE_MIN_VERSION_IOS;
    else process.env.MOBILE_MIN_VERSION_IOS = saved;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers without a bearer token', async () => {
    delete process.env.MOBILE_MIN_VERSION_IOS;
    const res = await request(app.getHttpServer())
      .get('/v1/client-policy')
      .set('X-Client-Version', 'ios/0.9.0+12')
      .expect(200);
    expect(res.body).toEqual({
      update_required: false,
      update_url: DEFAULT_UPDATE_URLS.ios,
    });
  });

  it('tells a build below the minimum to update, read at request time', async () => {
    process.env.MOBILE_MIN_VERSION_IOS = '0.9.1';
    const res = await request(app.getHttpServer())
      .get('/v1/client-policy')
      .set('X-Client-Version', 'ios/0.9.0+12')
      .expect(200);
    expect(res.body.update_required).toBe(true);
  });

  it('forbids shared caching, since the answer depends on a header', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/client-policy')
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ update_required: false, update_url: null });
  });
});
