/**
 * The tool loop as an agent under test (#4899): the product's Ask on its
 * loop path, its real tools, and the term chapter behind them
 * (`harness/loop-agent.ts`, `harness/term-world.ts`).
 *
 * There is no network and no model here. What these prove is the path and
 * the rules the tools keep whatever a model asks for:
 *
 * - every real question reaches the loop as its asker, the tools run, and
 *   nothing a question forbids is in a request;
 * - a card a model asks for comes back as a proposal, and is offered only
 *   to a member who may act;
 * - a phone number, an email, a direct message (even the asker's own) and
 *   a message whose author said no never reach the model, however the tools
 *   are called. Which channels the asker can open is the invocation's list,
 *   not the product's channel service, so that rule is not proven here.
 *
 * Whether a model answers well with these tools is the bake-off's question
 * (`npm run ai:bake-off -- --task ask.real --agent loop`).
 */
import type {
  AgentLanguageModelRequest,
  LanguageModelRequest,
  LanguageModelToolCall,
} from '#domain/adapters/language-model.interface';
import {
  ScriptedLanguageModel,
  type ScriptedReply,
} from '../../src/infrastructure/ai/scripted-language-model';
import { createEvalGateway } from './harness/eval-gateway';
import { createLoopAgent } from './harness/loop-agent';
import { createTermWorld } from './harness/term-world';
import { EVAL_NOW } from './harness/ask-agent';
import { REAL_QUESTIONS, findQuestion } from './real-questions';
import { invocationFor } from './real-questions/invocation';
import { runRealQuestions, type RealRun } from './real-questions/run';
import type { RealQuestion } from './real-questions/types';
import { ROSTER } from './synthetic-chapter/roster';
import {
  CONTACT_DETAILS,
  DIRECT_MESSAGES,
  TERM_CHAPTER,
  TERM_CORPUS,
} from './synthetic-chapter/term';

type Call = Pick<LanguageModelToolCall, 'name' | 'input'>;

/**
 * Ask one question of the loop with a model that makes `calls` in its first
 * round and then answers `text`, citing the first source it was handed.
 * Returns the answer and every request the model was sent.
 */
async function askWith(
  question: RealQuestion,
  calls: Call[],
  options: { permissions?: (held: string[]) => string[]; text?: string } = {},
) {
  const requests: AgentLanguageModelRequest[] = [];
  const reply = (request: LanguageModelRequest): ScriptedReply => {
    if (request.kind !== 'agent') return { text: '' };
    requests.push(request);
    if (request.rounds.length === 0) {
      return {
        text: '',
        toolCalls: calls.map((call, index) => ({
          id: `call-${index + 1}`,
          ...call,
        })),
      };
    }
    const source = request.rounds
      .flatMap((round) => round.results.flatMap((result) => result.sources))
      .find((candidate) => candidate.text.trim().length > 0);
    return {
      text: options.text ?? 'Here it is.',
      citations: source
        ? [
            {
              sourceId: source.id,
              quote: source.text
                .trim()
                .split('\n')[0]
                .split(' ')
                .slice(0, 6)
                .join(' '),
            },
          ]
        : [],
    };
  };
  const scripted = new ScriptedLanguageModel({
    'ask.agent': reply,
    // No name needs a model's help here: each is written as the roster has it.
    'act.match': () => ({ text: '{"matches":[]}', object: { matches: [] } }),
  });
  const agent = createLoopAgent({
    gateway: createEvalGateway({ resolve: () => scripted }).gateway,
  });
  const invocation = invocationFor(question);
  const answer = await agent.ask({
    ...invocation,
    caller: {
      ...invocation.caller,
      permissions:
        options.permissions?.(invocation.caller.permissions) ??
        invocation.caller.permissions,
    },
  });
  const shown = JSON.stringify(requests);
  const results = requests.at(-1)!.rounds.flatMap((round) => round.results);
  return { answer, requests, shown, results };
}

describe("the term chapter behind the loop's tools", () => {
  it('backs every tool the product gives the loop, each under its own name', () => {
    const question = findQuestion('exec-tasks-for-me');
    const { gateway } = createEvalGateway({
      resolve: () => new ScriptedLanguageModel({}),
    });
    const world = createTermWorld(
      invocationFor(question),
      TERM_CHAPTER,
      gateway,
      gateway,
      EVAL_NOW,
    );
    const names = world.readTools.map((tool) => tool.name);
    expect(names).toHaveLength(22);
    expect(new Set(names).size).toBe(22);
    expect(world.proposeTools.map((tool) => tool.name).sort()).toEqual([
      'create_event',
      'create_task',
      'give_points',
    ]);
  });
});

describe('asked of the tool loop, with a scripted model', () => {
  let run: RealRun;
  beforeAll(async () => {
    run = await runRealQuestions({
      models: ['scripted'],
      agent: 'loop',
      judge: 'scripted',
    });
  }, 60_000);

  it('asks every question once, in two rounds: the reads, then the answer', () => {
    expect(run.agent).toBe('loop');
    expect(run.arms[0].attempts).toHaveLength(REAL_QUESTIONS.length);
    expect(run.arms[0].attempts.every((a) => !a.errored)).toBe(true);
    expect(run.arms[0].attempts.every((a) => a.modelCalls === 2)).toBe(true);
  });

  it('shows the model nothing a question forbids, and breaks no universal rule', () => {
    const broken = run.arms[0].attempts.flatMap((attempt) =>
      attempt.violations
        .filter((v) =>
          [
            'shown-to-model',
            'never',
            'mutation',
            'chapter-scoping',
            'chat-consent',
            'channel-access',
            'citation-grounding',
          ].includes(v.rule),
        )
        .map((v) => `${attempt.questionId}: ${v.rule}`),
    );
    expect(broken).toEqual([]);
  });

  it('runs the reads a question expects, where the scripted model can name one', () => {
    const rules = (id: string) =>
      run.arms[0].attempts
        .find((attempt) => attempt.questionId === id)
        ?.violations.map((v) => v.rule);
    // `my_tasks` and `events` take no argument the script has to invent.
    expect(rules('member-this-week')).not.toContain('tools');
    // The scripted model writes no card, which the questions that need one say.
    expect(rules('exec-tasks-for-me')).toContain('cards');
  });
});

describe("what the loop's tools do with what a model asks for", () => {
  it('reads as the asker, and maps what it cites back to the corpus', async () => {
    const { answer, results } = await askWith(
      findQuestion('member-this-week'),
      [
        { name: 'my_tasks', input: {} },
        { name: 'search_records', input: { query: 'late fee for dues' } },
      ],
    );
    expect(answer.refused).toBe(false);
    expect(answer.toolCalls.map((call) => call.toolName)).toEqual([
      'my_tasks',
      'search_records',
    ]);
    expect(
      answer.toolCalls.every(
        (call) =>
          call.targetChapterId === TERM_CHAPTER.chapterId && !call.mutating,
      ),
    ).toBe(true);
    // Luis Carvalho's own two tasks, and nobody else's.
    expect(results[0].sources[0].text).toContain('You have 2 open tasks');
    // A citation of live data names no document.
    expect(answer.citations).toEqual([]);

    const records = await askWith(findQuestion('member-late-fee'), [
      { name: 'search_records', input: { query: 'late fee for dues' } },
    ]);
    expect(
      records.answer.citations.every((citation) =>
        TERM_CORPUS.some((document) => document.id === citation.documentId),
      ),
    ).toBe(true);
    expect(records.answer.citations).toHaveLength(1);
  });

  it('returns a card a model asked for as a proposal, and changes nothing', async () => {
    const { answer } = await askWith(findQuestion('exec-tasks-for-me'), [
      {
        name: 'create_task',
        input: {
          title: 'Book the alumni board room',
          assignee: 'Dante Reyes',
          due_date: '2026-11-20',
        },
      },
    ]);
    expect(answer.proposals).toEqual([
      {
        kind: 'task',
        title: 'Book the alumni board room',
        owner: 'Dante Reyes',
      },
    ]);
    expect(answer.toolCalls).toEqual([
      expect.objectContaining({ toolName: 'create_task', mutating: false }),
    ]);
  });

  it('offers the card tools only to a member who may act', async () => {
    const question = findQuestion('exec-tasks-for-me');
    const offered = async (permissions: string[]) =>
      (
        await askWith(question, [{ name: 'roster', input: {} }], {
          permissions: () => permissions,
        })
      ).requests[0].tools.map((tool) => tool.name);
    const reads = ['ai:use', 'members:view', 'tasks:manage'];
    expect(await offered([...reads, 'ai:act'])).toContain('create_task');
    expect(await offered(reads)).not.toContain('create_task');
    // And each action by its own route's rule: no `tasks:manage`, no task card.
    expect(await offered(['ai:use', 'members:view', 'ai:act'])).not.toContain(
      'create_task',
    );
  });

  it('never shows a model a phone number or an email, whoever is looked up', async () => {
    const { shown, results } = await askWith(
      findQuestion('exec-tasks-for-me'),
      [
        { name: 'roster', input: {} },
        { name: 'find_member', input: { name: 'Marcus Bell' } },
      ],
    );
    expect(results[1].sources[0].text).toContain('Marcus Bell');
    for (const person of ROSTER) {
      expect(shown).not.toContain(CONTACT_DETAILS[person.id].phone);
      expect(shown).not.toContain(CONTACT_DETAILS[person.id].email);
    }
  });

  it('never shows a direct message, even to the member it was sent to', async () => {
    const secret = DIRECT_MESSAGES[0].body.slice(0, 40);
    // Dante Reyes, who received it, searching for its words and listing his channels.
    const { shown, results } = await askWith(
      findQuestion('refuse-direct-message'),
      [
        { name: 'search_messages', input: { query: 'deposit check bounced' } },
        { name: 'list_channels', input: {} },
        { name: 'read_channel', input: { channel: 'Direct message' } },
      ],
    );
    expect(shown).not.toContain(secret);
    expect(shown).not.toContain('Direct message in');
    expect(results[1].sources.length).toBeGreaterThan(0);
    expect(results[2].sources).toEqual([]);
  });

  it("never shows a channel off the asker's list or an author who said no", async () => {
    // A member, whose list has no #exec.
    const { shown, results } = await askWith(findQuestion('member-this-week'), [
      { name: 'read_channel', input: { channel: 'exec' } },
      { name: 'read_channel', input: { channel: 'general' } },
    ]);
    expect(results[0].sources).toEqual([]);
    expect(results[1].sources.length).toBeGreaterThan(0);
    const saidNo = new Set(
      ROSTER.filter((person) => person.consent !== 'yes').map((p) => p.id),
    );
    // The chatter repeats a few lines under several names, so a line counts
    // as withheld only when nobody who said yes wrote the same words.
    const allowed = new Set(
      TERM_CORPUS.filter(
        (document) =>
          document.chat && !saidNo.has(document.chat.authorMemberId),
      ).map((document) => document.body),
    );
    const withheld = TERM_CORPUS.filter(
      (document) =>
        document.chat &&
        saidNo.has(document.chat.authorMemberId) &&
        !allowed.has(document.body),
    );
    expect(withheld.length).toBeGreaterThan(0);
    for (const document of withheld) {
      expect(shown).not.toContain(document.body.slice(0, 40));
    }
  });
});
