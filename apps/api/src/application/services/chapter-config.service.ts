import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../../infrastructure/supabase/database.types';
import type { DuesCadence } from '../../domain/entities/chapter-dues-config.entity';
import {
  buildChapterConfigFromArchetype,
  getArchetype,
  MODULE_CATALOG,
} from '@repo/org-archetypes';
import { isModuleEnabled } from '@repo/validation';
import { buildChapterPalette } from './chapter-palette';
import type { PatchChapterConfigDto } from '../../interface/dtos/chapter-config.dto';
import {
  SERVICE_CONFIG_DEFAULTS,
  SERVICE_CONFIG_FIELDS,
  SERVICE_CONFIG_SELECT,
  type ServiceConfig,
} from './chapter-service-config.service';
import { ActivationService } from './activation.service';

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

/**
 * Dues config returned by `getConfig` and persisted by `patchConfig`.
 *
 * API-facing subset of `chapter_dues_config` (no timestamps). Writes use
 * `TablesInsert<'chapter_dues_config'>`; `cadence` is `DuesCadence` so the
 * upsert is assignable without `as never`.
 */
export type DuesConfig = {
  cadence: DuesCadence;
  active_amount_cents: number;
  new_member_amount_cents: number;
  alumni_amount_cents: number;
  installments_allowed: boolean;
  installment_count: number;
  late_fee_cents: number;
  grace_days: number;
  scholarship_pool_cents: number;
};

const DUES_FIELDS = [
  'cadence',
  'active_amount_cents',
  'new_member_amount_cents',
  'alumni_amount_cents',
  'installments_allowed',
  'installment_count',
  'late_fee_cents',
  'grace_days',
  'scholarship_pool_cents',
] as const satisfies ReadonlyArray<keyof DuesConfig>;

const DUES_SELECT = DUES_FIELDS.join(', ');

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

@Injectable()
export class ChapterConfigService {
  private readonly logger = new Logger(ChapterConfigService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly activation: ActivationService,
  ) {}

  async getConfig(chapterId: string) {
    const { data: chapter, error } = await this.supabase
      .from('chapters')
      .select(
        'id, name, university, org_archetype, enabled_modules, vocabulary, branding, theme_palette, beta_config, analytics_opt_out',
      )
      .eq('id', chapterId)
      .maybeSingle();

    if (error || !chapter) {
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
    const { data: workflowRows } = await this.supabase
      .from('chapter_workflows')
      .select('key, enabled, threshold')
      .eq('chapter_id', chapterId);
    const workflowOverrides = new Map(
      (
        (workflowRows ?? []) as Array<{
          key: string;
          enabled: boolean;
          threshold: number | null;
        }>
      ).map((row) => [row.key, row]),
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
    const { data: duesRow } = await this.supabase
      .from('chapter_dues_config')
      .select(DUES_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    const dues: DuesConfig = {
      ...DUES_DEFAULTS,
      ...((duesRow as Partial<DuesConfig> | null) ?? {}),
    };

    // Service-hours policy is the same singleton shape (chapter_service_config,
    // PK = chapter_id); an unconfigured chapter falls back to the table default.
    const { data: serviceRow } = await this.supabase
      .from('chapter_service_config')
      .select(SERVICE_CONFIG_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    const service: ServiceConfig = {
      ...SERVICE_CONFIG_DEFAULTS,
      ...((serviceRow as Partial<ServiceConfig> | null) ?? {}),
    };

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
      workflows,
      dues,
      service,
      role_pack: archetype.rolePack,
    };
  }

  async patchConfig(
    chapterId: string,
    actorUserId: string,
    dto: PatchChapterConfigDto,
  ) {
    const existing = await this.getConfig(chapterId);

    // Build the diff for the audit log
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const update: TablesUpdate<'chapters'> = {};

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

      const readAccent = (branding: unknown): string | undefined =>
        (branding as { colors?: { accent?: string } } | undefined)?.colors
          ?.accent;
      const previousAccent = readAccent(existing.branding);
      const nextAccent = readAccent(mergedBranding);

      // #795: mirror the authoritative accent into the legacy column.
      //
      // No separate `accent_color` diff entry: `getConfig`'s select does not
      // read that column, so the only "previous" value available here is the
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
    const workflowUpserts: TablesInsert<'chapter_workflows'>[] = [];
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

    // Dues are a singleton row (chapter_dues_config, PK = chapter_id). A partial
    // PATCH merges the provided fields onto the current row; only a real change
    // writes (and audits). Numeric/enum guards are enforced by the DTO.
    let duesUpsert: TablesInsert<'chapter_dues_config'> | null = null;
    if (dto.dues !== undefined) {
      const current = existing.dues;
      const next: DuesConfig = { ...current };
      for (const key of DUES_FIELDS) {
        const incoming = (dto.dues as Partial<DuesConfig>)[key];
        if (incoming !== undefined) {
          (next as unknown as Record<string, unknown>)[key] = incoming;
        }
      }
      if (DUES_FIELDS.some((key) => next[key] !== current[key])) {
        duesUpsert = { chapter_id: chapterId, ...next };
        diff['dues'] = { from: current, to: next };
      }
    }

    // Service-hours policy is the same singleton merge as dues.
    let serviceUpsert: TablesInsert<'chapter_service_config'> | null = null;
    if (dto.service !== undefined) {
      const current = existing.service;
      const next: ServiceConfig = { ...current };
      for (const key of SERVICE_CONFIG_FIELDS) {
        const incoming = (dto.service as Partial<ServiceConfig>)[key];
        if (incoming !== undefined) {
          (next as unknown as Record<string, unknown>)[key] = incoming;
        }
      }
      if (SERVICE_CONFIG_FIELDS.some((key) => next[key] !== current[key])) {
        serviceUpsert = { chapter_id: chapterId, ...next };
        diff['service'] = { from: current, to: next };
      }
    }

    if (
      Object.keys(update).length === 0 &&
      workflowUpserts.length === 0 &&
      duesUpsert === null &&
      serviceUpsert === null
    ) {
      return existing;
    }

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await this.supabase
        .from('chapters')
        .update(update)
        .eq('id', chapterId);

      if (updateError) {
        this.logger.error('Failed to update chapter config', updateError);
        throw updateError;
      }
    }

    if (workflowUpserts.length > 0) {
      const { error: workflowError } = await this.supabase
        .from('chapter_workflows')
        .upsert(workflowUpserts, { onConflict: 'chapter_id,key' });

      if (workflowError) {
        this.logger.error('Failed to update chapter workflows', workflowError);
        throw workflowError;
      }
    }

    if (duesUpsert) {
      const { error: duesError } = await this.supabase
        .from('chapter_dues_config')
        .upsert(duesUpsert, { onConflict: 'chapter_id' });

      if (duesError) {
        this.logger.error('Failed to update chapter dues config', duesError);
        throw duesError;
      }
    }

    if (serviceUpsert) {
      const { error: serviceError } = await this.supabase
        .from('chapter_service_config')
        .upsert(serviceUpsert, { onConflict: 'chapter_id' });

      if (serviceError) {
        this.logger.error(
          'Failed to update chapter service config',
          serviceError,
        );
        throw serviceError;
      }
    }

    // Write audit log entry. The audit trail is a hard requirement, so a
    // failure here surfaces as an error rather than being silently dropped.
    const audit: TablesInsert<'chapter_audit_log'> = {
      chapter_id: chapterId,
      actor_user_id: actorUserId,
      action: 'chapter_config_updated',
      target_type: 'chapter',
      target_id: chapterId,
      scope: 'chapter',
      diff,
      member_visible: true,
    };
    const { error: auditError } = await this.supabase
      .from('chapter_audit_log')
      .insert(audit);

    if (auditError) {
      this.logger.error('Failed to write chapter audit log', auditError);
      throw auditError;
    }

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

    // Recompute theme palette if branding colors changed. Use the merged
    // branding colors so a partial color patch keeps the untouched channel.
    if (dto.branding?.colors) {
      const mergedColors =
        (mergedBranding as { colors?: { dark?: string; accent?: string } })
          ?.colors ?? dto.branding.colors;
      await this.recomputePalette(chapterId, mergedColors).catch((err) =>
        this.logger.warn('Failed to recompute palette', err),
      );
    }

    return this.getConfig(chapterId);
  }

  async recomputeAndPersistPalette(chapterId: string) {
    const { data: chapter, error } = await this.supabase
      .from('chapters')
      .select('branding')
      .eq('id', chapterId)
      .maybeSingle();

    if (error || !chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const branding = ((chapter as Record<string, unknown>)['branding'] ??
      {}) as {
      colors?: { dark?: string; accent?: string };
    };
    const colors = branding.colors ?? {};
    return this.recomputePalette(chapterId, colors);
  }

  private async recomputePalette(
    chapterId: string,
    colors: { dark?: string; accent?: string },
  ) {
    const build = buildChapterPalette(colors);

    // Colour problems are logged, never thrown: the palette written is still
    // valid, and failing a config save the officer asked for because one hex
    // was malformed is a worse outcome than a slightly wrong accent (#840).
    // Chapter id is included because these are per-tenant data problems.
    if (build.invalidLegacyInputs.length > 0) {
      this.logger.warn(
        `Invalid brand color(s) for chapter ${chapterId}: ${build.invalidLegacyInputs
          .map((key) => `${key}="${colors[key as 'dark' | 'accent']}"`)
          .join(', ')} — substituted platform bronze. Expected #RRGGBB.`,
      );
    }
    if (build.invalidSeed) {
      this.logger.warn(
        `Invalid accent seed for chapter ${chapterId}: accent="${colors.accent}" — substituted house gold. Expected #RRGGBB.`,
      );
    }
    // The engine guarantees these by construction (accent-engine.md §8), so a
    // failure means the vendored generator changed behaviour under us.
    if (build.failedContrastChecks.length > 0) {
      this.logger.warn(
        `Signet accent contrast below AA for chapter ${chapterId}: ${build.failedContrastChecks
          .map((c) => `${c.role} on ${c.against} = ${c.ratio.toFixed(2)}:1`)
          .join(', ')}`,
      );
    }
    if (build.legacyFailed) {
      this.logger.warn(
        `Failed to derive the legacy theme palette for chapter ${chapterId}; persisted the Signet map alone.`,
      );
    }

    const patch: TablesUpdate<'chapters'> = { theme_palette: build.palette };
    const { error } = await this.supabase
      .from('chapters')
      .update(patch)
      .eq('id', chapterId);

    if (error) {
      this.logger.error('Failed to persist theme palette', error);
      throw error;
    }

    return build;
  }
}
