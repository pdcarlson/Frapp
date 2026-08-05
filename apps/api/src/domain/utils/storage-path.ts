import { BadRequestException } from '@nestjs/common';

/** The parser treats `%2e` as `.` when deciding what is a dot segment. */
const PERCENT_DOT = /%2e/gi;

/**
 * Percent-encoded path separators, normalized before splitting.
 *
 * Today's stack does not decode these — undici leaves them literal and the
 * storage server rejects the key — so `..%2f..%2fx` is inert *in production*.
 * It is normalized anyway because the guard must not depend on that: a proxy,
 * CDN, or gateway that decodes `%2f` before path resolution is a common
 * misconfiguration, and without this the only thing catching an encoded
 * separator is the decoded form, which a malformed `%` disables (bypass #4's
 * exact shape). Detection should never rest on `decodeURIComponent` succeeding.
 */
const PERCENT_SEPARATOR = /%2f|%5c/gi;

/**
 * Any C0 control or DEL. No legitimate object key contains one.
 *
 * This is load-bearing, not hygiene: the WHATWG URL parser *deletes* tab, LF
 * and CR from a URL before removing dot segments, so `.\t.` arrives at storage
 * as `..` while looking like neither `.` nor `..` to a segment comparison.
 * Seven such spellings read another bucket's object against a live stack
 * before this check existed. Rejecting the characters outright is what closes
 * that — do not relax it without adding a strip-then-recheck pass in its place.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

/**
 * Is this segment one the URL parser will remove or climb on?
 *
 * Spelled the way the parser decides it: `%2e` counts as a dot, case
 * insensitively, so `%2e%2e`, `.%2e` and `%2e.` are all `..`. Deliberately does
 * NOT rely on `decodeURIComponent` — see the note in `isUnsafeStoragePath`.
 */
function isDotSegment(segment: string): boolean {
  const normalized = segment.replace(PERCENT_DOT, '.');
  return normalized === '' || normalized === '.' || normalized === '..';
}

/**
 * True when `path` contains a segment that can escape its prefix or bucket.
 *
 * Why this is not just `split('/').includes('..')`:
 *
 * `@supabase/storage-js` interpolates the object path into the request URL
 * without percent-encoding it and hands it straight to `fetch`, whose URL parser
 * then performs dot-segment removal. Four distinct spellings have escaped in
 * testing against a live stack, each reading another bucket's object under the
 * service-role key (which bypasses RLS): literal `../..`; `%2e%2e` and friends,
 * because the parser treats `%2e` as a dot; `.\t.`, because it *deletes* tab, LF
 * and CR first; and `p%/%2e%2e/…`, which is the subtle one — a malformed percent
 * anywhere in the string made `decodeURIComponent` throw, silently disabling the
 * decoded-form check that was the only thing detecting `%2e%2e`.
 *
 * So the dot test is applied to the raw segments directly, spelled the way the
 * parser spells it, and never depends on decoding succeeding. The decoded form
 * is still checked as an extra pass, and backslash counts as a separator because
 * special-scheme URLs treat it as one.
 */
export function isUnsafeStoragePath(path: string): boolean {
  if (path.length === 0) return true;

  const forms = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) forms.push(decoded);
  } catch {
    // Malformed percent-encoding, e.g. a filename containing a bare `%`. This
    // is intentionally NOT treated as unsafe (it would reject legitimate
    // uploads) and, critically, nothing below depends on the decoded form
    // existing — relying on it was bypass #4.
  }

  // Control characters are rejected outright: this is what closes the
  // tab/newline escape, and it costs nothing legitimate, since server-built
  // keys are uuid/slug structured and path.basename of a real filename has none.
  if (forms.some((form) => CONTROL_CHAR.test(form))) return true;

  return forms.some((form) =>
    form.replace(PERCENT_SEPARATOR, '/').split(/[/\\]/).some(isDotSegment),
  );
}

/** Throw `BadRequestException` when `path` could escape its prefix or bucket. */
export function assertSafeStoragePath(
  path: string,
  message = 'Invalid storage path',
): void {
  if (isUnsafeStoragePath(path)) {
    throw new BadRequestException(message);
  }
}
