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
