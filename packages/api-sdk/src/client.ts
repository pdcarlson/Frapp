import createClient, { Middleware } from "openapi-fetch";
import { failureOf } from "./api-error";
import { createFirstScreenBatchMiddleware } from "./first-screen-batch";
import { mintRequestId, REQUEST_ID_HEADER } from "./request-id";

// Re-exported: callers have always imported these from the client.
export { mintRequestId, REQUEST_ID_HEADER } from "./request-id";
import type { paths } from "./types";

export interface FrappClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  getChapterId?: () => string | null;
  /**
   * The calling build, sent as {@link CLIENT_VERSION_HEADER} on every request
   * (#2526): `<ios|android>/<version>+<build>`. A store binary can't be
   * updated from here, so this header is how the API tells builds apart, and
   * `GET /v1/client-policy` reads it to decide whether a build is still
   * served. Mobile native builds set it; web and Expo Go leave it unset.
   */
  clientVersion?: string;
  /**
   * Called when the API answers a request that carried a bearer token with a
   * 401: the API no longer accepts this session. The usual cause is an
   * account deleted on another device, whose Supabase access token stays
   * valid until it expires while `SupabaseAuthGuard` refuses every call.
   *
   * The SDK only reports it. The app decides whether the session is really
   * over (it asks Supabase Auth) and signs out, so one place owns that
   * outcome instead of every screen rendering its own failure for it.
   * A 401 for a request sent without a token is not reported: that one is
   * the caller's missing sign-in, not a session the API turned down.
   */
  onUnauthorized?: () => void;
  /**
   * The zone this device's clock reads in, sent as {@link TIME_ZONE_HEADER}.
   * Defaults to the runtime's own (`Intl`), which is right for both the
   * browser and the phone; a test can pin it.
   */
  getTimeZone?: () => string | null;
  /**
   * Answer the reads a screen fires together from one `GET /v1/bootstrap`
   * (#4709): see `createFirstScreenBatchMiddleware`. The web dashboard and
   * the phone app turn it on; off by default, so a client that doesn't ask
   * sends every read on its own route as before.
   */
  batchFirstScreenReads?: boolean;
  /**
   * Replaces {@link requestTimeoutMs}'s choice for every request; a test can
   * shorten it. Unset, each request gets its own limit.
   */
  requestTimeoutMs?: number;
}

/**
 * How long an API request may wait for its response (#3433), as
 * `spec/ui/resilience/api-retry.md` § Per-Endpoint Timeout Configuration
 * sets it: 15s for a read, 20s for a write, 10s for the two the member is
 * watching (member search, a chat send), and 90s for the AI calls that answer
 * only once the model has.
 *
 * Nothing else bounds it on Android. React Native's OkHttp client is built
 * with connect, read and write timeouts of 0 ("no timeout"), so a request on a
 * half-open connection (a Wi-Fi to cellular handoff) never fails, its query
 * sits in `isFetching` for good, and it holds one of OkHttp's five
 * connections to the API host. Uploads don't go through this client (they
 * `PUT` to a signed storage URL), so they aren't held to it.
 *
 * It bounds the wait for the response itself, which is when `fetch` resolves:
 * the headers. A body read after that (the Ask stream, whose headers go out
 * before the model starts) is not cut off.
 */
export const REQUEST_TIMEOUT_MS = {
  read: 15_000,
  write: 20_000,
  watched: 10_000,
  model: 90_000,
} as const;

/** The requests whose limit isn't their method's, by `METHOD schemaPath`. */
const TIMEOUT_BY_ROUTE: Readonly<Record<string, number>> = {
  "GET /v1/members/search": REQUEST_TIMEOUT_MS.watched,
  // Idempotent by `client_message_id`, so a send cut off here and sent again
  // lands once (`spec/ui/resilience/message-delivery.md`).
  "POST /v1/channels/{id}/messages": REQUEST_TIMEOUT_MS.watched,
  // A model call answered in the request, not streamed (Ask streams).
  "POST /v1/ai/act": REQUEST_TIMEOUT_MS.model,
  "POST /v1/ai/act/event-audience": REQUEST_TIMEOUT_MS.model,
  "POST /v1/ai/catch-up": REQUEST_TIMEOUT_MS.model,
};

/** The limit {@link REQUEST_TIMEOUT_MS} sets for one request. */
export const requestTimeoutMs = (method: string, schemaPath: string): number =>
  TIMEOUT_BY_ROUTE[`${method.toUpperCase()} ${schemaPath}`] ??
  (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD"
    ? REQUEST_TIMEOUT_MS.read
    : REQUEST_TIMEOUT_MS.write);

/**
 * The message a timed-out request fails with. It is React Native's own
 * wording for a timeout, which `@repo/hooks`' `errorCopy` and the Sentry
 * query reporter (`@repo/observability`) already read as a dead request: the
 * screen shows its offline copy, and the call is retried as a dropped
 * connection is.
 */
const REQUEST_TIMEOUT_MESSAGE = "Network request timed out";

const requestTimeoutError = (): Error => {
  const error = new Error(REQUEST_TIMEOUT_MESSAGE);
  error.name = "TimeoutError";
  return error;
};

/** Whether `error` is a request this client gave up on (#3433). */
export const isRequestTimeout = (error: unknown): boolean =>
  error instanceof Error &&
  error.name === "TimeoutError" &&
  error.message === REQUEST_TIMEOUT_MESSAGE;

/**
 * `fetch`, failing after `timeoutOf(request)` without a response. The
 * caller's own `signal` (TanStack Query's, when a query is cancelled) still
 * aborts it: the request goes out on a controller that both abort. The global
 * `fetch` is read per call, so an instrumented one (Sentry's) installed after
 * the client was built is still the one used.
 *
 * The timeout also rejects by itself rather than only aborting, so a `fetch`
 * that ignores its signal still lets the caller go.
 */
const fetchWithTimeout =
  (timeoutOf: (request: Request) => number) =>
  async (request: Request, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const callerSignal = request.signal as AbortSignal | null | undefined;
    const followCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) followCaller();
    else callerSignal?.addEventListener("abort", followCaller, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = requestTimeoutError();
        controller.abort(error);
        reject(error);
      }, timeoutOf(request));
    });
    try {
      return await Promise.race([
        globalThis.fetch(request, { ...init, signal: controller.signal }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", followCaller);
    }
  };

/** The client's request methods, each wrapped by {@link createFrappClient}. */
const REQUEST_METHODS = [
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
  "request",
] as const;

type CallResult = { error?: unknown; response: Response };

/**
 * Matches the API's `TIME_ZONE_HEADER`. The API records it per member so a
 * push can name an event's time the way the member's phone shows it.
 */
export const TIME_ZONE_HEADER = "x-time-zone";

/** This runtime's IANA zone, or null where `Intl` cannot say. */
const runtimeTimeZone = (): string | null => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
};

/** Matches the API's `CLIENT_VERSION_HEADER` (`#domain/constants/client-version`). */
export const CLIENT_VERSION_HEADER = "x-client-version";

/**
 * Ensure `x-request-id` is present. Honours a caller-supplied value.
 * Same rule as {@link createFrappClient}; {@link withRequestIdInit} applies it
 * for raw `fetch` health probes that cannot go through the OpenAPI client
 * (`/health` is not under `/v1`).
 */
const ensureRequestIdHeader = (headers: Headers): Headers => {
  if (!headers.has(REQUEST_ID_HEADER)) {
    headers.set(REQUEST_ID_HEADER, mintRequestId());
  }
  return headers;
};

/**
 * Return a `RequestInit` whose headers include `x-request-id`.
 * Does not copy `sentry-trace` / `baggage`; those stay Sentry's.
 */
export const withRequestIdInit = (init: RequestInit = {}): RequestInit => {
  const headers = ensureRequestIdHeader(new Headers(init.headers));
  return { ...init, headers };
};

/**
 * Normalize an API base URL to the bare origin the generated client expects.
 *
 * `openapi.json` declares no `servers` entry and carries the version in the
 * path (`/v1/...`; only `/health` does not), and `openapi-fetch` concatenates
 * `baseUrl + path` verbatim. So `baseUrl` must NOT end in `/v1` — one that
 * does produces `/v1/v1/...` and 404s every request.
 *
 * The documented convention is therefore the bare origin (see
 * `docs/internal/environment/ENV_REFERENCE.md`). This function exists because
 * the value does not come from the repo: it arrives as deploy-time config in
 * Vercel and EAS, which the repo can neither read nor validate at build time.
 * Normalizing here makes a stale `/v1` left in one of those settings a no-op
 * instead of a total outage.
 *
 * Stripping is also correct for an API genuinely mounted under a prefix:
 * `https://host/api/v1` becomes `https://host/api`, and the generated `/v1`
 * path segment puts it back.
 */
export const normalizeApiBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -"/v1".length) : trimmed;
};

export const createFrappClient = (config: FrappClientConfig) => {
  // Each request's limit, recorded by the last middleware from its schema
  // path (which `fetch` never sees) for the request object `fetch` gets.
  const timeouts = new WeakMap<Request, number>();
  const timeoutOf = (request: Request): number =>
    config.requestTimeoutMs ??
    timeouts.get(request) ??
    requestTimeoutMs(request.method, "");

  const client = createClient<paths>({
    baseUrl: normalizeApiBaseUrl(config.baseUrl),
    fetch: fetchWithTimeout(timeoutOf),
  });

  // A failed call always reports what it failed with, status included
  // (#3394). openapi-fetch hands back a falsy `error` for a non-2xx with an
  // empty body (an edge's 502), and most hooks end in `if (error) throw
  // error; return data`, which then reads the failure as a success: the
  // mutation's success toast fires for a write that never happened. Settled
  // here, every hook throws it with its status, whatever its body.
  const methods = client as unknown as Record<
    (typeof REQUEST_METHODS)[number],
    (...args: unknown[]) => Promise<CallResult>
  >;
  for (const name of REQUEST_METHODS) {
    const call = methods[name];
    methods[name] = async (...args) => {
      const result = await call(...args);
      return result.response.ok
        ? result
        : { ...result, error: failureOf(result) };
    };
  }

  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      if (config.getAuthToken) {
        const token = await config.getAuthToken();
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
        }
      }

      if (config.getChapterId) {
        const chapterId = config.getChapterId();
        if (chapterId) {
          request.headers.set("x-chapter-id", chapterId);
        }
      }

      if (config.clientVersion) {
        request.headers.set(CLIENT_VERSION_HEADER, config.clientVersion);
      }

      const timeZone = (config.getTimeZone ?? runtimeTimeZone)();
      if (timeZone) {
        request.headers.set(TIME_ZONE_HEADER, timeZone);
      }

      ensureRequestIdHeader(request.headers);

      return request;
    },
    onResponse({ request, response }) {
      if (
        response.status === 401 &&
        config.onUnauthorized &&
        request.headers.has("Authorization")
      ) {
        config.onUnauthorized();
      }
      return undefined;
    },
  };

  client.use(authMiddleware);
  // After the auth middleware: a batch is keyed on the headers it sets.
  if (config.batchFirstScreenReads) {
    client.use(createFirstScreenBatchMiddleware());
  }
  // Last, so the request it records is the one `fetch` is handed.
  client.use({
    onRequest({ request, schemaPath }) {
      timeouts.set(request, requestTimeoutMs(request.method, schemaPath));
      return undefined;
    },
  });

  return client;
};
