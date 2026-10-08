import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Chapter } from '#domain/entities/chapter.entity';
import {
  DUES_CONFIG_FIELDS,
  type DuesConfig,
} from '#domain/entities/chapter-dues-config.entity';
import {
  SERVICE_CONFIG_FIELDS,
  type ServiceConfig,
} from '#domain/entities/chapter-service-config.entity';
import {
  POINTS_CONFIG_FIELDS,
  type PointsConfig,
} from '#domain/entities/chapter-points-config.entity';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import {
  CHAPTER_CONFIG_REPOSITORY,
  type ChapterWorkflowUpsert,
  type IChapterConfigRepository,
} from '#domain/repositories/chapter-config.repository.interface';
import {
  buildChapterConfigFromArchetype,
  getArchetype,
  MODULE_CATALOG,
} from '@repo/org-archetypes';
import { isModuleEnabled } from '@repo/validation';
import {
  buildChapterPalette,
  chapterPaletteColumns,
  logChapterPaletteWarnings,
  type ChapterBrandingInput,
  type ChapterPaletteBuild,
} from './chapter-palette';
import { SERVICE_CONFIG_DEFAULTS } from './chapter-service-config.service';
import { ChapterPointsConfigService } from './chapter-points-config.service';
import { ActivationService } from './activation.service';
import {
  ChapterAuditLogService,
  type AuditDiff,
} from './chapter-audit-log.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/**
 * Paid module keys, read from the catalog rather than a second hand-kept list —
 * a module that changes tier must not silently drop out of the activation
 * funnel (#267).
 *
 * Resolved on call rather than at module load: several specs `jest.mock`
 * `@repo/org-archetypes` down to the two helpers they need, and a top-level
 * read of `MODULE_CATALOG` turns any such partial mock into a module-graph
 * crash in suites that never touch modules at all. The catalog is ~25 frozen
 * entries and this runs only on a PATCH that changes `enabled_modules`.
 */
function paidModuleKeys(): readonly string[] {
  return MODULE_CATALOG.filter((entry) => entry.tier === 'paid').map(
    (entry) => entry.key,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `patch` onto `base`. Nested plain objects merge key by
 * key; everything else (scalars, arrays) is replaced by the patch value.
 * Used so a partial config PATCH preserves untouched keys in JSON columns.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] =
      isPlainObject(value) && isPlainObject(result[key])
        ? deepMerge(result[key], value)
        : value;
  }
  return result;
}

/** Why a failed settings read throws instead of falling back to defaults. */
const FABRICATED_PRIOR_STATE =
  'refusing to report or write against a fabricated prior state';

/**
 * Returned when a chapter has no `chapter_dues_config` row yet. Mirrors the
 * table's column defaults (migration 20260530193000): an unconfigured chapter
 * reports zero amounts on a per-semester cadence with no installment plan.
 */
const DUES_DEFAULTS: DuesConfig = {
  cadence: 'per_semester',
  active_amount_cents: 0,
  new_member_amount_cents: 0,
  alumni_amount_cents: 0,
  installments_allowed: false,
  installment_count: 1,
  late_fee_cents: 0,
  grace_days: 7,
  scholarship_pool_cents: 0,
};

/**
 * `fallback` with every field in `fields` that `incoming` supplies laid over
 * it. `undefined` means "not supplied" and keeps the fallback value; `null` is
 * a real value and is written. Generic over the field list so each assignment
 * is checked against its own column type rather than erased by a cast.
 * Exported only for its direct spec; its one production home is this file.
 */
export function mergeDefinedFields<T, K extends keyof T>(
  fallback: T,
  incoming: { readonly [P in K]?: T[P] },
  fields: readonly K[],
): T {
  const next: T = { ...fallback };
  for (const key of fields) {
    const value = incoming[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** Whether `next` differs from `current` on any of `fields`. */
function fieldsChanged<T, K extends keyof T>(
  current: T,
  next: T,
  fields: readonly K[],
): boolean {
  return fields.some((key) => next[key] !== current[key]);
}

/** One incoming workflow toggle in a config PATCH. */
export type ChapterWorkflowPatch = {
  key: string;
  enabled: boolean;
  /** Omitted means "leave the current threshold alone", not "clear it". */
  threshold?: number;
};

/** The beta-rollout block, stored as loose jsonb on `chapters.beta_config`. */
export type ChapterBetaConfigPatch = {
  enabled?: boolean;
  style?: string;
};

/**
 * What `patchConfig` accepts. Every key is optional and absent means "leave it
 * alone", which is what makes the JSON columns merge rather than replace.
 *
 * The three singleton blocks reuse the domain's config types
 * ({@link DuesConfig}, `ServiceConfig`, `PointsConfig`) instead of restating
 * their fields, which is also what lets `patchConfig` drop the
 * `as Partial<…>` casts it used to need on each one.
 *
 * The interface layer's `PatchChapterConfigDto` is the validated wire shape and
 * stays there: the application layer may not import it (dependency-cruiser
 * `api-application-not-to-interface`), and `ChapterConfigController` is where the two
 * meet. That call site checks assignability, which is **one-directional**:
 * it catches a field this type requires that the DTO stopped supplying, and
 * it does not catch a field added to the DTO and never added here — that one
 * validates on the wire and is silently dropped before it reaches this
 * service. Widen the DTO and this type together.
 */
export interface PatchChapterConfigInput {
  org_archetype?: string;
  enabled_modules?: Record<string, boolean>;
  vocabulary?: Record<string, string>;
  branding?: ChapterBrandingInput;
  beta_config?: ChapterBetaConfigPatch;
  dues?: Partial<DuesConfig>;
  service?: Partial<ServiceConfig>;
  points?: Partial<PointsConfig>;
  workflows?: ChapterWorkflowPatch[];
  analytics_opt_out?: boolean;
  /** `null` clears the default rather than meaning "not supplied" (#422). */
  default_invite_role_id?: string | null;
}

@Injectable()
export class ChapterConfigService {
  private readonly logger = new Logger(ChapterConfigService.name);

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(CHAPTER_CONFIG_REPOSITORY)
    private readonly configRepo: IChapterConfigRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly activation: ActivationService,
    private readonly pointsConfig: ChapterPointsConfigService,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  async getConfig(chapterId: string) {
    const chapter = await this.readOrThrow(
      'chapters',
      chapterId,
      'refusing to report a read failure as a missing chapter',
      () => this.chapterRepo.findById(chapterId),
    );

    // A thrown read, not `null`. Collapsing them reports a failed read as
    // "this chapter does not exist" — the same error-is-indistinguishable-from-
    // absence bug as the three reads below (#1626), and its most invisible
    // instance: AllExceptionsFilter routes <500 to recordSecurityEvent, whose
    // SECURITY_EVENT_KINDS covers only 401/403/429, so a 404 emits no error
    // log, no security event and no Sentry capture. A PostgREST schema-cache
    // reload would turn every config read into a silent 404 on a live chapter.
    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    // Merge archetype defaults with chapter-specific overrides
    const archetypeKey: string = chapter.org_archetype ?? 'ifc';
    const archetype = getArchetype(archetypeKey);
    const seed = buildChapterConfigFromArchetype(archetypeKey);

    // Workflows live in their own table; overlay per-chapter overrides onto the
    // archetype catalog. Label/units always come from the seed (the catalog is
    // the source of truth for presentation); enabled/threshold come from the
    // chapter row when one exists, else the seed default.
    //
    // Fails *closed* on a read error, for the reason spelled out at the points
    // read below: `patchConfig` merges a PATCH onto whatever this returns, so a
    // swallowed error would substitute the archetype seed for the chapter's
    // real overrides. An empty list means "no overrides", so a read failure
    // must not be allowed to look like one.
    const workflowRows = await this.readOrThrow(
      'chapter_workflows',
      chapterId,
      FABRICATED_PRIOR_STATE,
      () => this.configRepo.findWorkflows(chapterId),
    );
    const workflowOverrides = new Map(
      workflowRows.map((row) => [row.key, row]),
    );
    const workflows = seed.workflows.map((wf) => {
      const override = workflowOverrides.get(wf.key);
      return {
        key: wf.key,
        label: wf.label,
        enabled: override ? override.enabled : wf.enabled,
        threshold:
          override && override.threshold != null
            ? override.threshold
            : wf.threshold,
        units: wf.units,
      };
    });

    // Dues are a singleton row (chapter_dues_config, PK = chapter_id). An
    // unconfigured chapter has no row yet, so fall back to the table defaults.
    // A read error is NOT an unconfigured chapter, and must not be treated as
    // one: `patchConfig` merges onto this value and upserts the whole row, so
    // defaulting here lets an officer editing `cadence` write every amount back
    // to 0 and record a `from` the chapter never held.
    const duesRow = await this.readOrThrow(
      'chapter_dues_config',
      chapterId,
      FABRICATED_PRIOR_STATE,
      () => this.configRepo.findDuesConfig(chapterId),
    );
    const dues: DuesConfig = { ...DUES_DEFAULTS, ...(duesRow ?? {}) };

    // Service-hours policy is the same singleton shape (chapter_service_config,
    // PK = chapter_id); an unconfigured chapter falls back to the table default.
    // Same fail-closed rule as dues: resetting `minutes_per_point` to the
    // default silently changes how many points every subsequently-approved
    // service entry awards.
    const serviceRow = await this.readOrThrow(
      'chapter_service_config',
      chapterId,
      FABRICATED_PRIOR_STATE,
      () => this.configRepo.findServiceConfig(chapterId),
    );
    const service: ServiceConfig = {
      ...SERVICE_CONFIG_DEFAULTS,
      ...(serviceRow ?? {}),
    };

    // Points anti-fraud limits are the same singleton shape
    // (chapter_points_config, PK = chapter_id); an unconfigured chapter falls
    // back to the table defaults, which are the values PointsService used to
    // hardcode.
    //
    // Routed through ChapterPointsConfigService rather than inlined like dues
    // and service above, for two reasons the other two don't have. It applies
    // the same per-field clamp enforcement uses, so what this endpoint reports
    // is what adjustPoints will actually apply — when those diverged, a stored
    // 0 rendered "up to 0 adjustments per hour" on a chapter the server was
    // letting make 50. And it throws rather than silently defaulting on a read
    // error, which matters because `patchConfig` uses this value as the prior
    // state it merges a PATCH onto: a swallowed error would let an officer
    // editing one limit overwrite the other back to the default and write an
    // audit row recording a `from` the chapter never had.
    const points: PointsConfig =
      await this.pointsConfig.getConfigOrThrow(chapterId);

    return {
      id: chapterId,
      org_archetype: archetypeKey,
      archetype_meta: {
        label: archetype.label,
        short: archetype.short,
        description: archetype.description,
        council: archetype.council,
      },
      enabled_modules: {
        ...seed.modules,
        ...(chapter.enabled_modules ?? {}),
      },
      vocabulary: {
        ...seed.vocabulary,
        ...(chapter.vocabulary ?? {}),
      },
      branding: chapter.branding ?? {},
      theme_palette: chapter.theme_palette ?? {},
      beta_config: chapter.beta_config ?? {},
      analytics_opt_out: chapter.analytics_opt_out ?? false,
      // #422. `null` is meaningful here — "no default configured", which
      // InviteService reads as "fall back to the seeded Member role". A
      // deleted role clears this via `on delete set null`, so a client never
      // sees an id that no longer resolves.
      default_invite_role_id: chapter.default_invite_role_id ?? null,
      workflows,
      dues,
      service,
      points,
      role_pack: archetype.rolePack,
    };
  }

  /**
   * #422. Guards the one cross-tenant hazard this field introduces: the id is
   * caller-supplied, and `roles` is chapter-scoped, so an id belonging to
   * another chapter would otherwise persist happily and then resolve to that
   * chapter's role name on every subsequent invite.
   *
   * The database FK only proves the role *exists*; it cannot prove it is
   * *this* chapter's without a redundant unique key on `roles (id,
   * chapter_id)`. So the check lives here, and it filters on `chapter_id` in
   * the query rather than reading the row and comparing after — a
   * cross-chapter id then comes back as "not found" and is indistinguishable
   * from a nonexistent one, which is the correct thing to tell the caller.
   */
  private async assertRoleBelongsToChapter(
    chapterId: string,
    roleId: string,
  ): Promise<void> {
    const matches = await this.callOrThrow(
      'Failed to validate default invite role',
      () => this.roleRepo.findByIds([roleId], chapterId),
    );
    if (matches.length === 0) {
      throw new BadRequestException({
        code: 'chapter.config.invalid_default_invite_role',
        message:
          'default_invite_role_id must name a role that belongs to this chapter.',
      });
    }
  }

  async patchConfig(
    chapterId: string,
    actorUserId: string,
    dto: PatchChapterConfigInput,
  ) {
    const existing = await this.getConfig(chapterId);

    // Build the diff for the audit log
    const diff: AuditDiff = {};
    const update: Partial<Chapter> = {};

    if (
      dto.org_archetype !== undefined &&
      dto.org_archetype !== existing.org_archetype
    ) {
      diff['org_archetype'] = {
        from: existing.org_archetype,
        to: dto.org_archetype,
      };
      update['org_archetype'] = dto.org_archetype;
    }
    // Scalar boolean on the chapters row (mirrors org_archetype). Drives the
    // per-chapter analytics opt-out the AnalyticsService gate reads per event.
    if (
      dto.analytics_opt_out !== undefined &&
      dto.analytics_opt_out !== existing.analytics_opt_out
    ) {
      diff['analytics_opt_out'] = {
        from: existing.analytics_opt_out,
        to: dto.analytics_opt_out,
      };
      update['analytics_opt_out'] = dto.analytics_opt_out;
    }
    // #422: the role new invites default to. Nullable scalar FK on the
    // chapters row. `null` is a real value here (clear the default), so this
    // branch keys on `!== undefined` rather than truthiness — otherwise
    // clearing it would be indistinguishable from not touching it.
    if (
      dto.default_invite_role_id !== undefined &&
      dto.default_invite_role_id !== existing.default_invite_role_id
    ) {
      if (dto.default_invite_role_id !== null) {
        await this.assertRoleBelongsToChapter(
          chapterId,
          dto.default_invite_role_id,
        );
      }
      diff['default_invite_role_id'] = {
        from: existing.default_invite_role_id,
        to: dto.default_invite_role_id,
      };
      update['default_invite_role_id'] = dto.default_invite_role_id;
    }
    // JSON columns are patched, not replaced: a partial payload deep-merges
    // onto the existing value so untouched keys are preserved.
    // Funnel step 5 (#267) — capture *which* paid modules flip off→on in this
    // patch. Computed here, where both sides of the merge are in hand, but not
    // emitted until the write below actually lands. `isModuleEnabled` is the
    // shared "enabled unless explicitly false" rule, so a chapter that simply
    // has no key for a module (created before the module existed) doesn't read
    // as a transition on the next unrelated patch.
    let newlyEnabledPaidModules: string[] = [];
    if (dto.enabled_modules !== undefined) {
      const merged = deepMerge(existing.enabled_modules, dto.enabled_modules);
      diff['enabled_modules'] = { from: existing.enabled_modules, to: merged };
      update['enabled_modules'] = merged as Record<string, boolean>;

      const before = existing.enabled_modules as Record<string, boolean>;
      const after = merged as Record<string, boolean>;
      newlyEnabledPaidModules = paidModuleKeys().filter(
        (key) => !isModuleEnabled(before, key) && isModuleEnabled(after, key),
      );
    }
    if (dto.vocabulary !== undefined) {
      const merged = deepMerge(existing.vocabulary, dto.vocabulary);
      diff['vocabulary'] = { from: existing.vocabulary, to: merged };
      update['vocabulary'] = merged as Record<string, unknown>;
    }
    let mergedBranding: Record<string, unknown> | undefined;
    if (dto.branding !== undefined) {
      mergedBranding = deepMerge(existing.branding, dto.branding) as Record<
        string,
        unknown
      >;
      diff['branding'] = { from: existing.branding, to: mergedBranding };
      update['branding'] = mergedBranding;
      // Every branding write re-derives the palette (below) and clears the
      // engine stamp here, atomically with the seed, with or without colors
      // in the PATCH (#1165, accent-engine.md §4). This write stores the whole
      // merged object as `getConfig` read it, accent included, so a Settings
      // accent save landing between that read and this write gets its seed
      // replaced under the palette it just stamped current. The recompute
      // re-derives from the seed stored here; if it fails, which is only
      // logged, the cleared stamp leaves the row for the stale-palette sweep
      // instead of stamped current over a palette from another seed. (The
      // accent save itself is still lost in that race: #2607.)
      update['theme_palette_engine_version'] = null;

      const readAccent = (branding: unknown): string | undefined =>
        (branding as { colors?: { accent?: string } } | undefined)?.colors
          ?.accent;
      const previousAccent = readAccent(existing.branding);
      const nextAccent = readAccent(mergedBranding);

      // #795: mirror the authoritative accent into the legacy column.
      //
      // No separate `accent_color` diff entry: `getConfig` does not return
      // that column, so the only "previous" value available here is the
      // branding accent, and on exactly the legacy rows this mirror exists to
      // repair those two disagree. Recording the branding value as the column's
      // prior state would put a number in the audit log that the column never
      // held. The branding diff above already records the accent change, which
      // is the authoritative one.
      if (typeof nextAccent === 'string' && nextAccent !== previousAccent) {
        update['accent_color'] = nextAccent;
      }
    }
    if (dto.beta_config !== undefined) {
      const merged = deepMerge(existing.beta_config, dto.beta_config);
      diff['beta_config'] = { from: existing.beta_config, to: merged };
      update['beta_config'] = merged as Record<string, unknown>;
    }

    // Workflows are persisted to their own table (chapter_workflows). Incoming
    // keys are validated against the chapter catalog (from getConfig) so an
    // unknown key can never write a row, and only changed rows are upserted.
    const workflowUpserts: ChapterWorkflowUpsert[] = [];
    if (dto.workflows !== undefined) {
      const catalog = new Map(
        (
          existing.workflows as Array<{
            key: string;
            enabled: boolean;
            threshold?: number;
          }>
        ).map((wf) => [wf.key, wf]),
      );
      const from: Record<string, { enabled: boolean; threshold?: number }> = {};
      const to: Record<string, { enabled: boolean; threshold?: number }> = {};
      for (const incoming of dto.workflows) {
        const current = catalog.get(incoming.key);
        if (!current) continue; // ignore unknown keys — no bare write
        const nextThreshold = incoming.threshold ?? current.threshold;
        if (
          incoming.enabled === current.enabled &&
          nextThreshold === current.threshold
        ) {
          continue; // unchanged
        }
        workflowUpserts.push({
          chapter_id: chapterId,
          key: incoming.key,
          enabled: incoming.enabled,
          threshold: nextThreshold ?? null,
        });
        from[incoming.key] = {
          enabled: current.enabled,
          threshold: current.threshold,
        };
        to[incoming.key] = {
          enabled: incoming.enabled,
          threshold: nextThreshold,
        };
      }
      if (workflowUpserts.length > 0) {
        diff['workflows'] = { from, to };
      }
    }

    // Dues, service-hours policy and points anti-fraud limits are singleton
    // rows (PK = chapter_id). A partial PATCH merges the provided fields onto
    // the current row; only a real change writes (and audits). Numeric/enum
    // guards are enforced by the DTO, and the points floors a second time by
    // the column CHECK, so the merge only has to decide what changed.
    //
    // The repository writes `chapter_id` over each merged config, never under
    // it, so nothing client-shaped can retarget the row.
    let duesUpsert: DuesConfig | null = null;
    if (dto.dues !== undefined) {
      const current = existing.dues;
      const next = mergeDefinedFields(current, dto.dues, DUES_CONFIG_FIELDS);
      if (fieldsChanged(current, next, DUES_CONFIG_FIELDS)) {
        duesUpsert = next;
        diff['dues'] = { from: current, to: next };
      }
    }

    let serviceUpsert: ServiceConfig | null = null;
    if (dto.service !== undefined) {
      const current = existing.service;
      const next = mergeDefinedFields(
        current,
        dto.service,
        SERVICE_CONFIG_FIELDS,
      );
      if (fieldsChanged(current, next, SERVICE_CONFIG_FIELDS)) {
        serviceUpsert = next;
        diff['service'] = { from: current, to: next };
      }
    }

    let pointsUpsert: PointsConfig | null = null;
    if (dto.points !== undefined) {
      const current = existing.points;
      const next = mergeDefinedFields(
        current,
        dto.points,
        POINTS_CONFIG_FIELDS,
      );
      if (fieldsChanged(current, next, POINTS_CONFIG_FIELDS)) {
        pointsUpsert = next;
        diff['points'] = { from: current, to: next };
      }
    }

    if (
      Object.keys(update).length === 0 &&
      workflowUpserts.length === 0 &&
      duesUpsert === null &&
      serviceUpsert === null &&
      pointsUpsert === null
    ) {
      return existing;
    }

    if (Object.keys(update).length > 0) {
      await this.callOrThrow('Failed to update chapter config', () =>
        this.chapterRepo.update(chapterId, update),
      );
    }

    if (workflowUpserts.length > 0) {
      await this.callOrThrow('Failed to update chapter workflows', () =>
        this.configRepo.upsertWorkflows(workflowUpserts),
      );
    }

    if (duesUpsert) {
      const dues = duesUpsert;
      await this.callOrThrow('Failed to update chapter dues config', () =>
        this.configRepo.upsertDuesConfig(chapterId, dues),
      );
    }

    if (serviceUpsert) {
      const service = serviceUpsert;
      await this.callOrThrow('Failed to update chapter service config', () =>
        this.configRepo.upsertServiceConfig(chapterId, service),
      );
    }

    if (pointsUpsert) {
      const points = pointsUpsert;
      await this.callOrThrow('Failed to update chapter points config', () =>
        this.configRepo.upsertPointsConfig(chapterId, points),
      );
    }

    // Write audit log entry, after the config writes above and before the
    // activation milestone below — the ordering `getConfig`'s fail-closed
    // contract depends on. The audit trail is a hard requirement, so a failure
    // here surfaces as an error rather than being silently dropped;
    // `ChapterAuditLogService.record` logs and rethrows for exactly that.
    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_config_updated',
      targetType: 'chapter',
      targetId: chapterId,
      diff,
    });

    // ADR-08 (Chunk 05): `#chapter-audit` mirroring is now owned by the
    // ChatBridgeWorker which subscribes to `chapter_audit_log` INSERTs and
    // posts the `system_audit` message itself. Each audit-writing service no
    // longer needs to call into chat.

    // Funnel step 5 (#267), now that the update and its audit row have landed.
    // A patch can enable several paid modules at once; the milestone is "the
    // chapter started using paid features", so it records once and names the
    // module alphabetically-first only to keep the property deterministic.
    if (newlyEnabledPaidModules.length > 0) {
      await this.activation.record(
        chapterId,
        'activation-first-paid-module-enabled',
        {
          module: [...newlyEnabledPaidModules].sort()[0] ?? null,
          modules_enabled: newlyEnabledPaidModules.length,
        },
      );
    }

    // Recompute the theme palette whenever the PATCH wrote `branding`, with or
    // without colors and changed or not: the seed guard needs the palette
    // re-derived from whatever seed that write stored (see the stamp above).
    // Use the merged branding colors so a partial color patch keeps the
    // untouched channel. Capture the derived map so a trailing `getConfig`
    // failure can still return the tokens we just persisted (#1670 fallback).
    let committedThemePalette:
      | Awaited<ReturnType<ChapterConfigService['getConfig']>>['theme_palette']
      | undefined;
    if (mergedBranding) {
      const mergedColors =
        (mergedBranding as { colors?: { accent?: string } }).colors ?? {};
      try {
        const { build, written } = await this.recomputePalette(
          chapterId,
          mergedColors,
        );
        if (written) committedThemePalette = build.palette;
      } catch (err) {
        logThrowable(this.logger, 'warn', 'Failed to recompute palette', err);
      }
    }

    // Trailing re-read is best-effort freshness, not part of the write.
    // The leading `getConfig` above *must* fail closed (#1626): it is the
    // prior state this method merges onto and upserts as a whole row. This
    // one runs after the chapters update, the singleton upserts, the audit
    // insert, and activation.record have already committed. Letting it throw
    // turns a durable PATCH into HTTP 500; `usePatchOrgConfig.onError` then
    // restores the pre-mutation cache, so the officer sees a snap-back while
    // `#chapter-audit` shows a change they believe did not happen (#1670).
    try {
      return await this.getConfig(chapterId);
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `trailing getConfig after committed patch failed for chapter ${chapterId}; returning locally-merged state`,
        err,
      );
      return this.configAfterCommittedPatch(existing, {
        update,
        workflowUpserts,
        duesUpsert,
        serviceUpsert,
        pointsUpsert,
        themePalette: committedThemePalette,
      });
    }
  }

  /**
   * In-memory view of a PATCH that already wrote. Used only when the trailing
   * `getConfig` fails; the response is then best-effort-fresh rather than
   * round-trip-verified (palette recompute is already fire-and-forget).
   */
  private configAfterCommittedPatch(
    existing: Awaited<ReturnType<ChapterConfigService['getConfig']>>,
    committed: {
      update: Partial<Chapter>;
      workflowUpserts: ChapterWorkflowUpsert[];
      duesUpsert: DuesConfig | null;
      serviceUpsert: ServiceConfig | null;
      pointsUpsert: PointsConfig | null;
      themePalette?: Awaited<
        ReturnType<ChapterConfigService['getConfig']>
      >['theme_palette'];
    },
  ): Awaited<ReturnType<ChapterConfigService['getConfig']>> {
    const {
      update,
      workflowUpserts,
      duesUpsert,
      serviceUpsert,
      pointsUpsert,
      themePalette,
    } = committed;

    let orgArchetype = existing.org_archetype;
    let archetypeMeta = existing.archetype_meta;
    let rolePack = existing.role_pack;
    if (update.org_archetype !== undefined) {
      orgArchetype = update.org_archetype;
      const archetype = getArchetype(orgArchetype);
      archetypeMeta = {
        label: archetype.label,
        short: archetype.short,
        description: archetype.description,
        council: archetype.council,
      };
      rolePack = archetype.rolePack;
    }

    const workflowByKey = new Map(
      workflowUpserts.map((row) => [row.key, row] as const),
    );
    // Same shape as `getConfig`: every key is always present. Spreading `wf`
    // and overlaying optional upsert fields would drop `units` from the
    // required-key type (`threshold?:` vs `threshold: number | undefined`).
    const workflows = existing.workflows.map((wf) => {
      const next = workflowByKey.get(wf.key);
      if (!next) return wf;
      const threshold: number | undefined =
        next.threshold == null ? wf.threshold : next.threshold;
      return {
        key: wf.key,
        label: wf.label,
        enabled: next.enabled ?? wf.enabled,
        threshold,
        units: wf.units,
      };
    });

    return {
      ...existing,
      org_archetype: orgArchetype,
      archetype_meta: archetypeMeta,
      role_pack: rolePack,
      enabled_modules:
        update.enabled_modules !== undefined
          ? update.enabled_modules
          : existing.enabled_modules,
      vocabulary:
        update.vocabulary !== undefined
          ? (update.vocabulary as typeof existing.vocabulary)
          : existing.vocabulary,
      branding:
        update.branding !== undefined ? update.branding : existing.branding,
      theme_palette: themePalette ?? existing.theme_palette,
      beta_config:
        update.beta_config !== undefined
          ? update.beta_config
          : existing.beta_config,
      analytics_opt_out:
        update.analytics_opt_out !== undefined
          ? update.analytics_opt_out
          : existing.analytics_opt_out,
      default_invite_role_id:
        'default_invite_role_id' in update
          ? (update.default_invite_role_id ?? null)
          : existing.default_invite_role_id,
      workflows,
      dues: duesUpsert ?? existing.dues,
      service: serviceUpsert ?? existing.service,
      points: pointsUpsert ?? existing.points,
    };
  }

  async recomputeAndPersistPalette(chapterId: string) {
    // Thrown, not `null`, for the same reason as getConfig's chapters read:
    // this route sits on the same controller behind the same
    // `chapter-config:manage`, so collapsing a failed read into 404 gives
    // Save-accent the identical invisible failure — no error log, no security
    // event, no Sentry capture.
    const chapter = await this.readOrThrow(
      'chapters',
      chapterId,
      'refusing to report a read failure as a missing chapter during palette recompute',
      () => this.chapterRepo.findById(chapterId),
    );
    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const branding = (chapter.branding ?? {}) as {
      colors?: { accent?: string };
    };
    const colors = branding.colors ?? {};
    // A lost race (`written: false`) still returns the build: it is what this
    // chapter's seed, as read, derives to, and the newer write that beat it
    // holds a palette derived from its own seed. So after a lost race the
    // response's `palette` is not the stored one, and a caller that painted
    // it would show the superseded accent; spec/behavior/chapter-config.md
    // says so. No client calls this route today (the Settings accent editor
    // saves through `PATCH /v1/chapters/current`), so nothing is exposed to
    // that. A first caller that applies the palette should re-read the
    // chapter rather than trust this response.
    const { build } = await this.recomputePalette(chapterId, colors);
    // Picked, not spread: `failedFillChecks` is logged and never disclosed
    // (chapter-palette.ts), and a field added to the build later should not
    // reach the response by default.
    return {
      palette: build.palette,
      invalidSeed: build.invalidSeed,
      failedContrastChecks: build.failedContrastChecks,
    };
  }

  /**
   * Derive and persist the palette for the seed the caller read, and report
   * whether the write landed.
   *
   * Compare-and-set on the seed, the same guard the stale-palette sweep uses
   * (`SupabaseScheduledJobsRepository.writeRecomputedPalette`): the write lands only
   * while `branding.colors.accent` is still the seed this palette was derived
   * from. Both callers read that seed in an earlier statement, so a Settings
   * accent save can land in between; without the guard this write would put
   * the old seed's palette back under a current stamp, where neither the next
   * read nor the sweep would notice. `written: false` is that lost race, not
   * an error: the write that won carries a palette derived from its own seed.
   */
  private async recomputePalette(
    chapterId: string,
    colors: { accent?: string },
  ): Promise<{ build: ChapterPaletteBuild; written: boolean }> {
    const build = buildChapterPalette(colors);

    // Colour problems are logged, never thrown: the palette written is still
    // valid, and failing a config save the officer asked for because one hex
    // was malformed is a worse outcome than a slightly wrong accent (#840).
    logChapterPaletteWarnings(
      this.logger,
      `for chapter ${chapterId}`,
      colors.accent,
      build,
    );
    const written = await this.callOrThrow(
      'Failed to persist theme palette',
      () =>
        this.chapterRepo.updatePaletteIfSeedUnchanged(
          chapterId,
          chapterPaletteColumns(build),
          colors.accent,
        ),
    );
    if (!written) {
      this.logger.warn(
        `Theme palette for chapter ${chapterId} not written: its accent changed after it was read, and the newer write stands`,
      );
    }
    return { build, written };
  }

  /**
   * Run a read whose failure must surface rather than pass for absence, and
   * log which table failed and why this service refuses to guess. The thrown
   * `SupabaseQueryError` carries the cause.
   */
  private async readOrThrow<T>(
    table: string,
    chapterId: string,
    refusal: string,
    read: () => Promise<T>,
  ): Promise<T> {
    try {
      return await read();
    } catch (err) {
      logThrowable(
        this.logger,
        'error',
        `${table} read failed for chapter ${chapterId}; ${refusal}`,
        err,
      );
      throw err;
    }
  }

  /** Run a repository call, logging `message` with the cause before rethrowing. */
  private async callOrThrow<T>(
    message: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (err) {
      logThrowable(this.logger, 'error', message, err);
      throw err;
    }
  }
}
