import { SupabaseFinancialInvoiceRepository } from './supabase-financial-invoice.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `financial_invoices` — dues. Money makes the read side and
 * the write side separately dangerous: a cross-chapter read discloses what
 * another chapter charges its members, and a cross-chapter write marks somebody
 * else's invoice paid.
 *
 * Both write paths are covered here rather than reads alone. `applyPayment` is
 * the one a Stripe webhook reaches, with an invoice id it learned from outside
 * the request, and it does its work inside SQL — so `p_chapter_id` is the whole
 * control. `update` and `setPaymentIntentIfOpen` are officer and member routes
 * that carry the request's chapter, and both scope the statement itself rather
 * than reading first and checking after.
 */

const INVOICE_A = '0a000000-0000-4000-8000-000000000040';
const INVOICE_B = '0b000000-0000-4000-8000-000000000040';

const seed = () => ({
  financial_invoices: [
    inA({
      id: INVOICE_A,
      user_id: USER_SHARED,
      title: 'Fall dues',
      description: null,
      amount: 25000,
      status: 'OPEN',
      due_date: '2026-01-01',
      paid_at: null,
      stripe_payment_intent_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: INVOICE_B,
      user_id: USER_SHARED,
      title: 'Fall dues',
      description: null,
      amount: 25000,
      status: 'OPEN',
      due_date: '2026-01-01',
      paid_at: null,
      stripe_payment_intent_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseFinancialInvoiceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseFinancialInvoiceRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseFinancialInvoiceRepository(harness.client);
  });

  it('findById refuses an id belonging to another chapter', async () => {
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(INVOICE_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('findByChapter returns only the caller chapter invoices', async () => {
    const invoices = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(invoices.map((i) => i.id)).toEqual([INVOICE_B]);
  });

  it('findByUser scopes a member billing history to the caller chapter', async () => {
    const invoices = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B),
    );

    expect(invoices.map((i) => i.id)).toEqual([INVOICE_B]);
  });

  it('findOverdue keeps the chapter predicate alongside the status and date filters', async () => {
    const overdue = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findOverdue(CHAPTER_B),
    );

    expect(overdue.map((i) => i.id)).toEqual([INVOICE_B]);
  });

  it('update leaves another chapter invoice untouched', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(INVOICE_B, CHAPTER_B, { status: 'PAID' }),
    );

    const rows = harness.rows('financial_invoices');
    expect(rows.find((r) => r.id === INVOICE_B)?.status).toBe('PAID');
    expect(rows.find((r) => r.id === INVOICE_A)?.status).toBe('OPEN');
  });

  it('setPaymentIntentIfOpen will not attach an intent to another chapter invoice', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setPaymentIntentIfOpen(INVOICE_A, CHAPTER_B, 'pi_123'),
    );

    expect(updated).toBeNull();
    expect(
      harness.rows('financial_invoices').find((r) => r.id === INVOICE_A)
        ?.stripe_payment_intent_id,
    ).toBeNull();
  });

  it('applyPayment passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: {
        apply_invoice_payment: {
          data: [{ id: INVOICE_B, chapter_id: CHAPTER_B, status: 'PAID' }],
        },
      },
    });
    repo = new SupabaseFinancialInvoiceRepository(harness.client);

    // The payment applies inside SQL, so `p_chapter_id` is the only tenancy
    // control on this path — there is no `.eq()` for a reviewer to look for.
    const paid = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.applyPayment(INVOICE_B, CHAPTER_B, 'pi_123', 'ch_123'),
    );

    expect(paid?.id).toBe(INVOICE_B);
    expect(harness.rpcCalls[0].args).toMatchObject({
      p_invoice_id: INVOICE_B,
      p_chapter_id: CHAPTER_B,
    });
  });

  it('create issues the invoice under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000041',
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        title: 'Spring dues',
        amount: 20000,
        status: 'OPEN',
        due_date: '2026-06-01',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(
      harness
        .rows('financial_invoices')
        .filter((r) => r.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });
});
