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
 * The "poll until terminal" skeleton behind `verify-vercel-deploy.mjs`,
 * `deploy-render-commit.mjs`, `deploy-vercel.mjs` and, since #2505,
 * `verify-served-commit.mjs`. Before this (#1351), four provider pollers (the
 * first three and the since-retired `verify-render-deploy.mjs`) each
 * hand-wrote the same loop — `startedAt = clock.now()` →
 * while under the deadline: fetch, classify, return on terminal, else log and
 * sleep → identical timeout-failure return — which meant a change to the
 * loop's boundary or timeout semantics could land in some copies and not
 * others, silently.
 *
 * What is deliberately NOT shared: the deploy-path pollers treat a cancel
 * as failure where `verify-vercel-deploy.mjs` treats it as neutral (documented
 * at length in `deploy-vercel.mjs`'s header) — a real difference,
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
