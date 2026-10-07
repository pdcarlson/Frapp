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
 * `applySubscriptionWebhook` is an RPC; `p_chapter_id` is the whole control.
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

  describe('isAnalyticsOptedOut', () => {
    it('reads only the caller chapter', async () => {
      harness = createTenantHarness({
        tables: {
          chapters: seed().chapters.map((row) => ({
            ...row,
            analytics_opt_out: row.id === CHAPTER_B,
          })),
        },
        tenantColumns: { chapters: 'id' },
        collisionExempt: {
          chapters: [
            'stripe_customer_id',
            'subscription_id',
            'analytics_opt_out',
          ],
        },
      });
      repo = new SupabaseChapterRepository(harness.client);

      await expect(
        harness.expectTenantScoped(CHAPTER_B, () =>
          repo.isAnalyticsOptedOut(CHAPTER_B),
        ),
      ).resolves.toBe(true);
    });

    it('reads a chapter with no row as not opted out', async () => {
      // Analytics emits for an unknown chapter rather than suppressing it; a
      // flipped default here would silently drop those events.
      await expect(
        repo.isAnalyticsOptedOut('77777777-7777-4777-8777-777777777777'),
      ).resolves.toBe(false);
    });
  });

  describe('findByIds', () => {
    it('returns only the requested chapter ids', async () => {
      // PK batch, not `.eq('id', one chapter)` — `expectTenantScoped` requires
      // that eq filter, so this asserts the returned ids directly.
      const chapters = await repo.findByIds([CHAPTER_B]);

      expect(chapters.map((c) => c.id)).toEqual([CHAPTER_B]);
    });

    it('returns every requested tenant-root row', async () => {
      const chapters = await repo.findByIds([CHAPTER_A, CHAPTER_B]);

      expect(chapters.map((c) => c.id).sort()).toEqual(
        [CHAPTER_A, CHAPTER_B].sort(),
      );
    });

    it('returns [] without querying when ids is empty', async () => {
      await expect(repo.findByIds([])).resolves.toEqual([]);
      expect(harness.ops).toEqual([]);
    });
  });

  it('update writes only the requested chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(CHAPTER_B, { accent_color: '#123456' }),
    );

    const rows = harness.rows('chapters');
    expect(rows.find((r) => r.id === CHAPTER_B)?.accent_color).toBe('#123456');
    expect(rows.find((r) => r.id === CHAPTER_A)?.accent_color).toBeNull();
  });

  describe('applySubscriptionWebhook', () => {
    it('passes the chapter to the RPC', async () => {
      harness = createTenantHarness({
        tables: seed(),
        tenantColumns: { chapters: 'id' },
        collisionExempt: {
          chapters: ['stripe_customer_id', 'subscription_id'],
        },
        rpc: {
          apply_subscription_webhook: {
            data: [
              {
                applied: { id: CHAPTER_B, subscription_status: 'active' },
                previous_subscription_status: 'active',
              },
            ],
          },
        },
      });
      repo = new SupabaseChapterRepository(harness.client);

      const applied = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.applySubscriptionWebhook(CHAPTER_B, '2026-06-02T12:00:00.000Z', {
          subscription_status: 'active',
        }),
      );

      expect(applied?.id).toBe(CHAPTER_B);
      expect(applied?.previous_subscription_status).toBe('active');
      expect(harness.rpcCalls[0].args).toMatchObject({
        p_chapter_id: CHAPTER_B,
        p_event_at: '2026-06-02T12:00:00.000Z',
        p_patch: { subscription_status: 'active' },
      });
    });

    it('returns null when the RPC updates zero rows', async () => {
      harness = createTenantHarness({
        tables: seed(),
        tenantColumns: { chapters: 'id' },
        collisionExempt: {
          chapters: ['stripe_customer_id', 'subscription_id'],
        },
        rpc: { apply_subscription_webhook: { data: [] } },
      });
      repo = new SupabaseChapterRepository(harness.client);

      const applied = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.applySubscriptionWebhook(CHAPTER_B, '2026-06-01T12:00:00.000Z', {
          subscription_status: 'past_due',
        }),
      );

      expect(applied).toBeNull();
    });
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

describe('SupabaseChapterRepository — updatePaletteIfSeedUnchanged', () => {
  const PALETTE = {
    theme_palette: { accent: '#AA0000' },
    theme_palette_engine_version: 3,
  };

  const chapterWith = (id: string, branding: Record<string, unknown>) => ({
    id,
    name: 'Beta Chapter',
    university: 'State University',
    branding,
    theme_palette: {},
    theme_palette_engine_version: null,
  });

  const harnessWith = (branding: Record<string, unknown>) =>
    createTenantHarness({
      tables: {
        chapters: [
          chapterWith(CHAPTER_A, branding),
          chapterWith(CHAPTER_B, branding),
        ],
      },
      tenantColumns: { chapters: 'id' },
    });

  it('writes the palette onto only the requested chapter while its accent is still the seed', async () => {
    const harness = harnessWith({ colors: { accent: '#AA0000' } });
    const repo = new SupabaseChapterRepository(harness.client);

    const written = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updatePaletteIfSeedUnchanged(CHAPTER_B, PALETTE, '#AA0000'),
    );

    expect(written).toBe(true);
    const rows = harness.rows('chapters');
    expect(rows.find((r) => r.id === CHAPTER_B)?.theme_palette).toEqual(
      PALETTE.theme_palette,
    );
    // Both twins carry the same accent, so only the id predicate spares A.
    expect(rows.find((r) => r.id === CHAPTER_A)?.theme_palette).toEqual({});
  });

  it('reports a lost race and writes nothing once the accent has moved on', async () => {
    const harness = harnessWith({ colors: { accent: '#0000AA' } });
    const repo = new SupabaseChapterRepository(harness.client);

    const written = await repo.updatePaletteIfSeedUnchanged(
      CHAPTER_B,
      PALETTE,
      '#AA0000',
    );

    expect(written).toBe(false);
    expect(
      harness.rows('chapters').find((r) => r.id === CHAPTER_B)?.theme_palette,
    ).toEqual({});
  });

  it('guards on "no accent" when the palette was derived without one', async () => {
    const harness = harnessWith({});
    const repo = new SupabaseChapterRepository(harness.client);

    await expect(
      repo.updatePaletteIfSeedUnchanged(CHAPTER_B, PALETTE, undefined),
    ).resolves.toBe(true);

    const accented = harnessWith({ colors: { accent: '#AA0000' } });
    await expect(
      new SupabaseChapterRepository(
        accented.client,
      ).updatePaletteIfSeedUnchanged(CHAPTER_B, PALETTE, undefined),
    ).resolves.toBe(false);
  });
});
