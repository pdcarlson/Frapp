// Injectable clock used by verifier scripts so unit tests can run without
// actually sleeping. `now` defaults to Date.now; `sleep` defaults to a real
// setTimeout-based delay. Tests replace both with counters.

export function createClock({
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return { now, sleep };
}

/**
 * The "poll until terminal" skeleton shared by the four provider pollers
 * (`verify-render-deploy.mjs`, `verify-vercel-deploy.mjs`,
 * `deploy-render-production.mjs`, `deploy-vercel-production.mjs`) before this
 * (#1351). All four hand-wrote the same loop — `startedAt = clock.now()` →
 * while under the deadline: fetch, classify, return on terminal, else log and
 * sleep → identical timeout-failure return — which meant a change to the
 * loop's boundary or timeout semantics could land in some copies and not
 * others, silently.
 *
 * What is deliberately NOT shared: the two production-path pollers treat a
 * cancel as failure where the two observers treat it as neutral (documented
 * at length in `deploy-vercel-production.mjs`'s header) — a real difference,
 * not divergence. So this function owns only the loop mechanics; every
 * site-specific judgment stays in the caller's `fetchOne`/`classify`
 * closures, verbatim.
 *
 * `fetchOne()` asks the provider for the current state once. `classify`
 * receives that state (plus how long the loop has been running) and returns
 * either `null`/`undefined` to keep polling, or a terminal `{status,
 * message}` result to stop immediately and return it — constructing that
 * result, including its exact wording, is entirely the caller's job, since
 * none of the wording is loop mechanics. `onTimeout` builds the result for
 * the one path `classify` never sees: the deadline elapsing with nothing
 * terminal observed.
 */
export async function pollUntilTerminal({
  fetchOne,
  classify,
  onTimeout,
  clock = createClock(),
  pollIntervalMs,
  overallTimeoutMs,
  logger = console,
}) {
  const startedAt = clock.now();
  let lastState;

  while (clock.now() - startedAt < overallTimeoutMs) {
    lastState = await fetchOne();
    const elapsedMs = clock.now() - startedAt;

    const verdict = classify(lastState, { elapsedMs, logger });
    if (verdict) return verdict;

    await clock.sleep(pollIntervalMs);
  }

  return onTimeout(lastState, clock.now() - startedAt);
}
