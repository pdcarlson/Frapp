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
  // here: `buildChapterPalette` (chapter-palette.ts, not mocked) reads
  // `invalidSeed` and iterates `contrastChecks` and `fillChecks`.
  deriveSignetPalette: jest.fn(() => ({
    palette: { '--signet-accent-primary': '#C49A3A' },
    resolvedSeed: '#F2B72E',
    invalidSeed: false,
    fillChecks: [],
    contrastChecks: [
      {
        role: '--signet-accent-text',
        against: '#0E0D0B',
        ratio: 7.2,
        passes: true,
      },
    ],
  })),
  // The real constant, not a stand-in: a writer that dropped the stamp would
  // otherwise persist `undefined` here and still pass (#1165).
  SIGNET_ENGINE_VERSION: jest.requireActual<{ SIGNET_ENGINE_VERSION: number }>(
    '@repo/chapter-theme',
  ).SIGNET_ENGINE_VERSION,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  ChapterConfigService,
  mergeDefinedFields,
} from './chapter-config.service';
import { SERVICE_CONFIG_DEFAULTS } from './chapter-service-config.service';
import { POINTS_CONFIG_DEFAULTS } from './chapter-points-config.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { CHAPTER_CONFIG_REPOSITORY } from '#domain/repositories/chapter-config.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { ActivationService } from './activation.service';
import {
  ChapterAuditLogService,
  type AuditDiff,
} from './chapter-audit-log.service';
import { createAuditLogServiceMock } from '#test/helpers/audit-log.mock';
import { ChapterPointsConfigService } from './chapter-points-config.service';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';

// Read from the real package, not the mock above: compared against the mocked
// value, a mock that dropped the constant would make both sides `undefined`.
const { SIGNET_ENGINE_VERSION } = jest.requireActual<{
  SIGNET_ENGINE_VERSION: number;
}>('@repo/chapter-theme');

const CHAPTER_ID = 'ch-1';

type WorkflowRow = { key: string; enabled: boolean; threshold: number | null };

/**
 * Builds the three repositories `ChapterConfigService` reads and writes through
 * (`CHAPTER_REPOSITORY`, `CHAPTER_CONFIG_REPOSITORY`, `ROLE_REPOSITORY`). Reads
 * resolve the given rows, or reject with the `SupabaseQueryError` the real
 * repositories throw when a read error is injected. Writes are captured so
 * tests can assert on them.
 */
function makeRepos(
  workflowRows: WorkflowRow[],
  duesRow: Record<string, unknown> | null = null,
  enabledModules: Record<string, boolean> = {},
  serviceRow: Record<string, unknown> | null = null,
  pointsRow: Record<string, unknown> | null = null,
  // #422: the persisted default invite role, and what a `roles` lookup for a
  // candidate id resolves to. `roleLookupRow: null` models both "no such role"
  // and "belongs to another chapter" — the service filters on `chapter_id` in
  // the query, so those are the same answer by construction.
  options: {
    defaultInviteRoleId?: string | null;
    roleLookupRow?: { id: string } | null;
    roleLookupError?: {
      code?: string;
      message: string;
      details?: string;
      hint?: string;
    };
    // #1626: inject a transient read failure on any of getConfig's reads. The harness pinned `error: null` on all of them,
    // which is why nothing caught that a swallowed error was substituting
    // defaults for the chapter's real config and then writing them back.
    readErrors?: {
      workflows?: { message: string } | null;
      dues?: { message: string } | null;
      service?: { message: string } | null;
      // `points` is here even though ChapterConfigService does not read that
      // table directly: it routes through ChapterPointsConfigService's
      // getConfigOrThrow, the fail-closed precedent the other three now follow.
      // Without this key, rewriting that call as `.catch(() => DEFAULTS)` —
      // the exact #1626 bug, on the read whose whole reason for existing is to
      // fail closed — left all 46 tests green.
      points?: { message: string } | null;
      // The `chapters` read. Its bug was the same shape but reported through a
      // different door: `error || !chapter` answered 404, and a 404 emits no
      // error log, no security event and no Sentry capture.
      chapters?: { message: string } | null;
    };
    // 1-based read index that should fail. Static `readErrors` cannot
    // express "leading getConfig ok, trailing getConfig fail" (#1670).
    readErrorOnCall?: {
      chapters?: number;
      workflows?: number;
      dues?: number;
      service?: number;
      points?: number;
    };
    trailingReadError?: { message: string };
    // Model a chapter id that resolves to no row at all — the legitimate 404,
    // which must stay distinguishable from a failed read.
    chapterRowOverride?: null;
    // The branding a chapters read returns (default `{}`).
    chapterBranding?: Record<string, unknown>;
    // Whether the seed-guarded palette write lands (#1165). `false` is a lost
    // compare-and-set: the accent changed after it was read.
    paletteWritten?: boolean;
    paletteWriteError?: { message: string };
  } = {},
) {
  const readErrors = options.readErrors ?? {};
  const readCallCount = {
    chapters: 0,
    workflows: 0,
    dues: 0,
    service: 0,
    points: 0,
  };
  const trailingReadError = options.trailingReadError ?? {
    message: 'trailing read failed',
  };

  const resolveRead = <T>(
    table: keyof typeof readCallCount,
    data: T,
  ): Promise<T> => {
    readCallCount[table] += 1;
    const staticError = readErrors[table];
    if (staticError) {
      return Promise.reject(new SupabaseQueryError(staticError));
    }
    const nth = options.readErrorOnCall?.[table];
    if (nth != null && readCallCount[table] === nth) {
      return Promise.reject(new SupabaseQueryError(trailingReadError));
    }
    return Promise.resolve(data);
  };
  const chapterRow = {
    id: CHAPTER_ID,
    org_archetype: 'ifc',
    enabled_modules: enabledModules,
    vocabulary: {},
    branding: options.chapterBranding ?? {},
    theme_palette: {},
    beta_config: { enabled: true, style: 'sidebar_pill' },
    analytics_opt_out: false,
    default_invite_role_id: options.defaultInviteRoleId ?? null,
  };

  const workflowUpsert = jest.fn().mockResolvedValue(undefined);
  const duesUpsert = jest.fn().mockResolvedValue(undefined);
  const serviceUpsert = jest.fn().mockResolvedValue(undefined);
  const pointsUpsert = jest.fn().mockResolvedValue(undefined);
  const chapterUpdate = jest.fn().mockResolvedValue(chapterRow);
  const paletteWrite = options.paletteWriteError
    ? jest
        .fn()
        .mockRejectedValue(new SupabaseQueryError(options.paletteWriteError))
    : jest.fn().mockResolvedValue(options.paletteWritten ?? true);

  const chapterRepo = {
    findById: jest.fn(() =>
      resolveRead(
        'chapters',
        options.chapterRowOverride === null ? null : chapterRow,
      ),
    ),
    update: chapterUpdate,
    updatePaletteIfSeedUnchanged: paletteWrite,
  };
  const configRepo = {
    findWorkflows: jest.fn(() => resolveRead('workflows', workflowRows)),
    findDuesConfig: jest.fn(() => resolveRead('dues', duesRow)),
    findServiceConfig: jest.fn(() => resolveRead('service', serviceRow)),
    findPointsConfig: jest.fn(() => resolveRead('points', pointsRow)),
    upsertWorkflows: workflowUpsert,
    upsertDuesConfig: duesUpsert,
    upsertServiceConfig: serviceUpsert,
    upsertPointsConfig: pointsUpsert,
  };
  /*
   * Returns the role only when the lookup was scoped to this chapter, so a
   * service that stopped passing the chapter gets `[]` (a 400) on every
   * positive test below, and the call-shape test "scopes the role lookup by
   * chapter_id" fails by name. The cross-chapter 400 test cannot catch that
   * on its own: its fixture has no matching role, so it answers `[]` either
   * way. (Before #3220 this was a Supabase builder mock recording its `.eq`
   * filters, for the same reason.)
   */
  const roleRepo = {
    findByIds: jest.fn((ids: string[], chapterId?: string) => {
      if (options.roleLookupError) {
        return Promise.reject(new SupabaseQueryError(options.roleLookupError));
      }
      const row = options.roleLookupRow ?? null;
      const scoped = chapterId === CHAPTER_ID && ids.length > 0;
      return Promise.resolve(scoped && row ? [row] : []);
    }),
  };

  return {
    chapterRepo,
    configRepo,
    roleRepo,
    workflowUpsert,
    duesUpsert,
    serviceUpsert,
    pointsUpsert,
    chapterUpdate,
    paletteWrite,
  };
}

type Repos = ReturnType<typeof makeRepos>;

/**
 * Shared across the file: `buildService` is module-scope, so the activation
 * mock is too. Reset in `beforeEach` so per-test assertions on the paid-module
 * milestone don't see a previous test's calls.
 */
const mockActivation: jest.Mocked<Pick<ActivationService, 'record'>> = {
  record: jest.fn().mockResolvedValue(true),
};

/**
 * The one audit writer (#2167). The row this produces — `scope`,
 * `member_visible`, the `target_id`/`diff` defaults, and the rethrow on a
 * failed write — is asserted in `chapter-audit-log.service.spec.ts`; here we
 * assert what this service asks for.
 */
const mockAuditLog = createAuditLogServiceMock();

beforeEach(() => {
  mockActivation.record.mockClear();
  mockAuditLog.record.mockClear();
});

async function buildService(repos: Repos) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterConfigService,
      // The real service, not a double: it only needs the config repository,
      // which the stub above already provides, and wiring it for real means
      // these specs exercise the per-field clamp the config endpoint now
      // shares with enforcement rather than asserting against a mock that
      // cannot drift.
      ChapterPointsConfigService,
      { provide: CHAPTER_REPOSITORY, useValue: repos.chapterRepo },
      { provide: CHAPTER_CONFIG_REPOSITORY, useValue: repos.configRepo },
      { provide: ROLE_REPOSITORY, useValue: repos.roleRepo },
      { provide: ActivationService, useValue: mockActivation },
      { provide: ChapterAuditLogService, useValue: mockAuditLog },
    ],
  }).compile();
  return module.get(ChapterConfigService);
}

describe('ChapterConfigService — workflows', () => {
  describe('getConfig', () => {
    it('returns the seed catalog when the chapter has no overrides', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

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
      const repos = makeRepos([
        { key: 'wf_budget_approval', enabled: true, threshold: 1000 },
        { key: 'wf_advisor_digest', enabled: true, threshold: null },
      ]);
      const service = await buildService(repos);

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
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [
          { key: 'wf_advisor_digest', enabled: true }, // false -> true
          { key: 'wf_task_confirm', enabled: true }, // unchanged (seed true)
        ],
      });

      // Only the changed workflow is upserted.
      expect(repos.workflowUpsert).toHaveBeenCalledTimes(1);
      const [rows] = repos.workflowUpsert.mock.calls[0];
      expect(rows).toEqual([
        {
          chapter_id: CHAPTER_ID,
          key: 'wf_advisor_digest',
          enabled: true,
          threshold: null,
        },
      ]);

      // No chapters-table column changed, so it is never updated...
      expect(repos.chapterUpdate).not.toHaveBeenCalled();
      // ...but the audit row still fires, carrying the workflows diff.
      expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect(auditRow.action).toBe('chapter_config_updated');
      expect((auditRow.diff as AuditDiff).workflows.to).toHaveProperty(
        'wf_advisor_digest',
      );
      expect((auditRow.diff as AuditDiff).workflows.to).not.toHaveProperty(
        'wf_task_confirm',
      );
    });

    it('ignores unknown workflow keys (no bare write)', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [{ key: 'wf_not_in_catalog', enabled: true }],
      });

      // Nothing changed → no upsert, no audit, returns existing config.
      expect(repos.workflowUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — dues', () => {
  describe('getConfig', () => {
    it('returns the table defaults when the chapter has no dues row', async () => {
      const repos = makeRepos([], null);
      const service = await buildService(repos);

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
      const repos = makeRepos([], {
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
      const service = await buildService(repos);

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
      const repos = makeRepos([], null);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly', active_amount_cents: 50000 },
      });

      expect(repos.duesUpsert).toHaveBeenCalledTimes(1);
      const [chapterId, row] = repos.duesUpsert.mock.calls[0];
      // Provided fields applied; untouched fields fall back to the defaults.
      expect(chapterId).toBe(CHAPTER_ID);
      expect(row).toMatchObject({
        cadence: 'monthly',
        active_amount_cents: 50000,
        installment_count: 1,
      });

      // No chapters-table column changed, but the audit row still fires.
      expect(repos.chapterUpdate).not.toHaveBeenCalled();
      expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect((auditRow.diff as AuditDiff).dues.to).toMatchObject({
        cadence: 'monthly',
      });
    });

    it('is a no-op when the dues payload matches the current row', async () => {
      const repos = makeRepos([], {
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
      const service = await buildService(repos);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly', active_amount_cents: 50000 },
      });

      expect(repos.duesUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — branding accent (#795)', () => {
  describe('patchConfig', () => {
    it('mirrors the branding accent into the legacy accent_color column', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // Two writes, not one: the config update, then a second from
      // `recomputePalette` persisting `theme_palette`. Any branding change
      // triggers that recompute, so the mirror has to ride on the first call.
      expect(repos.chapterUpdate).toHaveBeenCalledTimes(1);
      expect(repos.paletteWrite).toHaveBeenCalledTimes(1);
      const [chapterId, update] = repos.chapterUpdate.mock.calls[0];
      expect(chapterId).toBe(CHAPTER_ID);
      expect(update.accent_color).toBe('#8B0000');
      expect(update.branding).toMatchObject({ colors: { accent: '#8B0000' } });

      // The accent change is audited under `branding`, which is the
      // authoritative store. No separate `accent_color` entry: `getConfig` does
      // not select that column, so the only "before" value available here is
      // the branding accent — and on exactly the legacy rows this mirror exists
      // to repair, the two disagree. Recording it would put a value in the
      // audit log that the column never actually held.
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect(auditRow.diff).not.toHaveProperty('accent_color');
      expect((auditRow.diff as AuditDiff).branding.to).toMatchObject({
        colors: { accent: '#8B0000' },
      });
    });

    it('persists the Signet map alone in theme_palette', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // The recompute is the second write. Since the #920 slice-9 cutover the
      // column holds one map: `derivePalette` is gone, so there is no second
      // half that could go stale against this one.
      const [, paletteUpdate] = repos.paletteWrite.mock.calls[0];
      expect(paletteUpdate.theme_palette).toMatchObject({
        '--signet-accent-primary': '#C49A3A',
      });
      const written = Object.keys(
        paletteUpdate.theme_palette as Record<string, string>,
      );
      expect(written.length).toBeGreaterThan(0);
      expect(written.every((key) => key.startsWith('--signet-'))).toBe(true);
    });

    it('clears the engine stamp in the same write as a new branding seed (#1165)', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // The branding write goes first and the palette write second, and the
      // second can fail on its own. Nulling the stamp with the seed means a
      // failed recompute leaves the row for the stale-palette sweep instead of
      // under a current stamp the sweep never looks at.
      const [, brandingWrite] = repos.chapterUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(brandingWrite.branding).toBeDefined();
      expect(brandingWrite).toHaveProperty(
        'theme_palette_engine_version',
        null,
      );
    });

    it('re-derives the palette on a branding PATCH that carries no colours too', async () => {
      const repos = makeRepos([], null, {}, null, null, {
        chapterBranding: { colors: { accent: '#2F6B4F' } },
      });
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { greek_letters: 'ΑΒ' },
      });

      // The write stores the whole merged branding as read, accent included,
      // so it can put an older seed back under a palette an accent save
      // stamped in between. It clears the stamp with that seed, and the
      // recompute re-derives from the seed it stored, guarded on it.
      const [, write] = repos.chapterUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(write.branding).toBeDefined();
      expect(write).toHaveProperty('theme_palette_engine_version', null);
      expect(repos.paletteWrite).toHaveBeenCalledTimes(1);
      expect(repos.paletteWrite).toHaveBeenCalledWith(
        CHAPTER_ID,
        expect.anything(),
        '#2F6B4F',
      );
    });

    it('leaves the engine stamp alone on a PATCH that writes no branding', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        vocabulary: { member: 'Brother' },
      });

      const [, write] = repos.chapterUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(write).not.toHaveProperty('theme_palette_engine_version');
    });

    it('writes the palette only while the seed it was derived from is still stored', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // The same compare-and-set the stale-palette sweep uses: a Settings save
      // landing between the read and this write must not be overwritten.
      expect(repos.paletteWrite).toHaveBeenCalledWith(
        CHAPTER_ID,
        expect.anything(),
        '#8B0000',
      );
    });

    it('guards a chapter with no accent on the accent still being absent', async () => {
      const repos = makeRepos([], null, {}, null, null, {
        chapterBranding: {},
      });
      const service = await buildService(repos);

      await service.recomputeAndPersistPalette(CHAPTER_ID);

      // The repository guards on `is null` for an absent seed; `eq(null)`
      // would compile to `= null`, which matches nothing.
      expect(repos.paletteWrite).toHaveBeenCalledWith(
        CHAPTER_ID,
        expect.anything(),
        undefined,
      );
    });

    it('treats a lost compare-and-set as superseded, not as a failure', async () => {
      const repos = makeRepos([], null, {}, null, null, {
        chapterBranding: { colors: { accent: '#8B0000' } },
        paletteWritten: false,
      });
      const service = await buildService(repos);
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await service.recomputeAndPersistPalette(CHAPTER_ID);

      expect(result.palette).toBeDefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'not written: its accent changed after it was read',
        ),
      );
    });

    it('stamps the palette with the engine that wrote it, through both doors (#1165)', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });
      await service.recomputeAndPersistPalette(CHAPTER_ID);

      // The config PATCH and `POST /v1/chapters/:id/theme-palette`. A palette
      // written without its stamp reads as stale to the hourly sweep, and a
      // stamp without its palette would hide a stale fill from it for good, so
      // the two go in the same write.
      const paletteWrites = (
        repos.paletteWrite.mock.calls as Array<
          [string, Record<string, unknown>, string | undefined]
        >
      ).map(([, patch]) => patch);
      expect(paletteWrites).toHaveLength(2);
      for (const patch of paletteWrites) {
        expect(patch.theme_palette_engine_version).toBe(SIGNET_ENGINE_VERSION);
      }
    });

    it('recompute logs a failed fill floor and does not return it (#2541)', async () => {
      // `POST /v1/chapters/:id/theme-palette` returns the build. Spreading it
      // sent `failedFillChecks`, which only a broken lift causes, to the
      // client; the route picks what it discloses instead.
      const { deriveSignetPalette } = jest.requireMock<{
        deriveSignetPalette: jest.Mock;
      }>('@repo/chapter-theme');
      deriveSignetPalette.mockReturnValueOnce({
        palette: { '--signet-accent-primary': '#8B0000' },
        resolvedSeed: '#8B0000',
        invalidSeed: false,
        fillChecks: [
          {
            role: '--signet-accent-primary',
            against: '--popover',
            ratio: 1.5,
            passes: false,
          },
        ],
        contrastChecks: [],
      });
      const repos = makeRepos([]);
      const service = await buildService(repos);
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await service.recomputeAndPersistPalette(CHAPTER_ID);

      expect(result).toEqual({
        palette: { '--signet-accent-primary': '#8B0000' },
        invalidSeed: false,
        failedContrastChecks: [],
      });
      expect(warn).toHaveBeenCalledWith(
        `Signet accent fill below 3:1 for chapter ${CHAPTER_ID}: --signet-accent-primary on --popover = 1.50:1`,
      );
    });

    it('logs only the fill checks that failed, and nothing when all pass', async () => {
      // The engine reports a check for every ladder surface, passing or not;
      // only the failures belong in the log, or every save would log a fill
      // warning naming all four surfaces and bury the one a broken lift raises.
      const { deriveSignetPalette } = jest.requireMock<{
        deriveSignetPalette: jest.Mock;
      }>('@repo/chapter-theme');
      const fillCheck = (against: string, ratio: number) => ({
        role: '--signet-accent-primary',
        against,
        ratio,
        passes: ratio >= 3,
      });
      const base = {
        palette: { '--signet-accent-primary': '#C34437' },
        resolvedSeed: '#8B0000',
        invalidSeed: false,
        contrastChecks: [],
      };
      deriveSignetPalette
        .mockReturnValueOnce({
          ...base,
          fillChecks: [
            fillCheck('--background', 4.1),
            fillCheck('--popover', 2.9),
          ],
        })
        .mockReturnValueOnce({
          ...base,
          fillChecks: [
            fillCheck('--background', 4.1),
            fillCheck('--popover', 3.01),
          ],
        });
      const repos = makeRepos([]);
      const service = await buildService(repos);
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      await service.recomputeAndPersistPalette(CHAPTER_ID);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        `Signet accent fill below 3:1 for chapter ${CHAPTER_ID}: --signet-accent-primary on --popover = 2.90:1`,
      );

      warn.mockClear();
      await service.recomputeAndPersistPalette(CHAPTER_ID);
      expect(warn).not.toHaveBeenCalled();
    });

    it('never logs a failing ratio as its floor', async () => {
      // The engine fails a check on the unrounded ratio; `toFixed(2)` logged a
      // 4.4954 as "4.50:1" under "below AA", and would log a 2.996 fill as
      // "3.00:1" under "below 3:1". Both lines truncate.
      const { deriveSignetPalette } = jest.requireMock<{
        deriveSignetPalette: jest.Mock;
      }>('@repo/chapter-theme');
      deriveSignetPalette.mockReturnValueOnce({
        palette: { '--signet-accent-primary': '#0086FE' },
        resolvedSeed: '#0086FE',
        invalidSeed: false,
        fillChecks: [
          {
            role: '--signet-accent-primary',
            against: '--popover',
            ratio: 2.996,
            passes: false,
          },
        ],
        contrastChecks: [
          {
            role: '--signet-accent-text',
            against: '#131211',
            ratio: 4.4954,
            passes: false,
          },
        ],
      });
      const repos = makeRepos([]);
      const service = await buildService(repos);
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      await service.recomputeAndPersistPalette(CHAPTER_ID);

      expect(warn).toHaveBeenCalledWith(
        `Signet accent contrast below AA for chapter ${CHAPTER_ID}: --signet-accent-text on #131211 = 4.49:1`,
      );
      expect(warn).toHaveBeenCalledWith(
        `Signet accent fill below 3:1 for chapter ${CHAPTER_ID}: --signet-accent-primary on --popover = 2.99:1`,
      );
    });

    it('feeds the engine the branding accent, not a third read path', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { colors: { accent: '#8B0000' } },
      });

      // `chapters.accent_color` is a second source for the same fact and the
      // two can disagree; which one wins is open in #795. Until that lands the
      // engine must read `branding.colors.accent` and nothing else.
      const { deriveSignetPalette } = jest.requireMock<{
        deriveSignetPalette: jest.Mock;
      }>('@repo/chapter-theme');
      expect(deriveSignetPalette).toHaveBeenCalledWith('#8B0000');
    });

    it('does not write the column for a branding PATCH that leaves the accent alone', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        branding: { greek_letters: 'ΦΓΔ' },
      });

      const update = repos.chapterUpdate.mock.calls[0]?.[1] ?? {};
      expect(update).not.toHaveProperty('accent_color');
    });
  });
});

describe('ChapterConfigService — analytics opt-out', () => {
  describe('getConfig', () => {
    it('returns the chapter analytics_opt_out flag (defaulting off)', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.analytics_opt_out).toBe(false);
    });
  });

  describe('patchConfig', () => {
    it('updates the chapters column and audits the change', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        analytics_opt_out: true,
      });

      expect(repos.chapterUpdate).toHaveBeenCalledTimes(1);
      expect(repos.chapterUpdate).toHaveBeenCalledWith(CHAPTER_ID, {
        analytics_opt_out: true,
      });
      expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect(auditRow.action).toBe('chapter_config_updated');
      // `memberVisible` is left unset so `record`'s default (true) applies;
      // the row value itself is pinned in chapter-audit-log.service.spec.ts.
      expect(auditRow.memberVisible).toBeUndefined();
      expect((auditRow.diff as AuditDiff).analytics_opt_out).toEqual({
        from: false,
        to: true,
      });
    });

    it('is a no-op when the flag already matches', async () => {
      const repos = makeRepos([]);
      const service = await buildService(repos);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        analytics_opt_out: false,
      });

      expect(repos.chapterUpdate).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

describe('ChapterConfigService — service hours', () => {
  describe('getConfig', () => {
    it('falls back to the 60 min/point default when the chapter has no row', async () => {
      // An absent row is the unconfigured state, not an error: it must report
      // the same rate the API awarded before the rate became configurable.
      const repos = makeRepos([], null, {}, null);
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.service).toEqual({ minutes_per_point: 60 });
    });

    it('returns the chapter override when a row exists', async () => {
      const repos = makeRepos([], null, {}, { minutes_per_point: 30 });
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.service).toEqual({ minutes_per_point: 30 });
    });
  });

  describe('patchConfig', () => {
    it('upserts the rate and audits the change', async () => {
      const repos = makeRepos([], null, {}, null);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        service: { minutes_per_point: 45 },
      });

      expect(repos.serviceUpsert).toHaveBeenCalledTimes(1);
      expect(repos.serviceUpsert).toHaveBeenCalledWith(CHAPTER_ID, {
        minutes_per_point: 45,
      });
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect((auditRow.diff as AuditDiff).service).toEqual({
        from: { minutes_per_point: 60 },
        to: { minutes_per_point: 45 },
      });
    });

    it('is a no-op when the rate already matches', async () => {
      const repos = makeRepos([], null, {}, { minutes_per_point: 30 });
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        service: { minutes_per_point: 30 },
      });

      expect(repos.serviceUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
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
      const repos = makeRepos([], null, {}, null, null);
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.points).toEqual(DEFAULTS);
    });

    it('returns the chapter override when a row exists', async () => {
      const repos = makeRepos([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.points).toEqual({
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
    });
  });

  describe('patchConfig', () => {
    it('upserts both limits and audits the change', async () => {
      const repos = makeRepos([], null, {}, null, null);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });

      expect(repos.pointsUpsert).toHaveBeenCalledTimes(1);
      expect(repos.pointsUpsert).toHaveBeenCalledWith(CHAPTER_ID, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const auditRow = mockAuditLog.record.mock.calls[0][0];
      expect((auditRow.diff as AuditDiff).points).toEqual({
        from: DEFAULTS,
        to: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });
    });

    // A partial PATCH must not silently reset the limit it did not mention —
    // the merge is what makes each dial independently settable.
    it('merges a partial patch onto the untouched limit', async () => {
      const repos = makeRepos([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { anomaly_threshold: 500 },
      });

      expect(repos.pointsUpsert).toHaveBeenCalledWith(CHAPTER_ID, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 500,
      });
    });

    it('is a no-op when both limits already match', async () => {
      const repos = makeRepos([], null, {}, null, {
        adjustment_rate_limit_per_hour: 10,
        anomaly_threshold: 250,
      });
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        points: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      });

      expect(repos.pointsUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });
  });
});

describe('ChapterConfigService — activation funnel (#267)', () => {
  it('records the milestone when a paid module flips off -> on', async () => {
    const repos = makeRepos([], null, { events: false });
    const service = await buildService(repos);

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
    const repos = makeRepos([], null, { events: false, dues: false });
    const service = await buildService(repos);

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
    const repos = makeRepos([], null, { chat: false });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { chat: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('ignores a paid module that was already on', async () => {
    const repos = makeRepos([], null, { events: true });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  // `isModuleEnabled` treats an absent key as enabled, so a chapter created
  // before a module existed must not look like it just turned it on.
  it('ignores a paid module with no prior key', async () => {
    const repos = makeRepos([], null, {});
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: true },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('does not record when a paid module is turned off', async () => {
    const repos = makeRepos([], null, { events: true });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      enabled_modules: { events: false },
    });

    expect(mockActivation.record).not.toHaveBeenCalled();
  });
});

/**
 * #422. `default_invite_role_id` is a nullable scalar FK on the chapters row.
 * The database FK proves the role exists; only this service can prove it is
 * *this* chapter's, so that check is the one worth pinning.
 */
describe('ChapterConfigService default invite role (#422)', () => {
  it('returns the persisted default from getConfig', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      defaultInviteRoleId: 'role-pledge',
    });
    const service = await buildService(repos);

    const config = await service.getConfig(CHAPTER_ID);

    expect(config.default_invite_role_id).toBe('role-pledge');
  });

  it('reports null when no default is configured', async () => {
    const repos = makeRepos([], null, {}, null, null, {});
    const service = await buildService(repos);

    const config = await service.getConfig(CHAPTER_ID);

    expect(config.default_invite_role_id).toBeNull();
  });

  it('persists a role that belongs to the chapter', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupRow: { id: 'role-pledge' },
    });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      default_invite_role_id: 'role-pledge',
    });

    expect(repos.chapterUpdate).toHaveBeenCalledWith(
      CHAPTER_ID,
      expect.objectContaining({ default_invite_role_id: 'role-pledge' }),
    );
  });

  /*
   * The tenant-isolation case. RLS is enabled with no permissive policies and
   * the API holds the service-role key, so a cross-chapter id would otherwise
   * persist happily and then resolve to another chapter's role name on every
   * subsequent invite.
   */
  it('rejects a role from another chapter with 400', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupRow: null,
    });
    const service = await buildService(repos);

    await expect(
      service.patchConfig(CHAPTER_ID, 'user-1', {
        default_invite_role_id: 'role-elsewhere',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repos.chapterUpdate).not.toHaveBeenCalled();
  });

  /*
   * Guards the guard. If `assertRoleBelongsToChapter` ever stops passing the
   * chapter, this fails immediately and by name. The cross-chapter test above
   * cannot: its fixture has no matching role in any chapter.
   */
  it('scopes the role lookup by chapter_id, not just by id', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupRow: { id: 'role-pledge' },
    });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      default_invite_role_id: 'role-pledge',
    });

    expect(repos.roleRepo.findByIds).toHaveBeenCalledWith(
      ['role-pledge'],
      CHAPTER_ID,
    );
  });

  it('rejects a role id that does not exist with 400', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupRow: null,
    });
    const service = await buildService(repos);

    await expect(
      service.patchConfig(CHAPTER_ID, 'user-1', {
        default_invite_role_id: 'role-missing',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  /*
   * Clearing is a real operation, not a no-op: null returns invites to the
   * seeded Member fallback. It must skip validation — there is no role to
   * validate — and must still reach the update, which is why `patchConfig`
   * keys this branch on `!== undefined` rather than truthiness.
   */
  it('clears the default without validating, when passed null', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      defaultInviteRoleId: 'role-pledge',
      roleLookupRow: null,
    });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      default_invite_role_id: null,
    });

    expect(repos.chapterUpdate).toHaveBeenCalledWith(
      CHAPTER_ID,
      expect.objectContaining({ default_invite_role_id: null }),
    );
  });

  it('audits the change like every other config write', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupRow: { id: 'role-pledge' },
    });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      default_invite_role_id: 'role-pledge',
    });

    expect(mockAuditLog.record).toHaveBeenCalled();
  });

  it('is a no-op when the value is unchanged', async () => {
    const repos = makeRepos([], null, {}, null, null, {
      defaultInviteRoleId: 'role-pledge',
      roleLookupRow: { id: 'role-pledge' },
    });
    const service = await buildService(repos);

    await service.patchConfig(CHAPTER_ID, 'user-1', {
      default_invite_role_id: 'role-pledge',
    });

    expect(repos.chapterUpdate).not.toHaveBeenCalled();
  });

  it('does not log PostgREST details when the default-invite-role lookup fails (#1669)', async () => {
    const details =
      'Key (email)=(alice@example.com) is not present in table "users".';
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const repos = makeRepos([], null, {}, null, null, {
      roleLookupError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details,
        hint: 'Check the role id.',
      },
    });
    const service = await buildService(repos);

    try {
      const thrown: unknown = await service
        .patchConfig(CHAPTER_ID, 'user-1', {
          default_invite_role_id: 'role-pledge',
        })
        .catch((error: unknown) => error);
      // Thrown as the wrapper (#1264): the code survives, the row values in
      // `details` never leave the query site.
      expect(thrown).toBeInstanceOf(SupabaseQueryError);
      expect(thrown).toMatchObject({ code: 'PGRST116' });
      expect(thrown).not.toHaveProperty('details');

      expect(errorSpy).toHaveBeenCalled();
      const printed = errorSpy.mock.calls
        .map((args) =>
          args.map((arg) =>
            typeof arg === 'string' ? arg : JSON.stringify(arg),
          ),
        )
        .flat()
        .join('\n');
      expect(printed).toContain('Failed to validate default invite role');
      expect(printed).toContain('PGRST116');
      expect(printed).not.toContain('alice@example.com');
      // The thrown value is a real `SupabaseQueryError` now (the repository
      // wraps it), so `logThrowable` may hand Nest its stack string as the
      // second argument. Never an object: that is what would be inspected.
      expect(
        errorSpy.mock.calls.every((args) =>
          args.slice(1).every((arg) => typeof arg === 'string'),
        ),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ── Read errors must not become defaults (#1626) ─────────────────────────────
//
// getConfig reads four things. The `chapters` read throws; the other three
// destructured only `data` and discarded `error`. Because `data` is null on
// both "no row yet" and "read failed", a transient PostgREST/network failure
// was indistinguishable from an unconfigured chapter and returned defaults
// with a 200.
//
// That alone would be a display bug. `patchConfig` uses getConfig's result as
// the prior state it merges a PATCH onto and then upserts the WHOLE row, which
// is what turns it into data loss. Measured against the pre-fix code, a
// swallowed dues read plus a cadence-only PATCH wrote:
//   {cadence:'monthly', active_amount_cents:0, new_member_amount_cents:0,
//    alumni_amount_cents:0, late_fee_cents:0, scholarship_pool_cents:0}
// over a chapter configured at 75000/90000/5000/2500/10000, and recorded an
// audit `from` of all zeros — a prior state the chapter never held, so the
// audit log could not be used to reconstruct what was lost.
//
// The points read three lines below getConfig's dues read already failed
// closed for exactly this reason; dues, service and workflows did not.

describe('ChapterConfigService — a failed read is never a default (#1626)', () => {
  const READ_ERROR = { message: 'connection terminated unexpectedly' };

  const CONFIGURED_DUES = {
    cadence: 'semester',
    active_amount_cents: 75000,
    new_member_amount_cents: 90000,
    alumni_amount_cents: 5000,
    late_fee_cents: 2500,
    scholarship_pool_cents: 10000,
    installment_count: 2,
  };

  describe('getConfig', () => {
    it.each([
      ['workflows', { workflows: READ_ERROR }],
      ['dues', { dues: READ_ERROR }],
      ['service', { service: READ_ERROR }],
    ])('throws when the %s read fails', async (_label, readErrors) => {
      const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
        readErrors,
      });
      const service = await buildService(repos);

      await expect(service.getConfig(CHAPTER_ID)).rejects.toMatchObject({
        message: READ_ERROR.message,
      });
    });

    it('still returns the real defaults when the chapter simply has no rows', async () => {
      // The other half of the contract, and why this cannot be `if (!data)
      // throw`: an unconfigured chapter is a legitimate success-with-defaults.
      //
      // Asserted against the real default objects, not `toBeDefined()` — a
      // presence check passes for any non-throwing implementation, which is
      // what the first draft of this test did. The per-field defaults are
      // covered more strictly by the dues/service/points/workflows suites
      // above (they compare against literals, which is what actually catches
      // drift from the migration). Dues is deliberately not re-asserted here —
      // its literal test is the drift detector, and a second copy would just be
      // another thing to update. What this adds is that service, points and
      // workflows all survive the SAME call rather than each in isolation.
      const repos = makeRepos([]);
      const service = await buildService(repos);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.service).toMatchObject(SERVICE_CONFIG_DEFAULTS);
      expect(config.points).toMatchObject(POINTS_CONFIG_DEFAULTS);
      expect(config.workflows.length).toBeGreaterThan(0);
    });

    it('reports a failed chapters read as an error, not as a missing chapter', async () => {
      // `error || !chapter` answered 404 for both. That is the same
      // error-is-absence bug, through the quietest door in the filter: a <500
      // goes to recordSecurityEvent, which only knows 401/403/429, so a
      // PostgREST schema-cache reload would have turned every config read into
      // a silent 404 on a live chapter with nothing in Sentry.
      const repos = makeRepos([], null, {}, null, null, {
        readErrors: { chapters: READ_ERROR },
      });
      const service = await buildService(repos);

      const err: unknown = await service.getConfig(CHAPTER_ID).catch((e) => e);
      expect(err).toMatchObject({ message: READ_ERROR.message });
      expect(err).not.toBeInstanceOf(NotFoundException);
    });

    it('still reports a genuinely missing chapter as 404', async () => {
      const repos = makeRepos([], null, {}, null, null, {
        chapterRowOverride: null,
      });
      const service = await buildService(repos);

      await expect(service.getConfig(CHAPTER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('recomputeAndPersistPalette reports a failed chapters read as an error too', async () => {
      // Same controller, same `chapter-config:manage`, same collapse. Fixing
      // only getConfig would have left Save-accent with the identical
      // invisible 404 the comment above declares a bug.
      const repos = makeRepos([], null, {}, null, null, {
        readErrors: { chapters: READ_ERROR },
      });
      const service = await buildService(repos);

      const err: unknown = await service
        .recomputeAndPersistPalette(CHAPTER_ID)
        .catch((e) => e);
      expect(err).toMatchObject({ message: READ_ERROR.message });
      expect(err).not.toBeInstanceOf(NotFoundException);
    });

    it('recomputeAndPersistPalette still reports a genuinely missing chapter as 404', async () => {
      // The palette twin of the 404 branch. Without this, deleting its
      // NotFoundException leaves the method dying on the `branding` read as a
      // 500 instead — a worse status with no test to notice.
      const repos = makeRepos([], null, {}, null, null, {
        chapterRowOverride: null,
      });
      const service = await buildService(repos);

      await expect(
        service.recomputeAndPersistPalette(CHAPTER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the points read fails, via getConfigOrThrow', async () => {
      // The precedent read. It is not one of the three this issue names, but it
      // is the one the fix is modelled on, and nothing pinned it.
      const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
        readErrors: { points: READ_ERROR },
      });
      const service = await buildService(repos);

      await expect(service.getConfig(CHAPTER_ID)).rejects.toMatchObject({
        message: READ_ERROR.message,
      });
    });
  });

  describe('patchConfig', () => {
    it('cannot zero a configured chapter through a swallowed dues read error', async () => {
      const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
        readErrors: { dues: READ_ERROR },
      });
      const service = await buildService(repos);

      await expect(
        service.patchConfig(CHAPTER_ID, 'user-1', {
          dues: { cadence: 'monthly' },
        }),
      ).rejects.toMatchObject({ message: READ_ERROR.message });

      // The point of the test: nothing was written, so nothing was lost, and
      // no audit row claims a `from` the chapter never held.
      expect(repos.duesUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('cannot reset minutes_per_point through a swallowed service read error', async () => {
      const repos = makeRepos(
        [],
        CONFIGURED_DUES,
        {},
        { minutes_per_point: 45 },
        null,
        { readErrors: { service: READ_ERROR } },
      );
      const service = await buildService(repos);

      await expect(
        service.patchConfig(CHAPTER_ID, 'user-1', {
          service: { minutes_per_point: 30 },
        }),
      ).rejects.toMatchObject({ message: READ_ERROR.message });

      expect(repos.serviceUpsert).not.toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('still applies a partial dues PATCH when the read succeeds', async () => {
      // Non-vacuity guard: proves the two tests above fail for the read error,
      // not because this harness cannot write at all.
      const repos = makeRepos([], CONFIGURED_DUES);
      const service = await buildService(repos);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly' },
      });

      expect(repos.duesUpsert).toHaveBeenCalledTimes(1);
      const [, row] = repos.duesUpsert.mock.calls[0];
      // The five amounts survive; only cadence changed.
      expect(row).toMatchObject({
        cadence: 'monthly',
        active_amount_cents: 75000,
        new_member_amount_cents: 90000,
        alumni_amount_cents: 5000,
        late_fee_cents: 2500,
        scholarship_pool_cents: 10000,
      });
    });
  });
});

// ── Trailing getConfig cannot fail a committed PATCH (#1670) ─────────────────
//
// patchConfig used to `return this.getConfig(chapterId)` after the writes and
// the audit row. getConfig fails closed (#1626), so a transient trailing
// read turned a durable PATCH into HTTP 500. The client then rolled the
// optimistic cache back while `#chapter-audit` showed a change the officer
// believed had not happened.
//
// Static `readErrors` fail every select of that table, so they can only
// pin the leading read. `readErrorOnCall` is 1-based: 1 = leading (must
// still fail closed), 2 = trailing (must not fail the request).

describe('ChapterConfigService — trailing getConfig cannot fail a committed PATCH (#1670)', () => {
  const TRAILING = { message: 'trailing connection terminated' };
  const CONFIGURED_DUES = {
    cadence: 'semester',
    active_amount_cents: 75000,
    new_member_amount_cents: 90000,
    alumni_amount_cents: 5000,
    late_fee_cents: 2500,
    scholarship_pool_cents: 10000,
    installment_count: 2,
  };

  it('returns the merged dues row when only the trailing dues read fails', async () => {
    const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
      readErrorOnCall: { dues: 2 },
      trailingReadError: TRAILING,
    });
    const service = await buildService(repos);

    const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
      dues: { cadence: 'monthly' },
    });

    expect(repos.duesUpsert).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
    expect(result.dues).toMatchObject({
      cadence: 'monthly',
      active_amount_cents: 75000,
      new_member_amount_cents: 90000,
      alumni_amount_cents: 5000,
      late_fee_cents: 2500,
      scholarship_pool_cents: 10000,
    });
  });

  it('returns the merged service row when only the trailing service read fails', async () => {
    const repos = makeRepos(
      [],
      CONFIGURED_DUES,
      {},
      { minutes_per_point: 45 },
      null,
      {
        readErrorOnCall: { service: 2 },
        trailingReadError: TRAILING,
      },
    );
    const service = await buildService(repos);

    const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
      service: { minutes_per_point: 30 },
    });

    expect(repos.serviceUpsert).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
    expect(result.service).toMatchObject({ minutes_per_point: 30 });
  });

  it('returns the merged points row when only the trailing points read fails', async () => {
    const repos = makeRepos(
      [],
      CONFIGURED_DUES,
      {},
      null,
      { adjustment_rate_limit_per_hour: 20, anomaly_threshold: 400 },
      {
        readErrorOnCall: { points: 2 },
        trailingReadError: TRAILING,
      },
    );
    const service = await buildService(repos);

    const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
      points: { anomaly_threshold: 250 },
    });

    expect(repos.pointsUpsert).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
    expect(result.points).toEqual({
      adjustment_rate_limit_per_hour: 20,
      anomaly_threshold: 250,
    });
  });

  it('returns the overlayed workflow when only the trailing workflows read fails', async () => {
    const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
      readErrorOnCall: { workflows: 2 },
      trailingReadError: TRAILING,
    });
    const service = await buildService(repos);

    const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
      workflows: [{ key: 'wf_budget_approval', enabled: false }],
    });

    expect(repos.workflowUpsert).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
    expect(result.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'wf_budget_approval',
          enabled: false,
          threshold: 500,
          units: 'USD',
        }),
      ]),
    );
  });

  it('returns the persisted theme palette when the trailing chapters read fails', async () => {
    const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
      readErrorOnCall: { chapters: 2 },
      trailingReadError: TRAILING,
    });
    const service = await buildService(repos);

    const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
      branding: { colors: { accent: '#8B0000' } },
    });

    expect(repos.chapterUpdate).toHaveBeenCalled();
    expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
    expect(result.branding).toMatchObject({ colors: { accent: '#8B0000' } });
    expect(result.theme_palette).toMatchObject({
      '--signet-accent-primary': '#C49A3A',
    });
  });

  it('still fails closed when the first dues read fails (call 1)', async () => {
    const repos = makeRepos([], CONFIGURED_DUES, {}, null, null, {
      readErrorOnCall: { dues: 1 },
      trailingReadError: TRAILING,
    });
    const service = await buildService(repos);

    await expect(
      service.patchConfig(CHAPTER_ID, 'user-1', {
        dues: { cadence: 'monthly' },
      }),
    ).rejects.toMatchObject({ message: TRAILING.message });

    expect(repos.duesUpsert).not.toHaveBeenCalled();
    expect(mockAuditLog.record).not.toHaveBeenCalled();
  });
});

describe('mergeDefinedFields', () => {
  type Config = { cadence: string; amount: number; note: string | null };
  const FIELDS = ['cadence', 'amount', 'note'] as const;
  const fallback: Config = { cadence: 'monthly', amount: 100, note: 'keep' };

  it('lays every supplied field over the fallback', () => {
    expect(
      mergeDefinedFields(
        fallback,
        { cadence: 'yearly', amount: 250, note: 'new' },
        FIELDS,
      ),
    ).toEqual({ cadence: 'yearly', amount: 250, note: 'new' });
  });

  it('keeps the fallback for a listed field that is undefined or absent', () => {
    expect(mergeDefinedFields(fallback, { amount: undefined }, FIELDS)).toEqual(
      fallback,
    );
  });

  it('writes a null, which is a real value rather than "not supplied"', () => {
    expect(mergeDefinedFields(fallback, { note: null }, FIELDS)).toEqual({
      ...fallback,
      note: null,
    });
  });

  it('writes a falsy value such as 0', () => {
    expect(mergeDefinedFields(fallback, { amount: 0 }, FIELDS).amount).toBe(0);
  });

  it('ignores a supplied key that is not in the field list', () => {
    // A wider row than the field list, the way an upsert row carrying
    // `chapter_id` is passed back in; a fresh literal would not typecheck.
    const incoming: Partial<Config> = { cadence: 'yearly', amount: 5 };
    expect(
      mergeDefinedFields(fallback, incoming, ['cadence'] as const),
    ).toEqual({ ...fallback, cadence: 'yearly' });
  });

  it('returns a new object and leaves the fallback untouched', () => {
    const before = { ...fallback };
    const next = mergeDefinedFields(fallback, { amount: 1 }, FIELDS);
    expect(next).not.toBe(fallback);
    expect(fallback).toEqual(before);
  });
});
