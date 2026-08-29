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
  const path = cut === -1 ? url : url.slice(0, cut);
  return stripAuthority(path);
}

/**
 * Absolute-form and protocol-relative request targets, reduced to their path.
 *
 * Node hands `req.url` the request line **verbatim**, and RFC 9112 permits
 * absolute-form (`GET http://host/path HTTP/1.1`) on any request, not just to a
 * proxy. Express then routes on `req.path` while leaving `req.url` whole, so
 * cutting only at `?` would keep the scheme, host — and the `userinfo`, which
 * is where this stops being cosmetic: a caller sending
 * `GET http://user:hunter2@api.frapp.live/v1/health` would otherwise write
 * those credentials straight into the log stream this function exists to keep
 * credential-free. Verified against the Express version in this repo: that
 * request arrives with `req.url` intact and `req.path` as `/v1/health`.
 *
 * It also keeps route grouping honest — absolute-form records would otherwise
 * never group with the origin-form records for the same route, which is exactly
 * when someone is probing.
 */
function stripAuthority(path: string): string {
  // Origin-form, the overwhelmingly common case: already just a path.
  if (path.startsWith('/') && !path.startsWith('//')) return path;

  const afterScheme = path.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.*)$/);
  const authorityAndPath = afterScheme
    ? afterScheme[1]
    : path.startsWith('//')
      ? path.slice(2)
      : undefined;

  // Neither absolute nor protocol-relative — asterisk-form (`OPTIONS *`) or
  // authority-form (`CONNECT host:port`). Neither carries a path to recover,
  // and neither should be rewritten into something that looks like one.
  if (authorityAndPath === undefined) return path;

  const slash = authorityAndPath.indexOf('/');
  return slash === -1 ? '/' : authorityAndPath.slice(slash);
}
