import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ASK_STREAM_VERSION, type AskStep } from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { ActService } from '../act/act.service';
import type { ActOutcome } from '../act/act-tool';
import { askAgentEnabled } from '../../../config/ai-config';
import { AskService, type AskInput, type AskTurnEvent } from './ask.service';

export interface AskConversationInput extends AskInput {
  /**
   * The client can show a proposal card, so a request to do something may
   * end in one. False for every build that only knows answers.
   */
  actions: boolean;
  /**
   * The client also draws the cards an answer comes with
   * (`AskAnswer.proposals`). Read with `actions`, by the tool loop only.
   */
  answerCards?: boolean;
}

/** An outcome of the request lane that is shown as a card. */
export type AskProposal = Extract<
  ActOutcome,
  { status: 'proposed' | 'needs_event' | 'unclear' }
>;

/**
 * What one turn of the conversation yields: Ask's own stream events, or, in
 * place of an answer, the proposal the member's words asked for.
 */
export type AskConversationEvent = AskTurnEvent;

/**
 * One conversation (`spec/behavior/ai.md` § One conversation): the member
 * types one thing in one place, and Frapp either answers it or proposes a
 * card, without the member choosing a mode first.
 *
 * **There is no model that can both read the chapter's text and pick an
 * action.** A turn runs two lanes that share nothing but the member's own
 * words, and this class only decides which lane's result is shown
 * (`docs/security/ai-prompt-injection.md` C3, C5):
 *
 * - **The answer lane** is `AskService`, unchanged: it searches, reads as
 *   the asker and writes an answer from sources. Its calls are offered no
 *   action and no tool that changes anything.
 * - **The request lane** is `ActService`, unchanged: one planning call sees
 *   what the member typed and the actions they may take, and nothing the
 *   answer lane found. It runs only for a client that asked for it
 *   (`actions`) and a member who holds `ai:act`, and it ends in a proposal
 *   the member confirms or in nothing.
 *
 * The lanes start together so a question waits on nothing. When the request
 * lane reads the member's words as something to do (a proposal, a choice of
 * event, or an action with a detail left unsaid), its card is the turn. It is
 * sent the moment the request lane has it, and the answer lane is stopped
 * where it stands: it may have searched the index and picked its tools by
 * then, but it has run no tool, kept nothing and written no word, because it
 * asks before it goes past its search (`AskInput.mayGoOn`) and is told only
 * once the request lane has spoken. Otherwise the answer goes on as if the
 * request lane had not run. A request lane that fails, is refused or is
 * unavailable is the same as one that found nothing to do: the member still
 * gets their answer.
 *
 * **The turn says when it is becoming a card** (#4701). The moment the
 * request lane has read the words as an action the member was offered, and
 * before it looks up that action's details, the stream carries the
 * `proposing` step. It is said from the request lane's own progress, never
 * guessed from the words, and a request lane that then comes back with
 * nothing is followed by the answer's own steps.
 *
 * **With the tool loop on (`ASK_AGENT=on`, #4899) there is one lane.** The
 * request lane is not run. The loop's model is offered, beside its reads,
 * the cards this member may have Frapp propose, so a request can rest on
 * what it read ("a task for each action item in the minutes"). That is the
 * change to C5 Paul approved on 2026-11-13: the model that reads may also
 * propose. What holds in its place is in `AgentProposeTool`: a card changes
 * nothing, only the asker can open it, and Confirm checks their permission
 * again. A client that did not send `actions` is offered no card at all.
 */
@Injectable()
export class AskConversationService {
  private readonly logger = new Logger(AskConversationService.name);

  constructor(
    private readonly askService: AskService,
    private readonly actService: ActService,
  ) {}

  async *converse(
    input: AskConversationInput,
    now: Date = new Date(),
  ): AsyncGenerator<AskConversationEvent, void, void> {
    if (!input.actions) {
      yield* this.askService.ask(input, now);
      return;
    }
    if (askAgentEnabled()) {
      yield* this.askService.ask(
        { ...input, cards: input.answerCards === true ? 'many' : 'one' },
        now,
      );
      return;
    }
    // The answer lane gets a signal of its own, so a card can stop the calls
    // it has in flight. The member leaving still stops both lanes.
    const stop = new AbortController();
    const left = () => stop.abort();
    if (input.signal?.aborted) stop.abort();
    input.signal?.addEventListener('abort', left, { once: true });
    // Resolved when the request lane has picked an action, and never if it
    // does not.
    let picked: () => void = () => undefined;
    let acting: Promise<void> | null = new Promise<void>((resolve) => {
      picked = resolve;
    });
    // Started before the answer lane's first await, so both run side by side.
    const card = this.proposal(input, now, picked);
    let request: Promise<AskProposal | null> | null = card;
    const answer = this.askService.ask(
      {
        ...input,
        signal: stop.signal,
        // The answer lane goes past its search only for a turn that is not
        // a card.
        mayGoOn: async () => (await card) === null,
      },
      now,
    );
    try {
      let next = answer.next();
      // `start` names the turn, so it goes out first whichever lane is ahead.
      let started = false;
      // Whether the answer lane has said its first step.
      let searching = false;
      for (;;) {
        if (!started) {
          const result = await next;
          if (result.done) return;
          started = true;
          yield result.value;
          next = answer.next();
          continue;
        }
        // The order settles a tie. The request lane is first: when it and
        // the answer lane have both settled by now, the card is what the turn
        // is. "Working out a card" waits for the answer lane's first step,
        // so it is never said and then replaced by "searching".
        const first = await Promise.race([
          ...(request === null
            ? []
            : [
                request.then(
                  (outcome) => ({ lane: 'request', outcome }) as const,
                ),
              ]),
          next.then((result) => ({ lane: 'answer', result }) as const),
          ...(acting === null || !searching
            ? []
            : [acting.then(() => ({ lane: 'acting' }) as const)]),
        ]);
        if (first.lane === 'acting') {
          acting = null;
          yield {
            v: ASK_STREAM_VERSION,
            type: 'status',
            step: 'proposing' satisfies AskStep,
          };
          continue;
        }
        if (first.lane === 'request') {
          request = null;
          acting = null;
          if (first.outcome === null) continue;
          // The step still being waited on ends with the lane.
          next.catch(() => undefined);
          yield { type: 'act', outcome: first.outcome };
          return;
        }
        if (first.result.done) {
          // The answer lane ends with no answer only because the turn is a
          // card, which it was told before this loop was.
          const outcome = request === null ? null : await request;
          if (outcome !== null) yield { type: 'act', outcome };
          return;
        }
        searching = true;
        yield first.result.value;
        next = answer.next();
      }
    } finally {
      input.signal?.removeEventListener('abort', left);
      // Ends the answer lane where it stands, and the calls it is waiting on.
      stop.abort();
      void answer.return(undefined).catch(() => undefined);
    }
  }

  /**
   * The request lane's card, or null when the member's words are not a
   * request to do something. Never rejects: it is awaited late, or not at
   * all when the answer lane ends first.
   */
  private async proposal(
    input: AskConversationInput,
    now: Date,
    onAction: () => void,
  ): Promise<AskProposal | null> {
    try {
      const outcome = await this.actService.act(
        {
          chapterId: input.chapterId,
          userId: input.userId,
          enabledModules: input.enabledModules,
          timeZone: input.timeZone,
          request: input.question,
          // The member's own earlier messages, never an answer. A turn they
          // tapped from the opening suggestions is not their words: it can
          // name a record another member wrote, so it is left out (C3). How
          // many of the rest the planner reads is the request lane's own rule.
          earlier: (input.history ?? [])
            .filter((turn) => turn.suggested !== true)
            .map((turn) => turn.question),
          keepEarlier: true,
          onAction,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        now,
      );
      if (outcome.status === 'proposed' || outcome.status === 'needs_event') {
        return outcome;
      }
      // An action was read and a detail was not said: the card asks for it.
      // With no action read at all, the words go to the answer lane.
      if (outcome.status === 'unclear' && outcome.action !== null) {
        return outcome;
      }
      return null;
    } catch (error) {
      // The member may not have Frapp act: every turn of theirs is a question.
      if (error instanceof ForbiddenException) return null;
      // The member left. The answer lane ends the turn on the same signal;
      // rejecting here would be a rejection nobody is waiting for.
      if (error instanceof LanguageModelError && error.kind === 'aborted') {
        return null;
      }
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'ask-conversation-request-lane',
        message: 'Ask: the request lane failed; answering instead',
        // A database or programming error. Neither carries what was typed.
        error,
      });
      return null;
    }
  }
}
