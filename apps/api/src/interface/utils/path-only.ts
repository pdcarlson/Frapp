import { stripAuthority } from '@repo/validation';

/**
 * The request path with any query string and fragment removed.
 *
 * `req.url` on Express **includes the query string**, so logging it verbatim
 * writes every query parameter into the log stream at whatever level the call
 * site uses. A query is free text on a public surface and routinely carries
 * credentials: `GET /v1/discord/connect/callback` carries `?code=…&state=…`,
 * and per `supabase/migrations/20260824140000_discord_bot_connection.sql` the
 * state row's primary key IS the CSRF token, so the whole attack is a SELECT on
 * a value the log already contains.
 *
 * `spec/behavior/observability.md` § Metrics → Security events specifies the
 * `security_event` `path` field as "Request path without the query string".
 * Only that row: § Structured Logging listed the request-log fields as
 * "endpoint", never a `path`, so the request log and the internal-error record
 * were covered by nothing. Rule 1 of § Structured Logging, added alongside this
 * helper, is what generalizes the requirement — every log site writing a
 * request path routes it through this function.
 *
 * No allowlist. Keeping selected parameters would mean each new query parameter
 * is logged by default until someone notices it should not be, which is the
 * failure this exists to prevent; the spec asks for the query string gone, not
 * filtered. Route grouping and debugging read the path, which is preserved
 * exactly.
 *
 * The authority half is no longer implemented here. `stripAuthority` was
 * hoisted into `packages/validation` by #1388 and is imported below, so this
 * internal log sink and the external Sentry boundary now reduce a target the
 * same way. Before that they diverged, and backwards: the Sentry scrubber —
 * the sink with the stricter threat model, because it ships to a third party —
 * was the one that kept scheme, host and `userinfo`.
 */
export function pathOnly(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  return stripAuthority(path);
}
