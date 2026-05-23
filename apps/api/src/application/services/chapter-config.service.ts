import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  buildChapterConfigFromArchetype,
  getArchetype,
} from '@repo/org-archetypes';
import { derivePalette } from '@repo/chapter-theme';
import type { PatchChapterConfigDto } from '../../interface/dtos/chapter-config.dto';

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
      .single();

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
    if (dto.enabled_modules !== undefined) {
      diff['enabled_modules'] = {
        from: existing.enabled_modules,
        to: dto.enabled_modules,
      };
      update['enabled_modules'] = dto.enabled_modules;
    }
    if (dto.vocabulary !== undefined) {
      diff['vocabulary'] = { from: existing.vocabulary, to: dto.vocabulary };
      update['vocabulary'] = dto.vocabulary;
    }
    if (dto.branding !== undefined) {
      diff['branding'] = { from: existing.branding, to: dto.branding };
      update['branding'] = dto.branding;
    }
    if (dto.beta_config !== undefined) {
      diff['beta_config'] = { from: existing.beta_config, to: dto.beta_config };
      update['beta_config'] = dto.beta_config;
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

    // Write audit log entry
    await this.supabase.from('chapter_audit_log').insert({
      chapter_id: chapterId,
      actor_user_id: actorUserId,
      action: 'chapter_config_updated',
      target_type: 'chapter',
      target_id: chapterId,
      scope: 'chapter',
      diff,
      member_visible: true,
    });

    // Post system_audit message to #chapter-audit (best-effort)
    await this.postAuditMessage(chapterId, diff).catch((err) =>
      this.logger.warn('Failed to post audit message', err),
    );

    // Recompute theme palette if branding colors changed
    if (dto.branding?.colors) {
      await this.recomputePalette(chapterId, dto.branding.colors).catch((err) =>
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
      .single();

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

    await this.supabase
      .from('chapters')
      .update({ theme_palette: result.palette })
      .eq('id', chapterId);

    return result;
  }

  private async postAuditMessage(
    chapterId: string,
    diff: Record<string, unknown>,
  ) {
    // Find the #chapter-audit channel for this chapter
    const { data: channel } = await this.supabase
      .from('chat_channels')
      .select('id')
      .eq('chapter_id', chapterId)
      .eq('name', 'chapter-audit')
      .maybeSingle();

    if (!channel) return;

    const keys = Object.keys(diff).join(', ');
    await this.supabase.from('chat_messages').insert({
      channel_id: channel.id,
      sender_id: '00000000-0000-0000-0000-000000000000', // system sentinel
      content: `Chapter configuration updated: ${keys}`,
      kind: 'system_audit',
      payload: diff,
    });
  }
}
