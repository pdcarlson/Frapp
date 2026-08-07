/**
 * The behavioural half of the suite: run every case against the agent and grade
 * the answer.
 *
 * There is no agent in the repo yet (FRA-309 / FRA-310). Rather than pass
 * silently, the cases below report as skipped and the guard test states the
 * NOT_IMPLEMENTED status explicitly. Set `AI_EVALS_REQUIRE_AGENT=1` — which CI
 * should do the moment an implementation lands — and the guard becomes a hard
 * failure, so the suite can never drift back to asserting nothing unnoticed.
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
