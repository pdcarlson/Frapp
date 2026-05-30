import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  buildChapterConfigFromArchetype,
  getArchetype,
} from '@repo/org-archetypes';
import { derivePalette } from '@repo/chapter-theme';
import type { PatchChapterConfigDto } from '../../interface/dtos/chapter-config.dto';

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

/** Dues config returned by `getConfig` and persisted by `patchConfig`. */
export interface DuesConfig {
  cadence: string;
  active_amount_cents: number;
  new_member_amount_cents: number;
  alumni_amount_cents: number;
  installments_allowed: boolean;
  installment_count: number;
  late_fee_cents: number;
  grace_days: number;
  scholarship_pool_cents: number;
}

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
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getConfig(chapterId: string) {
    const { data: chapter, error } = await this.supabase
      .from('chapters')
      .select(
        'id, name, university, org_archetype, enabled_modules, vocabulary, branding, theme_palette, beta_config',
      )
      .eq('id', chapterId)
      .maybeSingle();

    if (error || !chapter) {
      throw new NotFoundException('Chapter not found');
    }

    // Merge archetype defaults with chapter-specific overrides
    const archetypeKey: string =
      ((chapter as Record<string, unknown>)['org_archetype'] as string) ??
      'ifc';
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
        ...(((chapter as Record<string, unknown>)['enabled_modules'] as Record<
          string,
          boolean
        >) ?? {}),
      },
      vocabulary: {
        ...seed.vocabulary,
        ...(((chapter as Record<string, unknown>)['vocabulary'] as Record<
          string,
          string
        >) ?? {}),
      },
      branding: (chapter as Record<string, unknown>)['branding'] ?? {},
      theme_palette:
        (chapter as Record<string, unknown>)['theme_palette'] ?? {},
      beta_config: (chapter as Record<string, unknown>)['beta_config'] ?? {},
      workflows,
      dues,
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
    const update: Record<string, unknown> = {};

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
    // JSON columns are patched, not replaced: a partial payload deep-merges
    // onto the existing value so untouched keys are preserved.
    if (dto.enabled_modules !== undefined) {
      const merged = deepMerge(existing.enabled_modules, dto.enabled_modules);
      diff['enabled_modules'] = { from: existing.enabled_modules, to: merged };
      update['enabled_modules'] = merged;
    }
    if (dto.vocabulary !== undefined) {
      const merged = deepMerge(existing.vocabulary, dto.vocabulary);
      diff['vocabulary'] = { from: existing.vocabulary, to: merged };
      update['vocabulary'] = merged;
    }
    let mergedBranding: unknown;
    if (dto.branding !== undefined) {
      mergedBranding = deepMerge(existing.branding, dto.branding);
      diff['branding'] = { from: existing.branding, to: mergedBranding };
      update['branding'] = mergedBranding;
    }
    if (dto.beta_config !== undefined) {
      const merged = deepMerge(existing.beta_config, dto.beta_config);
      diff['beta_config'] = { from: existing.beta_config, to: merged };
      update['beta_config'] = merged;
    }

    // Workflows are persisted to their own table (chapter_workflows). Incoming
    // keys are validated against the chapter catalog (from getConfig) so an
    // unknown key can never write a row, and only changed rows are upserted.
    const workflowUpserts: Array<{
      chapter_id: string;
      key: string;
      enabled: boolean;
      threshold: number | null;
    }> = [];
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
    let duesUpsert: (DuesConfig & { chapter_id: string }) | null = null;
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

    if (
      Object.keys(update).length === 0 &&
      workflowUpserts.length === 0 &&
      duesUpsert === null
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

    // Write audit log entry. The audit trail is a hard requirement, so a
    // failure here surfaces as an error rather than being silently dropped.
    const { error: auditError } = await this.supabase
      .from('chapter_audit_log')
      .insert({
        chapter_id: chapterId,
        actor_user_id: actorUserId,
        action: 'chapter_config_updated',
        target_type: 'chapter',
        target_id: chapterId,
        scope: 'chapter',
        diff,
        member_visible: true,
      });

    if (auditError) {
      this.logger.error('Failed to write chapter audit log', auditError);
      throw auditError;
    }

    // ADR-08 (Chunk 05): `#chapter-audit` mirroring is now owned by the
    // ChatBridgeWorker which subscribes to `chapter_audit_log` INSERTs and
    // posts the `system_audit` message itself. Each audit-writing service no
    // longer needs to call into chat.

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
    const result = derivePalette({
      dark: colors.dark ?? '#1F1A15',
      accent: colors.accent ?? '#7A5A2F',
    });

    const { error } = await this.supabase
      .from('chapters')
      .update({ theme_palette: result.palette })
      .eq('id', chapterId);

    if (error) {
      this.logger.error('Failed to persist theme palette', error);
      throw error;
    }

    return result;
  }
}
