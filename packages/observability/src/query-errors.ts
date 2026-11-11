import { isClientContractErrorCode } from "./api-error-codes";
import { httpStatusClass } from "./sentry-http";

/**
 * What web and mobile report to Sentry when a React Query query or mutation
 * fails (#3377). `spec/behavior/observability.md` § Error Tracking owns the
 * rules; this module is the one place they are written down in code.
 *
 * Each app binds it once, in `lib/sentry/query-errors.ts`, and hands the
 * handlers to its `QueryCache` and `MutationCache`. The app supplies the three
 * pieces this package cannot reach: its Sentry SDK's `captureException` (web
 * and mobile run different SDKs, and `@sentry/*` is never imported here, not
 * even as a type: `sentry-scrubbing.ts`), whether it believes it is online,
 * and TanStack's `isCancelledError`. Query and mutation are read structurally,
 * so this package takes no `@tanstack` dependency either.
 *
 * **What is reported.** Every final failure (after retries), at `warning`
 * level, except a 4xx whose `code` is a client-contract code
 * (`api-error-codes.ts`), which is a bug and goes at `error` (#4096). Not
 * reported at all:
 * - a 401 or 403, which is the auth flow answering, not a bug;
 * - a cancelled query, or an error named `AbortError`;
 * - a failure with no HTTP status while the app reads offline. A response, any
 *   response, means the device reached the API, so a status is reported
 *   whatever the online reading says.
 *
 * A failure with no status while online is still reported. A fetch that dies
 * before any answer (`network`) is a timeout, an outage or a CORS fault, and
 * an exception thrown inside a `queryFn` (`exception`) is usually a client bug
 * or contract drift. The issue listed both as invisible.
 *
 * **What the event carries.** Only identifiers:
 * - the query key's first element, when it is identifier-shaped. Later
 *   elements hold chapter, channel and entity ids, and `["search", chapterId,
 *   query]` holds the text a member typed, so neither they nor `queryHash` are
 *   ever sent. A mutation without a `mutationKey` reports under `unkeyed`;
 *   every one in `@repo/hooks` sets one (#3393);
 * - the status, its class, the API's machine `code` and the body's
 *   `requestId`, each kept only when it has the shape those fields have;
 * - for an HTTP failure or a dead fetch, an `Error` this module builds from
 *   those identifiers. The API's body is never passed on: its `message` is
 *   free text and can echo what a member sent. An `Error` thrown inside a
 *   `queryFn` is passed on with its stack and message, the same way the route
 *   boundaries report what they catch, and the shared scrubber sweeps its
 *   message like any other. TanStack's own errors put the whole `queryHash` in
 *   the message (`<queryHash> data is undefined`, `Missing queryFn:
 *   '<queryHash>'`), so a copy with the hash replaced by
 *   {@link QUERY_KEY_PLACEHOLDER} is sent instead whenever it appears.
 *
 * Tags carry those identifiers because the scrubber drops `extra` and custom
 * contexts, and keeps tags and the fingerprint (swept). A client-contract
 * failure also carries `api_error_class: client-contract`, and its `Error` is
 * named `ClientContractError` rather than `ApiError`, so its Sentry title says
 * what it is.
 *
 * **Grouping.** `react-query`, the kind, the key root, then the status class
 * (`4xx`, `5xx`) or `network`, then the API's `code` when there is one: one
 * Sentry issue per feature and kind of failure. A client-contract failure ends
 * its fingerprint with `client-contract`, so it opens an issue of its own at
 * `error` level rather than joining a `warning` one an older build opened. An `exception` keeps Sentry's
 * own grouping (`{{ default }}`) ahead of the kind and root, so two different
 * bugs under one root stay two issues.
 *
 * **Rate limit.** One report per fingerprint per {@link DEFAULT_REPORT_INTERVAL_MS}
 * for each reporter, so a query that fails on every focus, reconnect or retry
 * loop can't flood the project. An `exception`'s fingerprint leaves the split
 * to Sentry, so it is limited per root, error type and message instead. It is a
 * deliberate drop beside § Sampling's `1.0` for error events, and the spec
 * records it as one. The reporter remembers at most
 * {@link MAX_REMEMBERED_RATE_KEYS} of what it limits on, forgetting the oldest.
 *
 * **It never throws.** `MutationCache` awaits its `onError` before the
 * mutation's own, so a throw here would surface as the caller's error.
 */

/** One report per fingerprint per this long, per reporter. */
export const DEFAULT_REPORT_INTERVAL_MS = 10 * 60_000;

/**
 * How many rate keys one reporter remembers. A rate key is the fingerprint,
 * except for an `exception`, whose key is its root, error type and message.
 * Key roots and status classes are few, but an exception's message is part of
 * its key, so this bounds a session that throws many different ones.
 */
export const MAX_REMEMBERED_RATE_KEYS = 500;

/** What replaces the `queryHash` in a TanStack error's message and stack. */
export const QUERY_KEY_PLACEHOLDER = "[query-key]";

/** How much of an exception's message its rate limit reads. */
const RATE_KEY_MESSAGE_CHARS = 200;

/** Statuses the auth flow answers with: a sign-in redirect or a refusal screen. */
const AUTH_FLOW_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * What `fetch` rejects with when no response arrived, per runtime: Chromium,
 * Safari, Firefox, then React Native's two (`whatwg-fetch`). openapi-fetch
 * rethrows it unchanged, so this is what a `queryFn` throws. Sentry's fetch
 * instrumentation appends the host to the browser three by default
 * (`enhanceFetchErrorMessages`: `Load failed (api.frapp.live)`), so each
 * pattern allows one parenthesized suffix. Each is anchored at both ends:
 * `Failed to fetch dynamically imported module: …` is a chunk that failed to
 * load, a bug report, not a dead request.
 */
const HOST_SUFFIX = String.raw`(?: \([^()]*\))?`;
const DEAD_FETCH_MESSAGES: readonly RegExp[] = [
  "Failed to fetch",
  "Load failed",
  String.raw`NetworkError when attempting to fetch resource\.?`,
  "Network request failed",
  "Network request timed out",
].map((message) => new RegExp(`^${message}${HOST_SUFFIX}$`));

/** A query-key root or a mutation-key root, as the hooks write them. */
const KEY_ROOT_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** The API's machine codes: `chapter.module.disabled`, `DEGRADED`. */
const ERROR_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
/** `req_` plus a UUID, as the API and the SDK both mint it. */
const REQUEST_ID_RE = /^req_[A-Za-z0-9-]{1,64}$/;

/** The root an event names when the key has none worth naming. */
export const UNKEYED_ROOT = "unkeyed";

export type QueryErrorKind = "query" | "mutation";

/** What each app's Sentry binding passes to `captureException`. */
export interface QueryErrorReport {
  readonly error: Error;
  /** `error` only for a client-contract 4xx; every other failure is `warning`. */
  readonly level: "warning" | "error";
  readonly fingerprint: string[];
  readonly tags: Record<string, string>;
}

export interface QueryErrorReporterOptions {
  /**
   * The app's binding of
   * `Sentry.captureException(report.error, { level, fingerprint, tags })`.
   */
  readonly capture: (report: QueryErrorReport) => void;
  /** Whether the app reads online right now. */
  readonly isOnline: () => boolean;
  /** TanStack's `isCancelledError`. */
  readonly isCancelled: (error: unknown) => boolean;
  /** Minimum gap between two reports with one fingerprint. */
  readonly intervalMs?: number;
  readonly now?: () => number;
}

/** The part of TanStack's `Query` read here. */
export interface ReportedQuery {
  readonly queryKey: readonly unknown[];
  /** Read only to remove it from a TanStack error's message, never sent. */
  readonly queryHash?: string;
}

/** The part of TanStack's `Mutation` read here. */
export interface ReportedMutation {
  readonly options: { readonly mutationKey?: readonly unknown[] | undefined };
}

/** Handlers shaped for `QueryCacheConfig.onError` and `MutationCacheConfig.onError`. */
export interface QueryErrorReporter {
  readonly onQueryError: (error: unknown, query: ReportedQuery) => void;
  readonly onMutationError: (
    error: unknown,
    variables: unknown,
    onMutateResult: unknown,
    mutation: ReportedMutation,
  ) => void;
}

type Failure =
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "exception"; readonly error: unknown };

export function createQueryErrorReporter(
  options: QueryErrorReporterOptions,
): QueryErrorReporter {
  const intervalMs = options.intervalMs ?? DEFAULT_REPORT_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const lastReportedAt = new Map<string, number>();

  const report = (
    error: unknown,
    kind: QueryErrorKind,
    key: readonly unknown[] | undefined,
    queryHash?: string,
  ): void => {
    try {
      const failure = classify(error, options);
      if (!failure) return;
      const root = keyRoot(key);
      const built = buildReport(failure, error, kind, root, queryHash);
      const at = now();
      const last = lastReportedAt.get(built.rateKey);
      if (last !== undefined && at - last < intervalMs) return;
      // Recorded before the capture, so a capture that throws is not retried
      // on every refetch either. Deleted first so the newest is last in the
      // Map's order and the oldest is the one forgotten.
      lastReportedAt.delete(built.rateKey);
      lastReportedAt.set(built.rateKey, at);
      if (lastReportedAt.size > MAX_REMEMBERED_RATE_KEYS) {
        const oldest = lastReportedAt.keys().next();
        if (!oldest.done) lastReportedAt.delete(oldest.value);
      }
      options.capture(built.report);
    } catch {
      // Reporting is a side channel: a broken reporter loses the report, never
      // the caller's own error handling.
    }
  };

  return {
    onQueryError: (error, query) => {
      report(error, "query", query.queryKey, query.queryHash);
    },
    onMutationError: (error, _variables, _onMutateResult, mutation) => {
      report(error, "mutation", mutation.options.mutationKey);
    },
  };
}

function classify(
  error: unknown,
  options: Pick<QueryErrorReporterOptions, "isOnline" | "isCancelled">,
): Failure | null {
  if (options.isCancelled(error) || nameOf(error) === "AbortError") return null;
  const status = statusOf(error);
  if (status !== undefined) {
    return AUTH_FLOW_STATUSES.has(status) ? null : { kind: "http", status };
  }
  if (!options.isOnline()) return null;
  const deadFetch = deadFetchMessage(error);
  if (deadFetch !== undefined) return { kind: "network", message: deadFetch };
  return { kind: "exception", error };
}

function buildReport(
  failure: Failure,
  error: unknown,
  kind: QueryErrorKind,
  root: string,
  queryHash: string | undefined,
): { report: QueryErrorReport; rateKey: string } {
  const tags: Record<string, string> = {
    query_kind: kind,
    query_key_root: root,
    query_failure: failure.kind,
  };
  const requestId = requestIdOf(error);
  if (requestId) tags.request_id = requestId;

  if (failure.kind === "http") {
    const statusClass = httpStatusClass(failure.status) ?? "unknown";
    const code = codeOf(error);
    // A 5xx is the server's fault whatever its code; the API reports it.
    const clientContract =
      statusClass === "4xx" && isClientContractErrorCode(code);
    tags["http.status_code"] = String(failure.status);
    tags.status_class = statusClass;
    if (code) tags.error_code = code;
    if (clientContract) tags.api_error_class = "client-contract";
    const fingerprint = [
      "react-query",
      kind,
      root,
      statusClass,
      ...(code ? [code] : []),
      ...(clientContract ? ["client-contract"] : []),
    ];
    return {
      report: {
        error: namedError(
          clientContract ? "ClientContractError" : "ApiError",
          `${kind} "${root}" answered ${failure.status}${code ? ` (${code})` : ""}`,
        ),
        level: clientContract ? "error" : "warning",
        fingerprint,
        tags,
      },
      rateKey: fingerprint.join("\u0000"),
    };
  }

  if (failure.kind === "network") {
    const fingerprint = ["react-query", kind, root, "network"];
    return {
      report: {
        error: namedError(
          "NetworkError",
          `${kind} "${root}" got no response (${failure.message})`,
        ),
        level: "warning",
        fingerprint,
        tags,
      },
      rateKey: fingerprint.join("\u0000"),
    };
  }

  const thrown =
    failure.error instanceof Error
      ? withoutQueryHash(failure.error, queryHash)
      : namedError("QueryError", `${kind} "${root}" threw a non-Error value`);
  return {
    report: {
      error: thrown,
      level: "warning",
      fingerprint: ["{{ default }}", "react-query", kind, root],
      tags,
    },
    // Sentry splits these by stack, so the limit is per error type and
    // message rather than per root: a second bug under one root is not held
    // back by the first.
    rateKey: [
      "react-query",
      kind,
      root,
      "exception",
      thrown.name,
      String(thrown.message).slice(0, RATE_KEY_MESSAGE_CHARS),
    ].join("\u0000"),
  };
}

function keyRoot(key: readonly unknown[] | undefined): string {
  const first = key?.[0];
  return typeof first === "string" && KEY_ROOT_RE.test(first)
    ? first
    : UNKEYED_ROOT;
}

function fieldOf(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function nameOf(error: unknown): unknown {
  return fieldOf(error, "name");
}

/** `@repo/api-sdk`'s `statusOf`, read structurally: this package can't import it. */
function statusOf(error: unknown): number | undefined {
  const statusCode = fieldOf(error, "statusCode");
  if (typeof statusCode === "number") return statusCode;
  const status = fieldOf(error, "status");
  return typeof status === "number" ? status : undefined;
}

function codeOf(error: unknown): string | undefined {
  const code = fieldOf(error, "code");
  return typeof code === "string" && ERROR_CODE_RE.test(code) ? code : undefined;
}

/** The API error body's `requestId`, the id the API logged the request under. */
function requestIdOf(error: unknown): string | undefined {
  const id = fieldOf(error, "requestId");
  return typeof id === "string" && REQUEST_ID_RE.test(id) ? id : undefined;
}

function deadFetchMessage(error: unknown): string | undefined {
  if (nameOf(error) !== "TypeError") return undefined;
  const message = fieldOf(error, "message");
  if (typeof message !== "string") return undefined;
  return DEAD_FETCH_MESSAGES.some((pattern) => pattern.test(message))
    ? message
    : undefined;
}

/**
 * The error as it is, or, when its message or stack holds the query's hash
 * (TanStack writes the whole key there), a copy with the hash replaced. The
 * original is never changed: the screen that caught it still reads it.
 */
function withoutQueryHash(error: Error, queryHash: string | undefined): Error {
  if (!queryHash) return error;
  const message = String(error.message);
  const stack = typeof error.stack === "string" ? error.stack : undefined;
  if (!message.includes(queryHash) && !stack?.includes(queryHash)) return error;
  const copy = new Error(message.split(queryHash).join(QUERY_KEY_PLACEHOLDER));
  copy.name = error.name;
  if (stack !== undefined) {
    copy.stack = stack.split(queryHash).join(QUERY_KEY_PLACEHOLDER);
  }
  return copy;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
