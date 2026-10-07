import { SupabaseChapterConfigRepository } from './supabase-chapter-config.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the chapter settings tables: `chapter_workflows` and the
 * three singleton rows keyed by `chapter_id`. These feed enforcement (dues
 * grace, service points rate, points anti-fraud limits) as well as the config
 * endpoint, so a dropped predicate applies another chapter's policy, and a
 * misdirected upsert rewrites it.
 */

const WF_A = '0a000000-0000-4000-8000-0000000000c1';
const WF_B = '0b000000-0000-4000-8000-0000000000c1';

const DUES = {
  cadence: 'monthly' as const,
  active_amount_cents: 5000,
  new_member_amount_cents: 2500,
  alumni_amount_cents: 0,
  installments_allowed: true,
  installment_count: 3,
  late_fee_cents: 500,
  grace_days: 10,
  scholarship_pool_cents: 0,
};

// The singleton tables are keyed by `chapter_id` and have no `id` column. The
// harness tracks rows by `id` to tell an overwrite from a move, so each seeded
// row carries one here; it is fixture identity, not a column the repository
// reads or writes.
const seed = () => ({
  chapter_workflows: [
    inA({ id: WF_A, key: 'wf_dues_grace', enabled: true, threshold: 14 }),
    inB({ id: WF_B, key: 'wf_dues_grace', enabled: true, threshold: 14 }),
  ],
  chapter_dues_config: [
    inA({ id: 'dues-a', ...DUES }),
    inB({ id: 'dues-b', ...DUES }),
  ],
  chapter_service_config: [
    inA({ id: 'service-a', minutes_per_point: 30 }),
    inB({ id: 'service-b', minutes_per_point: 30 }),
  ],
  chapter_points_config: [
    inA({
      id: 'points-a',
      adjustment_rate_limit_per_hour: 20,
      anomaly_threshold: 40,
    }),
    inB({
      id: 'points-b',
      adjustment_rate_limit_per_hour: 20,
      anomaly_threshold: 40,
    }),
  ],
});

describe('SupabaseChapterConfigRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterConfigRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterConfigRepository(harness.client);
  });

  it('findWorkflows returns only the caller chapter overrides', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findWorkflows(CHAPTER_B),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'wf_dues_grace', threshold: 14 });
  });

  it('findWorkflow resolves one key inside the caller chapter', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findWorkflow(CHAPTER_B, 'wf_dues_grace'),
    );

    expect(row).toMatchObject({ enabled: true, threshold: 14 });
    await expect(repo.findWorkflow(CHAPTER_B, 'wf_other')).resolves.toBe(null);
  });

  it('upsertWorkflows overwrites the caller chapter row on (chapter_id, key)', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsertWorkflows([
        {
          chapter_id: CHAPTER_B,
          key: 'wf_dues_grace',
          enabled: false,
          threshold: 3,
        },
      ]),
    );

    const rows = harness.rows('chapter_workflows');
    expect(rows.find((r) => r.id === WF_B)).toMatchObject({
      enabled: false,
      threshold: 3,
    });
    // Same key in A: only a conflict target that includes chapter_id spares it.
    expect(rows.find((r) => r.id === WF_A)).toMatchObject({
      enabled: true,
      threshold: 14,
    });
  });

  it('findDuesConfig reads the caller chapter row', async () => {
    const dues = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findDuesConfig(CHAPTER_B),
    );

    expect(dues).toMatchObject(DUES);
  });

  it('upsertDuesConfig writes onto the caller chapter row only', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsertDuesConfig(CHAPTER_B, { ...DUES, cadence: 'per_quarter' }),
    );

    const rows = harness.rows('chapter_dues_config');
    expect(rows.find((r) => r.chapter_id === CHAPTER_B)?.cadence).toBe(
      'per_quarter',
    );
    expect(rows.find((r) => r.chapter_id === CHAPTER_A)?.cadence).toBe(
      'monthly',
    );
  });

  it('upsertDuesConfig keys the row on the argument, not on the config', async () => {
    // A config carrying a foreign `chapter_id` must not retarget the write:
    // the repository spreads the config first and the key last. Passed as a
    // variable so the extra key reaches the call, as a widened merge would.
    const smuggled = {
      ...DUES,
      cadence: 'per_quarter' as const,
      chapter_id: CHAPTER_A,
    };
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsertDuesConfig(CHAPTER_B, smuggled),
    );

    expect(
      harness
        .rows('chapter_dues_config')
        .find((r) => r.chapter_id === CHAPTER_A)?.cadence,
    ).toBe('monthly');
  });

  it('findServiceConfig and upsertServiceConfig stay inside the caller chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findServiceConfig(CHAPTER_B),
      ),
    ).resolves.toMatchObject({ minutes_per_point: 30 });

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsertServiceConfig(CHAPTER_B, { minutes_per_point: 45 }),
    );

    const rows = harness.rows('chapter_service_config');
    expect(
      rows.find((r) => r.chapter_id === CHAPTER_B)?.minutes_per_point,
    ).toBe(45);
    expect(
      rows.find((r) => r.chapter_id === CHAPTER_A)?.minutes_per_point,
    ).toBe(30);
  });

  it('findPointsConfig and upsertPointsConfig stay inside the caller chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findPointsConfig(CHAPTER_B),
      ),
    ).resolves.toMatchObject({
      adjustment_rate_limit_per_hour: 20,
      anomaly_threshold: 40,
    });

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsertPointsConfig(CHAPTER_B, {
        adjustment_rate_limit_per_hour: 5,
        anomaly_threshold: 40,
      }),
    );

    const rows = harness.rows('chapter_points_config');
    expect(
      rows.find((r) => r.chapter_id === CHAPTER_B)
        ?.adjustment_rate_limit_per_hour,
    ).toBe(5);
    expect(
      rows.find((r) => r.chapter_id === CHAPTER_A)
        ?.adjustment_rate_limit_per_hour,
    ).toBe(20);
  });

  it('a singleton read returns null for a chapter with no row', async () => {
    // Neither seeded twin belongs to this chapter, so a row coming back means
    // the chapter predicate was dropped.
    const UNCONFIGURED = '99999999-9999-4999-8999-999999999999';

    await expect(repo.findDuesConfig(UNCONFIGURED)).resolves.toBe(null);
  });
});
