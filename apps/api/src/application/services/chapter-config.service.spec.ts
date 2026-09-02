// The shared @repo packages ship ESM-only dist; the API jest setup doesn't
// transform them. Mock the two pure helpers — their seed/palette logic is
// covered by each package's own tests. Here we exercise the config
// orchestration (workflow merge + audit-logged PATCH) only.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn(() => ({
    archetype: 'ifc',
    modules: { chat: true },
    rolePack: 'ifc_standard',
    vocabulary: { recruitment: 'Rush', pledge: 'New member', class: 'Class' },
    customFields: [],
    workflows: [
      {
        key: 'wf_budget_approval',
        label: 'Budget approval',
        enabled: true,
        threshold: 500,
        units: 'USD',
      },
      { key: 'wf_task_confirm', label: 'Task confirm', enabled: true },
      { key: 'wf_advisor_digest', label: 'Advisor digest', enabled: false },
    ],
    dues: {},
  })),
  getArchetype: jest.fn((key: string) => ({ key, rolePack: 'ifc_standard' })),
  // Enough of the real catalog to exercise the activation funnel's paid-module
  // detection (#267): one always-on free module and two paid ones.
  MODULE_CATALOG: [
    { key: 'chat', tier: 'free', alwaysOn: true },
    { key: 'events', tier: 'paid', alwaysOn: false },
    { key: 'dues', tier: 'paid', alwaysOn: false },
  ],
}));
jest.mock('@repo/chapter-theme', () => ({
  // Mirrors the real DeriveSignetPaletteResult shape — see the note in
  // chapter-onboarding.service.spec.ts for why a partial double is a trap
  // here: the service reads `invalidSeed` and iterates `contrastChecks`.
  deriveSignetPalette: jest.fn(() => ({
    palette: { '--signet-accent-primary': '#C49A3A' },
    resolvedSeed: '#F2B72E',
    invalidSeed: false,
    contrastChecks: [
      {
        role: '--signet-accent-text',
        against: '#0E0D0B',
        ratio: 7.2,
        passes: true,
      },
    ],
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ChapterConfigService } from './chapter-config.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { ActivationService } from './activation.service';
import { ChapterPointsConfigService } from './chapter-points-config.service';

const CHAPTER_ID = 'ch-1';

type WorkflowRow = { key: string; enabled: boolean; threshold: number | null };

/**
 * Builds a Supabase client stub. `chapters` resolves the given row through
 * `maybeSingle()` (and `{error:null}` when an update is awaited); the other
 * tables resolve their awaited value directly. Mutating calls are captured so
 * tests can assert on them.
 */
function makeSupabase(
  workflowRows: WorkflowRow[],
  duesRow: Record<string, unknown> | null = null,
  enabledModules: Record<string, boolean> = {},
  serviceRow: Record<string, unknown> | null = null,
  pointsRow: Record<string, unknown> | null = null,
) {
  const chapterRow = {
    id: CHAPTER_ID,
    org_archetype: 'ifc',
    enabled_modules: enabledModules,
    vocabulary: {},
    branding: {},
    theme_palette: {},
    beta_config: { enabled: true, style: 'sidebar_pill' },
    analytics_opt_out: false,
  };

  const workflowUpsert = jest.fn().mockReturnValue({ error: null });
  const duesUpsert = jest.fn().mockReturnValue({ error: null });
  const serviceUpsert = jest.fn().mockReturnValue({ error: null });
  const pointsUpsert = jest.fn().mockReturnValue({ error: null });
  const auditInsert = jest.fn().mockResolvedValue({ error: null });
  const chapterUpdate = jest.fn();

  const from = jest.fn((table: string) => {
    if (table === 'chapters') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.update = jest.fn((payload: unknown) => {
        chapterUpdate(payload);
        return builder;
      });
      // `eq` is the terminal for updates (awaited) and a passthrough for selects.
      builder.eq = jest.fn().mockReturnValue(
        Object.assign(Promise.resolve({ error: null }), {
          maybeSingle: jest
            .fn()
            .mockResolvedValue({ data: chapterRow, error: null }),
        }),
      );
      return builder;
    }
    if (table === 'chapter_workflows') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.eq = jest
        .fn()
        .mockResolvedValue({ data: workflowRows, error: null });
      builder.upsert = jest.fn((rows: unknown, opts: unknown) =>
        workflowUpsert(rows, opts),
      );
      return builder;
    }
    if (table === 'chapter_dues_config') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.eq = jest.fn().mockReturnValue({
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: duesRow, error: null }),
      });
      builder.upsert = jest.fn((rows: unknown, opts: unknown) =>
        duesUpsert(rows, opts),
      );
      return builder;
    }
    if (table === 'chapter_service_config') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.eq = jest.fn().mockReturnValue({
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: serviceRow, error: null }),
      });
      builder.upsert = jest.fn((rows: unknown, opts: unknown) =>
        serviceUpsert(rows, opts),
      );
      return builder;
    }
    if (table === 'chapter_points_config') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.eq = jest.fn().mockReturnValue({
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: pointsRow, error: null }),
      });
      builder.upsert = jest.fn((rows: unknown, opts: unknown) =>
        pointsUpsert(rows, opts),
      );
      return builder;
    }
    if (table === 'chapter_audit_log') {
      return { insert: auditInsert };
    }
    return {};
  });

  return {
    from,
    workflowUpsert,
    duesUpsert,
    serviceUpsert,
    pointsUpsert,
    auditInsert,
    chapterUpdate,
  };
}

/**
 * Shared across the file: `buildService` is module-scope, so the activation
 * mock is too. Reset in `beforeEach` so per-test assertions on the paid-module
 * milestone don't see a previous test's calls.
 */
const mockActivation: jest.Mocked<Pick<ActivationService, 'record'>> = {
  record: jest.fn().mockResolvedValue(true),
};

beforeEach(() => {
  mockActivation.record.mockClear();
});

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterConfigService,
      // The real service, not a double: it only needs SUPABASE_CLIENT, which
      // the stub above already provides, and wiring it for real means these
      // specs exercise the per-field clamp the config endpoint now shares with
      // enforcement rather than asserting against a mock that cannot drift.
      ChapterPointsConfigService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
      { provide: ActivationService, useValue: mockActivation },
    ],
  }).compile();
  return module.get(ChapterConfigService);
}

describe('ChapterConfigService — workflows', () => {
  describe('getConfig', () => {
    it('returns the seed catalog when the chapter has no overrides', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.workflows).toEqual([
        {
          key: 'wf_budget_approval',
          label: 'Budget approval',
          enabled: true,
          threshold: 500,
          units: 'USD',
        },
        {
          key: 'wf_task_confirm',
          label: 'Task confirm',
          enabled: true,
          threshold: undefined,
          units: undefined,
        },
        {
          key: 'wf_advisor_digest',
          label: 'Advisor digest',
          enabled: false,
          threshold: undefined,
          units: undefined,
        },
      ]);
    });

    it('overlays chapter overrides (enabled + threshold) onto the catalog', async () => {
      const supabase = makeSupabase([
        { key: 'wf_budget_approval', enabled: true, threshold: 1000 },
        { key: 'wf_advisor_digest', enabled: true, threshold: null },
      ]);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);
      const byKey = Object.fromEntries(config.workflows.map((w) => [w.key, w]));

      // override threshold wins; label/units stay from the seed catalog
      expect(byKey['wf_budget_approval']).toMatchObject({
        threshold: 1000,
        units: 'USD',
      });
      // override enabled wins; null threshold falls back to the seed default
      expect(byKey['wf_advisor_digest']).toMatchObject({ enabled: true });
    });
  });

  describe('patchConfig', () => {
    it('upserts only changed workflows and audits them on a workflows-only PATCH', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [
          { key: 'wf_advisor_digest', enabled: true }, // false -> true
          { key: 'wf_task_confirm', enabled: true }, // unchanged (seed true)
        ],
      });

      // Only the changed workflow is upserted.
      expect(supabase.workflowUpsert).toHaveBeenCalledTimes(1);
      const [rows, opts] = supabase.workflowUpsert.mock.calls[0];
      expect(rows).toEqual([
        {
          chapter_id: CHAPTER_ID,
          key: 'wf_advisor_digest',
          enabled: true,
          threshold: null,
        },
      ]);
      expect(opts).toEqual({ onConflict: 'chapter_id,key' });

      // No chapters-table column changed, so it is never updated...
      expect(supabase.chapterUpdate).not.toHaveBeenCalled();
      // ...but the audit row still fires, carrying the workflows diff.
      expect(supabase.auditInsert).toHaveBeenCalledTimes(1);
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.action).toBe('chapter_config_updated');
      expect(auditRow.diff.workflows.to).toHaveProperty('wf_advisor_digest');
      expect(auditRow.diff.workflows.to).not.toHaveProperty('wf_task_confirm');
    });

    it('ignores unknown workflow keys (no bare write)', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [{ key: 'wf_not_in_catalog', enabled: true }],
      });

      // Nothing changed → no upsert, no audit, returns existing config.
      expect(supabase.workflowUpsert).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — dues', () => {
  describe('getConfig', () => {
    it('returns the table defaults when the chapter has no dues row', async () => {
      const supabase = makeSupabase([], null);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.dues).toEqual({
        cadence: 'per_semester',
        active_amount_cents: 0,
        new_member_amount_cents: 0,
        alumni_amount_cents: 0,
        installments_allowed: false,
        installment_count: 1,
        late_fee_cents: 0,
        grace_days: 7,
        scholarship_pool_cents: 0,
      });
    });

    it('returns the persisted dues row when one exists', async () => {
      const supabase = makeSupabase([], {
        cadence: 'monthly',
        active_amount_cents: 85000,
        new_member_amount_cents: 42500,
        alumni_amount_cents: 0,
        installments_allowed: true,
        installment_count: 4,
        late_fee_cents: 2500,
        grace_days: 10,
        scholarship_pool_cents: 120000,
      });
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.dues).toMatchObject({
        cadence: 'monthly',
        active_amount_cents: 85000,
        installment_count: 4,
        grace_days: 10,
      });
    });
  });

  describe('patchConfig', () => {
    it('upserts the singleton dues row and audits the change', async () => {
      const supabase = makeSupabase([], null);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly', active_amount_cents: 50000 },
      });

      expect(supabase.duesUpsert).toHaveBeenCalledTimes(1);
      const [row, opts] = supabase.duesUpsert.mock.calls[0];
      // Provided fields applied; untouched fields fall back to the defaults.
      expect(row).toMatchObject({
        chapter_id: CHAPTER_ID,
        cadence: 'monthly',
        active_amount_cents: 50000,
        installment_count: 1,
      });
      expect(opts).toEqual({ onConflict: 'chapter_id' });

      // No chapters-table column changed, but the audit row still fires.
      expect(supabase.chapterUpdate).not.toHaveBeenCalled();
      expect(supabase.auditInsert).toHaveBeenCalledTimes(1);
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.diff.dues.to).toMatchObject({ cadence: 'monthly' });
    });

    it('is a no-op when the dues payload matches the current row', async () => {
      const supabase = makeSupabase([], {
        cadence: 'monthly',
        active_amount_cents: 50000,
        new_member_amount_cents: 0,
        alumni_amount_cents: 0,
        installments_allowed: false,
        installment_count: 1,
        late_fee_cents: 0,
        grace_days: 7,
        scholarship_pool_cents: 0,
      });
      const service = await buildService(supabase);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly', active_amount_cents: 50000 },
      });

      expect(supabase.duesUpsert).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — branding accent (#795)', () => {
  describe('patchConfig', () => {
    it('mirrors the branding accent into the legacy accent_color column', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // Two writes, not one: the config update, then a second from
      // `recomputePalette` persisting `theme_palette`. Any branding change
      // triggers that recompute, so the mirror has to ride on the first call.
      expect(supabase.chapterUpdate).toHaveBeenCalledTimes(2);
      const update = supabase.chapterUpdate.mock.calls[0][0];
      expect(update.accent_color).toBe('#8B0000');
      expect(update.branding).toMatchObject({ colors: { accent: '#8B0000' } });

      // The accent change is audited under `branding`, which is the
      // authoritative store. No separate `accent_color` entry: `getConfig` does
      // not select that column, so the only "before" value available here is
      // the branding accent — and on exactly the legacy rows this mirror exists
      // to repair, the two disagree. Recording it would put a value in the
      // audit log that the column never actually held.
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.diff).not.toHaveProperty('accent_color');
      expect(auditRow.diff.branding.to).toMatchObject({
        colors: { accent: '#8B0000' },
      });
    });

    it('persists the Signet map alone in theme_palette', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // The recompute is the second write. Since the #920 slice-9 cutover the
      // column holds one map: `derivePalette` is gone, so there is no second
      // half that could go stale against this one.
      const paletteUpdate = supabase.chapterUpdate.mock.calls[1][0];
      expect(paletteUpdate.theme_palette).toMatchObject({
        '--signet-accent-primary': '#C49A3A',
      });
      const written = Object.keys(
        paletteUpdate.theme_palette as Record<string, string>,
      );
      expect(written.length).toBeGreaterThan(0);
      expect(written.every((key) => key.startsWith('--signet-'))).toBe(true);
    });

    it('feeds the engine the branding accent, not a third read path', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // `chapters.accent_color` is a second source for the same fact and the
      // two can disagree; which one wins is open in #795. Until that lands the
      // engine must read `branding.colors.accent` and nothing else.
      const { deriveSignetPalette } = jest.requireMock(
        '@repo/chapter-theme',
      ) as { deriveSignetPalette: jest.Mock };
      expect(deriveSignetPalette).toHaveBeenCalledWith('#8B0000');
    });

    it('does not write the column for a branding PATCH that leaves the accent alone', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { greek_letters: 'ΦΓΔ' },
      });

      const update = supabase.chapterUpdate.mock.calls[0]?.[0] ?? {};
      expect(update).not.toHaveProperty('accent_color');
    });
  });
});

describe('ChapterConfigService — analytics opt-out', () => {
  describe('getConfig', () => {
    it('returns the chapter analytics_opt_out flag (defaulting off)', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.analytics_opt_out).toBe(false);
    });
  });

  describe('patchConfig', () => {
    it('updates the chapters column and audits the change', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        analytics_opt_out: true,
      });

      expect(supabase.chapterUpdate).toHaveBeenCalledTimes(1);
      expect(supabase.chapterUpdate).toHaveBeenCalledWith({
        analytics_opt_out: true,
      });
      expect(supabase.auditInsert).toHaveBeenCalledTimes(1);
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.action).toBe('chapter_config_updated');
      expect(auditRow.member_visible).toBe(true);
      expect(auditRow.diff.analytics_opt_out).toEqual({
        from: false,
        to: true,
      });
    });

    it('is a no-op when the flag already matches', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        analytics_opt_out: false,
      });

      expect(supabase.chapterUpdate).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — service hours', () => {
  describe('getConfig', () => {
    it('falls back to the 60 min/point default when the chapter has no row', async () => {
      // An absent row is the unconfigured state, not an error: it must report
      // the same rate the API awarded before the rate became configurable.
      const supabase = makeSupabase([], null, {}, null);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.service).toEqual({ minutes_per_point: 60 });
    });

    it('returns the chapter override when a row exists', async () => {
      const supabase = makeSupabase([], null, {}, { minutes_per_point: 30 });
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.service).toEqual({ minutes_per_point: 30 });
    });
  });

  describe('patchConfig', () => {
    it('upserts the rate and audits the change', async () => {
      const supabase = makeSupabase([], null, {}, null);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        service: { minutes_per_point: 45 },
      });

      expect(supabase.serviceUpsert).toHaveBeenCalledTimes(1);
      expect(supabase.serviceUpsert).toHaveBeenCalledWith(
        { chapter_id: CHAPTER_ID, minutes_per_point: 45 },
        { onConflict: 'chapter_id' },
      );
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.diff.service).toEqual({
        from: { minutes_per_point: 60 },
        to: { minutes_per_point: 45 },
      });
    });

    it('is a no-op when the rate already matches', async () => {
      const supabase = makeSupabase([], null, {}, { minutes_per_point: 30 });
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        service: { minutes_per_point: 30 },
      });

      expect(supabase.serviceUpsert).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
    });
  });
});

describe('ChapterConfigService — points anti-fraud limits (#394)', () => {
  const DEFAULTS = {
    adjustment_rate_limit_per_hour: 50,
    anomaly_threshold: 100,
  };

  describe('getConfig', () => {
    it('falls back to the defaults when the chapter has no row', async () => {
      // An absent row is the unconfigured state, not an error: it must report
      // the same limits PointsService enforced before they became
      // configurable, which is what makes this migration backfill-free.
      const supabase = makeSupabase([], null, {}, null, null);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.points).toEqual(DEFAULTS);
    });

    it('returns the chapter override when a row exists', async () => {
      const supabase = makeSupabase([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.points).toEqual({
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
    });
  });

  describe('patchConfig', () => {
    it('upserts both limits and audits the change', async () => {
      const supabase = makeSupabase([], null, {}, null, null);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });

      expect(supabase.pointsUpsert).toHaveBeenCalledTimes(1);
      expect(supabase.pointsUpsert).toHaveBeenCalledWith(
        {
          chapter_id: CHAPTER_ID,
          adjustment_rate_limit_per_hour: 10,
          anomaly_threshold: 250,
        },
        { onConflict: 'chapter_id' },
      );
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.diff.points).toEqual({
        from: DEFAULTS,
        to: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });
    });

    // A partial PATCH must not silently reset the limit it did not mention —
    // the merge is what makes each dial independently settable.
    it('merges a partial patch onto the untouched limit', async () => {
      const supabase = makeSupabase([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { anomaly_threshold: 500 },
      });

      expect(supabase.pointsUpsert).toHaveBeenCalledWith(
        {
          chapter_id: CHAPTER_ID,
          adjustment_rate_limit_per_hour: 10,
          anomaly_threshold: 500,
        },
        { onConflict: 'chapter_id' },
      );
    });

    it('is a no-op when both limits already match', async () => {
      const supabase = makeSupabase([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });

      expect(supabase.pointsUpsert).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
    });
  });
});

describe('ChapterConfigService — activation funnel (#267)', () => {
  it('records the milestone when a paid module flips off -> on', async () => {
    const supabase = makeSupabase([], null, { events: false });
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true },
    });

    expect(mockActivation.record).toHaveBeenCalledWith(
      CHAPTER_ID,
      'activation-first-paid-module-enabled',
      { module: 'events', modules_enabled: 1 },
    );
  });

  it('names the alphabetically-first module when a patch enables several', async () => {
    const supabase = makeSupabase([], null, { events: false, dues: false });
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true, dues: true },
    });

    expect(mockActivation.record).toHaveBeenCalledWith(
      CHAPTER_ID,
      'activation-first-paid-module-enabled',
      { module: 'dues', modules_enabled: 2 },
    );
  });

  it('ignores a free module being toggled', async () => {
    const supabase = makeSupabase([], null, { chat: false });
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { chat: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('ignores a paid module that was already on', async () => {
    const supabase = makeSupabase([], null, { events: true });
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  // `isModuleEnabled` treats an absent key as enabled, so a chapter created
  // before a module existed must not look like it just turned it on.
  it('ignores a paid module with no prior key', async () => {
    const supabase = makeSupabase([], null, {});
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('does not record when a paid module is turned off', async () => {
    const supabase = makeSupabase([], null, { events: true });
    const service = await buildService(supabase);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: false },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });
});
