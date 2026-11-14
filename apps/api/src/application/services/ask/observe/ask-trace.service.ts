import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ASK_TRACE_REPOSITORY,
  type IAskTraceRepository,
} from '#domain/repositories/ask-trace.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import { reportCaughtFailure } from '../../../../infrastructure/observability/report-caught-failure';
import { AiConsentService } from '../../ai/ai-consent.service';
import { AnalyticsService } from '../../analytics.service';
import {
  cleanAskTrace,
  type AskTurnTrace,
  type CleanAskTrace,
} from './ask-trace';

/** The PostHog event one finished turn sends. */
export const ASK_TURN_EVENT = 'ai-answer-finished';
/** The PostHog event each tool call in a turn sends. */
export const ASK_TOOL_EVENT = 'ai-answer-tool-called';

/** Asked again this soon after the last question counts as a rephrase. */
const ASK_REPHRASE_WINDOW_MS = 60_000;

/**
 * The trace of every Ask turn (#4902, `spec/behavior/ai.md` § Stored AI
 * text): which tools ran, how big, how long, what it cost and how it ended,
 * so a weak answer can be found and understood without anyone's words being
 * kept. The loop calls {@link record} once, when the turn ends, however it
 * ends.
 *
 * - **No text.** `AskTurnTrace` has no field for it, `cleanAskTrace` holds
 *   every string to a code, and the tables' checks do the same again.
 * - **Kept 90 days**, then swept. It goes sooner with the asker: when they
 *   leave the chapter or delete their account (a cascade from their
 *   membership row), and when they answer No on the AI sheet (the listener
 *   below).
 * - **Sent to PostHog too**, as one event per turn and one per tool call,
 *   under the asker's pseudonym like every server event. The model rounds
 *   are not sent again: the gateway already sends `ai-call-finished` for
 *   each provider call.
 */
@Injectable()
export class AskTraceService implements OnModuleInit {
  private readonly logger = new Logger(AskTraceService.name);

  constructor(
    @Inject(ASK_TRACE_REPOSITORY) private readonly traces: IAskTraceRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    private readonly consent: AiConsentService,
    private readonly analytics: AnalyticsService,
  ) {}

  onModuleInit(): void {
    // A No on the AI sheet takes the member's traces and thumbs with it.
    // Safe to run twice, as the consent service requires.
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.traces.deleteByUser(userId);
    });
  }

  /**
   * Keeps one turn's trace and sends its events. Returns whether a row was
   * kept. Never throws: a trace that could not be kept must not cost the
   * member their answer, so the loop may await this or not. A failure is
   * reported, and the report carries nothing of the turn.
   */
  async record(turn: AskTurnTrace): Promise<boolean> {
    try {
      const clean = cleanAskTrace(turn);
      if (!clean) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'ask-trace-shape',
          message: 'Ask trace: a turn did not say whose it was',
        });
        return false;
      }
      const { trace, steps } = clean;
      const startedAt = new Date(trace.started_at);
      const [member, last] = await Promise.all([
        this.members.findByUserAndChapter(trace.user_id, trace.chapter_id),
        this.traces.lastStartedAt(trace.chapter_id, trace.user_id, startedAt),
      ]);
      // They left the chapter while the answer was being written.
      if (!member) return false;
      const isRephrase =
        last !== null &&
        startedAt.getTime() - new Date(last).getTime() <=
          ASK_REPHRASE_WINDOW_MS;
      const kept = await this.traces.insertTrace(
        { ...trace, member_id: member.id, is_rephrase: isRephrase },
        steps,
      );
      if (!kept) return false;
      // A No on the AI sheet while the answer was being written has already
      // deleted this member's traces; this one landed after. Read their
      // answer again and take this one back out. Only this one: an answer
      // that is not a yes can also be a sheet they have yet to see again,
      // which is no reason to delete what they agreed to before.
      if (
        (await this.consent.getConsentState(trace.user_id)).answer !== 'yes'
      ) {
        await this.traces.deleteTrace(trace.id, trace.chapter_id);
        return false;
      }
      await this.send({ ...trace, is_rephrase: isRephrase }, steps);
      return true;
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ask-trace-record',
        message: 'Ask trace: a turn could not be kept',
        // A database error; the rows it could quote hold ids, codes and
        // counts only.
        error,
      });
      return false;
    }
  }

  /** One tick of the sweep: deletes every trace past its 90 days. */
  sweep(now: Date): Promise<number> {
    return this.traces.deleteExpired(now);
  }

  /** The same numbers as analytics events. Best effort. */
  private async send(
    trace: CleanAskTrace['trace'] & { is_rephrase: boolean },
    steps: CleanAskTrace['steps'],
  ): Promise<void> {
    const options = { chapterId: trace.chapter_id, app: 'api' as const };
    try {
      await this.analytics.track(ASK_TURN_EVENT, trace.user_id, {
        ...options,
        properties: {
          ask_id: trace.id,
          door: trace.door,
          prompt_version: trace.prompt_version,
          model: trace.model,
          effort: trace.effort,
          outcome: trace.outcome,
          limit_kind: trace.limit_kind,
          error_kind: trace.error_kind,
          is_follow_up: trace.is_follow_up,
          is_rephrase: trace.is_rephrase,
          read_chat: trace.read_chat,
          truncated: trace.truncated,
          rounds: trace.rounds,
          tool_calls: trace.tool_calls,
          tool_failures: trace.tool_failures,
          input_tokens: trace.input_tokens,
          output_tokens: trace.output_tokens,
          cached_input_tokens: trace.cached_input_tokens,
          cost_micro_usd: trace.cost_micro_usd,
          duration_ms: trace.duration_ms,
          sources_read: trace.sources_read,
          citations_kept: trace.citations_kept,
          citations_dropped: trace.citations_dropped,
          left_out_messages: trace.left_out_messages,
          proposals: trace.proposals,
        },
      });
      await Promise.all(
        steps
          .filter((step) => step.kind === 'tool')
          .map((step) =>
            this.analytics.track(ASK_TOOL_EVENT, trace.user_id, {
              ...options,
              properties: {
                ask_id: trace.id,
                tool: step.tool,
                outcome: step.outcome,
                round: step.round,
                duration_ms: step.duration_ms,
                arg_bytes: step.arg_bytes,
                result_chars: step.result_chars,
                result_sources: step.result_sources,
              },
            }),
          ),
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ask-trace-analytics',
        message: 'Ask trace: the turn was kept but its events did not send',
        error,
      });
    }
  }
}
