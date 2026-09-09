import createClient, { Middleware } from 'openapi-fetch';
import type { paths } from './types';

export interface FrappClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  getChapterId?: () => string | null;
}

export const REQUEST_ID_HEADER = "x-request-id";

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

/**
 * Opaque request-correlation id. Not a Sentry/OTEL trace id, not a credential.
 *
 * Do not call `crypto.randomUUID()` bare: React Native has no `crypto` global
 * (`packages/chat-core/src/random-id.ts`, #937). api-sdk cannot import that
 * helper — chat-core already depends on this package. Same three-tier order:
 * `randomUUID` → `getRandomValues` → `Math.random` last resort.
 */
export const mintRequestId = (): string => `req_${newRequestUuid()}`;

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

function getCrypto(): CryptoLike | undefined {
  return (globalThis as { crypto?: CryptoLike }).crypto;
}

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function newRequestUuid(): string {
  const cryptoObj = getCrypto();
  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return formatUuidV4(bytes);
}

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

      ensureRequestIdHeader(request.headers);

      return request;
    },
  };

  client.use(authMiddleware);

  return client;
};
