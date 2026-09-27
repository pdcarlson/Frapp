import { SENTRY_REQUEST_HEADER_ALLOWLIST } from "./sentry-scrubbing";

/**
 * Structural copy of the Sentry SDK's `DataCollection` option (v11,
 * `@sentry/core` `types/datacollection.d.ts`), narrowed to the values this
 * repo ships. This package cannot name `@sentry/*` types (see
 * `apps/api/src/infrastructure/observability/sentry-scrubbing.ts`), so each
 * `Sentry.init` call site assigns the result to the real option type, and a
 * changed SDK shape fails to compile there.
 */
export interface SentryDataCollection {
  userInfo: false;
  cookies: false;
  httpHeaders: { request: { allow: string[] }; response: false };
  httpBodies: [];
  urlQueryParams: false;
  graphQL: { document: false; variables: false };
  genAI: { inputs: false; outputs: false };
  databaseQueryData: false;
  queues: false;
  stackFrameVariables: false;
  frameContextLines: number;
}

/**
 * What the Sentry SDK may collect, set for every surface that runs the v11
 * JS SDK (the API and both Next apps, browser and server). Issue #2722.
 *
 * v11 removed `sendDefaultPii` and replaced it with this object, and **every
 * category defaults to on**. Leaving it unset would start collecting cookies,
 * headers, all four HTTP body directions, query strings and stack-frame
 * locals. So every category is named here, and none is left to a default.
 *
 * The rule for each value: collect at the source only what the scrubber
 * (`sentry-scrubbing.ts`) would let through anyway. The scrubber is still the
 * layer that makes an event safe, because it also sweeps free text. But
 * whatever the SDK never collects can't leak through a scrubber bug, and
 * none of these settings drops anything that reaches Sentry today.
 *
 * Compared with v10's `sendDefaultPii: false`, which filtered by key name
 * (`[Filtered]` for keys like `authorization`, everything else verbatim):
 *
 * - `userInfo: false`: same as v10. The SDK does not infer the client IP or
 *   fill `user.*`. The API sets a pseudonymous `user.id` itself.
 * - `cookies: false`: stricter. v10 collected cookies and filtered them by
 *   name; the scrubber drops `request.cookies` whole.
 * - `httpHeaders`: stricter. Request headers are the scrubber's own
 *   allowlist, and any other header name arrives valued `[Filtered]` (the
 *   SDK's allow mode keeps the key), which the scrubber then drops. Response
 *   headers are off, because no scrubber rule keeps one.
 * - `httpBodies: []`: same as v10. No body in either direction.
 * - `urlQueryParams: false`: stricter. The scrubber cuts every URL to its
 *   path and drops `query_string`, so the SDK no longer collects one.
 * - `graphQL`: stricter. v10 always attached the document (literals
 *   redacted). No surface runs GraphQL, so this only matters if one is added.
 * - `genAI`, `databaseQueryData`: same as v10 (off).
 * - `queues`: new in v11, off. No surface enqueues through an instrumented
 *   queue client, and task arguments are exactly the payloads that must not
 *   leave.
 * - `stackFrameVariables: false`: stricter. v10 left it on, and only the
 *   scrubber's frame allowlist (and `includeLocalVariables` being unset)
 *   kept `vars` off the wire. Turning on local variables for a debugging
 *   session would have put request payloads behind that one rule.
 * - `frameContextLines: 7`: unchanged. It is source code, not user data, and
 *   7 is what v10 resolved (`ContextLines`' own default). v11's default is 5.
 *
 * A fresh object per call, so the SDK can never mutate a shared copy.
 */
export function sentryDataCollection(): SentryDataCollection {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { allow: [...SENTRY_REQUEST_HEADER_ALLOWLIST] },
      response: false,
    },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 7,
  };
}
