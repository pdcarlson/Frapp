import { stripAuthority } from "./sentry-scrubbing";

/**
 * Path-only URL for analytics. Query, fragment, and authority never leave.
 * `/join?token=` becomes `/join` (or `undefined` if nothing safe remains).
 *
 * Browser-safe: no `process.env`, no `node:*`. Landing pageviews and the
 * anonymous PostHog property filter both use this so a marketing capture
 * cannot ship an invite token.
 */
export function pathOnlyAnalyticsPath(value: string): string | undefined {
  const withoutHash = value.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery) return undefined;
  const path = stripAuthority(withoutQuery);
  if (!path.startsWith("/")) return undefined;
  if (path.includes("?") || path.includes("#")) return undefined;
  return path;
}

/** A path segment that names a record rather than a screen. */
const RECORD_ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|\d+|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,})$/i;

/**
 * The route a page or screen view records (#3382): path-only, with any
 * segment that names a record (a UUID, a long hex or numeric id, a long
 * token) replaced by `[id]`, so `/events/3f2a…` is recorded as
 * `/events/[id]`. No web or mobile route carries an id in its path today
 * (they ride the query string, which is dropped); this keeps a future
 * dynamic route from sending one. `undefined` when nothing safe remains.
 */
export function analyticsRouteTemplate(value: string): string | undefined {
  const path = pathOnlyAnalyticsPath(value);
  if (!path) return undefined;
  return path
    .split("/")
    .map((segment) => (RECORD_ID_SEGMENT.test(segment) ? "[id]" : segment))
    .join("/");
}
