import type { ErrorEvent } from '@sentry/nestjs';
import { pseudonymizeIp, pseudonymizeUserId } from './pseudonyms';

/**
 * PII scrubbing for everything leaving the API for Sentry (issue #481).
 *
 * `spec/behavior/observability.md` § Error Tracking splits identifiers into two
 * classes, and this module is the single enforcement point for both:
 *
 *  - **Pseudonymized:** `user_id` and `chapter_id` → HMAC-SHA256 under the
 *    per-environment analytics salt.
 *  - **Redacted entirely:** emails, IP addresses, auth tokens (including any
 *    `Authorization` header value), request bodies, response bodies, message
 *    contents, document contents, and free-text fields that may contain
 *    user-typed PII.
 *
 * The design principle is **allowlist, not denylist**, everywhere a structure
 * is enumerable — headers, request fields, top-level event keys. A denylist
 * silently starts leaking the day Sentry's SDK adds a field, and the failure is
 * invisible because nobody reads their own error reports looking for PII.
 *
 * Free text is the one place an allowlist is impossible: an exception message
 * is the payload we actually want, and dropping it would make the whole
 * integration pointless. Those strings get a redaction sweep instead
 * ({@link redactFreeText}), which is best-effort by construction and is the
 * weakest link here by design — hence the strictness everywhere else.
 */

/** Request headers worth keeping. Everything else is dropped unread. */
const HEADER_ALLOWLIST = new Set(['content-type', 'x-request-id']);

/**
 * Top-level event keys that may survive. Sentry's own envelope metadata plus
 * the fields we deliberately populate.
 *
 * `user`, `request`, and `breadcrumbs` are absent on purpose: they are rebuilt
 * field-by-field below rather than passed through.
 */
const EVENT_KEY_ALLOWLIST = new Set([
  'event_id',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'logger',
  'server_name',
  'release',
  'dist',
  'environment',
  'sdk',
  'type',
  'fingerprint',
  'transaction',
  'transaction_info',
  'exception',
  'message',
  'tags',
  'contexts',
  'modules',
]);

/**
 * Contexts Sentry populates with runtime/infra facts (no user data). Anything
 * else — including the `state` context some integrations attach — is dropped.
 */
const CONTEXT_ALLOWLIST = new Set([
  'trace',
  'runtime',
  'os',
  'device',
  'culture',
  'app',
  'cloud_resource',
]);

// ── Free-text redaction ──────────────────────────────────────────────────────

/**
 * A URL — absolute or a bare path — together with its query string.
 *
 * Query strings are the single most common place a token turns up in free
 * text: an http breadcrumb's message, a fetch error, a logged upstream URL.
 * Stripping the query wherever a URL appears in prose is stricter than
 * stripping `request.url` alone, which is what a structural scrubber would
 * catch. Anchored on `/` or a scheme so ordinary prose ending in a question
 * mark is left alone.
 */
const URL_QUERY_RE = /((?:https?:\/\/\S*?|\/[^\s?#]*)\?)\S*/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** `Bearer <jwt|opaque>`, and bare three-segment JWTs wherever they appear. */
const BEARER_RE = /\bBearer\s+[\w\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g;
/**
 * Supabase/Stripe-shaped API keys and the project's own secret prefixes.
 * The body allows `_` because every real key has one (`sk_live_…`, `sk_test_…`)
 * and stopping at the first underscore would match four harmless characters.
 */
const KEYLIKE_RE = /\b(?:sk|pk|rk|whsec|sbp)_[A-Za-z0-9_]{8,}/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/**
 * IPv6, in the two shapes that actually occur: the full eight groups, or any
 * `::`-compressed form with at least one hex group attached.
 *
 * Requiring either eight groups or a literal `::` is what keeps `12:30:45` — a
 * clock time, three colon-separated runs of valid hex — out of the match. A
 * looser "two or more colon-separated hex groups" pattern silently rewrites
 * every timestamp in every log line it touches.
 */
const IPV6_RE =
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?|(?<![0-9a-f:])::[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*/gi;

/**
 * Best-effort PII sweep over a free-text string (exception messages, culprits,
 * transaction names, breadcrumb messages).
 *
 * UUIDs are **pseudonymized rather than dropped**. Every UUID the API handles
 * is a user, chapter, or row id drawn from the same salt namespace, so hashing
 * one in a message yields byte-identical output to the `user`/`chapter` tags on
 * the same event. An operator can therefore still answer "is this the tenant
 * from the other error?" from the message alone — which is most of why the
 * message is worth keeping — while the raw id never leaves the process.
 *
 * Order matters: JWTs and key-shaped strings are consumed before the generic
 * sweeps so a token containing a dotted-quad-looking run is not partially
 * rewritten into something unrecognizable.
 */
export function redactFreeText(input: string): string {
  return input
    .replace(URL_QUERY_RE, (_match, uptoQuestionMark: string) =>
      uptoQuestionMark.slice(0, -1),
    )
    .replace(BEARER_RE, '[redacted:token]')
    .replace(JWT_RE, '[redacted:token]')
    .replace(KEYLIKE_RE, '[redacted:key]')
    .replace(EMAIL_RE, '[redacted:email]')
    .replace(UUID_RE, (uuid) => {
      const hashed = pseudonymizeUserId(uuid.toLowerCase());
      return hashed ? `[id:${hashed}]` : '[redacted:id]';
    })
    .replace(IPV4_RE, (ip) => {
      const hashed = pseudonymizeIp(ip);
      return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
    })
    .replace(IPV6_RE, (ip) => {
      const hashed = pseudonymizeIp(ip);
      return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
    });
}

function redactMaybe(value: unknown): string | undefined {
  return typeof value === 'string' ? redactFreeText(value) : undefined;
}

/** Path without query or fragment — query strings routinely carry tokens. */
function pathOnly(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  const cut = url.search(/[?#]/);
  const trimmed = cut === -1 ? url : url.slice(0, cut);
  return redactFreeText(trimmed);
}

// ── Structural scrubbing ─────────────────────────────────────────────────────

function scrubException(
  exception: ErrorEvent['exception'],
): ErrorEvent['exception'] {
  if (!exception?.values) return exception;
  return {
    ...exception,
    values: exception.values.map((value) => ({
      ...value,
      value: redactMaybe(value.value) ?? value.value,
      // Stack frames keep file/line/function (code identity, not user data) but
      // `vars` is a snapshot of local variables — arbitrary request payload.
      stacktrace: value.stacktrace && {
        ...value.stacktrace,
        frames: value.stacktrace.frames?.map(({ vars: _vars, ...frame }) => ({
          ...frame,
          filename: redactMaybe(frame.filename) ?? frame.filename,
        })),
      },
    })),
  };
}

function scrubRequest(
  request: ErrorEvent['request'],
): ErrorEvent['request'] | undefined {
  if (!request) return undefined;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (HEADER_ALLOWLIST.has(key.toLowerCase()) && typeof value === 'string') {
      headers[key.toLowerCase()] = redactFreeText(value);
    }
  }

  // Rebuilt, not spread: `data` (body), `cookies`, `env` (which carries
  // REMOTE_ADDR), and `query_string` are all dropped by omission.
  return {
    ...(request.method ? { method: request.method } : {}),
    ...(pathOnly(request.url) ? { url: pathOnly(request.url) } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function scrubBreadcrumbs(
  breadcrumbs: ErrorEvent['breadcrumbs'],
): ErrorEvent['breadcrumbs'] {
  if (!breadcrumbs) return undefined;
  return breadcrumbs.map(({ data: _data, ...crumb }) => ({
    ...crumb,
    // `data` is dropped wholesale: on http breadcrumbs it holds the full URL
    // with query string and the response body size, and on custom ones it is
    // whatever the caller passed.
    message: redactMaybe(crumb.message) ?? crumb.message,
  }));
}

function scrubTags(tags: ErrorEvent['tags']): ErrorEvent['tags'] {
  if (!tags) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) continue;
    out[key] = redactFreeText(String(value));
  }
  return out;
}

function scrubContexts(
  contexts: ErrorEvent['contexts'],
): ErrorEvent['contexts'] {
  if (!contexts) return undefined;
  const out: NonNullable<ErrorEvent['contexts']> = {};
  for (const [key, value] of Object.entries(contexts)) {
    if (CONTEXT_ALLOWLIST.has(key) && value) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * `beforeSend`: the last thing that runs before an event leaves the process.
 *
 * Returns the scrubbed event, or `null` to drop it entirely. Nothing here may
 * throw — a scrubber that throws inside `beforeSend` is indistinguishable from
 * one that passes the event through unscrubbed in some SDK versions, so the
 * whole body is wrapped and a failure **drops the event**. Losing an error
 * report is strictly better than leaking a payload we failed to inspect.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (EVENT_KEY_ALLOWLIST.has(key)) {
        scrubbed[key] = value;
      }
    }

    if (event.exception) scrubbed.exception = scrubException(event.exception);
    if (event.message) scrubbed.message = redactFreeText(event.message);
    if (event.transaction) scrubbed.transaction = pathOnly(event.transaction);
    if (event.tags) scrubbed.tags = scrubTags(event.tags);
    if (event.contexts) scrubbed.contexts = scrubContexts(event.contexts);

    const request = scrubRequest(event.request);
    if (request && Object.keys(request).length > 0) scrubbed.request = request;

    const breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
    if (breadcrumbs?.length) scrubbed.breadcrumbs = breadcrumbs;

    // `user` is rebuilt from the id alone, and only when that id is already a
    // pseudonym (64 lowercase hex). Anything else — a raw uuid a stray
    // `setUser` call put there, an email, an ip — is dropped rather than
    // trusted. `username`/`email`/`ip_address` are never carried over.
    const userId = event.user?.id;
    if (typeof userId === 'string' && /^[0-9a-f]{64}$/.test(userId)) {
      scrubbed.user = { id: userId };
    }

    // Through `unknown`: the allowlist loop builds a plain record, so there is
    // no structural overlap for TypeScript to check against. The keys that
    // survive are exactly `EVENT_KEY_ALLOWLIST`, which is a subset of
    // `ErrorEvent`'s own, plus the rebuilt fields assigned below it.
    return scrubbed as unknown as ErrorEvent;
  } catch {
    return null;
  }
}
