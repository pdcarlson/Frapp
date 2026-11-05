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

/**
 * A path segment that names a screen: lowercase words joined by hyphens
 * (`chat-thread`), a route group (`(tabs)`), or an already-templated param
 * (`[id]`), at most 24 characters. Every web, landing and mobile route is one
 * of these (the longest, `discord-import`, is 14); anything else (an id, a
 * token, an email, a code) is what the template must not keep.
 */
const SCREEN_SEGMENT =
  /^(?:[a-z]+(?:-[a-z]+)*|\([a-z]+(?:-[a-z]+)*\)|\[[A-Za-z]+\])$/;
const MAX_SCREEN_SEGMENT = 24;
/** A hex run is a record id even when it happens to be all letters. */
const HEX_RUN = /^[0-9a-f]{12,}$/;

function namesScreen(segment: string): boolean {
  return (
    segment.length <= MAX_SCREEN_SEGMENT &&
    SCREEN_SEGMENT.test(segment) &&
    !HEX_RUN.test(segment)
  );
}

/**
 * The route a page or screen view records (#3382), and the form every
 * URL-shaped SDK property leaves in: path-only, with every segment that does
 * not name a screen replaced by `[id]`, so `/events/3f2a…` is recorded as
 * `/events/[id]` and `/members/jane@school.edu` as `/members/[id]`. No web
 * or mobile route carries an id in its path today (ids ride the query
 * string, which is dropped); this keeps a future dynamic route, or a
 * malformed link that lands on not-found, from sending one. `undefined` when
 * nothing safe remains.
 */
export function analyticsRouteTemplate(value: string): string | undefined {
  const path = pathOnlyAnalyticsPath(value);
  if (!path) return undefined;
  return path
    .split("/")
    .map((segment) =>
      segment === "" || namesScreen(segment) ? segment : "[id]",
    )
    .join("/");
}
