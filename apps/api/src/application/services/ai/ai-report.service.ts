import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  AI_REPORT_RETENTION_DAYS,
  MEETING_DRAFT_PROMPT_VERSION,
  type AiReportReason,
  type AiReportSubject,
} from '@repo/validation';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import {
  AI_REPORT_REPOSITORY,
  type IAiReportRepository,
} from '#domain/repositories/ai-report.repository.interface';
import {
  AskReportReceiptError,
  openAskReportReceipt,
} from '#domain/utils/ai-report-receipt';
import { sealAiText } from '#domain/utils/ai-text-cipher';
import { aiStoredTextKeyRing } from '../../../config/ai-stored-text-config';
import { ACT_PLAN_PROMPT_VERSION } from '../act/act-prompt';
import { AiSuggestionService } from '../ai-suggestion.service';
import { MeetingDraftService } from '../meeting-draft.service';
import type { EnabledModules } from '../module-gate';
import { AiConsentService } from './ai-consent.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AiReportInput {
  /** From `ChapterGuard`. */
  chapterId: string;
  /** The reporter, from the auth guard. */
  userId: string;
  enabledModules: EnabledModules | null;
  subject: AiReportSubject;
  subjectId: string;
  reason: AiReportReason;
  note?: string | null;
  /** Ask only: the answer's `report_receipt`, as the server sent it. */
  receipt?: string | null;
}

export interface AiReportOutcome {
  /** This member had already reported this; nothing new was kept. */
  already_reported: boolean;
  /** Whether the text itself was kept, sealed, or only the reason and note. */
  kept_text: boolean;
  /** When what was kept is deleted. */
  expires_at: string;
}

/** What a report keeps of its subject, before it is sealed. */
interface Kept {
  /**
   * What the row names as reported, when it differs from what the client
   * sent: a draft is named by its request, so a draft asked for again can
   * be reported again.
   */
  subjectId?: string;
  exchange: Record<string, unknown> | null;
  /** Members whose own words are in `exchange`. */
  quoted: string[];
  model: string | null;
  promptVersion: string | null;
}

const NOTHING: Kept = {
  exchange: null,
  quoted: [],
  model: null,
  promptVersion: null,
};

/** The context a report is sealed to, so it opens only as this chapter's. */
export function aiReportContext(chapterId: string): string {
  return `ai-report:${chapterId}`;
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'ai.report.not_found',
    message: 'There is nothing to report here any more.',
  });
}

/**
 * Report this (#4315, `spec/behavior/ai.md` § Stored AI text, ADR-28
 * decision 8): a member flags something the AI made, and that one exchange
 * is kept, sealed, for 30 days, for the Frapp team. It is the one place AI
 * text is stored on purpose.
 *
 * - **Only what the member could see.** A draft is reported by someone who
 *   may edit those minutes, a suggestion by someone whose Suggested list
 *   holds it, and an answer only by the member it was given to (its receipt
 *   opens for no one else). The text kept is the server's own copy, never
 *   what the client sends: Ask's comes from the receipt the server sealed
 *   into the answer, the others from the database.
 * - **No key, no text.** Without `AI_STORED_TEXT_KEY` the report still
 *   records what was reported, why, and the member's note, but none of the
 *   exchange.
 * - **Whose words.** Each report records the members it quotes. Their No on
 *   the AI sheet (the listener below) or their deleted account (a trigger in
 *   the migration) deletes it early, as does the reporter's deleted account.
 * - **Nobody in the chapter reads it**, and no route serves it. The Frapp
 *   team reads it from the database with the key
 *   (`docs/ops/ai-stored-text.md`).
 *
 * No report text is logged, and the report is not an analytics event.
 */
@Injectable()
export class AiReportService implements OnModuleInit {
  constructor(
    @Inject(AI_REPORT_REPOSITORY) private readonly reports: IAiReportRepository,
    private readonly drafts: MeetingDraftService,
    private readonly suggestions: AiSuggestionService,
    private readonly consent: AiConsentService,
  ) {}

  onModuleInit(): void {
    // A member who says No takes their words out of every report quoting
    // them. Safe to run twice, as the consent service requires.
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.reports.deleteQuoting(userId);
    });
  }

  /** Whether a report made now would keep the text, for the sheet's words. */
  keepsText(): boolean {
    return aiStoredTextKeyRing() !== null;
  }

  async report(
    input: AiReportInput,
    now: Date = new Date(),
  ): Promise<AiReportOutcome> {
    const ring = aiStoredTextKeyRing();
    const kept = await this.kept(input, ring !== null, now);
    const subjectId = kept.subjectId ?? input.subjectId;
    // The reporter's own words are theirs to report; they are not "quoted".
    const quoted = [...new Set(kept.quoted)].filter(
      (id) => id !== input.userId,
    );
    const sealed =
      ring && kept.exchange
        ? sealAiText(
            ring,
            JSON.stringify({
              subject: input.subject,
              subject_id: subjectId,
              ...kept.exchange,
            }),
            aiReportContext(input.chapterId),
          )
        : null;
    const expiresAt = new Date(
      now.getTime() + AI_REPORT_RETENTION_DAYS * DAY_MS,
    );
    const note = input.note?.trim() || null;
    const inserted = await this.reports.insert({
      chapterId: input.chapterId,
      reportedBy: input.userId,
      subjectType: input.subject,
      subjectId,
      reason: input.reason,
      note,
      sealed,
      quotedUserIds: quoted,
      model: kept.model,
      promptVersion: kept.promptVersion,
      createdAt: now,
      expiresAt,
    });
    if (inserted === 'kept' && sealed && quoted.length > 0) {
      await this.dropIfQuotedSaidNo(quoted);
    }
    return {
      already_reported: inserted === 'duplicate',
      kept_text: inserted === 'kept' && sealed !== null,
      expires_at: expiresAt.toISOString(),
    };
  }

  /** One tick of the sweep: deletes every report past its date. */
  sweep(now: Date): Promise<number> {
    return this.reports.deleteExpired(now);
  }

  /**
   * What the report keeps of its subject. The access checks run whether or
   * not text will be kept, so nobody files a report on something they could
   * not see.
   */
  private async kept(
    input: AiReportInput,
    keepText: boolean,
    now: Date,
  ): Promise<Kept> {
    switch (input.subject) {
      case 'ask_answer':
        return this.keptAnswer(input, keepText, now);
      case 'meeting_draft':
        return this.keptDraft(input, keepText);
      case 'ai_suggestion':
        return this.keptSuggestion(input, keepText);
      default:
        throw notFound();
    }
  }

  private keptAnswer(input: AiReportInput, keepText: boolean, now: Date): Kept {
    // An answer from a server with no key carries no receipt, and one from
    // before reports existed carries none either: the report is kept without
    // the text rather than refused.
    if (!keepText || !input.receipt) return NOTHING;
    try {
      const receipt = openAskReportReceipt(
        aiStoredTextKeyRing(),
        input.receipt,
        { chapterId: input.chapterId, userId: input.userId },
        now,
      );
      if (receipt.ask_id !== input.subjectId) {
        throw new AskReportReceiptError('invalid');
      }
      // What the row keeps besides the text: the version and ask id are the
      // receipt's own bookkeeping, and the rest has its own column.
      const { quoted_user_ids, model, prompt_version } = receipt;
      const exchange: Record<string, unknown> = { ...receipt };
      for (const key of [
        'v',
        'ask_id',
        'quoted_user_ids',
        'model',
        'prompt_version',
      ]) {
        delete exchange[key];
      }
      return {
        exchange,
        quoted: quoted_user_ids,
        model,
        promptVersion: prompt_version,
      };
    } catch (error) {
      if (error instanceof AskReportReceiptError) {
        if (error.reason === 'expired') {
          throw new BadRequestException({
            code: 'ai.report.too_old',
            message:
              'This answer is too old to report. Ask again, then report the new answer.',
          });
        }
        throw new BadRequestException({
          code: 'ai.report.receipt_invalid',
          message: 'This answer could not be matched. Ask again.',
        });
      }
      throw error;
    }
  }

  private async keptDraft(
    input: AiReportInput,
    keepText: boolean,
  ): Promise<Kept> {
    // 403 or 404 from the minutes' own rule when the caller may not edit
    // them; null when there is no draft to report, or the caller could not
    // open the draft routes (the meetings module off, no `meetings:record`).
    const draft = await this.drafts.forReport(
      input.chapterId,
      input.subjectId,
      input.userId,
      input.enabledModules,
    );
    if (!draft) throw notFound();
    if (!keepText) return { ...NOTHING, subjectId: draft.requestId };
    return {
      subjectId: draft.requestId,
      exchange: {
        meeting_id: input.subjectId,
        notes: draft.notes,
        meeting_date: draft.meetingDate,
        status: draft.status,
        draft: draft.result,
        minutes_now: draft.minutesNow,
      },
      // The officer whose notes they are, when that is someone else.
      quoted: draft.requestedBy ? [draft.requestedBy] : [],
      model: aiCatalogEntry('minutes.draft').model,
      promptVersion: MEETING_DRAFT_PROMPT_VERSION,
    };
  }

  private async keptSuggestion(
    input: AiReportInput,
    keepText: boolean,
  ): Promise<Kept> {
    const suggestion = await this.suggestions.findVisible(
      input.chapterId,
      input.subjectId,
      input.userId,
      input.enabledModules,
    );
    if (!suggestion) throw notFound();
    if (!keepText) return NOTHING;
    const fromRequest = suggestion.source_type === 'request';
    return {
      exchange: {
        kind: suggestion.kind,
        status: suggestion.status,
        source_type: suggestion.source_type,
        source_id: suggestion.source_id,
        suggestion: suggestion.payload,
        quote: suggestion.quote,
      },
      quoted: suggestion.quote_author_id ? [suggestion.quote_author_id] : [],
      // Suggested tasks are read from posted minutes with no model call; a
      // proposal a member asked for (#718) came from the acting agent's plan.
      model: fromRequest ? aiCatalogEntry('act.plan').model : null,
      promptVersion: fromRequest ? ACT_PLAN_PROMPT_VERSION : null,
    };
  }

  /**
   * A quoted member who said No while the report was being made: their No
   * deleted what quoted them before this row landed. Delete it now.
   */
  private async dropIfQuotedSaidNo(quoted: readonly string[]): Promise<void> {
    const states = await Promise.all(
      quoted.map(async (id) => ({
        id,
        answer: (await this.consent.getConsentState(id)).answer,
      })),
    );
    for (const state of states) {
      if (state.answer === 'no') await this.reports.deleteQuoting(state.id);
    }
  }
}
