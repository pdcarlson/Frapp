import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildChapterConfigFromArchetype } from '@repo/org-archetypes';
import { buildChapterPalette } from './chapter-palette';
import { LEGAL_POLICY_VERSION } from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import { ChapterService } from './chapter.service';
import { ActivationService } from './activation.service';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { ChapterOnboardingDto } from '../../interface/dtos/chapter-onboarding.dto';
import { SYSTEM_SENDER_ID } from '../../domain/constants/chat';

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
    const colors = (branding.colors ?? {}) as { accent?: string };
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
      // #795: the wizard's accent never reached `chapters.accent_color`, so the
      // column kept its schema default `#2563EB` and every surface reading it —
      // the dashboard shell, mobile branding, the membership summary — showed
      // Royal Blue for a chapter that had chosen something else. `branding` is
      // authoritative; this mirrors it into the column in the same INSERT.
      ...(colors.accent ? { accent_color: colors.accent } : {}),
      // Always present now: `buildChapterPalette` yields at least the Signet
      // map even for a chapter that supplied no colours, because §3 defines the
      // no-accent case as the house seed run through the same pipeline. The
      // conditional spread this replaced could never be false.
      theme_palette: themePalette,
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
    if (branding.colors?.accent) colors.accent = branding.colors.accent;
    if (Object.keys(colors).length > 0) result.colors = colors;
    return result;
  }

  private buildPalette(colors: { accent?: string }) {
    const build = buildChapterPalette(colors);

    // A substituted colour is always an upstream data or plumbing bug, and
    // without a log the chapter is simply onboarded with a plausible-looking
    // wrong brand colour and nothing anywhere records it (#840).
    if (build.invalidSeed) {
      this.logger.warn(
        `Invalid chapter accent seed during onboarding: accent="${colors.accent}" — substituted house gold. Expected #RRGGBB.`,
      );
    }

    return build.palette;
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

    const welcomeMessage: TablesInsert<'chat_messages'> = {
      channel_id: channel.id,
      sender_id: SYSTEM_SENDER_ID,
      content: welcome,
      kind: 'system_audit',
    };
    const { error } = await this.supabase
      .from('chat_messages')
      .insert(welcomeMessage);
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
    const request: TablesInsert<'chapter_directory_requests'> = {
      chapter_id: chapterId,
      requested_by: userId,
      org_letters: (branding.greek_letters as string | undefined) ?? null,
      org_name: dto.name,
      chapter_designation: (branding.designation as string | undefined) ?? null,
      university: dto.university,
      university_short: (branding.school_short as string | undefined) ?? null,
      founded_year: typeof foundedAt === 'number' ? foundedAt : null,
      archetype: effectiveArchetype,
    };
    const { error } = await this.supabase
      .from('chapter_directory_requests')
      .insert(request);
    if (error) {
      this.logger.warn('chapter_directory_requests insert failed', error);
    }
  }
}
