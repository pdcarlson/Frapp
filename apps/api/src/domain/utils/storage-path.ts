import { BadRequestException } from '@nestjs/common';

/**
 * True when `path` contains a segment that can escape its prefix or bucket.
 *
 * Why this is not just `split('/').includes('..')`:
 *
 * `@supabase/storage-js` interpolates the object path into the request URL
 * without percent-encoding it, and the WHATWG URL parser then performs
 * dot-segment removal — during which it treats `%2e` as `.`, case-insensitively.
 * So `chapters/<mine>/branding/%2e%2e/%2e%2e/x` collapses to a path in a
 * *different bucket*, which the API then fetches with its service-role key
 * (bypassing RLS entirely). Verified against a live stack: the literal `..`
 * form was rejected by a raw-segment check while `%2e%2e`, `%2E%2E`, and `.%2e`
 * all still read another chapter's object.
 *
 * So both the raw and the percent-decoded forms are checked. Decoding may throw
 * on a malformed sequence — a filename legitimately containing a bare `%`, which
 * server-built keys can carry via `path.basename(filename)` — and that is safe
 * to ignore: a path that cannot be decoded cannot spell `%2e` either, so the raw
 * check stands on its own. Backslash is treated as a separator too, since
 * special-scheme URLs do the same.
 */
export function isUnsafeStoragePath(path: string): boolean {
  if (path.length === 0) return true;

  const forms = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) forms.push(decoded);
  } catch {
    // Malformed percent-encoding; the raw form is the only meaningful one.
  }

  return forms.some((form) =>
    form
      .split(/[/\\]/)
      .some((segment) => segment === '' || segment === '.' || segment === '..'),
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
