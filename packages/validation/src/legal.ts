// ── Legal / compliance ───────────────────────────────────────────────────────
// The policy version itself is the API's (`apps/api/src/domain/constants/
// legal.ts`, #3268): clients never compare against it.

/**
 * The checkbox every acceptance surface shows: the create-chapter wizard, the
 * join screens and the Terms prompt, on web and mobile. The owner approved this
 * wording with the Terms of 2026-09 (#2261), so change it only with them, and
 * with the Terms.
 */
export const LEGAL_ACCEPTANCE_LABEL =
  "I'm 18 or older and agree to the Terms of Service and Privacy Policy.";

/**
 * The 403 the API answers with when a caller who hasn't accepted the current
 * Terms tries to join or create a chapter without the checkbox (#2302). It
 * throws both; `isTermsRequiredError` in `@repo/hooks` recognises either.
 *
 * The message matters as much as the code. Clients read the code first, but
 * an API older than #1020 sent none, so the message is the fallback, and it
 * is shared from here so the server and both apps can't drift apart on it.
 */
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = "legal.acceptance_required";
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  "Agree to the Terms of Service and Privacy Policy to continue.";

/**
 * The code on every 400 the API's global `ValidationPipe` answers with: a
 * body, query or path DTO it refuses (#4096). The `message` stays the pipe's
 * array of field failures. Clients don't word it (`copyForErrorCode`), since
 * a member's form is validated before it is sent; `@repo/observability`
 * classes it as client-contract, so a client that sends one reports a bug.
 */
export const REQUEST_VALIDATION_FAILED_CODE = "request.validation_failed";

/**
 * The 404 code on `GET /v1/channels/{id}/messages` when its `since` cursor
 * names no message in the channel (#2807). Chat clients read it
 * (`readMessageRows` in `@repo/chat-core/history`) to tell a cursor they should
 * drop from a channel they can't read, which answers 404 too.
 */
export const CHAT_SINCE_NOT_FOUND_CODE = "chat.since_not_found";

/**
 * The API's 410 message for a request from an account that has been deleted
 * but whose session hasn't ended yet. Shared so a client can tell it apart
 * from the other 410s it can meet on the same route (an expired invite).
 */
export const ACCOUNT_DELETED_MESSAGE = "Account has been deleted";

/**
 * The join screens' copy when the box isn't ticked, or when the server refused
 * a join for want of it (#2302). Web `/join` and mobile s02 both render it;
 * `spec/ui/design-system/writing.md` § 7, Join chapter, is its spec.
 */
export const JOIN_TERMS_REQUIRED_COPY =
  "Agree to the Terms of Service and Privacy Policy to join.";

/**
 * The Terms prompt's copy (#2302), rendered by mobile `(auth)/terms.tsx` and
 * web's `TermsPrompt`. `spec/ui/design-system/writing.md` § 7, Terms prompt,
 * is its spec.
 */
export const TERMS_PROMPT_COPY = {
  title: "Agree to the Terms to continue",
  body: "We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.",
  cta: "Agree and continue",
  unticked: "Agree to the Terms of Service and Privacy Policy to continue.",
  deleted: "This account has been deleted. Sign out to continue.",
  failed: "Couldn't save your agreement. Check your connection and try again.",
} as const;
