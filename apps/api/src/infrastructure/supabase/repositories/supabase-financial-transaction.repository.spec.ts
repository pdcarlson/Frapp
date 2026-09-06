import { SupabaseFinancialTransactionRepository } from './supabase-financial-transaction.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `financial_transactions` — the payment ledger behind dues.
 *
 * `findByInvoice` is the one method in this repository with no chapter
 * predicate, and it is worth being precise about rather than vague: the table
 * *does* carry `chapter_id`, so this is not a structural exemption the way
 * `users` is. It is safe today only because `FinancialInvoiceService` resolves
 * the invoice through `invoiceRepo.findById(id, chapterId)` first. The
 * assertion below pins that shape by inspecting the query the repository
 * actually issued, so the absence is recorded rather than assumed.
 */

const TXN_A = '0a000000-0000-4000-8000-000000000050';
const TXN_B = '0b000000-0000-4000-8000-000000000050';
const INVOICE_A = '0a000000-0000-4000-8000-000000000051';
const INVOICE_B = '0b000000-0000-4000-8000-000000000051';

const seed = () => ({
  financial_transactions: [
    inA({
      id: TXN_A,
      invoice_id: INVOICE_A,
      amount: 25000,
      type: 'PAYMENT',
      stripe_charge_id: 'ch_shared',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: TXN_B,
      invoice_id: INVOICE_B,
      amount: 25000,
      type: 'PAYMENT',
      stripe_charge_id: 'ch_shared',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseFinancialTransactionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseFinancialTransactionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // An invoice belongs to one chapter, so its id cannot collide.
      collisionExempt: { financial_transactions: ['invoice_id'] },
    });
    repo = new SupabaseFinancialTransactionRepository(harness.client);
  });

  it('create writes the ledger row under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000052',
        chapter_id: CHAPTER_B,
        invoice_id: INVOICE_B,
        amount: 1000,
        type: 'REFUND',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  describe('deliberately unscoped surfaces', () => {
    it('findByInvoice filters by invoice id alone', async () => {
      await repo.findByInvoice(INVOICE_B);

      const [query] = harness.ops;
      expect(query.table).toBe('financial_transactions');
      expect(query.filters.map((f) => f.column)).toEqual(['invoice_id']);
    });
  });
});
