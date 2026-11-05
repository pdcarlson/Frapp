import {
  PRODUCTION_APP_ORIGIN,
  type ClientAnalyticsApp,
} from '@repo/validation';
import {
  CLIENT_VERSION_HEADER,
  parseClientVersionHeader,
} from '#domain/constants/client-version';
import { getHeaderValue } from '../types/request-context.types';
import type { RequestContext } from '../types/request-context.types';
import { DASHBOARD_DEV_ORIGIN, STAGING_APP_ORIGIN } from './cors.options';

/**
 * Browser origins of the web dashboard: production, staging, and its local
 * dev server, as the CORS allowlist names them (`cors.options.ts`). Not the
 * allowlist's Expo web origin, which is the mobile codebase in a browser.
 */
const DASHBOARD_ORIGINS: ReadonlySet<string> = new Set([
  PRODUCTION_APP_ORIGIN,
  STAGING_APP_ORIGIN,
  DASHBOARD_DEV_ORIGIN,
]);

/**
 * Which app sent this request, for labelling a server-side analytics event
 * (#593), read from what the clients already send:
 *
 *  - `mobile` when `X-Client-Version` parses. Native store and dev builds send
 *    it (#2526); Expo Go doesn't.
 *  - `web` when `Origin` is the dashboard's. A browser sends `Origin` on every
 *    cross-origin request, and the dashboard calls the API cross-origin; the
 *    native apps send none.
 *  - otherwise `undefined`: a server-side Next.js call, Expo Go, or a client
 *    this can't place.
 *
 * A label, not an authority: a non-browser client can set either header.
 */
export function requestApp(
  request: Pick<RequestContext, 'headers'>,
): ClientAnalyticsApp | undefined {
  if (parseClientVersionHeader(request.headers[CLIENT_VERSION_HEADER])) {
    return 'mobile';
  }
  const origin = getHeaderValue(request.headers, 'origin');
  if (origin && DASHBOARD_ORIGINS.has(origin)) return 'web';
  return undefined;
}
