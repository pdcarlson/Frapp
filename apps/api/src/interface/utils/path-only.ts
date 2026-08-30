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
 * `packages/validation`'s Sentry scrubber has a `pathOnly` of its own that does
 * NOT strip the authority. Treat that as a known gap, not a design — the
 * justification once offered for it, that its `redactFreeText` covers userinfo,
 * does not hold. `redactFreeText` has no rule about URL authority at all; what
 * it removes is whatever its e-mail pattern happens to overlap, which for some
 * inputs is the password and host, for others half the password, and for others
 * nothing whatsoever. #1388 carries the measured cases — deliberately there and
 * not here, because a regex's incidental behaviour is exactly the kind of
 * detail a comment states once and then drifts on.
 *
 * The part that is stable, and the reason this helper does not delegate: that
 * function is not an authority stripper and does not claim to be. #1388's fix
 * is to hoist `stripAuthority` below into that package so both sinks share one
 * implementation. Until then the internal log stream is the hardened one and
 * the external boundary is not, which is backwards.
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
  // Origin-form, the overwhelmingly common case: already just a path. This
  // includes a `//`-leading target, which is a legal origin-form path — RFC
  // 9112's `absolute-path` is `1*( "/" segment )` and a segment may be empty.
  //
  // A protocol-relative target (`//host/path`) is deliberately NOT handled.
  // It is not one of the four request-target forms, so it cannot legitimately
  // arrive; treating it as one meant discarding the first segment of any legal
  // `//`-leading path, which is strictly worse than the leak this function
  // fixes. `GET //x/v1/chapters/join` 404s but would have been logged as
  // `/v1/chapters/join` — a real route, indistinguishable in the path field
  // from a genuine request, which is log forgery in the function whose whole
  // subject is log integrity.
  if (path.startsWith('/')) return path;

  const afterScheme = path.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.*)$/);

  // Not absolute-form — asterisk-form (`OPTIONS *`) or authority-form
  // (`CONNECT host:port`). Neither carries a path to recover, and neither
  // should be rewritten into something that looks like one.
  if (!afterScheme) return path;

  const authorityAndPath = afterScheme[1];
  const slash = authorityAndPath.indexOf('/');
  return slash === -1 ? '/' : authorityAndPath.slice(slash);
}
