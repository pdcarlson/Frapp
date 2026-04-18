import createClient, { Middleware } from 'openapi-fetch';
import type { paths } from './types';

export interface FrappClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  getChapterId?: () => string | null;
}

/**
 * Contract paths include a `/v1/...` prefix. When `API_URL` already ends with
 * `/v1` (common in Infisical), passing it through unchanged would produce
 * `/v1/v1/...` and 404s. Strip redundant `/v1` segments from the configured origin.
 */
function resolveOpenApiBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '');
  while (base.endsWith('/v1')) {
    base = base.slice(0, -3).replace(/\/+$/, '');
  }
  return base;
}

export const createFrappClient = (config: FrappClientConfig) => {
  const client = createClient<paths>({ baseUrl: resolveOpenApiBaseUrl(config.baseUrl) });

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

      return request;
    },
  };

  client.use(authMiddleware);

  return client;
};
