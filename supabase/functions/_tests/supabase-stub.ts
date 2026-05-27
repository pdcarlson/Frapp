// Test-only replacement for `@supabase/supabase-js` (wired via the test import
// map at `supabase/functions/_tests/deno.json`). Both Edge entrypoints call
// `createClient` twice (anon + service-role); this stub returns the same
// per-test mock client for every call so a test can script the whole sequence
// in one place.
//
// Each test calls `setNextClient(mock.client)` before invoking the captured
// handler. The stub stays sticky across the request so anon and service
// `createClient` calls return the same mock.
//
// `chat-authz.ts` does `import type { SupabaseClient } from "@supabase/supabase-js"`
// and chat-send's insert chain uses `.returns<Record<string, unknown>[]>()` — a
// type argument. Under the test import map those specifiers resolve here, so the
// stub must expose BOTH the `SupabaseClient` type AND a builder shape where
// `.returns<T>()` is a recognized generic function. Otherwise Deno's default
// type-check trips with TS2305 ("no exported member") or TS2347 ("untyped
// function calls may not accept type arguments") and the edge-fn-tests job
// reds before any test runs.

// deno-lint-ignore no-explicit-any
type Anything = any;

export interface QueryBuilder {
  select(...args: Anything[]): QueryBuilder;
  insert(...args: Anything[]): QueryBuilder;
  /** ADR-07: chat-react UPSERTs vote-change rows; the stub exposes
   * `.update(...)` so the Edge Function type-checks under the test import
   * map. */
  update(...args: Anything[]): QueryBuilder;
  eq(column: string, value: Anything): QueryBuilder;
  in(column: string, values: Anything[]): QueryBuilder;
  maybeSingle(): Promise<{ data: Anything; error: Anything }>;
  single(): Promise<{ data: Anything; error: Anything }>;
  returns<T>(): Promise<{ data: T; error: Anything }>;
  then<R = Anything>(
    onfulfilled?: (value: { data: Anything; error: Anything }) => R,
    onrejected?: (reason: Anything) => Anything,
  ): Promise<R>;
}

export interface SupabaseClient {
  auth: {
    getUser(jwt?: string): Promise<{
      data: { user: { id: string } | null };
      error: Anything;
    }>;
  };
  from(table: string): QueryBuilder;
  channel(name: string): { send(event: Anything): Promise<Anything> };
  removeChannel(channel: Anything): Promise<Anything>;
}

let nextClient: SupabaseClient | null = null;

export function setNextClient(client: SupabaseClient) {
  nextClient = client;
}

export function resetClient() {
  nextClient = null;
}

export function createClient(
  _url: string,
  _key: string,
  _opts?: Anything,
): SupabaseClient {
  if (!nextClient) {
    throw new Error(
      "supabase-stub: setNextClient(...) was not called before the handler ran",
    );
  }
  return nextClient;
}
