import createClient, { Middleware } from 'openapi-fetch';
import { randomClientId } from './random-id';
import type { paths } from './types';

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
   * The zone this device's clock reads in, sent as {@link TIME_ZONE_HEADER}.
   * Defaults to the runtime's own (`Intl`), which is right for both the
   * browser and the phone; a test can pin it.
   */
  getTimeZone?: () => string | null;
}

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Matches the API's `TIME_ZONE_HEADER`. The API records it per member so a
 * push can name an event's time the way the member's phone shows it.
 */
export const TIME_ZONE_HEADER = "x-time-zone";

/** This runtime's IANA zone, or null where `Intl` cannot say. */
export const runtimeTimeZone = (): string | null => {
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
 * Opaque request-correlation id. Not a Sentry/OTEL trace id, not a credential.
 *
 * Minted through {@link randomClientId}, never a bare `crypto.randomUUID()`:
 * React Native has no `crypto` global (`./random-id.ts`, #937).
 */
export const mintRequestId = (): string => `req_${randomClientId()}`;

/**
 * Ensure `x-request-id` is present. Honours a caller-supplied value.
 * Same rule as {@link createFrappClient} — used by raw `fetch` health probes
 * that cannot go through the OpenAPI client (`/health` is not under `/v1`).
 */
export const ensureRequestIdHeader = (headers: Headers): Headers => {
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
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -'/v1'.length) : trimmed;
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
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      }

      if (config.getChapterId) {
        const chapterId = config.getChapterId();
        if (chapterId) {
          request.headers.set('x-chapter-id', chapterId);
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
  };

  client.use(authMiddleware);

  return client;
};
