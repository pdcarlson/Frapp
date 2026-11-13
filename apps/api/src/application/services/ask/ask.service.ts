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
import {
  aiCatalogEntry,
  type AiAgentTaskName,
  type AiCitedTaskName,
} from '#domain/constants/ai-model-catalog';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import { sealAskReportReceipt } from '#domain/utils/ai-report-receipt';
import { placeCitations } from '#domain/utils/citation-placement';
import { askAgentEnabled } from '../../../config/ai-config';
import { aiStoredTextKeyRing } from '../../../config/ai-stored-text-config';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import {
  AiGatewayService,
  type AiAgentRoundResult,
  type AiCitedResult,
  type AiUnavailable,
} from '../ai/ai-gateway.service';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiConsentService } from '../ai/ai-consent.service';
import { chatPassagesStillAllowed } from '../corpus/chat-message-corpus-source';
import {
  CorpusRetrievalService,
  type CorpusPassage,
} from '../corpus/corpus-retrieval.service';
import { MemberService } from '../member.service';
import { RbacService } from '../rbac.service';
import {
  AgentLoopService,
  type AgentLoopOutcome,
} from './agent/agent-loop.service';
import {
  AGENT_READ_TOOLS,
  type AgentReadTool,
  type AgentSource,
} from './agent/agent-tool';
import {
  ASK_AGENT_PROMPT_VERSION,
  askAgentSystem,
} from './agent/ask-agent-prompt';
import { AskDiagnosticsService } from './ask-diagnostics.service';
import {
  ASK_ANSWER_PROMPT_VERSION,
  ASK_ASKER_SOURCE_TITLE,
  ASK_PLAN_PROMPT_VERSION,
  ASK_PLAN_SYSTEM,
  AskPlanSchema,
  askAnswerMessages,
  askAnswerSystem,
  askAskerSourceText,
  askPlanMessage,
  askSearchQuery,
  earlierQuestions,
  looksLikeAskerSourceTitle,
} from './ask-prompt';
import {
  ASK_MAX_TOOLS_PER_QUESTION,
  ASK_TOOLS,
  toolsMemberMayUse,
  type AskTool,
  type AskToolContext,
} from './ask-tool';
import { nameInLine } from './ask-lines';
import {
  passageDetail,
  passageIsChat,
  passageKind,
  passageTarget,
} from './ask-passage';

/** The id of the source that says who is asking. */
const ASKER_SOURCE_ID = 'asker';

/** The role a chapter's alumni hold (`RbacService.getAlumniRoleId`). */
const ALUMNI_SYSTEM_KEY = 'ALUMNI';

/**
 * A round's words are held until this many are written, or the round ends:
 * a model sometimes says a line before it calls a tool, and that line is not
 * the answer. Past this it is taken to be writing the answer, and streams.
 */
const AGENT_TEXT_HOLD_CHARS = 160;

/** Which model call wrote an answer, and what it read with. */
interface AskRun {
  task: AiCitedTaskName | AiAgentTaskName;
  promptVersion: string;
  /** The reads that ran, by name. */
  tools: readonly string[];
}

/**
 * What the model is handed: who is asking first, when that is known, then
 * what was read. Only the asker source may carry its title, so any other
 * source that would read as it is renamed here.
 */
function sourcesForModel(
  asker: LanguageModelSource | null,
  entries: readonly AskSourceEntry[],
): LanguageModelSource[] {
  const read = entries.map(({ model }) =>
    looksLikeAskerSourceTitle(model.title)
      ? { ...model, title: `Chapter source: ${model.title}` }
      : model,
  );
  return asker ? [asker, ...read] : read;
}

/** Passages asked of retrieval for one question. */
const PASSAGE_LIMIT = 8;

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
  /**
   * Asked once the search and the planning call are back, and before
   * anything else: no tool has run, nothing has been kept and no word has
   * been written. False ends the turn there with nothing more sent, which is
   * how a conversation whose turn became a card stops its answer
   * (`AskConversationService`). Left out, the answer goes straight on.
   */
  mayGoOn?: () => Promise<boolean>;
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

function passageEntry(
  passage: CorpusPassage,
  timeZone: string,
): AskSourceEntry {
  const chat = passageIsChat(passage);
  const detail = passageDetail(passage);
  const target = passageTarget(passage);
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
      kind: passageKind(passage),
      title: passage.title,
      // A chat passage's heading is its day, which `date` already says.
      detail: chat ? null : detail,
      date: passage.sourceAt,
      target,
    },
  };
}

/** The kinds that come from the index. Every other kind is a live record. */
const INDEXED_KINDS: ReadonlySet<string> = new Set([
  'document',
  'minutes',
  'chat',
]);

/**
 * What the model reads as the name of something a tool returned. Chat is
 * labelled as chat, with its channel and day, and live data as read just
 * now, as in the one-shot path (C8). Only the asker block may carry its
 * title.
 */
function agentSourceTitle(source: AgentSource, timeZone: string): string {
  const title = source.chat
    ? `Chat message in ${source.title}, ${sourceDay(source.date, timeZone)}`
    : !INDEXED_KINDS.has(source.kind)
      ? `${source.title} (live data, read just now)`
      : [source.title, source.detail, sourceDay(source.date, timeZone)]
          .filter(Boolean)
          .join(', ');
  return looksLikeAskerSourceTitle(title) ? `Chapter source: ${title}` : title;
}

function agentSourceEntry(source: AgentSource, title: string): AskSourceEntry {
  return {
    chat: source.chat,
    authorIds: source.chat ? source.authorIds : [],
    model: { id: source.id, title, text: source.text },
    view: {
      id: source.id,
      kind: source.kind,
      title: source.title,
      detail: source.detail,
      date: source.date,
      target: source.target,
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
 *    passages, then chat, labelled as chat (C1, C8). Ahead of them all goes
 *    one source that says who is asking (#4890), for a member who may read
 *    the roster. It is context, not proof: it is never shown as a source
 *    and a citation of it backs nothing. Words are forwarded as
 *    they are written. An earlier turn is context, never a source: the
 *    answer still stands only on quotes found in this question's sources.
 * 5. **No answer without a source.** When the model stops, the gateway has
 *    kept only the quotes that are word for word in the source they name. An
 *    answer left with none is replaced by "couldn't find that" (C6, C7).
 *    The clients replace what they streamed with this final answer.
 * 6. **Citations placed** at the end of the sentence each one backs, and
 *    only the sources actually cited are sent.
 *
 * **What the stream says it is doing is what happened** (#4701): `searching`
 * at the start, `reading` after step 1 with the tools picked and how many
 * sources were found (and not at all when there is nothing to read), and
 * `writing` at the first word of step 4. A step carries tool names and a
 * count, never a title or a passage.
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
    private readonly members: MemberService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly diagnostics: AskDiagnosticsService,
    @Inject(ASK_TOOLS) private readonly tools: readonly AskTool[],
    private readonly loop: AgentLoopService,
    @Inject(AGENT_READ_TOOLS)
    private readonly agentTools: readonly AgentReadTool[],
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
    const held = new Set(
      await this.rbac.getEffectivePermissions(input.chapterId, input.userId),
    );
    if (askAgentEnabled()) {
      yield* this.askWithTools(input, askId, held, now);
      return;
    }
    const offered = this.offeredTools(input, held);
    // Read beside the search and the plan, which do not wait for it. It
    // never rejects.
    const askerRead = this.asker(input, held);
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
    // Nothing past the search is run, kept or shown for a turn that became
    // a card.
    if (input.mayGoOn && !(await input.mayGoOn())) return;
    // A member who closed the panel while that was worked out is not read
    // for, written for or kept: not every turn sends a step here for the
    // route to stop at.
    if (input.signal?.aborted) return;
    if (retrieved.status !== 'ok') {
      yield this.done(
        emptyAnswer('unavailable', { reason: unavailableReason(retrieved) }),
      );
      return;
    }

    // Said only when there is something to read, and it names it: the live
    // reads the planner picked, and how many sources the search found, each
    // counted once however many of its passages matched (#4701).
    const found = new Set(retrieved.passages.map((passage) => passage.sourceId))
      .size;
    if (planned.length > 0 || found > 0) {
      yield event({
        type: 'status',
        step: 'reading',
        reads: planned.map((tool) => tool.name),
        found,
      });
    }
    // The last of chat's three consent checks (#4314): a member who said No
    // since the search ran has their words dropped here, before any text
    // leaves Frapp. Their messages join the left-out count, never by name.
    const [toolEntries, allowed, asker] = await Promise.all([
      this.runTools(planned, input, now),
      chatPassagesStillAllowed(
        retrieved.passages,
        input.chapterId,
        this.consent,
      ),
      askerRead,
    ]);
    // Nor is anything written or kept for one who left while it read.
    if (input.signal?.aborted) return;
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
    const run: AskRun = {
      task: 'ask.answer',
      promptVersion: ASK_ANSWER_PROMPT_VERSION,
      tools: planned.map((tool) => tool.name),
    };

    if (entries.length === 0) {
      const answer = emptyAnswer('not_found', { left_out_messages: leftOut });
      answer.saved = await this.keep(input, answer, '', entries, run, now);
      answer.report_receipt = this.receipt(
        askId,
        input,
        answer,
        '',
        entries,
        run,
        now,
      );
      yield this.done(answer);
      return;
    }

    // Who is asking goes first, and only beside something that was found:
    // it says who "me" is, and is never a reason to write (C7). It is not
    // among `entries`, so a citation of it backs nothing and it is never
    // shown as a source.
    const given = sourcesForModel(asker, entries);

    // "Writing" is said at the first word, not before the model has been
    // asked: until then it is still reading what it was handed.
    let writing = false;
    let result: AiCitedResult | null = null;
    for await (const part of this.gateway.streamCited(
      'ask.answer',
      {
        promptVersion: ASK_ANSWER_PROMPT_VERSION,
        system: askAnswerSystem(longDate(now, input.timeZone), asker !== null),
        messages: askAnswerMessages(input.question, input.history),
        sources: given,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      context,
    )) {
      if (part.type === 'text') {
        if (!writing) {
          writing = true;
          yield this.step('writing');
        }
        yield event({ type: 'text', delta: part.delta });
      } else result = part.result;
    }

    const answer = this.answerFrom(result, entries, leftOut);
    const written = result?.status === 'ok' ? result.text : '';
    answer.saved = await this.keep(input, answer, written, entries, run, now);
    answer.report_receipt = this.receipt(
      askId,
      input,
      answer,
      written,
      entries,
      run,
      now,
      given,
    );
    yield this.done(answer);
  }

  /**
   * The same question, answered by the tool loop (epic #4898). The model is
   * offered the reads this member may use and decides what to read; what it
   * reads may lead it to read more, as the asker and nothing else
   * (`AgentLoopService` has the rules). Nothing is searched for it ahead of
   * time, so there is no "nothing found, no model call" here: a miss is the
   * model saying so, or an answer left with no checked source.
   *
   * What does not change from the one-shot path: who is asking goes beside
   * the question and is never a source; an answer stands only with a
   * citation the gateway found word for word in something a tool returned;
   * and the answer, the kept exchange and the report receipt are made the
   * same way.
   */
  private async *askWithTools(
    input: AskInput,
    askId: string,
    held: ReadonlySet<string>,
    now: Date,
  ): AsyncGenerator<AskStreamEvent, void, void> {
    const offered = toolsMemberMayUse(
      this.agentTools.filter((tool) => tool.effect === 'read'),
      held,
      input.enabledModules,
    );
    const asker = await this.asker(input, held);
    // No tool has run and no model has been asked for a turn that became a
    // card, or whose member has left.
    if (input.mayGoOn && !(await input.mayGoOn())) return;
    if (input.signal?.aborted) return;

    const context = asker ? [asker] : [];
    const titleOf = (source: AgentSource) =>
      agentSourceTitle(source, input.timeZone);
    const reads: string[] = [];
    let pending = '';
    let writing = false;
    let outcome: AgentLoopOutcome | null = null;
    for await (const part of this.loop.run({
      task: 'ask.agent',
      promptVersion: ASK_AGENT_PROMPT_VERSION,
      system: askAgentSystem(longDate(now, input.timeZone), asker !== null),
      messages: askAnswerMessages(input.question, input.history),
      context,
      tools: offered,
      toolContext: {
        chapterId: input.chapterId,
        userId: input.userId,
        now,
        timeZone: input.timeZone,
        permissions: held,
        enabledModules: input.enabledModules,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      call: { chapterId: input.chapterId, actingUserId: input.userId },
      titleOf,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })) {
      if (part.type === 'text') {
        pending += part.delta;
        if (writing || pending.length >= AGENT_TEXT_HOLD_CHARS) {
          if (!writing) {
            writing = true;
            yield this.step('writing');
          }
          yield event({ type: 'text', delta: pending });
          pending = '';
        }
      } else if (part.type === 'discard') {
        // Words before a call were not the answer. Any that already went out
        // are replaced by the final answer, as every streamed word is.
        pending = '';
        writing = false;
      } else if (part.type === 'tool') {
        if (!reads.includes(part.name)) reads.push(part.name);
        yield event({ type: 'status', step: 'reading', reads: [...reads] });
      } else outcome = part.outcome;
    }
    // The loop ends with nothing for a member who left.
    if (outcome === null) return;
    if (pending && outcome.result.status === 'ok') {
      if (!writing) yield this.step('writing');
      yield event({ type: 'text', delta: pending });
    }

    const entries = outcome.sources.map((source) =>
      agentSourceEntry(source, titleOf(source)),
    );
    const ran = new Set(
      outcome.rounds.flatMap((round) =>
        round.calls.flatMap((call) =>
          call.outcome === 'ok' ? [call.tool] : [],
        ),
      ),
    );
    const run: AskRun = {
      task: 'ask.agent',
      promptVersion: ASK_AGENT_PROMPT_VERSION,
      tools: [...ran],
    };
    let answer = this.answerFrom(
      outcome.result,
      entries,
      outcome.leftOutMessages,
    );
    // A turn cut off at the length limit before it wrote anything that
    // stands did not look and find nothing. It is not an answer at all.
    if (
      outcome.result.status === 'ok' &&
      outcome.result.truncated &&
      answer.status === 'not_found'
    ) {
      answer = emptyAnswer('unavailable', { reason: 'not_available' });
    }
    const written = outcome.result.status === 'ok' ? outcome.result.text : '';
    answer.saved = await this.keep(input, answer, written, entries, run, now);
    answer.report_receipt = this.receipt(
      askId,
      input,
      answer,
      written,
      entries,
      run,
      now,
      [...context, ...entries.map((entry) => entry.model)],
    );
    yield this.done(answer);
  }

  /** Step 5 and 6: what the member is finally shown. */
  private answerFrom(
    result: AiCitedResult | AiAgentRoundResult | null,
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
      // Said whether or not a chat source is cited: a sentence can draw on a
      // message whose quote was dropped, and the client must not send it
      // back as history either way.
      read_chat: entries.some((entry) => entry.chat),
    });
  }

  /**
   * Who is asking, as a source (#4890): their name, the roles they hold and
   * whether they are an alum, which is what the roster shows of them. So it
   * is read only for a member who may open the roster, and nothing else
   * about them reaches a model (`ai.md` § Live structured data). A read that
   * fails means an answer that does not know the asker, not no answer.
   */
  private async asker(
    input: AskInput,
    held: ReadonlySet<string>,
  ): Promise<LanguageModelSource | null> {
    if (!held.has(WILDCARD) && !held.has(SystemPermissions.MEMBERS_VIEW)) {
      return null;
    }
    try {
      const [member, users, roles] = await Promise.all([
        this.members.findByUserAndChapter(input.userId, input.chapterId),
        this.users.findDisplayIdentitiesByIds([input.userId]),
        this.rbac.findByChapter(input.chapterId),
      ]);
      const name = nameInLine(users[0]?.display_name);
      if (!name) return null;
      // Role ids are compared lower-cased, as `RbacService` compares them:
      // a member's list can carry an id in another case, or a role since
      // deleted.
      const byId = new Map(roles.map((role) => [role.id.toLowerCase(), role]));
      const mine = [
        ...new Set((member.role_ids ?? []).map((id) => id.toLowerCase())),
      ].flatMap((id) => byId.get(id) ?? []);
      return {
        id: ASKER_SOURCE_ID,
        title: ASK_ASKER_SOURCE_TITLE,
        text: askAskerSourceText({
          name,
          // The commas between roles are this line's own, so a role's name
          // loses the characters that would read as another role or line.
          roles: mine.map((role) => nameInLine(role.name)).filter(Boolean),
          alumni: mine.some((role) => role.system_key === ALUMNI_SYSTEM_KEY),
        }),
      };
    } catch (error) {
      this.logger.warn(
        `Ask: who is asking could not be read (${
          error instanceof Error ? error.name : 'unknown'
        }); answering without it`,
      );
      return null;
    }
  }

  /**
   * The tools this asker may use for this question: the route's permission
   * held, its module on, and read-only. Ask never offers, and never runs, a
   * tool that changes anything.
   */
  private offeredTools(input: AskInput, held: ReadonlySet<string>): AskTool[] {
    const readOnly = this.tools.filter((tool) => tool.effect === 'read');
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
    run: AskRun,
    now: Date,
  ): Promise<boolean> {
    if (!input.savedNoticeShown) return false;
    if (answer.status === 'unavailable') return false;
    if (entries.some((entry) => entry.chat)) return false;
    const entry = aiCatalogEntry(run.task);
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
        tools: [...run.tools],
        model: entry.model,
        prompt_version: run.promptVersion,
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
    run: AskRun,
    now: Date,
    /** What the model was handed, when it was handed anything. */
    given: readonly LanguageModelSource[] = [],
  ): string | null {
    if (answer.status === 'unavailable') return null;
    try {
      const entry = aiCatalogEntry(run.task);
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
          given: given.map(({ title, text }) => ({ title, text })),
          tools: [...run.tools],
          model: entry.model,
          prompt_version: run.promptVersion,
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
