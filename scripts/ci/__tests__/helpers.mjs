// Shared offline test doubles for the watchdog suites (ci-wake, pr-base-sync).
// One fetch-mock implementation so the mocked ghRequest HTTP contract
// (`ok`/`status`/`text()`) cannot drift between suites.

/**
 * Minimal fetch mock: routes matched by method + path substring in order,
 * calls recorded (method, url, body). `body` may be a function of the recorded
 * calls array, for responses that change across attempts (polling sequences).
 */
export function makeFetchMock(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ?? null });
    const route = routes.find(
      (r) => r.method === method && url.includes(r.path),
    );
    const status = route?.status ?? 200;
    const body =
      typeof route?.body === "function" ? route.body(calls) : (route?.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetchImpl, calls };
}

export const quiet = { log: () => {} };
