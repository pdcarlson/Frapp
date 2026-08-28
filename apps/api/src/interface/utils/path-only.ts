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
 * `spec/behavior/observability.md` § Structured Logging specifies the `path`
 * field as "Request path without the query string" — this is the function that
 * makes that true, and every log site writing a path must route through it.
 *
 * No allowlist. Keeping selected parameters would mean each new query parameter
 * is logged by default until someone notices it should not be, which is the
 * failure this exists to prevent; the spec asks for the query string gone, not
 * filtered. Route grouping and debugging read the path, which is preserved
 * exactly.
 *
 * Deliberately *not* shared with `pathOnly` in `packages/validation`'s Sentry
 * scrubber: that one additionally runs `redactFreeText` and guards the
 * external-reporting boundary, where the threat model and the retention policy
 * both differ from the internal log stream.
 */
export function pathOnly(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
