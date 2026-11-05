import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildChapterConfigFromArchetype } from '@repo/org-archetypes';
import type { CustomFieldEntry } from '@repo/org-archetypes';
import {
  buildChapterPalette,
  chapterPaletteColumns,
  logChapterPaletteWarnings,
  type ChapterBrandingInput,
} from './chapter-palette';
import { buildCustomFieldRows } from './custom-field-provisioning';
import { LEGAL_POLICY_VERSION } from '#domain/constants/legal';
import { ChapterService } from './chapter.service';
import { ActivationService } from './activation.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import type { Chapter } from '#domain/entities/chapter.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  type IChatChannelRepository,
  type IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  CUSTOM_FIELD_REPOSITORY,
  type ICustomFieldRepository,
} from '#domain/repositories/custom-field.repository.interface';
import {
  CHAPTER_DIRECTORY_REPOSITORY,
  type IChapterDirectoryRepository,
  type NewChapterDirectoryRequest,
} from '#domain/repositories/chapter-directory.repository.interface';

type Branding = Record<string, unknown>;

/**
 * What `onboard` needs from the wizard submit.
 *
 * `accept_terms_privacy` is **required here**, and that is deliberate.
 * `onboard` stamps the chapter's `legal_accepted_at`, `legal_policy_version`
 * and `legal_accepted_by` unconditionally (`spec/behavior/legal.md`), so the
 * acceptance record it writes is only truthful because
 * `ChapterOnboardingDto`'s `@Equals(true)` refused the request otherwise. It
 * also passes the flag to `LegalAcceptanceService.requireOrAccept`, which
 * records the officer's own acceptance on their user row (#2302). Dropping the field from this signature would leave that gate
 * enforceable by exactly one controller, and a second caller — a backfill, a
 * seed, a partner-provisioning route with its own DTO — could then compile a
 * call that writes a legal acceptance for an acceptance that never happened.
 * Keeping it in the signature is what makes such a caller state the claim.
 * (It is `boolean`, not the literal `true`, only so the DTO stays assignable;
 * `@Equals(true)` is what enforces the value.)
 *
 * The interface layer's `ChapterOnboardingDto` is the validated wire shape and
 * stays there: the application layer may not import it (dependency-cruiser
 * `api-application-not-to-interface`), and `ChapterController.onboard` is where the two
 * meet. That call site checks assignability, which is **one-directional**:
 * it catches a field this type requires that the DTO stopped supplying, and
 * it does not catch a field added to the DTO and never added here — that one
 * validates on the wire and is silently dropped before it reaches this
 * service. Widen the DTO and this type together.
 */
export interface ChapterOnboardingInput {
  /** Chapter display name (org name). */
  name: string;
  /** University / institution name. */
  university: string;
  /** Org archetype key (`ifc`, `npc`, …). Defaults to `ifc` when omitted. */
  org_archetype?: string;
  /** `chapter_directory` row id when the wizard matched a listed chapter. */
  directory_id?: string;
  branding?: ChapterBrandingInput;
  /** The admin accepted the Terms of Service and Privacy Policy. See above. */
  accept_terms_privacy: boolean;
}

/**
 * Orchestrates the onboarding wizard submit (Chunk 03), entirely on the cold
 * path (NestJS + service-role Supabase), not the chat hot path:
 *  1. materialize the chapter config from the archetype seed,
 *  2. create the chapter (+ default roles / membership / channels via
 *     ChapterService.create),
 *  3. seed the archetype's default custom fields into chapter_custom_fields,
 *  4. post a one-time welcome system_audit message into #general,
 *  5. for manual-entry chapters (no directory match), record a
 *     chapter_directory_requests row so the curated seed can be backfilled.
 */
@Injectable()
export class ChapterOnboardingService {
  private readonly logger = new Logger(ChapterOnboardingService.name);

  constructor(
    private readonly chapterService: ChapterService,
    @Inject(CUSTOM_FIELD_REPOSITORY)
    private readonly customFieldRepo: ICustomFieldRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAPTER_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: IChapterDirectoryRepository,
    private readonly activation: ActivationService,
    private readonly legalAcceptance: LegalAcceptanceService,
  ) {}

  async onboard(userId: string, dto: ChapterOnboardingInput): Promise<Chapter> {
    // The same checkbox is also the founding officer's own acceptance (#2302),
    // recorded on their user row before the chapter and their membership
    // exist, so no member is ever created without one. The chapter-level
    // stamp below stays: it is the officer agreeing for the chapter.
    await this.legalAcceptance.requireOrAccept(
      userId,
      dto.accept_terms_privacy,
    );

    const archetypeKey = dto.org_archetype ?? 'ifc';
    // buildChapterConfigFromArchetype deep-clones (structuredClone) the seed,
    // so per-chapter edits never leak back into the shared catalog.
    const seed = buildChapterConfigFromArchetype(archetypeKey);

    const branding = this.normalizeBranding(dto.branding);
    const colors = (branding.colors ?? {}) as { accent?: string };
    const paletteColumns = this.buildPalette(colors);

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
      // conditional spread this replaced could never be false. Stamped with
      // the engine version in the same spread (#1165), so a new chapter is
      // never mistaken for a stale one by the palette sweep.
      ...paletteColumns,
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

    // Best-effort: a failed custom-field / welcome / directory-request write
    // must not roll back an otherwise successfully created chapter, so each
    // rejection (a PostgREST error the repository threw, or fetch/DNS/TLS) is
    // logged and reported to Sentry here, and nowhere else.
    // The field seed and the directory request report at `error`, not `warn`:
    // a failure is silent from the officer's side — onboarding still returns
    // 201 — and nothing retries either write. The field seed also fails for
    // *every* chapter, not one, since the rows are identical each time. A
    // wrong conflict target or a renamed column would otherwise seed nothing
    // indefinitely with no signal above debug noise.
    await this.provisionCustomFields(chapter.id, seed.customFields).catch(
      (err) =>
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'onboarding-custom-field-seed',
          message: 'Failed to provision archetype custom fields',
          error: err,
        }),
    );

    await this.postWelcomeMessage(chapter.id, chapter.name, branding).catch(
      (err) =>
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'onboarding-welcome-message',
          message: 'Failed to post onboarding welcome message',
          error: err,
        }),
    );

    if (!dto.directory_id) {
      await this.recordDirectoryRequest(
        chapter.id,
        userId,
        dto,
        branding,
        seed.archetype,
      ).catch((err) =>
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'onboarding-directory-request',
          message: 'Failed to record chapter directory request',
          error: err,
        }),
      );
    }

    return chapter;
  }

  private normalizeBranding(
    branding?: ChapterOnboardingInput['branding'],
  ): Branding {
    const result: Branding = {};
    if (!branding) return result;
    if (branding.greek_letters) result.greek_letters = branding.greek_letters;
    const shortName = branding.short_name?.trim();
    if (shortName) result.short_name = shortName;
    // Stored only as an opt-out: absent already means shown, so a chapter that
    // keeps its letters carries no key it didn't choose.
    if (branding.show_greek_letters === false)
      result.show_greek_letters = false;
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
    // wrong brand colour and nothing anywhere records it (#840). The same goes
    // for a failed contrast or fill check, which only a generator change causes.
    logChapterPaletteWarnings(
      this.logger,
      'during onboarding',
      colors.accent,
      build,
    );

    return chapterPaletteColumns(build);
  }

  /**
   * Seed the archetype's default custom fields (#572). Without this a freshly
   * onboarded chapter opens Settings → Fields on an empty table, even though
   * `buildChapterConfigFromArchetype` already materialized the defaults.
   *
   * Written directly rather than through `CustomFieldService.create` on
   * purpose: that path appends a `chapter_audit_log` row per field, which the
   * ChatBridgeWorker mirrors into #chapter-audit — so routing 8 seed fields
   * through it would open every new chapter with 8 audit messages before a
   * human has touched anything. The two guarantees that matter (a per-chapter
   * `options` structure, and select-requires-choices) are kept by
   * `buildCustomFieldRows`; the audit trail is not, matching how default roles
   * and channels are seeded.
   *
   * Re-running provisioning is a no-op (see `seedDefaults`).
   */
  private async provisionCustomFields(
    chapterId: string,
    entries: readonly CustomFieldEntry[],
  ) {
    const { rows, skipped } = buildCustomFieldRows(chapterId, entries);

    // A malformed seed entry is a repo bug, not a chapter's problem — the rest
    // still seeds, but it must not disappear silently.
    if (skipped.length > 0) {
      this.logger.warn(
        `Skipped malformed custom-field seed entries: ${skipped.join(', ')}`,
      );
    }
    if (rows.length === 0) return;

    // A failure rejects to `onboard`, which logs it.
    await this.customFieldRepo.seedDefaults(rows);
  }

  private async postWelcomeMessage(
    chapterId: string,
    chapterName: string | null | undefined,
    branding: Branding,
  ) {
    const channel = await this.channelRepo.findByName(chapterId, 'general');
    if (!channel) return;

    // Names only, never Greek letters: some organizations (Phi Gamma Delta
    // among them) don't allow their letters to be shown, and a system post is
    // not where a chapter decides that (#2876, #3347). The short name ("FIJI")
    // when the wizard set one, else the organization's name.
    const shortName =
      typeof branding.short_name === 'string' ? branding.short_name.trim() : '';
    const designation =
      typeof branding.designation === 'string'
        ? branding.designation
        : undefined;
    const welcome = `${welcomeGreeting(
      shortName || chapterName?.trim() || undefined,
      designation,
    )} Invite your chapter to get the conversation started.`;

    await this.messageRepo.create({
      channel_id: channel.id,
      sender_id: SYSTEM_SENDER_ID,
      content: welcome,
      kind: 'system_audit',
    });
  }

  private async recordDirectoryRequest(
    chapterId: string,
    userId: string,
    dto: ChapterOnboardingInput,
    branding: Branding,
    // The archetype actually applied to the created chapter (resolved from the
    // seed, defaulted to `ifc` when the DTO omits one) — not the raw DTO value,
    // so the backfill candidate reflects what the officer's chapter really uses.
    effectiveArchetype: string,
  ) {
    const foundedAt = branding.founded_at;
    const request: NewChapterDirectoryRequest = {
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
    await this.directoryRepo.createRequest(request);
  }
}

/** Greek and Coptic, plus Greek Extended: any of them means letters. */
const GREEK_LETTER = /[\u0370-\u03FF\u1F00-\u1FFF]/;

/**
 * The welcome post's first sentence: designation first, then the chapter's
 * name, as "Welcome to the Tau Nu chapter of FIJI." (owner's call, #3347).
 *
 * `name` is free text (the short name, else the wizard's "Chapter /
 * organization name", which manual entry seeds from the raw search), so it is
 * cleaned rather than trusted:
 * - a name (or designation) with any Greek letter in it is dropped, because
 *   some organizations (Phi Gamma Delta) don't allow their letters to be shown;
 * - a name that repeats the designation ("FIJI Tau Nu" with "Tau Nu") loses
 *   it, and one that is only the designation is dropped.
 * A designation typed as "Tau Nu Chapter" (or "Tau Nu chapter.") loses its own
 * trailing "chapter", so the sentence doesn't say it twice.
 */
export function welcomeGreeting(
  name: string | undefined,
  rawDesignation: string | undefined,
): string {
  const cleaned = rawDesignation
    ?.trim()
    .replace(/(^|\s+)chapter[\s.,;:!]*$/i, '')
    .trim();
  // A designation typed in Greek ("ΤΝ") is letters too.
  const designation =
    cleaned && !GREEK_LETTER.test(cleaned) ? cleaned : undefined;
  const nameText = cleanName(name, designation);
  if (designation && nameText) {
    return `Welcome to the ${designation} chapter of ${nameText}.`;
  }
  if (designation) return `Welcome to the ${designation} chapter.`;
  if (nameText) return `Welcome to ${nameText}.`;
  return 'Welcome to your chapter.';
}

function cleanName(
  name: string | undefined,
  designation: string | undefined,
): string | undefined {
  const text = name?.trim();
  if (!text || GREEK_LETTER.test(text)) return undefined;
  if (!designation) return text;
  const lower = text.toLowerCase();
  const d = designation.toLowerCase();
  if (lower === d) return undefined;
  let stripped = text;
  if (lower.endsWith(` ${d}`)) stripped = text.slice(0, -d.length - 1);
  else if (lower.startsWith(`${d} `)) stripped = text.slice(d.length + 1);
  return stripped.trim() || undefined;
}
