/**
 * Resolution of the agent under test.
 *
 * There is no AI agent in the repo yet (FRA-309 / FRA-310), so this resolves to
 * `null` and the behavioural specs report NOT_IMPLEMENTED instead of passing
 * silently. Two ways to wire one up:
 *
 *   1. `registerAgentUnderTest(agent)` from a setup file — for in-repo wiring.
 *      This is the path to use when construction is async: await the setup in
 *      a jest `globalSetup`/`setupFiles` hook, then register the result.
 *   2. `AI_EVALS_AGENT_MODULE=<absolute path>` — a module exporting a
 *      **synchronous** `createAgentUnderTest(): AgentUnderTest`. The resolver
 *      runs at module load, so it cannot await; an async factory is rejected
 *      with a clear error rather than silently yielding a Promise that fails
 *      later as `agent.ask is not a function`.
 *
 * Set `AI_EVALS_REQUIRE_AGENT=1` to make a missing agent a hard failure. Flip
 * that on in CI the moment an implementation lands, so the suite can never
 * regress back to reporting NOT_IMPLEMENTED unnoticed.
 */
import type { AgentUnderTest } from './types';

let registered: AgentUnderTest | null = null;

export function registerAgentUnderTest(agent: AgentUnderTest): void {
  registered = agent;
}

/** True when the absence of an implementation should fail the build. */
export function agentIsRequired(): boolean {
  return process.env.AI_EVALS_REQUIRE_AGENT === '1';
}

function loadFromEnv(): AgentUnderTest | null {
  const modulePath = process.env.AI_EVALS_AGENT_MODULE;
  if (!modulePath) return null;

  // A dynamic require is the point: the module path is supplied at run time and
  // must not be a static dependency of this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(modulePath) as {
    createAgentUnderTest?: () => AgentUnderTest;
  };
  if (typeof mod.createAgentUnderTest !== 'function') {
    throw new Error(
      `AI_EVALS_AGENT_MODULE "${modulePath}" does not export createAgentUnderTest()`,
    );
  }

  const agent: AgentUnderTest = mod.createAgentUnderTest();
  if (typeof (agent as { then?: unknown } | null)?.then === 'function') {
    throw new Error(
      `AI_EVALS_AGENT_MODULE "${modulePath}" returned a Promise. The resolver runs ` +
        'at module load and cannot await; do async setup in a jest setup file and ' +
        'call registerAgentUnderTest() instead.',
    );
  }
  if (typeof agent?.ask !== 'function') {
    throw new Error(
      `AI_EVALS_AGENT_MODULE "${modulePath}" returned something that is not an AgentUnderTest.`,
    );
  }
  return agent;
}

/**
 * The agent under test, or `null` when none is wired up.
 *
 * A module named by `AI_EVALS_AGENT_MODULE` that fails to load is an error, not
 * a "no agent" — the difference between "not built yet" and "built but broken"
 * is exactly what this suite exists to keep visible.
 */
export function getAgentUnderTest(): AgentUnderTest | null {
  return registered ?? loadFromEnv();
}
