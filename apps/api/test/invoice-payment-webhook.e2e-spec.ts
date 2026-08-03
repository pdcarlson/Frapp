import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BILLING_PROVIDER } from '../src/domain/adapters/billing.interface';
import { createSupabaseMock } from './helpers/supabase-mock.factory';

const V1 = '/v1';

// FRA-15: unlike billing-webhook.e2e-spec.ts, the REAL BillingService and
// FinancialInvoiceService handle the event here — only the Supabase client and
// the Stripe provider boundary are mocked — so these tests prove the full
// HTTP → controller → BillingService → FinancialInvoiceService →
// apply_invoice_payment RPC pipeline.
//
// The RPC params are uuid-typed and BillingService drops non-UUID metadata
// before dispatching, so the fixtures below must be real UUIDs.
const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const paymentIntentEvent = (eventId: string) => ({
  id: eventId,
  type: 'payment_intent.succeeded',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'pi_1',
      metadata: {
        invoice_id: INVOICE_ID,
        chapter_id: CHAPTER_ID,
        user_id: USER_ID,
      },
      latest_charge: 'ch_1',
    },
  },
});

const expectedRpcArgs = [
  'apply_invoice_payment',
  {
    p_invoice_id: INVOICE_ID,
    p_chapter_id: CHAPTER_ID,
    p_payment_intent_id: 'pi_1',
    p_charge_id: 'ch_1',
  },
] as const;

describe('Invoice payment webhook (e2e)', () => {
  let app: INestApplication;
  const constructWebhookEvent = jest.fn();
  const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
  // The shared factory has no `rpc` (table queries only); the payment CAS goes
  // through supabase.rpc, so extend the mock object here.
  const supabaseMock = Object.assign(createSupabaseMock(), { rpc });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(supabaseMock)
      // Replaces the token in both the billing and financial-invoice modules.
      .overrideProvider(BILLING_PROVIDER)
      .useValue({ constructWebhookEvent })
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(
      (
        req: { body?: unknown; rawBody?: Buffer },
        _res: unknown,
        next: () => void,
      ) => {
        req.rawBody = Buffer.from(JSON.stringify(req.body ?? {}));
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies a signed payment_intent.succeeded via the apply_invoice_payment RPC', async () => {
    constructWebhookEvent.mockReturnValue(paymentIntentEvent('evt_pi_1'));
    rpc.mockResolvedValue({
      data: [
        {
          id: INVOICE_ID,
          user_id: USER_ID,
          chapter_id: CHAPTER_ID,
          title: 'Dues',
          amount: 5000,
          status: 'PAID',
        },
      ],
      error: null,
    });

    await request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .set('stripe-signature', 'sig_test')
      .send({ type: 'payment_intent.succeeded' })
      .expect(200)
      .expect({ received: true });

    expect(constructWebhookEvent).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(...expectedRpcArgs);
  });

  // Durable idempotency: a redelivery under a NEW event id sails past the
  // in-memory processed-event set, so it must be absorbed by the CAS RPC
  // returning no rows (already PAID) — still a 200, never an error.
  it('absorbs a redelivered payment under a new event id via the CAS miss path', async () => {
    constructWebhookEvent.mockReturnValue(paymentIntentEvent('evt_pi_2'));
    rpc.mockClear();
    rpc.mockResolvedValue({ data: [], error: null });

    await request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .set('stripe-signature', 'sig_test')
      .send({ type: 'payment_intent.succeeded' })
      .expect(200)
      .expect({ received: true });

    // The CAS was attempted (not skipped by in-memory dedupe) and missed; the
    // follow-up invoice lookup and ledger scan both resolve benignly on the
    // supabase mock (maybeSingle → { data: null, error: null }).
    expect(rpc).toHaveBeenCalledWith(...expectedRpcArgs);
  });

  // A foreign integration on the same Stripe account can attach arbitrary
  // metadata; forwarding a non-UUID into the uuid-typed RPC would 22P02 → 500
  // and Stripe would retry the event for days. Ack it and skip the RPC.
  it('acks and skips the RPC for an intent whose metadata is not a UUID', async () => {
    constructWebhookEvent.mockReturnValue({
      id: 'evt_pi_foreign',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_foreign',
          metadata: { invoice_id: 'inv-1', chapter_id: 'ch-1' },
          latest_charge: 'ch_1',
        },
      },
    });
    rpc.mockClear();

    await request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .set('stripe-signature', 'sig_test')
      .send({ type: 'payment_intent.succeeded' })
      .expect(200)
      .expect({ received: true });

    expect(rpc).not.toHaveBeenCalled();
  });
});
