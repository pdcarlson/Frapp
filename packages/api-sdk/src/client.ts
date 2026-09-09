import createClient, { Middleware } from 'openapi-fetch';
import type { paths } from './types';

export interface FrappClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  getChapterId?: () => string | null;
}

export const REQUEST_ID_HEADER = "x-request-id";

/** Opaque request-correlation id. Not a Sentry/OTEL trace id. */
export const mintRequestId = (): string =>
  `req_${globalThis.crypto.randomUUID()}`;

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

      if (!request.headers.has(REQUEST_ID_HEADER)) {
        request.headers.set(REQUEST_ID_HEADER, mintRequestId());
      }

      return request;
    },
  };

  client.use(authMiddleware);

  return client;
};
