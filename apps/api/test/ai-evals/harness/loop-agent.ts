/**
 * The agent the real questions are asked of once Ask is a tool loop
 * (#4899): the product's `AskService` on its loop path, with the product's
 * loop, prompt, 22 read tools and three card tools, over the term chapter
 * (`term-world.ts`, which says what stands in for the database).
 *
 * It is the same seam as `ask-agent.ts` (`AgentUnderTest`), so the same
 * questions, grader and bake-off run against either. What it reports:
 *
 * - `toolCalls`: every tool that ran, under the tool's own name. A call the
 *   loop refused (an unknown tool, bad arguments, over a limit) never ran
 *   and is not here.
 * - `proposals`: the cards the member would be shown, which is what the
 *   answer carries, not every card a tool made.
 * - `citations`: each kept citation, mapped to the corpus document it
 *   quotes. A citation of live data (a roster, a task list) names no
 *   document; the tool call is its record.
 *
 * The loop is switched on with `ASK_AGENT` for as long as a question is
 * being asked, and put back after, so the one-shot agent can run in the
 * same process before or after, not at the same time.
 */
import type { AskAnswer } from '@repo/validation';
import type { ILanguageModelRegistry } from '#domain/adapters/language-model.interface';
import type { AiGatewayService } from '../../../src/application/services/ai/ai-gateway.service';
import { AgentLoopService } from '../../../src/application/services/ask/agent/agent-loop.service';
import { AskService } from '../../../src/application/services/ask/ask.service';
import type { TermChapter } from '../synthetic-chapter/term';
import { EVAL_NOW, answerText, scriptedAskRegistry } from './ask-agent';
import { createEvalGateway } from './eval-gateway';
import { createTermWorld, termId } from './term-world';
import type {
  AgentAnswer,
  AgentInvocation,
  AgentUnderTest,
  ProposedCard,
} from './types';

export interface LoopAgentOptions {
  /** The gateway the loop's model calls go through, for a caller that meters them. */
  gateway?: AiGatewayService;
  /** The adapters behind the gateway, when none is given. */
  registry?: ILanguageModelRegistry;
  name?: string;
}

/** What the member reads when the turn ends in a question back to them. */
const ASKED_BACK = {
  needs_event: 'Which event do you mean?',
  unclear: 'I need one more detail to set that up.',
} as const;

let asking = 0;
let before: string | undefined;

/** `ASK_AGENT=on` while any question is in flight. */
async function withLoopOn<T>(run: () => Promise<T>): Promise<T> {
  if (asking === 0) {
    before = process.env.ASK_AGENT;
    process.env.ASK_AGENT = 'on';
  }
  asking += 1;
  try {
    return await run();
  } finally {
    asking -= 1;
    if (asking === 0) {
      if (before === undefined) delete process.env.ASK_AGENT;
      else process.env.ASK_AGENT = before;
    }
  }
}

export function createLoopAgent(
  options: LoopAgentOptions = {},
): AgentUnderTest {
  const gateway =
    options.gateway ??
    createEvalGateway(options.registry ?? scriptedAskRegistry()).gateway;
  // The question's embedding is not used by the stand-in index, so it never
  // goes to a paid model.
  const embedGateway = createEvalGateway(scriptedAskRegistry()).gateway;

  return {
    name: options.name ?? 'Ask loop + scripted model',
    ask(invocation: AgentInvocation): Promise<AgentAnswer> {
      const chapter = invocation.chapter as TermChapter | undefined;
      if (!chapter) {
        throw new Error(
          'The loop reads the chapter as records: the invocation needs `chapter` (the real-question set gives it)',
        );
      }
      return withLoopOn(async () => {
        const world = createTermWorld(
          invocation,
          chapter,
          gateway,
          embedGateway,
          EVAL_NOW,
        );
        const service = new AskService(
          world.retrieval,
          gateway,
          world.consent as never,
          world.rbac as never,
          world.members as never,
          world.users as never,
          { keep: () => Promise.resolve(false) } as never,
          // The one-shot reads are not offered on the loop path.
          [],
          new AgentLoopService(gateway),
          world.readTools,
          // The trace is the product's record of a turn; a run reads the
          // calls off the tools themselves.
          { record: () => Promise.resolve(false) } as never,
          world.from,
          world.proposeTools,
        );
        const from = invocation.from;

        let answer: AskAnswer | null = null;
        let askedBack: keyof typeof ASKED_BACK | null = null;
        const inPlace: ProposedCard[] = [];
        for await (const event of service.ask(
          {
            chapterId: world.chapterId,
            userId: world.userId,
            question: invocation.question,
            enabledModules: null,
            timeZone: 'America/New_York',
            savedNoticeShown: false,
            // A client that draws every card an answer comes with.
            cards: 'many',
            ...(from
              ? {
                  from: {
                    ...(from.channelId
                      ? { channel_id: termId(from.channelId) }
                      : {}),
                    ...(from.eventId ? { event_id: termId(from.eventId) } : {}),
                    ...(from.taskId ? { task_id: termId(from.taskId) } : {}),
                  },
                }
              : {}),
          },
          EVAL_NOW,
        )) {
          if (event.type === 'done') answer = event.answer;
          if (event.type === 'act') {
            const outcome = event.outcome;
            if (outcome.status === 'proposed') {
              const card = world.cards.get(outcome.suggestion.id);
              if (card) inPlace.push(card);
            } else {
              askedBack = outcome.status;
            }
          }
        }

        if (!answer) {
          // The turn ended on a card, or a question back, in place of an answer.
          return {
            text: askedBack ? ASKED_BACK[askedBack] : '',
            refused: false,
            citations: [],
            toolCalls: world.calls,
            proposals: inPlace,
          };
        }
        const sources = answer.sources;
        return {
          text: answerText(answer),
          refused: answer.status !== 'answered',
          citations: answer.citations.flatMap((citation) => {
            const documentId = world.documentFor(
              sources[citation.source].id,
              citation.quote,
            );
            return documentId
              ? [{ documentId, quotedText: citation.quote }]
              : [];
          }),
          toolCalls: world.calls,
          proposals: (answer.proposals ?? []).flatMap(
            (id) => world.cards.get(id) ?? [],
          ),
        };
      });
    },
  };
}
