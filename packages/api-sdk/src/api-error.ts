/**
 * Reading a rejected SDK call, in one place.
 *
 * `openapi-fetch` throws the parsed error body, and Nest puts the status on
 * `statusCode` while some paths carry `status` — so every consumer that wants
 * to branch on a status has to check both. This lived in
 * `apps/mobile/lib/api-error.ts` (study errors, dues pay errors, and check-in)
 * before being promoted here so web can share it without a second copy.
 *
 * `codeOf` matters more than it looks: the API's structured error codes are the
 * only reliable way to tell two failures with the same status apart — a module
 * gate and a permission denial are both 403, and they need opposite copy.
 *
 * Hand-written. OpenAPI codegen overwrites only `src/types.ts`; this module
 * is re-exported from `src/index.ts` (the package `exports` map has no
 * subpath for it).
 */
type ApiErrorShape = {
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
  code?: unknown;
};

/** The HTTP status, wherever the SDK put it. */
export function statusOf(error: unknown): number | undefined {
  const candidate = (error ?? {}) as ApiErrorShape;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  if (typeof candidate.status === "number") return candidate.status;
  return undefined;
}

/**
 * The server's own message, or `null`.
 *
 * An empty string and an empty array both read as absent, so a caller's
 * fallback wins rather than rendering a blank line where an explanation should
 * be. `apps/web`'s `getErrorMessage` also skips empty strings, but it does not
 * join `message` arrays (Nest validation-pipe bodies) — those fall through to
 * the toast fallback. That difference is tracked separately rather than
 * changed from here.
 */
export function serverMessageOf(error: unknown): string | null {
  const candidate = (error ?? {}) as ApiErrorShape;
  if (typeof candidate.message === "string" && candidate.message.length > 0) {
    return candidate.message;
  }
  if (Array.isArray(candidate.message) && candidate.message.length > 0) {
    return candidate.message.join(", ");
  }
  return null;
}

/** The API's structured error code (e.g. `chapter.module.disabled`), or `null`. */
export function codeOf(error: unknown): string | null {
  const candidate = (error ?? {}) as ApiErrorShape;
  return typeof candidate.code === "string" && candidate.code.length > 0
    ? candidate.code
    : null;
}
