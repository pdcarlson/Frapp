import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { SystemRoleKeys } from '#domain/constants/permissions';
import {
  ASK_DIAGNOSTICS_MAX_DAYS,
  type AskDiagnosticsWindow,
} from '#domain/entities/ask-diagnostics.entity';
import {
  ASK_DIAGNOSTICS_REPOSITORY,
  type IAskDiagnosticsRepository,
} from '#domain/repositories/ask-diagnostics.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { sealAiText } from '#domain/utils/ai-text-cipher';
import {
  aiStoredTextKeyRing,
  askDiagnosticsChapterId,
} from '../../../config/ai-stored-text-config';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { AiConsentService } from '../ai/ai-consent.service';
import { ChapterAuditLogService } from '../chapter-audit-log.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What `GET /v1/ai/ask` says about the window. */
export interface AskDiagnosticsView {
  /**
   * Whether this chapter is the one the window may be turned on for. False
   * everywhere unless the server names this chapter and holds the key.
   */
  offered: boolean;
  /** Whether the caller may turn it on or off: the chapter's president. */
  can_change: boolean;
  /** When the open window ends, or null when nothing is being kept. */
  ends_at: string | null;
}

/** What one kept exchange holds, before it is sealed. No ids of people. */
export interface AskDiagnosticsRecord {
  question: string;
  status: string;
  /** What the model wrote, before Frapp's checks changed what was shown. */
  answer: string;
  sources: Array<{ kind: string; title: string; detail: string | null }>;
  tools: string[];
  model: string;
  prompt_version: string;
  unverified_citations: number;
}

/** The same answer as a route that does not exist. */
function notOffered(): NotFoundException {
  return new NotFoundException({
    code: 'ai.ask.diagnostics.not_offered',
    message: 'This is not available for your chapter.',
  });
}

function presidentOnly(): ForbiddenException {
  return new ForbiddenException({
    code: 'ai.ask.diagnostics.president_only',
    message: "Only the chapter's president can turn saving on or off.",
  });
}

/** The context a sealed exchange is bound to, so it opens only as this chapter's. */
export function askDiagnosticsContext(chapterId: string): string {
  return `ask-diagnostics:${chapterId}`;
}

/**
 * The beta diagnostics window on Ask (`spec/behavior/ai.md` § Stored AI
 * text, ADR-28 decision 8, #4315).
 *
 * Off unless three things are true together: the server names this chapter
 * (`AI_DIAGNOSTICS_CHAPTER_ID`), the server holds a key to seal with
 * (`AI_STORED_TEXT_KEY`), and the chapter's president said yes, which is
 * recorded in the audit log. The yes fixes an end date 14 days out. Nothing
 * extends it: at that date the sweep deletes the window and everything it
 * kept, and the president can do the same sooner.
 *
 * It keeps Ask only, and never an answer that had chat in front of it. A
 * member's exchanges go when they leave the chapter or delete their account
 * (a cascade from their membership row), and when they answer No on the AI
 * sheet (the listener below).
 */
@Injectable()
export class AskDiagnosticsService implements OnModuleInit {
  private readonly logger = new Logger(AskDiagnosticsService.name);

  constructor(
    @Inject(ASK_DIAGNOSTICS_REPOSITORY)
    private readonly store: IAskDiagnosticsRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    private readonly consent: AiConsentService,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  onModuleInit(): void {
    // A No on the AI sheet takes the member's kept questions with it. Safe
    // to run twice, as the consent service requires.
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.store.deleteExchangesByUser(userId);
    });
  }

  /** The chapter's open window, or null: none, or one that has run out. */
  async openWindow(
    chapterId: string,
    now: Date,
  ): Promise<AskDiagnosticsWindow | null> {
    if (!this.offeredTo(chapterId)) return null;
    const window = await this.store.findWindow(chapterId);
    // A window past its end keeps nothing more, even before the sweep
    // deletes it.
    return window && new Date(window.ends_at).getTime() > now.getTime()
      ? window
      : null;
  }

  async view(
    chapterId: string,
    roleIds: readonly string[],
    now: Date,
  ): Promise<AskDiagnosticsView> {
    const offered = this.offeredTo(chapterId);
    if (!offered) return { offered, can_change: false, ends_at: null };
    const [window, president] = await Promise.all([
      this.openWindow(chapterId, now),
      this.isPresident(chapterId, roleIds),
    ]);
    return {
      offered,
      can_change: president,
      ends_at: window?.ends_at ?? null,
    };
  }

  /** The president's yes. Fixes the end date and records who said it. */
  async start(
    chapterId: string,
    actor: { userId: string; roleIds: readonly string[] },
    now: Date,
  ): Promise<AskDiagnosticsView> {
    await this.assertMayChange(chapterId, actor.roleIds);
    // A window that ran out and has not been swept yet would block a new
    // one; clear it first.
    await this.store.deleteExpiredWindows(now);
    const endsAt = new Date(now.getTime() + ASK_DIAGNOSTICS_MAX_DAYS * DAY_MS);
    const window = await this.store.openWindow({
      chapterId,
      startedBy: actor.userId,
      startedAt: now,
      endsAt,
    });
    if (!window) {
      throw new ConflictException({
        code: 'ai.ask.diagnostics.already_on',
        message: 'Saving is already on.',
      });
    }
    try {
      await this.auditLog.record({
        chapterId,
        actorUserId: actor.userId,
        action: 'ai_diagnostics_started',
        targetType: 'chapter',
        targetId: chapterId,
        diff: { ends_at: window.ends_at },
      });
    } catch (error) {
      // No window without a record of who agreed to it.
      await this.store.deleteWindow(chapterId);
      throw error;
    }
    return { offered: true, can_change: true, ends_at: window.ends_at };
  }

  /**
   * Turns it off early and deletes everything it kept. The president can do
   * this whatever the server's settings say now: a window that was opened
   * must stay closable after `AI_DIAGNOSTICS_CHAPTER_ID` is unset or moved to
   * another chapter. The record is written first, so a stop that deleted
   * something is never missing from the audit log; a record with nothing
   * left to delete is harmless.
   */
  async stop(
    chapterId: string,
    actor: { userId: string; roleIds: readonly string[] },
  ): Promise<AskDiagnosticsView> {
    const [president, window] = await Promise.all([
      this.isPresident(chapterId, actor.roleIds),
      this.store.findWindow(chapterId),
    ]);
    if (!window && !this.offeredTo(chapterId)) throw notOffered();
    if (!president) throw presidentOnly();
    if (window) {
      await this.auditLog.record({
        chapterId,
        actorUserId: actor.userId,
        action: 'ai_diagnostics_stopped',
        targetType: 'chapter',
        targetId: chapterId,
      });
      await this.store.deleteWindow(chapterId);
    }
    return {
      offered: this.offeredTo(chapterId),
      can_change: true,
      ends_at: null,
    };
  }

  /**
   * Keeps one exchange under the chapter's open window, sealed. Returns
   * whether it was kept. Never throws: a failure to keep a diagnostic copy
   * must not cost the member their answer. It is reported without any of
   * the text.
   */
  async keep(
    chapterId: string,
    userId: string,
    record: AskDiagnosticsRecord,
    now: Date,
  ): Promise<boolean> {
    try {
      const window = await this.openWindow(chapterId, now);
      if (!window) return false;
      const member = await this.members.findByUserAndChapter(userId, chapterId);
      if (!member) return false;
      const sealed = sealAiText(
        aiStoredTextKeyRing(),
        JSON.stringify(record),
        askDiagnosticsContext(chapterId),
      );
      const kept = await this.store.insertExchange({
        chapterId,
        windowId: window.id,
        memberId: member.id,
        userId,
        sealed,
        createdAt: now,
      });
      // A No on the AI sheet while the answer was being written has already
      // deleted this member's rows; this one landed after. Read their answer
      // again and take it back out.
      if (kept && !(await this.stillAgrees(userId))) {
        await this.store.deleteExchangesByUser(userId);
        return false;
      }
      return kept;
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ask-diagnostics-keep',
        message: 'Ask diagnostics: an exchange could not be kept',
        // The error is a database or cipher error; neither carries the text.
        error,
      });
      return false;
    }
  }

  /** One tick of the sweep. Returns how many windows ended. */
  sweep(now: Date): Promise<number> {
    return this.store.deleteExpiredWindows(now);
  }

  private offeredTo(chapterId: string): boolean {
    return (
      askDiagnosticsChapterId() === chapterId.toLowerCase() &&
      aiStoredTextKeyRing() !== null
    );
  }

  private async stillAgrees(userId: string): Promise<boolean> {
    const state = await this.consent.getConsentState(userId);
    return state.answer === 'yes';
  }

  private async assertMayChange(
    chapterId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    if (!this.offeredTo(chapterId)) throw notOffered();
    if (!(await this.isPresident(chapterId, roleIds))) throw presidentOnly();
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
