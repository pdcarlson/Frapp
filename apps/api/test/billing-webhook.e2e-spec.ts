import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/application/services/billing.service';
import { BILLING_PROVIDER } from '../src/domain/adapters/billing.interface';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';

const V1 = '/v1';

describe('Billing webhook (e2e)', () => {
  let app: INestApplication;
  const handleWebhookEvent = jest.fn().mockResolvedValue(undefined);
  const constructWebhookEvent = jest.fn().mockReturnValue({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    created: Date.now(),
    data: { object: { metadata: { chapter_id: 'ch-1' } } },
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(BillingService)
      .useValue({
        handleWebhookEvent,
      })
      .overrideProvider(BILLING_PROVIDER)
      .useValue({
        constructWebhookEvent,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    app.use((req, _res, next) => {
      req.rawBody = Buffer.from(JSON.stringify(req.body ?? {}));
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects missing Stripe signature', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .send({ type: 'checkout.session.completed' })
      .expect(400);
  });

  it('accepts valid signed webhook and forwards to billing service', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .set('stripe-signature', 'sig_test')
      .send({ type: 'checkout.session.completed' })
      .expect(200)
      .expect({ received: true });

    expect(constructWebhookEvent).toHaveBeenCalled();
    expect(handleWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt_test_1',
      }),
    );
  });

  // FRA-275: Stripe delivers event bursts from a small shared IP pool with no
  // bearer token, so without the exemption the whole burst lands in one
  // ip-keyed 30/min write bucket and real billing events get 429'd.
  it('is exempt from the write rate limit: a >30-request burst never 429s', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .post(`${V1}/webhooks/stripe`)
        .set('stripe-signature', 'sig_test')
        .send({ type: 'checkout.session.completed' });
      expect(res.status).toBe(200);
      // The skip path never reaches the throttler, so no rate-limit
      // bookkeeping headers appear either.
      const rateLimitHeaders = Object.keys(res.headers).filter((h) =>
        h.startsWith('x-ratelimit'),
      );
      expect(rateLimitHeaders).toEqual([]);
    }
  });

  it('leaves other unauthenticated POST routes throttled per IP', async () => {
    // First 30 pass the throttler and die at auth (401); the 31st is cut off
    // by the write bucket with the canonical Retry-After header.
    for (let i = 0; i < 30; i++) {
      await request(app.getHttpServer())
        .post(`${V1}/invoices`)
        .send({})
        .expect(401);
    }
    const res = await request(app.getHttpServer())
      .post(`${V1}/invoices`)
      .send({});
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
