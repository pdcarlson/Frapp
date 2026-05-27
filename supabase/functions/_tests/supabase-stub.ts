// Test-only replacement for `@supabase/supabase-js` (wired via the test import
// map at `supabase/functions/_tests/deno.json`). Both Edge entrypoints call
// `createClient` twice (anon + service-role); this stub returns the same
// per-test mock client for every call so a test can script the whole sequence
// in one place.
//
// Each test calls `setNextClient(mock.client)` before invoking the captured
// handler. The stub stays sticky across the request so anon and service
// `createClient` calls return the same mock.

// deno-lint-ignore no-explicit-any
let nextClient: any = null;

// deno-lint-ignore no-explicit-any
export function setNextClient(client: any) {
  nextClient = client;
}

export function resetClient() {
  nextClient = null;
}

export function createClient(
  _url: string,
  _key: string,
  // deno-lint-ignore no-explicit-any
  _opts?: any,
) {
  if (!nextClient) {
    throw new Error(
      "supabase-stub: setNextClient(...) was not called before the handler ran",
    );
  }
  return nextClient;
}
