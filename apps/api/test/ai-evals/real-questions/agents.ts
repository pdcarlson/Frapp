/**
 * The agents the real-question set can be asked of, each behind the one
 * interface (`AgentUnderTest`), built over a gateway the runner meters.
 *
 * Today there is one: `one-shot`, the Ask that shipped before the agent
 * rebuild (one search, a planner that picks from five reads, one answer
 * call). It is the baseline the loop has to beat (#4903).
 *
 * **Swapping the loop in (#4899).** Either add an entry here, or pass
 * `--agent /abs/path/to/module` to the bake-off, where the module exports
 * `createRealQuestionAgent(deps): AgentUnderTest`. The agent gets each
 * question as an `AgentInvocation` carrying `asker`, `from` and `chapter`
 * (`TermChapter`: the records its tools' services read). It must:
 *
 * - make every model call through `deps.gateway`, or nothing is metered and
 *   the `shown-to-model` check sees nothing;
 * - report each tool it ran in `toolCalls`, under the tool's own name;
 * - report the cards it proposed in `proposals` (an empty list when none);
 * - map each citation to the corpus document it quotes.
 */
import type { AiGatewayService } from '../../../src/application/services/ai/ai-gateway.service';
import { createAskAgent } from '../harness/ask-agent';
import type { AgentUnderTest } from '../harness/types';

export interface RealQuestionAgentDeps {
  gateway: AiGatewayService;
}

export type RealQuestionAgentFactory = (
  deps: RealQuestionAgentDeps,
) => AgentUnderTest;

/**
 * The one-shot Ask searches documents, minutes and chat once on every
 * question, without a tool call to show for it. It is recorded as the two
 * searches it stands for, so the baseline is not marked down for looking
 * something up the only way it can.
 */
function oneShot({ gateway }: RealQuestionAgentDeps): AgentUnderTest {
  const ask = createAskAgent({ gateway, name: 'one-shot Ask' });
  return {
    name: ask.name,
    async ask(invocation) {
      const answer = await ask.ask(invocation);
      const search = (toolName: string) => ({
        toolName,
        requiredPermission: 'members:view',
        targetChapterId: invocation.caller.chapterId,
        mutating: false,
      });
      return {
        ...answer,
        toolCalls: [
          search('search_records'),
          search('search_messages'),
          ...answer.toolCalls,
        ],
      };
    },
  };
}

export const REAL_QUESTION_AGENTS: Readonly<
  Record<string, RealQuestionAgentFactory>
> = {
  'one-shot': oneShot,
};

/** An agent by name, or by the absolute path of a module that makes one. */
export function findRealQuestionAgent(name: string): RealQuestionAgentFactory {
  const known = REAL_QUESTION_AGENTS[name];
  if (known) return known;
  if (!name.startsWith('/')) {
    throw new Error(
      `Unknown agent "${name}". Known: ${Object.keys(REAL_QUESTION_AGENTS).join(', ')}, or an absolute module path.`,
    );
  }
  // The path is given at run time and must not be a static dependency.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(name) as {
    createRealQuestionAgent?: RealQuestionAgentFactory;
  };
  if (typeof loaded.createRealQuestionAgent !== 'function') {
    throw new Error(`${name} does not export createRealQuestionAgent()`);
  }
  return loaded.createRealQuestionAgent;
}
