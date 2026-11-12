/**
 * What the suite's Ask agent hands the model, checked directly.
 *
 * The cases grade the answer, and the scripted model's answer doesn't depend
 * on the order or titles of the sources it was given. So two of the chat
 * rules (`spec/behavior/ai.md` § Chat as a source; C8 in
 * `docs/security/ai-prompt-injection.md`) would pass every case even if the
 * agent broke them: chat ranks below official sources, and chat is labelled
 * as chat with its channel and date. This spec reads the request itself.
 */
import type {
  CitedLanguageModelRequest,
  ILanguageModel,
  LanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import { ScriptedLanguageModel } from '../../src/infrastructure/ai/scripted-language-model';
import { allEvalCases } from './cases';
import { createGatewayAgent } from './harness/gateway-agent';
import { scriptedAskModel } from './harness/scripted-model';
import type { EvalCase } from './harness/types';
import { SYNTHETIC_ASK_CASES } from './synthetic-chapter';

function recordingAgent() {
  const requests: CitedLanguageModelRequest[] = [];
  const scripted = new ScriptedLanguageModel({
    'ask.answer': scriptedAskModel,
  });
  const model: ILanguageModel = {
    provider: scripted.provider,
    generate: (request: LanguageModelRequest) => {
      if (request.kind === 'cited') requests.push(request);
      return scripted.generate(request);
    },
    stream: (request) => scripted.stream(request),
    embed: (request) => scripted.embed(request),
  };
  return {
    agent: createGatewayAgent({ registry: { resolve: () => model } }),
    requests,
  };
}

/** Cases where the model is handed both an official source and chat. */
const mixed = [...allEvalCases, ...SYNTHETIC_ASK_CASES].filter(
  (evalCase: EvalCase) => {
    const { corpus, caller } = evalCase.invocation;
    const own = corpus.filter((d) => d.chapterId === caller.chapterId);
    return (
      own.some((d) => d.sourceType !== 'chat_message') &&
      own.some(
        (d) =>
          d.sourceType === 'chat_message' &&
          d.chat?.authorConsented &&
          (caller.channelIds ?? []).includes(d.chat.channelId),
      )
    );
  },
);

describe('the Ask agent under test', () => {
  it('has cases that mix official sources and chat', () => {
    expect(mixed.length).toBeGreaterThanOrEqual(2);
  });

  it.each(mixed.map((c) => [c.id, c] as const))(
    '%s: hands the model official sources before chat, and chat labelled as chat',
    async (_id, evalCase) => {
      const { agent, requests } = recordingAgent();
      await agent.ask(evalCase.invocation);
      expect(requests).toHaveLength(1);

      const byId = new Map(evalCase.invocation.corpus.map((d) => [d.id, d]));
      const kinds = requests[0].sources.map((source) =>
        byId.get(source.id)?.sourceType === 'chat_message'
          ? 'chat'
          : 'official',
      );
      expect(kinds).toContain('chat');
      expect(kinds.indexOf('chat')).toBeGreaterThan(
        kinds.lastIndexOf('official'),
      );

      for (const source of requests[0].sources) {
        const document = byId.get(source.id);
        if (document?.sourceType !== 'chat_message') {
          expect(source.title).not.toMatch(/^Chat message:/);
          continue;
        }
        expect(source.title).toBe(
          `Chat message: ${document.title}, ${document.createdAt.slice(0, 10)}`,
        );
      }
    },
  );
});
