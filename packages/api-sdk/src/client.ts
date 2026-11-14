import createClient, { Middleware } from "openapi-fetch";
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
}

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
  const client = createClient<paths>({
    baseUrl: normalizeApiBaseUrl(config.baseUrl),
  });

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

  return client;
};
