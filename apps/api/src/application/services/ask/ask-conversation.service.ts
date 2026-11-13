import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { AskStreamEvent } from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { ActService, type ActOutcome } from '../act/act.service';
import { AskService, type AskInput } from './ask.service';
import { earlierQuestions } from './ask-prompt';

export interface AskConversationInput extends AskInput {
  /**
   * The client can show a proposal card, so a request to do something may
   * end in one. False for every build that only knows answers.
   */
  actions: boolean;
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
export type AskConversationEvent =
  | AskStreamEvent
  | { type: 'act'; outcome: AskProposal };

/** The events that mean nothing has been read for an answer yet. */
function beforeReading(event: AskStreamEvent): boolean {
  return (
    event.type === 'start' ||
    (event.type === 'status' && event.step === 'searching')
  );
}

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
 * event, or an action with a detail left unsaid), its card is the turn and
 * the answer lane is stopped before it reads or writes anything. Otherwise
 * the answer goes on as if the request lane had not run. A request lane that
 * fails, is refused or is unavailable is the same as one that found nothing
 * to do: the member still gets their answer.
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
    // Started before the answer lane's first await, so both run side by side.
    let request = input.actions ? this.proposal(input, now) : null;
    // Returning from inside the loop ends the answer lane where it stands.
    for await (const event of this.askService.ask(input, now)) {
      if (request !== null && !beforeReading(event)) {
        const outcome = await request;
        request = null;
        if (outcome !== null) {
          yield { type: 'act', outcome };
          return;
        }
      }
      yield event;
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
  ): Promise<AskProposal | null> {
    try {
      const outcome = await this.actService.act(
        {
          chapterId: input.chapterId,
          userId: input.userId,
          enabledModules: input.enabledModules,
          timeZone: input.timeZone,
          request: input.question,
          // The member's own earlier messages, never an answer.
          earlier: earlierQuestions(input.history),
          keepEarlier: true,
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
