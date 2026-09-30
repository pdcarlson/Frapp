/**
 * Reading a rejected SDK call, in one place.
 *
 * `openapi-fetch` throws the parsed error body, and Nest puts the status on
 * `statusCode` while some paths carry `status` — so every consumer that wants
 * to branch on a status has to check both. This lived in
 * `apps/mobile/lib/api-error.ts` (study errors, dues pay errors, and check-in)
 * before being promoted here so web can share it without a second copy.
 *
 * Every error the API sends is an {@link ApiErrorBody}: `statusCode`,
 * `error`, `message` and `requestId`, plus `code` when the refusal has one
 * (#1020; contract in `spec/architecture/README.md` § 10). `codeOf` reads that
 * code, and a client should branch on it rather than on the message. Some
 * surfaces still match the server's exact message with a shared matcher from
 * `@repo/validation` (`subscriptionRefusalFromServerMessage`,
 * `moduleRefusalFromServerMessage`); moving them to the code first is #2995.
 * An API older than #1020 sends no code, so a message match stays the
 * fallback.
 *
 * Hand-written. OpenAPI codegen overwrites only `src/types.ts`; this module
 * is re-exported from `src/index.ts` (the package `exports` map has no
 * subpath for it).
 */
import type { components } from "./types";

/** The body of every error response, as `openapi.json` documents it. */
export type ApiErrorBody = components["schemas"]["ApiErrorResponseDto"];

/**
 * What the readers accept: any value, read defensively. Keyed on
 * {@link ApiErrorBody} so a renamed field fails to compile here. `status` is
 * not in the schema; some paths put the status there instead.
 */
type ApiErrorShape = { [K in keyof ApiErrorBody]?: unknown } & {
  status?: unknown;
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

/**
 * The API's structured error code (e.g. `chapter.module.disabled`), or `null`
 * when the refusal has none (see the header).
 */
export function codeOf(error: unknown): string | null {
  const candidate = (error ?? {}) as ApiErrorShape;
  return typeof candidate.code === "string" && candidate.code.length > 0
    ? candidate.code
    : null;
}
