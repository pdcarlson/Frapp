import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type {
  AiCallDescriptor,
  AiFeatureFamily,
} from '#domain/adapters/ai-call-context';
import type {
  AiConsentDecision,
  IAiConsentCheck,
} from '#domain/adapters/ai-consent-check.interface';
import {
  AI_CHAPTER_SWITCHES,
  AI_CONSENT_SHEET,
  AI_FAMILY_SWITCH,
  type AiChapterSwitch,
} from '#domain/constants/ai-consent-sheet';
import { SystemRoleKeys } from '#domain/constants/permissions';
import type { ChapterAiSettings } from '#domain/entities/ai-consent.entity';
import {
  AI_CONSENT_REPOSITORY,
  type ChapterAiSettingsPatch,
  type IAiConsentRepository,
} from '#domain/repositories/ai-consent.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { ChapterAuditLogService } from '../chapter-audit-log.service';

/** The column each switch is stored in. */
const SWITCH_COLUMN: Readonly<
  Record<AiChapterSwitch, keyof ChapterAiSettingsPatch>
> = {
  ask: 'ask_enabled',
  meeting_notes: 'meeting_notes_enabled',
  chat_source: 'chat_source_enabled',
};

/**
 * Families that read the chapter's records for the chapter, so they need the
 * chapter's switch and no member's Yes: today, building the index
 * (`corpus`). Embedding a member's question to search it is that member's own
 * use, which this gate does not see apart from indexing, so the route that
 * searches asks for the member's Yes first (an `ask` check) (#4311).
 */
const CHAPTER_RECORD_FAMILIES: ReadonlySet<AiFeatureFamily> = new Set([
  'corpus',
]);

/** What a feature does when a person answers No: see `onConsentWithdrawn`. */
export type AiConsentWithdrawnListener = (userId: string) => Promise<void>;

/** The chapter's switches as the API shows them. */
export interface AiChapterSettingsView {
  ask: boolean;
  meeting_notes: boolean;
  chat_source: boolean;
  /** When a switch last changed, or null when none ever has. */
  updated_at: string | null;
  /**
   * Whether the caller may change the switches: they hold the chapter's
   * President role. Clients draw the switches read-only otherwise; the PATCH
   * checks again, so this is a hint, never the gate.
   */
  can_change: boolean;
}

/** A person's standing against the current AI sheet. */
export interface AiConsentState {
  sheet: typeof AI_CONSENT_SHEET;
  /**
   * Their answer on this version: `yes`, `no`, or null when they have not
   * answered it, which counts as No.
   */
  answer: 'yes' | 'no' | null;
  answered_at: string | null;
  /**
   * True when they answered an earlier version and not this one: the sheet
   * changed since, so a client asks again and can say why.
   */
  sheet_changed: boolean;
}

function settingsView(
  row: ChapterAiSettings | null,
  canChange: boolean,
): AiChapterSettingsView {
  return {
    ask: row?.ask_enabled ?? false,
    meeting_notes: row?.meeting_notes_enabled ?? false,
    chat_source: row?.chat_source_enabled ?? false,
    updated_at: row?.updated_at ?? null,
    can_change: canChange,
  };
}

/**
 * The AI consent gates (#4308, `spec/behavior/ai.md` § Consent): the
 * president's switch for each feature family, and each person's answer on
 * the versioned AI sheet.
 *
 * It is the gateway's consent check (bound in
 * `modules/ai/ai-consent-seam.module.ts`), asked before every model call:
 * the family's switch must be on and, except for indexing the chapter's
 * records, the acting member must have said yes on the current sheet version. Nothing is cached, so turning a switch off or
 * answering No stops the next call.
 *
 * Whose chat messages may be read is a separate question, answered where the
 * corpus is read: {@link AiConsentService.chatAuthorsWhoSaidYes}.
 */
@Injectable()
export class AiConsentService implements IAiConsentCheck {
  private readonly withdrawnListeners: AiConsentWithdrawnListener[] = [];

  constructor(
    @Inject(AI_CONSENT_REPOSITORY)
    private readonly consents: IAiConsentRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  /**
   * Runs `listener` each time a person answers No, so what was made from
   * their words can let go of them (`spec/behavior/ai.md` § Chat as a
   * source): a waiting suggestion drops its quote of them (#4309), and the
   * chat index drops their messages (#4314). A feature registers in its own
   * `onModuleInit`. Listeners run after the No is saved and are awaited, so
   * one that fails fails the request, and the member's retry runs it again;
   * each must therefore be safe to run twice. Deleting an account is the same
   * opt-out, and is handled in `anonymize_user`, not here.
   */
  onConsentWithdrawn(listener: AiConsentWithdrawnListener): void {
    this.withdrawnListeners.push(listener);
  }

  async check(call: AiCallDescriptor): Promise<AiConsentDecision> {
    const [settings, consent] = await Promise.all([
      this.consents.findChapterSettings(call.chapterId),
      this.consents.findConsent(call.actingUserId, AI_CONSENT_SHEET.version),
    ]);
    const column = SWITCH_COLUMN[AI_FAMILY_SWITCH[call.family]];
    if (settings?.[column] !== true) {
      return { allowed: false, reason: 'chapter_off' };
    }
    // Indexing the chapter's records serves the chapter, not the member the
    // run names: the president's switch is the whole gate for them, whoever
    // uploaded or posted them, so a document from an officer who said No is
    // still indexed (`spec/behavior/ai.md` § Consent). A member's own words
    // are not records: their messages are filtered by author
    // (`chatAuthorsWhoSaidYes`), and their question is the Ask family's.
    if (CHAPTER_RECORD_FAMILIES.has(call.family)) return { allowed: true };
    if (consent?.accepted !== true) {
      return { allowed: false, reason: 'member_declined' };
    }
    return { allowed: true };
  }

  /**
   * Of `authorIds`, the members whose chat messages may be read in this
   * chapter: none while the chapter's chat switch is off, otherwise those who
   * said yes on the current sheet (`spec/behavior/ai.md` § Chat as a
   * source). The corpus reads only these authors' messages and counts the
   * rest as left out.
   */
  async chatAuthorsWhoSaidYes(
    chapterId: string,
    authorIds: readonly string[],
  ): Promise<Set<string>> {
    if (authorIds.length === 0) return new Set();
    const settings = await this.consents.findChapterSettings(chapterId);
    if (settings?.chat_source_enabled !== true) return new Set();
    return new Set(
      await this.consents.findAcceptedUserIds(
        authorIds,
        AI_CONSENT_SHEET.version,
      ),
    );
  }

  /**
   * The chapter's switches, and whether `viewerRoleIds` may change them, so
   * the settings page draws them read-only for everyone but the president.
   */
  async getChapterSettings(
    chapterId: string,
    viewerRoleIds: readonly string[],
  ): Promise<AiChapterSettingsView> {
    const [row, canChange] = await Promise.all([
      this.consents.findChapterSettings(chapterId),
      this.isPresident(chapterId, viewerRoleIds),
    ]);
    return settingsView(row, canChange);
  }

  /**
   * Turns switches on or off. Only the chapter's President may (the member
   * holding its `PRESIDENT` role, as for exec-only audit rows), because the
   * switch shares the chapter's records with a provider. Every change is
   * audited and mirrored to `#chapter-audit`; a request that changes nothing
   * writes nothing.
   */
  async updateChapterSettings(
    chapterId: string,
    actor: { userId: string; roleIds: readonly string[] },
    changes: Partial<Record<AiChapterSwitch, boolean>>,
  ): Promise<AiChapterSettingsView> {
    if (!(await this.isPresident(chapterId, actor.roleIds))) {
      throw new ForbiddenException({
        code: 'ai.settings.president_only',
        message: "Only the chapter's president can turn AI features on or off.",
      });
    }

    const existing = await this.consents.findChapterSettings(chapterId);
    const before = settingsView(existing, true);
    const patch: ChapterAiSettingsPatch = {};
    const diff: Record<string, { from: boolean; to: boolean }> = {};
    for (const key of AI_CHAPTER_SWITCHES) {
      const to = changes[key];
      if (to === undefined || to === before[key]) continue;
      patch[SWITCH_COLUMN[key]] = to;
      diff[key] = { from: before[key], to };
    }
    if (Object.keys(diff).length === 0) return before;

    const saved = await this.consents.saveChapterSettings(
      chapterId,
      patch,
      actor.userId,
      new Date(),
    );
    // After the write, as chapter config does: a failed audit fails the
    // request. The switches are then put back as they were, so a switch is
    // never left changed without a record of who changed it, and the
    // president's retry finds the change still to make and audits it.
    try {
      await this.auditLog.record({
        chapterId,
        actorUserId: actor.userId,
        action: 'ai_settings_updated',
        targetType: 'chapter',
        targetId: chapterId,
        diff,
      });
    } catch (error) {
      const restore: ChapterAiSettingsPatch = {};
      for (const key of Object.keys(diff) as AiChapterSwitch[]) {
        restore[SWITCH_COLUMN[key]] = before[key];
      }
      await this.consents.saveChapterSettings(
        chapterId,
        restore,
        existing?.updated_by ?? actor.userId,
        existing ? new Date(existing.updated_at) : new Date(),
      );
      throw error;
    }
    return settingsView(saved, true);
  }

  async getConsentState(userId: string): Promise<AiConsentState> {
    const latest = await this.consents.findLatestConsent(userId);
    return this.stateFrom(latest);
  }

  /**
   * Records the person's answer, from the sheet or later from Settings. The
   * answer is for the version the client showed, which must be the current
   * one: a Yes given to an older sheet would cover a provider or a kind of
   * data the person never saw.
   */
  async answer(
    userId: string,
    sheetVersion: number,
    accepted: boolean,
  ): Promise<AiConsentState> {
    if (sheetVersion !== AI_CONSENT_SHEET.version) {
      throw new ConflictException({
        code: 'ai.consent.stale_sheet',
        message:
          'The AI sheet has changed since it was shown. Show the current one and ask again.',
      });
    }
    const saved = await this.consents.saveConsent(
      userId,
      sheetVersion,
      accepted,
      new Date(),
    );
    if (!accepted) {
      for (const listener of this.withdrawnListeners) await listener(userId);
    }
    return this.stateFrom(saved);
  }

  private stateFrom(
    latest: {
      sheet_version: number;
      accepted: boolean;
      answered_at: string;
    } | null,
  ): AiConsentState {
    const current = latest?.sheet_version === AI_CONSENT_SHEET.version;
    return {
      sheet: AI_CONSENT_SHEET,
      answer: current ? (latest.accepted ? 'yes' : 'no') : null,
      answered_at: current ? latest.answered_at : null,
      sheet_changed: latest !== null && !current,
    };
  }

  private async isPresident(
    chapterId: string,
    roleIds: readonly string[],
  ): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const president = await this.roles.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.PRESIDENT,
    );
    return president !== null && roleIds.includes(president.id);
  }
}
