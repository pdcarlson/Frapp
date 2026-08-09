import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildChapterConfigFromArchetype } from '@repo/org-archetypes';
import { derivePalette } from '@repo/chapter-theme';
import { LEGAL_POLICY_VERSION } from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { ChapterService } from './chapter.service';
import { ActivationService } from './activation.service';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { ChapterOnboardingDto } from '../../interface/dtos/chapter-onboarding.dto';

// Well-known system user UUID (seeded in supabase/migrations). Sender for
// system_audit chat messages — the welcome post and the Chunk 02 audit bridge.
const SYSTEM_SENDER_ID = '00000000-0000-0000-0000-000000000000';

type Branding = Record<string, unknown>;

/**
 * Orchestrates the onboarding wizard submit (Chunk 03), entirely on the cold
 * path (NestJS + service-role Supabase) — never the chat Edge Functions:
 *  1. materialize the chapter config from the archetype seed,
 *  2. create the chapter (+ default roles / membership / channels via
 *     ChapterService.create),
 *  3. post a one-time welcome system_audit message into #general,
 *  4. for manual-entry chapters (no directory match), record a
 *     chapter_directory_requests row so the curated seed can be backfilled.
 */
@Injectable()
export class ChapterOnboardingService {
  private readonly logger = new Logger(ChapterOnboardingService.name);

  constructor(
    private readonly chapterService: ChapterService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly activation: ActivationService,
  ) {}

  async onboard(userId: string, dto: ChapterOnboardingDto): Promise<Chapter> {
    const archetypeKey = dto.org_archetype ?? 'ifc';
    // buildChapterConfigFromArchetype deep-clones (structuredClone) the seed,
    // so per-chapter edits never leak back into the shared catalog.
    const seed = buildChapterConfigFromArchetype(archetypeKey);

    const branding = this.normalizeBranding(dto.branding);
    const colors = (branding.colors ?? {}) as {
      dark?: string;
      accent?: string;
    };
    const themePalette = this.buildPalette(colors);

    const config: Partial<Chapter> = {
      org_archetype: seed.archetype,
      enabled_modules: seed.modules,
      // `vocabulary`/`theme_palette` are stored as loose jsonb
      // (Record<string, unknown>) but sourced from fixed-key interfaces
      // (VocabularyDefaults/ChapterPalette) that carry no index signature, so
      // widen through `unknown` to keep the assignment type-check deterministic.
      vocabulary: seed.vocabulary as unknown as Record<string, unknown>,
      branding,
      directory_id: dto.directory_id ?? null,
      // FRA-17: stamp Terms/Privacy acceptance from the session actor + server
      // clock. The DTO's @Equals(true) guarantees the admin accepted before we
      // reach here, so we set it unconditionally; we never trust a
      // client-supplied timestamp or policy version.
      legal_accepted_at: new Date().toISOString(),
      legal_policy_version: LEGAL_POLICY_VERSION,
      legal_accepted_by: userId,
      ...(themePalette
        ? {
            theme_palette: themePalette as unknown as Record<string, unknown>,
          }
        : {}),
    };

    const chapter = await this.chapterService.create(userId, {
      name: dto.name,
      university: dto.university,
      config,
    });

    // Step 1 of the activation funnel (#267). Recorded here rather than in
    // ChapterService.create so it counts *wizard* completions specifically —
    // the flow the funnel is measuring — and not chapters created by any other
    // caller (tests, seeds, future admin tooling).
    await this.activation.record(
      chapter.id,
      'activation-onboarding-submitted',
      { archetype: seed.archetype },
    );

    // Best-effort: a failed welcome / directory-request write must not roll
    // back an otherwise successfully created chapter.
    await this.postWelcomeMessage(chapter.id, branding).catch((err) =>
      this.logger.warn('Failed to post onboarding welcome message', err),
    );

    if (!dto.directory_id) {
      await this.recordDirectoryRequest(
        chapter.id,
        userId,
        dto,
        branding,
        seed.archetype,
      ).catch((err) =>
        this.logger.warn('Failed to record chapter directory request', err),
      );
    }

    return chapter;
  }

  private normalizeBranding(
    branding?: ChapterOnboardingDto['branding'],
  ): Branding {
    const result: Branding = {};
    if (!branding) return result;
    if (branding.greek_letters) result.greek_letters = branding.greek_letters;
    if (branding.designation) result.designation = branding.designation;
    if (branding.school_short) result.school_short = branding.school_short;
    if (
      typeof branding.founded_at === 'number' &&
      Number.isFinite(branding.founded_at)
    ) {
      result.founded_at = branding.founded_at;
    }
    const colors: Record<string, string> = {};
    if (branding.colors?.dark) colors.dark = branding.colors.dark;
    if (branding.colors?.accent) colors.accent = branding.colors.accent;
    if (Object.keys(colors).length > 0) result.colors = colors;
    return result;
  }

  private buildPalette(colors: { dark?: string; accent?: string }) {
    if (!colors.dark && !colors.accent) return null;
    try {
      return derivePalette({
        dark: colors.dark ?? '#1F1A15',
        accent: colors.accent ?? '#7A5A2F',
      }).palette;
    } catch (err) {
      this.logger.warn('Failed to derive theme palette during onboarding', err);
      return null;
    }
  }

  private async postWelcomeMessage(chapterId: string, branding: Branding) {
    const { data: channel } = await this.supabase
      .from('chat_channels')
      .select('id')
      .eq('chapter_id', chapterId)
      .eq('name', 'general')
      .maybeSingle();

    if (!channel) return;

    const greek = (branding.greek_letters as string | undefined)?.trim();
    const designation = (branding.designation as string | undefined)?.trim();
    const identity = [greek, designation].filter(Boolean).join(' ').trim();
    const welcome = identity
      ? `Welcome to ${identity}. Invite your chapter to get the conversation started.`
      : 'Welcome to your chapter. Invite your chapter to get the conversation started.';

    const { error } = await this.supabase.from('chat_messages').insert({
      channel_id: channel.id,
      sender_id: SYSTEM_SENDER_ID,
      content: welcome,
      kind: 'system_audit',
    });
    if (error) {
      this.logger.warn('Welcome system_audit message insert failed', error);
    }
  }

  private async recordDirectoryRequest(
    chapterId: string,
    userId: string,
    dto: ChapterOnboardingDto,
    branding: Branding,
    // The archetype actually applied to the created chapter (resolved from the
    // seed, defaulted to `ifc` when the DTO omits one) — not the raw DTO value,
    // so the backfill candidate reflects what the officer's chapter really uses.
    effectiveArchetype: string,
  ) {
    const foundedAt = branding.founded_at;
    const { error } = await this.supabase
      .from('chapter_directory_requests')
      .insert({
        chapter_id: chapterId,
        requested_by: userId,
        org_letters: (branding.greek_letters as string | undefined) ?? null,
        org_name: dto.name,
        chapter_designation:
          (branding.designation as string | undefined) ?? null,
        university: dto.university,
        university_short: (branding.school_short as string | undefined) ?? null,
        founded_year: typeof foundedAt === 'number' ? foundedAt : null,
        archetype: effectiveArchetype,
      });
    if (error) {
      this.logger.warn('chapter_directory_requests insert failed', error);
    }
  }
}
