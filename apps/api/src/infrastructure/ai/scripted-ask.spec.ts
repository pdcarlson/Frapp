import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import { scriptedAskAnswer, scriptedAskPlan } from './scripted-ask';
import type { ScriptedReply } from './scripted-language-model';

type Said = Extract<ScriptedReply, { text: string }>;

/**
 * The planning message as `ask-prompt.ts` writes it. Written out here, not
 * imported: infrastructure may not reach into the application layer, and
 * `ask.service.spec.ts` runs the real prompt through this scripted model.
 */
const askPlanMessage = (
  question: string,
  offered: ReadonlyArray<{ name: string; description: string }>,
): string =>
  [
    `Question: ${question}`,
    '',
    'Tools:',
    ...offered.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join('\n');

const tools = [
  'roster',
  'events',
  'my_points',
  'points_leaderboard',
  'my_dues',
].map((name) => ({ name, description: `About ${name}.` }));

const plan = (question: string) =>
  (
    scriptedAskPlan({
      kind: 'structured',
      messages: [{ role: 'user', content: askPlanMessage(question, tools) }],
    } as unknown as LanguageModelRequest) as Said
  ).object as { tools: string[] };

const answer = (
  question: string,
  sources: Array<{ id: string; text: string }>,
) =>
  scriptedAskAnswer({
    kind: 'cited',
    messages: [{ role: 'user', content: question }],
    sources: sources.map((source) => ({ ...source, title: 'Source' })),
  } as unknown as LanguageModelRequest) as Said;

describe('the scripted Ask replies', () => {
  it('plans from the words of the question, reading the tool list the product sends', () => {
    expect(plan('Who is the treasurer?').tools).toEqual(['roster']);
    expect(plan('When is the next chapter meeting?').tools).toEqual(['events']);
    expect(plan('How many points do I have?').tools).toEqual(['my_points']);
    expect(plan('What do the bylaws say about quorum?').tools).toEqual([]);
  });

  it('never plans a tool that was not offered', () => {
    const only = (
      scriptedAskPlan({
        kind: 'structured',
        messages: [
          {
            role: 'user',
            content: askPlanMessage(
              'Who is the treasurer and when is formal?',
              [tools[1]],
            ),
          },
        ],
      } as unknown as LanguageModelRequest) as Said
    ).object as { tools: string[] };
    expect(only.tools).toEqual(['events']);
  });

  it('answers with sentences copied from the sources, each cited word for word', () => {
    const reply = answer('What do the bylaws say about quorum?', [
      {
        id: 'p1',
        text: 'Article IV.\nQuorum under the bylaws is two thirds of active members. Meetings are weekly.',
      },
    ]);
    expect(reply.text).toBe(
      'Quorum under the bylaws is two thirds of active members.',
    );
    expect(reply.citations).toEqual([
      {
        sourceId: 'p1',
        quote: 'Quorum under the bylaws is two thirds of active members.',
      },
    ]);
  });

  it('cites nothing when no source shares the question’s words', () => {
    const reply = answer('Where is the spring retreat held?', [
      { id: 'p1', text: 'Quorum is two thirds of active members.' },
    ]);
    expect(reply.citations ?? []).toEqual([]);
  });

  it('reads a follow-up beside the question before it, and a question that stands alone by itself', () => {
    const sources = [
      { id: 'p1', text: 'Quorum for elections is three quarters.' },
      { id: 'p2', text: 'Devin Okafor is the treasurer.' },
    ].map((source) => ({ ...source, title: 'Source' }));
    const after = (question: string) =>
      scriptedAskAnswer({
        kind: 'cited',
        messages: [
          { role: 'user', content: 'What is quorum for elections?' },
          { role: 'assistant', content: 'Three quarters.' },
          { role: 'user', content: question },
        ],
        sources,
      } as unknown as LanguageModelRequest) as Said;
    expect(after('And who decides it?').citations).toEqual([
      { sourceId: 'p1', quote: 'Quorum for elections is three quarters.' },
    ]);
    expect(after('Who is the treasurer?').citations).toEqual([
      { sourceId: 'p2', quote: 'Devin Okafor is the treasurer.' },
    ]);
  });
});
