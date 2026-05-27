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
      beta_config:
        (chapter as Record<string, unknown>)['beta_config'] ?? seed.dues,
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

    if (Object.keys(update).length === 0) {
      return existing;
    }

    const { error: updateError } = await this.supabase
      .from('chapters')
      .update(update)
      .eq('id', chapterId);

    if (updateError) {
      this.logger.error('Failed to update chapter config', updateError);
      throw updateError;
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
