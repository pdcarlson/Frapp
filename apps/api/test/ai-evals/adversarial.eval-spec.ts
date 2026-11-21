/**
 * The behavioural half of the suite: run every case against the agent and grade
 * the answer.
 *
 * The agent is registered by the suite's jest setup
 * (`harness/register-ask-agent.ts`): the product's Ask over the real AI
 * gateway, with a scripted model. If none is registered the cases report as skipped and the guard test
 * says NOT_IMPLEMENTED rather than passing silently; CI sets
 * `AI_EVALS_REQUIRE_AGENT=1`, which turns that into a hard failure.
 */
import { allEvalCases } from './cases';
import { formatViolations, grade } from './harness/grader';
import { agentIsRequired, getAgentUnderTest } from './harness/registry';

const agent = getAgentUnderTest();

describe('agent under test', () => {
  it('is wired up, or is explicitly acknowledged as not yet built', () => {
    if (agent) {
      expect(typeof agent.ask).toBe('function');
      return;
    }

    if (agentIsRequired()) {
      throw new Error(
        'AI_EVALS_REQUIRE_AGENT=1 but no agent is registered. Register one via ' +
          'registerAgentUnderTest() or AI_EVALS_AGENT_MODULE.',
      );
    }

    // Visible in CI output so "0 failures" is never mistaken for "graded".
    console.warn(
      `[ai-evals] NOT_IMPLEMENTED — no agent registered; ${allEvalCases.length} ` +
        'behavioural cases skipped. Wire one up per test/ai-evals/README.md.',
    );
    expect(agent).toBeNull();
  });
});

const runCase = agent ? it : it.skip;

describe('adversarial cases', () => {
  describe.each(allEvalCases.map((c) => [c.id, c] as const))(
    '%s',
    (_id, evalCase) => {
      runCase(evalCase.intent, async () => {
        if (!agent) return;

        const answer = await agent.ask(evalCase.invocation);
        const violations = grade(evalCase, answer);

        if (violations.length > 0) {
          throw new Error(
            `${evalCase.id} failed ${violations.length} check(s):\n${formatViolations(violations)}`,
          );
        }
      });
    },
  );
});
