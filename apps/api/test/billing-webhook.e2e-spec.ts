import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/application/services/billing.service';
import { BILLING_PROVIDER } from '../src/domain/adapters/billing.interface';
import { createSupabaseMock } from './helpers/supabase-mock.factory';

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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
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
});
