import { SupabaseChapterRepository } from './supabase-chapter.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapters` — the tenant root, so it scopes by its own primary
 * key rather than by a `chapter_id` column. `tenantColumns` says so explicitly
 * instead of letting the harness assume the default and quietly check nothing.
 *
 * The Stripe lookups are the interesting case. They resolve a chapter *from*
 * an external identifier, so they are cross-tenant by construction: a Stripe
 * webhook has no chapter context until `findBySubscriptionId` or
 * `findByCustomerId` answers, through `BillingService.findChapterBySubscription`.
 * Orphan `findByStripeCustomerId` was deleted (#1088); `findByCustomerId` is
 * the production caller that replaced it (#1738).
 *
 * Those lookups are asserted as deliberate unscoped surfaces rather than left
 * to look like an oversight, and the Stripe distinguishing columns are
 * declared `collisionExempt` so the fixture states that decision out loud.
 * `claimSubscriptionId` is scoped by primary key — the tenant root.
 */

const STRIPE_CUSTOMER_B = 'cus_chapter_b';
const SUBSCRIPTION_B = 'sub_chapter_b';

const seed = () => ({
  chapters: [
    {
      id: CHAPTER_A,
      name: 'Beta Chapter',
      university: 'State University',
      subscription_status: 'active',
      stripe_customer_id: 'cus_chapter_a',
      subscription_id: 'sub_chapter_a',
      past_due_since: null,
      accent_color: null,
    },
    {
      id: CHAPTER_B,
      name: 'Beta Chapter',
      university: 'State University',
      subscription_status: 'active',
      stripe_customer_id: STRIPE_CUSTOMER_B,
      subscription_id: SUBSCRIPTION_B,
      past_due_since: null,
      accent_color: null,
    },
  ],
});

describe('SupabaseChapterRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      tenantColumns: { chapters: 'id' },
      // A Stripe customer belongs to exactly one chapter; making these collide
      // would model something that cannot happen and would make the two lookups
      // below untestable.
      collisionExempt: { chapters: ['stripe_customer_id', 'subscription_id'] },
    });
    repo = new SupabaseChapterRepository(harness.client);
  });

  it('findById resolves only the requested chapter', async () => {
    const chapter = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CHAPTER_B),
    );

    // Both chapters share a name and a university — an unlucky `.eq('name', …)`
    // refactor would return the wrong tenant and still look right.
    expect(chapter?.id).toBe(CHAPTER_B);
  });

  it('update writes only the requested chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(CHAPTER_B, { accent_color: '#123456' }),
    );

    const rows = harness.rows('chapters');
    expect(rows.find((r) => r.id === CHAPTER_B)?.accent_color).toBe('#123456');
    expect(rows.find((r) => r.id === CHAPTER_A)?.accent_color).toBeNull();
  });

  describe('claimSubscriptionId', () => {
    it('claims a null subscription_id on only the requested chapter', async () => {
      await repo.update(CHAPTER_B, {
        subscription_id: null,
        subscription_status: 'incomplete',
      });

      const claimed = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.claimSubscriptionId(CHAPTER_B, 'sub_claimed', null),
      );

      expect(claimed?.id).toBe(CHAPTER_B);
      expect(claimed?.subscription_id).toBe('sub_claimed');
      const rows = harness.rows('chapters');
      expect(rows.find((r) => r.id === CHAPTER_B)?.subscription_id).toBe(
        'sub_claimed',
      );
      expect(rows.find((r) => r.id === CHAPTER_A)?.subscription_id).toBe(
        'sub_chapter_a',
      );
    });

    it('returns null when another subscription already owns the row', async () => {
      const claimed = await repo.claimSubscriptionId(
        CHAPTER_B,
        'sub_other',
        null,
      );

      expect(claimed).toBeNull();
      expect(
        harness.rows('chapters').find((r) => r.id === CHAPTER_B)
          ?.subscription_id,
      ).toBe(SUBSCRIPTION_B);
    });

    it('overwrites a canceled leftover and refuses a live one', async () => {
      await repo.update(CHAPTER_B, {
        subscription_status: 'canceled',
      });

      const overwritten = await repo.claimSubscriptionId(
        CHAPTER_B,
        'sub_resubscribe',
        SUBSCRIPTION_B,
      );
      expect(overwritten?.subscription_id).toBe('sub_resubscribe');

      await repo.update(CHAPTER_A, {
        subscription_status: 'active',
      });
      const refused = await repo.claimSubscriptionId(
        CHAPTER_A,
        'sub_steal',
        'sub_chapter_a',
      );
      expect(refused).toBeNull();
      expect(
        harness.rows('chapters').find((r) => r.id === CHAPTER_A)
          ?.subscription_id,
      ).toBe('sub_chapter_a');
    });
  });

  describe('deliberately unscoped surfaces', () => {
    it('findBySubscriptionId resolves the chapter for a webhook that has no chapter context', async () => {
      const chapter = await repo.findBySubscriptionId(SUBSCRIPTION_B);

      expect(chapter?.id).toBe(CHAPTER_B);
    });

    it('findByCustomerId resolves the chapter for a webhook that has no chapter context', async () => {
      const chapter = await repo.findByCustomerId(STRIPE_CUSTOMER_B);

      expect(chapter?.id).toBe(CHAPTER_B);
    });
  });
});
