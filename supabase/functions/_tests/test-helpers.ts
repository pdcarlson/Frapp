// Shared helpers for the Edge-Function entrypoint tests.
//
// The production handlers call `Deno.serve(handler)` at module top level and
// build their Supabase clients via the `@supabase/supabase-js` constructor.
// We test the wiring without spinning up a real server or a real DB:
//
//   1. `installDenoServeInterceptor()` replaces `Deno.serve` with a setter
//      that captures the handler — the test then calls it directly with a
//      synthetic `Request`.
//   2. `buildMockClient(script)` returns a chainable mock matching the
//      supabase-js surface that the handlers actually call
//      (`auth.getUser`, `from(...).select/insert/eq/in/maybeSingle/single/returns`,
//      `channel(...).send`, `removeChannel`). Each `from(table)` shifts the
//      next scripted response from the per-table queue, so a single mock can
//      cover the whole authz + write sequence in one test.
//   3. Every method invocation is logged in `mock.calls` so the test can
//      assert that the `chat_messages` / `chat_message_actions` insert was
//      NOT called on an authz failure (the §2 predicate-wiring change-detector).

// deno-lint-ignore no-explicit-any
export type ScriptedResponse = { data?: any; error?: any };

export interface MockClientOptions {
  authGetUser?: ScriptedResponse;
  tables?: Record<string, ScriptedResponse[]>;
}

export interface BuilderCall {
  table: string;
  method: string;
  args: unknown[];
}

export interface MockClient {
  // deno-lint-ignore no-explicit-any
  client: any;
  calls: {
    auth: { getUser: string[] };
    from: Array<{ table: string }>;
    builder: BuilderCall[];
    channel: Array<{ name: string; events: unknown[] }>;
    removeChannel: number;
  };
  // Convenience: extract the insert payloads for a table.
  insertCalls(table: string): unknown[];
  // Convenience: count `from(table)` calls.
  fromCount(table: string): number;
}

export function buildMockClient(opts: MockClientOptions = {}): MockClient {
  const tables: Record<string, ScriptedResponse[]> = {};
  for (const [t, q] of Object.entries(opts.tables ?? {})) {
    tables[t] = [...q];
  }

  const calls: MockClient["calls"] = {
    auth: { getUser: [] },
    from: [],
    builder: [],
    channel: [],
    removeChannel: 0,
  };

  function makeQueryBuilder(table: string, response: ScriptedResponse) {
    // deno-lint-ignore no-explicit-any
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "then") {
            return (
              // deno-lint-ignore no-explicit-any
              resolve: (v: any) => void,
              // deno-lint-ignore no-explicit-any
              reject: (e: any) => void,
            ) => Promise.resolve(response).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            calls.builder.push({ table, method: prop as string, args });
            return builder;
          };
        },
      },
    );
    return builder;
  }

  const client = {
    auth: {
      getUser: (jwt: string) => {
        calls.auth.getUser.push(jwt);
        return Promise.resolve(
          opts.authGetUser ?? {
            data: { user: null },
            error: { message: "no-stub" },
          },
        );
      },
    },
    from: (table: string) => {
      calls.from.push({ table });
      const queue = tables[table] ?? [];
      const resp = queue.shift() ?? { data: null, error: null };
      return makeQueryBuilder(table, resp);
    },
    channel: (name: string) => {
      const events: unknown[] = [];
      calls.channel.push({ name, events });
      return {
        send: (event: unknown) => {
          events.push(event);
          return Promise.resolve({});
        },
      };
    },
    removeChannel: (_channel: unknown) => {
      calls.removeChannel++;
      return Promise.resolve({});
    },
  };

  return {
    client,
    calls,
    insertCalls(table: string) {
      return calls.builder
        .filter((c) => c.table === table && c.method === "insert")
        .map((c) => c.args[0]);
    },
    fromCount(table: string) {
      return calls.from.filter((c) => c.table === table).length;
    },
  };
}

// ── Deno.serve interceptor ─────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
let capturedHandler: ((req: Request) => Promise<Response>) | null = null;

export function installDenoServeInterceptor() {
  capturedHandler = null;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno.serve = (
    handlerOrOpts: unknown,
    maybeHandler?: unknown,
  ) => {
    capturedHandler =
      // deno-lint-ignore no-explicit-any
      (typeof handlerOrOpts === "function" ? handlerOrOpts : maybeHandler) as any;
    // Return a fake shutdown handle (the real `Deno.serve` returns a server).
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
  };
}

export function getCapturedHandler() {
  if (!capturedHandler) {
    throw new Error(
      "getCapturedHandler: Deno.serve was never called — did you `await import(...)` the entrypoint after installing the interceptor?",
    );
  }
  return capturedHandler;
}

// ── Request + env helpers ──────────────────────────────────────────────────

export function setEnv() {
  Deno.env.set("SUPABASE_URL", "http://test-supabase.local");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
}

export interface BuildRequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  url?: string;
}

export function buildRequest(opts: BuildRequestOpts = {}): Request {
  const headers = new Headers(opts.headers ?? {});
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  return new Request(opts.url ?? "http://test/fn", {
    method: opts.method ?? "POST",
    headers,
    body,
  });
}

export function withBearer(jwt: string): Record<string, string> {
  return { authorization: `Bearer ${jwt}` };
}
