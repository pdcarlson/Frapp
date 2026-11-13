import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ASK_STREAM_VERSION,
  type AskAnswer,
  type AskHistoryTurn,
  type AskSource,
  type AskStep,
  type AskStreamEvent,
  type AskUnavailableReason,
} from '@repo/validation';
import {
  LanguageModelError,
  type LanguageModelSource,
} from '#domain/adapters/language-model.interface';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import { sealAskReportReceipt } from '#domain/utils/ai-report-receipt';
import { placeCitations } from '#domain/utils/citation-placement';
import { aiStoredTextKeyRing } from '../../../config/ai-stored-text-config';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import {
  AiGatewayService,
  type AiCitedResult,
  type AiUnavailable,
} from '../ai/ai-gateway.service';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiConsentService } from '../ai/ai-consent.service';
import {
  CHAT_SOURCE_TYPE,
  chatPassagesStillAllowed,
} from '../corpus/chat-message-corpus-source';
import {
  CorpusRetrievalService,
  type CorpusPassage,
} from '../corpus/corpus-retrieval.service';
import { RbacService } from '../rbac.service';
import { AskDiagnosticsService } from './ask-diagnostics.service';
import {
  ASK_ANSWER_PROMPT_VERSION,
  ASK_PLAN_PROMPT_VERSION,
  ASK_PLAN_SYSTEM,
  AskPlanSchema,
  askAnswerMessages,
  askAnswerSystem,
  askPlanMessage,
  askSearchQuery,
  earlierQuestions,
} from './ask-prompt';
import {
  ASK_MAX_TOOLS_PER_QUESTION,
  ASK_TOOLS,
  toolsMemberMayUse,
  type AskTool,
  type AskToolContext,
} from './ask-tool';

/** Passages asked of retrieval for one question. */
const PASSAGE_LIMIT = 8;

const SOURCE_KIND: Readonly<Record<string, string>> = {
  chapter_document: 'document',
  meeting_minutes: 'minutes',
  [CHAT_SOURCE_TYPE]: 'chat',
};

export interface AskInput {
  /** From `ChapterGuard`. Never from the request body or a model. */
  chapterId: string;
  /** The asker, from the auth guard. */
  userId: string;
  question: string;
  /**
   * The conversation before this question, oldest first, as the client holds
   * it. Nothing here is trusted as a source: it is what the asker says was
   * said, and it reaches only the asker's own answer.
   */
  history?: readonly AskHistoryTurn[];
  /** The chapter's module switches, as `ChapterGuard` read them. */
  enabledModules: Record<string, boolean> | null;
  /** The asker's IANA time zone. */
  timeZone: string;
  /** The client showed the "answers are being saved" line before sending. */
  savedNoticeShown: boolean;
  signal?: AbortSignal;
}

/** One source handed to the model, with what a citation of it shows. */
interface AskSourceEntry {
  model: LanguageModelSource;
  view: AskSource;
  chat: boolean;
  /** Chat: whose words are in it. Empty for every other source. */
  authorIds: readonly string[];
}

type AskEventFields = AskStreamEvent extends infer E
  ? E extends AskStreamEvent
    ? Omit<E, 'v'>
    : never
  : never;

function event(fields: AskEventFields): AskStreamEvent {
  return { v: ASK_STREAM_VERSION, ...fields };
}

function emptyAnswer(
  status: AskAnswer['status'],
  fields: Partial<AskAnswer> = {},
): AskAnswer {
  return {
    status,
    reason: null,
    text: '',
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
    report_receipt: null,
    ...fields,
  };
}

/** Why a gateway call was not made, in the words the clients know. */
export function unavailableReason(result: AiUnavailable): AskUnavailableReason {
  if (result.reason === 'consent') {
    return result.detail === 'chapter_off' ? 'chapter_off' : 'consent_required';
  }
  if (result.reason === 'spend_cap') {
    if (result.detail === 'chapter_cap') return 'chapter_limit';
    if (result.detail === 'member_cap') return 'member_limit';
  }
  return 'not_available';
}

/** A day written out in full, in the asker's zone. Shared with Do (#718). */
export function longDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/**
 * A source's day as the model reads it, in the asker's zone like the "Today
 * is" line beside it: a message sent Saturday evening in Los Angeles is
 * Saturday's, though its UTC timestamp is already Sunday.
 */
function sourceDay(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : longDate(at, timeZone);
}

function passageDetail(passage: CorpusPassage): string | null {
  const page =
    passage.pageStart === null
      ? null
      : passage.pageEnd !== null && passage.pageEnd !== passage.pageStart
        ? `pages ${passage.pageStart} to ${passage.pageEnd}`
        : `page ${passage.pageStart}`;
  return [passage.heading, page].filter(Boolean).join(', ') || null;
}

function passageEntry(
  passage: CorpusPassage,
  timeZone: string,
): AskSourceEntry {
  const chat = passage.sourceType === CHAT_SOURCE_TYPE;
  const detail = passageDetail(passage);
  const target: AskSource['target'] =
    passage.sourceType === 'chapter_document'
      ? {
          type: 'document',
          document_id: passage.sourceId,
          page: passage.pageStart,
        }
      : passage.sourceType === 'meeting_minutes'
        ? { type: 'meeting', meeting_id: passage.sourceId }
        : chat && passage.channelId && passage.messageId
          ? {
              type: 'message',
              channel_id: passage.channelId,
              message_id: passage.messageId,
            }
          : null;
  return {
    chat,
    authorIds: chat ? passage.authorIds : [],
    model: {
      id: passage.id,
      // What the model reads as the source's name. Chat is labelled as chat,
      // with its channel and day, so it can be told from an official source
      // (`ai-prompt-injection.md` C8).
      title: chat
        ? `Chat message in ${passage.title}, ${sourceDay(passage.sourceAt, timeZone)}`
        : [passage.title, detail, sourceDay(passage.sourceAt, timeZone)]
            .filter(Boolean)
            .join(', '),
      text: passage.text,
    },
    view: {
      id: passage.id,
      kind: SOURCE_KIND[passage.sourceType] ?? passage.sourceType,
      title: passage.title,
      // A chat passage's heading is its day, which `date` already says.
      detail: chat ? null : detail,
      date: passage.sourceAt,
      target,
    },
  };
}

/**
 * Ask Frapp (#450, #451, `spec/behavior/ai.md`): one member's question,
 * answered from what that member could open, with every claim tied to a
 * source the server checked.
 *
 * One question runs these steps, and each rule is here, in the product, not
 * in a prompt (`docs/security/ai-prompt-injection.md` C1 to C8):
 *
 * 1. **Search and plan, side by side.** `CorpusRetrievalService.retrieve`
 *    searches the chapter's index as the asker: one chapter, the one the
 *    request's guard resolved, and only sources the asker can open. A small
 *    planning call picks which live reads the question needs, from the
 *    tools the asker may use. The planner sees the question, the asker's
 *    own earlier questions when there is a conversation, and nothing else,
 *    so no retrieved text, no earlier answer and no tool result can cause a
 *    read (C3, C8: nothing is done because a document or a message asked).
 * 2. **Live reads, as the asker.** Only a tool that was offered can be
 *    picked, and a tool is offered only after the route's permission and its
 *    module were checked for the asker. Each picked tool is checked to be
 *    read-only and runs with the asker's chapter and id. A result from any other chapter is dropped (C2, C4, C5).
 *    Chat passages get their last consent check here (#4314).
 * 3. **Nothing found, no model call.** With no passage and no tool result,
 *    the answer is "couldn't find that", and no text is generated (C7).
 * 4. **The answer, streamed.** The gateway gets the question as the user
 *    turn, after the conversation's earlier turns when the client sent
 *    them, and the sources as sources: live data first, then official
 *    passages, then chat, labelled as chat (C1, C8). Words are forwarded as
 *    they are written. An earlier turn is context, never a source: the
 *    answer still stands only on quotes found in this question's sources.
 * 5. **No answer without a source.** When the model stops, the gateway has
 *    kept only the quotes that are word for word in the source they name. An
 *    answer left with none is replaced by "couldn't find that" (C6, C7).
 *    The clients replace what they streamed with this final answer.
 * 6. **Citations placed** at the end of the sentence each one backs, and
 *    only the sources actually cited are sent.
 *
 * Nothing is stored, except by the beta diagnostics window when it is on
 * for the chapter and the client showed its notice (`AskDiagnosticsService`).
 * No question, answer or source text is logged here.
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly retrieval: CorpusRetrievalService,
    private readonly gateway: AiGatewayService,
    private readonly consent: AiConsentService,
    private readonly rbac: RbacService,
    private readonly diagnostics: AskDiagnosticsService,
    @Inject(ASK_TOOLS) private readonly tools: readonly AskTool[],
  ) {}

  /**
   * Refuses, before any stream begins, a member who cannot ask: the
   * president has Ask off (`ai.chapter_off`), or the member has not said yes
   * on the AI sheet (`ai.consent.required`). The gateway checks the same
   * again before every call; this is so a client gets an ordinary error it
   * can act on instead of a stream that opens and ends.
   */
  async assertMayAsk(chapterId: string, userId: string): Promise<void> {
    const entry = aiCatalogEntry('ask.answer');
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: 'ask.answer',
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: ASK_ANSWER_PROMPT_VERSION,
    });
    if (!decision.allowed) throw aiConsentRefusal(decision.reason);
  }

  async *ask(
    input: AskInput,
    now: Date = new Date(),
  ): AsyncGenerator<AskStreamEvent, void, void> {
    const askId = randomUUID();
    yield event({ type: 'start', ask_id: askId });
    yield this.step('searching');

    const context = { chapterId: input.chapterId, actingUserId: input.userId };
    const offered = await this.offeredTools(input);
    const [retrieved, planned] = await Promise.all([
      this.retrieval.retrieve(
        {
          chapterId: input.chapterId,
          actingUserId: input.userId,
          query: askSearchQuery(input.question, input.history),
          limit: PASSAGE_LIMIT,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        // One clock for the whole question: how old a source is, what
        // "today" is, and when the exchange was kept.
        now,
      ),
      this.plan(input, offered, context),
    ]);
    if (retrieved.status !== 'ok') {
      yield this.done(
        emptyAnswer('unavailable', { reason: unavailableReason(retrieved) }),
      );
      return;
    }

    yield this.step('reading');
    // The last of chat's three consent checks (#4314): a member who said No
    // since the search ran has their words dropped here, before any text
    // leaves Frapp. Their messages join the left-out count, never by name.
    const [toolEntries, allowed] = await Promise.all([
      this.runTools(planned, input, now),
      chatPassagesStillAllowed(
        retrieved.passages,
        input.chapterId,
        this.consent,
      ),
    ]);
    const leftOut = retrieved.leftOutMessages + allowed.withheldMessages;
    const passages = allowed.passages.map((passage) =>
      passageEntry(passage, input.timeZone),
    );
    // Live data is canon, then the official record, then chat, each in the
    // order retrieval ranked it.
    const entries = [
      ...toolEntries,
      ...passages.filter((entry) => !entry.chat),
      ...passages.filter((entry) => entry.chat),
    ];

    if (entries.length === 0) {
      const answer = emptyAnswer('not_found', { left_out_messages: leftOut });
      answer.saved = await this.keep(input, answer, '', entries, planned, now);
      answer.report_receipt = this.receipt(
        askId,
        input,
        answer,
        '',
        entries,
        planned,
        now,
      );
      yield this.done(answer);
      return;
    }

    yield this.step('writing');
    let result: AiCitedResult | null = null;
    for await (const part of this.gateway.streamCited(
      'ask.answer',
      {
        promptVersion: ASK_ANSWER_PROMPT_VERSION,
        system: askAnswerSystem(longDate(now, input.timeZone)),
        messages: askAnswerMessages(input.question, input.history),
        sources: entries.map((entry) => entry.model),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      context,
    )) {
      if (part.type === 'text')
        yield event({ type: 'text', delta: part.delta });
      else result = part.result;
    }

    const answer = this.answerFrom(result, entries, leftOut);
    const written = result?.status === 'ok' ? result.text : '';
    answer.saved = await this.keep(
      input,
      answer,
      written,
      entries,
      planned,
      now,
    );
    answer.report_receipt = this.receipt(
      askId,
      input,
      answer,
      written,
      entries,
      planned,
      now,
    );
    yield this.done(answer);
  }

  /** Step 5 and 6: what the member is finally shown. */
  private answerFrom(
    result: AiCitedResult | null,
    entries: readonly AskSourceEntry[],
    leftOut: number,
  ): AskAnswer {
    if (result === null) return emptyAnswer('not_found');
    if (result.status === 'unavailable') {
      return emptyAnswer('unavailable', { reason: unavailableReason(result) });
    }
    if (result.status === 'refused') return emptyAnswer('refused');
    const byId = new Map(entries.map((entry) => [entry.model.id, entry]));
    // The gateway already dropped every quote it could not find in the
    // source it names; a citation of something that was never handed over
    // cannot get past it, and is not trusted here either.
    const kept = result.citations.filter((citation) =>
      byId.has(citation.sourceId),
    );
    if (kept.length === 0) {
      // No answer without a source: whatever the model wrote, nothing the
      // server could find in a source backs it.
      return emptyAnswer('not_found', {
        left_out_messages: leftOut,
        unverified_citations: result.droppedCitations,
      });
    }

    const text = result.text.trimEnd();
    const sources: AskSource[] = [];
    const indexById = new Map<string, number>();
    const citations = placeCitations(text, kept).map((citation) => {
      let index = indexById.get(citation.sourceId);
      const entry = byId.get(citation.sourceId);
      if (index === undefined && entry) {
        index = sources.length;
        indexById.set(citation.sourceId, index);
        sources.push(entry.view);
      }
      return { source: index ?? 0, at: citation.at, quote: citation.quote };
    });
    return emptyAnswer('answered', {
      text,
      citations,
      sources,
      left_out_messages: leftOut,
      unverified_citations: result.droppedCitations,
      truncated: result.truncated,
    });
  }

  /**
   * The tools this asker may use for this question: the route's permission
   * held, its module on, and read-only. Ask never offers, and never runs, a
   * tool that changes anything.
   */
  private async offeredTools(input: AskInput): Promise<AskTool[]> {
    const readOnly = this.tools.filter((tool) => tool.effect === 'read');
    if (readOnly.length === 0) return [];
    const held = new Set(
      await this.rbac.getEffectivePermissions(input.chapterId, input.userId),
    );
    return toolsMemberMayUse(readOnly, held, input.enabledModules);
  }

  /**
   * Which of the offered tools the question needs. A planning call that
   * fails, is refused or answers badly means no live reads, not no answer:
   * the search still stands.
   */
  private async plan(
    input: AskInput,
    offered: readonly AskTool[],
    context: { chapterId: string; actingUserId: string },
  ): Promise<AskTool[]> {
    if (offered.length === 0) return [];
    try {
      const result = await this.gateway.generateObject(
        'ask.plan',
        {
          promptVersion: ASK_PLAN_PROMPT_VERSION,
          system: ASK_PLAN_SYSTEM,
          messages: [
            {
              role: 'user',
              content: askPlanMessage(
                input.question,
                offered,
                earlierQuestions(input.history),
              ),
            },
          ],
          schema: AskPlanSchema,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        context,
      );
      if (result.status !== 'ok') return [];
      const named = new Set(result.value.tools);
      // Only names that were offered, so a made-up or withheld tool is
      // nothing; and a few at most, whatever the model asked for.
      return offered
        .filter((tool) => named.has(tool.name))
        .slice(0, ASK_MAX_TOOLS_PER_QUESTION);
    } catch (error) {
      if (error instanceof LanguageModelError && error.kind === 'aborted') {
        throw error;
      }
      this.logger.warn(
        `Ask: the planning call failed (${
          error instanceof LanguageModelError ? error.kind : 'unknown'
        }); answering without live data`,
      );
      return [];
    }
  }

  /** Step 2. A tool that fails is left out; the others still answer. */
  private async runTools(
    planned: readonly AskTool[],
    input: AskInput,
    now: Date,
  ): Promise<AskSourceEntry[]> {
    const context: AskToolContext = {
      chapterId: input.chapterId,
      userId: input.userId,
      now,
      timeZone: input.timeZone,
    };
    const results = await Promise.all(
      planned.map(async (tool): Promise<AskSourceEntry | null> => {
        // Checked where it runs, not only where it was offered.
        if (tool.effect !== 'read') return null;
        try {
          const result = await tool.run(context);
          if (!result || !result.text.trim()) return null;
          if (result.chapterId !== input.chapterId) {
            // A bug in the tool, never the model's doing. Dropped, and told
            // to someone: it must not happen twice.
            reportCaughtFailure(this.logger, {
              level: 'error',
              site: 'ask-tool-foreign-chapter',
              message: `Ask: tool ${tool.name} returned another chapter's data; dropped`,
              tags: { tool: tool.name },
            });
            return null;
          }
          return {
            chat: false,
            authorIds: [],
            model: {
              id: `tool:${tool.name}`,
              title: `${tool.title} (live data, read just now)`,
              text: result.text,
            },
            view: {
              id: `tool:${tool.name}`,
              kind: tool.kind,
              title: tool.title,
              detail: null,
              date: null,
              target: { type: 'page', page: tool.page },
            },
          };
        } catch (error) {
          this.logger.warn(
            `Ask: tool ${tool.name} failed (${
              error instanceof Error ? error.name : 'unknown'
            }); answering without it`,
          );
          return null;
        }
      }),
    );
    return results.filter((entry): entry is AskSourceEntry => entry !== null);
  }

  /**
   * The beta diagnostics window: keeps this exchange when the window is on,
   * the client showed its notice, and no chat was in front of the model
   * (`ai.md` § Stored AI text). Returns whether it was kept.
   */
  private async keep(
    input: AskInput,
    answer: AskAnswer,
    written: string,
    entries: readonly AskSourceEntry[],
    planned: readonly AskTool[],
    now: Date,
  ): Promise<boolean> {
    if (!input.savedNoticeShown) return false;
    if (answer.status === 'unavailable') return false;
    if (entries.some((entry) => entry.chat)) return false;
    const entry = aiCatalogEntry('ask.answer');
    return this.diagnostics.keep(
      input.chapterId,
      input.userId,
      {
        question: input.question,
        status: answer.status,
        answer: written,
        sources: entries.map(({ view }) => ({
          kind: view.kind,
          title: view.title,
          detail: view.detail,
        })),
        tools: planned.map((tool) => tool.name),
        model: entry.model,
        prompt_version: ASK_ANSWER_PROMPT_VERSION,
        unverified_citations: answer.unverified_citations,
      },
      now,
    );
  }

  /**
   * "Report this" (#4315): the exchange, sealed into the answer so it can be
   * handed back with a report, and nothing stored now. Null when the server
   * holds no sealing key, or when no answer was attempted. Never throws: a
   * receipt that could not be made costs the member only the text in a
   * report, never their answer.
   */
  private receipt(
    askId: string,
    input: AskInput,
    answer: AskAnswer,
    written: string,
    entries: readonly AskSourceEntry[],
    planned: readonly AskTool[],
    now: Date,
  ): string | null {
    if (answer.status === 'unavailable') return null;
    try {
      const entry = aiCatalogEntry('ask.answer');
      const quoted = new Set(entries.flatMap((source) => source.authorIds));
      quoted.delete(input.userId);
      return sealAskReportReceipt(
        aiStoredTextKeyRing(),
        {
          v: 1,
          ask_id: askId,
          issued_at: now.toISOString(),
          question: input.question,
          written,
          shown: {
            status: answer.status,
            reason: answer.reason,
            text: answer.text,
            citations: answer.citations,
            sources: answer.sources.map((source) => ({
              kind: source.kind,
              title: source.title,
              detail: source.detail,
              date: source.date,
            })),
            left_out_messages: answer.left_out_messages,
            unverified_citations: answer.unverified_citations,
            truncated: answer.truncated,
          },
          given: entries.map((source) => ({
            title: source.model.title,
            text: source.model.text,
          })),
          tools: planned.map((tool) => tool.name),
          model: entry.model,
          prompt_version: ASK_ANSWER_PROMPT_VERSION,
          quoted_user_ids: [...quoted],
        },
        { chapterId: input.chapterId, userId: input.userId },
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ask-report-receipt',
        message: 'Ask: the report receipt could not be sealed',
        // A cipher or encoding error; neither carries the text.
        error,
      });
      return null;
    }
  }

  private step(step: AskStep): AskStreamEvent {
    return event({ type: 'status', step });
  }

  private done(answer: AskAnswer): AskStreamEvent {
    return event({ type: 'done', answer });
  }
}
