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
import type { AnalyticsAppVersion } from '../../application/services/analytics.service';
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

/**
 * The mobile build that sent this request, for stamping a server-side
 * analytics event with PostHog's own `$app_version` / `$app_build`: the same
 * keys `posthog-react-native` puts on the events it sends itself, so one
 * breakdown splits screens and server events alike by build. Read from
 * `X-Client-Version` (`ios/0.11.0+19` gives `0.11.0` and `19`, `android/0.13`
 * gives `0.13` and no build); `undefined`
 * when the header is absent or doesn't parse, which is the web dashboard,
 * Expo Go and anything older than #2526.
 *
 * Like `requestApp`, a label, not an authority.
 */
export function requestAppVersion(
  request: Pick<RequestContext, 'headers'>,
): AnalyticsAppVersion | undefined {
  const raw = request.headers[CLIENT_VERSION_HEADER];
  const parsed = parseClientVersionHeader(raw);
  if (!parsed || typeof raw !== 'string') return undefined;
  // The version as the client wrote it, not the parsed parts re-joined: the
  // SDK sends `nativeApplicationVersion` unpadded, so `0.13` must stay `0.13`
  // here too or one build splits into two `$app_version` values. The parse
  // above has already limited it to digits and dots.
  const version = raw
    .slice(raw.indexOf('/') + 1)
    .split('+')[0]
    .trim();
  return {
    version,
    build: parsed.build === null ? null : String(parsed.build),
  };
}
