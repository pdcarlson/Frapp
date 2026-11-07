import { codeOf, serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  OFFLINE_COPY,
  refusalCopy,
  STATUS_ERROR_COPY,
  TRY_AGAIN,
} from "@repo/validation";
import { SignedUploadError } from "./put-signed-upload";

/**
 * The one map from a failed call to what a member reads, shared by web and
 * mobile (principles.md P2.3, writing.md §3).
 *
 * A failure is told in the chapter's words, never the system's: no HTTP
 * status, no class-validator sentence (`name must be shorter than…`), no
 * `Forbidden`, no `Failed to fetch`. The caller says **what** failed (a toast
 * title, `Couldn't save the event`) and passes its own reason as the
 * fallback; this function supplies the **why and what next** when the failure
 * itself says more than the fallback can.
 *
 * In order:
 *
 * 1. An error the client wrote for members ({@link MemberFacingError}, and a
 *    refused upload's {@link SignedUploadError}, whose message each surface
 *    writes) shows its own message; a refused upload that was too large says
 *    so.
 * 2. A refusal the API names with a code, or with one of the guard sentences
 *    the shared matchers already read (module off, subscription lapsed).
 * 3. A server sentence in `SERVER_MESSAGE_COPY` (`@repo/validation`): the refusals that carry
 *    a reason the member can act on, rewritten once here. Apart from a screen
 *    that opts into `serverWritesForMembers`, this is the only way a server
 *    message reaches the screen; anything else the server says is dropped,
 *    because it was written for a developer.
 * 4. The status: no connection, signed out, not allowed, gone, too large, too
 *    many tries.
 * 5. The caller's fallback, for the statuses whose meaning depends on the
 *    screen (a 400 or 409 the map doesn't know, a 5xx).
 */
export function errorCopy(
  error: unknown,
  fallback = TRY_AGAIN,
  options: ErrorCopyOptions = {},
): string {
  if (error instanceof MemberFacingError) return error.message;
  if (error instanceof SignedUploadError) {
    return error.status === 413 ? STATUS_ERROR_COPY[413]! : error.message;
  }

  const known = serverCopyOf(error);
  if (known) return known;

  const status = statusOf(error) ?? wrappedStatusOf(error);
  const message = serverMessageOf(error);
  if (status !== undefined && message) {
    if (
      options.serverWritesForMembers &&
      REFUSAL_STATUSES.has(status) &&
      isMemberSentence(message)
    ) {
      return message;
    }
  }

  if (status === undefined) {
    return isNetworkFailure(error) ? OFFLINE_COPY : fallback;
  }
  return STATUS_ERROR_COPY[status] ?? fallback;
}

/**
 * What the failure itself says, in the chapter's words, or `null`: a refusal
 * the API names by code or guard sentence, or a server sentence in
 * `SERVER_MESSAGE_COPY`. For a screen with its own copy per status (the
 * study timer's), which wants the specific reason when there is one and its
 * own words otherwise. Never the raw server text.
 */
export function serverCopyOf(error: unknown): string | null {
  const code = codeOf(error);
  const status = statusOf(error) ?? wrappedStatusOf(error);
  // A message on something with no status is a client `Error`'s, not the
  // server's, so only a code is read from it.
  const message = status === undefined ? null : serverMessageOf(error);
  return refusalCopy({ status, code, message });
}

/**
 * An error whose message was written for members, thrown by client code so
 * {@link errorCopy} shows it as is. A plain `Error`'s message is not shown,
 * because most of them were written for whoever reads the console
 * (`The API did not return an import id.`).
 */
export class MemberFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberFacingError";
  }
}

export interface ErrorCopyOptions {
  /**
   * The screen's routes write their refusals for the officer reading them
   * (the Discord import's "Name the new role for Rush Chair."), so a 400, 403,
   * 409 or 503 sentence the map doesn't know is shown when it reads as one: it
   * opens like a sentence and names no permission key or route. Underscores and
   * `--flags` stay, because Discord names (`#study_hall`) and the exporter's
   * flags (`--partition 8mb`) are what the officer acts on.
   * Off by default; a screen opts in only when it has read its routes' throws.
   */
  serverWritesForMembers?: boolean;
}

const REFUSAL_STATUSES = new Set([400, 403, 409, 503]);

/** A sentence with nothing of the system's in it (principles.md P2.1, P2.2). */
function isMemberSentence(message: string): boolean {
  if (!/^[A-Z0-9#"]/.test(message)) return false;
  if (/\b[a-z-]+:[a-z-]+\b/.test(message)) return false; // permission keys
  if (/\(\*\)|\b(endpoint|route|header|uuid|idempotency)\b/i.test(message)) {
    return false;
  }
  return true;
}

/**
 * The status `@repo/chat-core` hangs on the `Error` it wraps a refusal in
 * (`throwApiError`: `response.status`, or `context.status`), where
 * {@link statusOf} doesn't look.
 */
function wrappedStatusOf(error: unknown): number | undefined {
  const candidate = error as {
    response?: { status?: unknown };
    context?: { status?: unknown };
  } | null;
  const status = candidate?.response?.status ?? candidate?.context?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Whether a failure with no status is a dropped connection: `fetch`'s
 * `TypeError` (`Failed to fetch` in Chrome, `Load failed` in Safari,
 * `NetworkError…` in Firefox, `Network request failed` in React Native), or
 * an abort or timeout. Read by message, not by `TypeError` alone, because a
 * bug's `Cannot read properties of undefined` is a `TypeError` too.
 */
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return /failed to fetch|^load failed$|network ?(request|error)|timed? ?out/i.test(
    error.message,
  );
}

export { TRY_AGAIN };
