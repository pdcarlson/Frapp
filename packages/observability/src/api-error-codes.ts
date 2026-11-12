/**
 * The API's machine error codes (`code` in the error body, contract in
 * `spec/architecture/README.md` § Error responses), split by what a client
 * reporting one has learned (#4096). The query-error reporter
 * (`query-errors.ts`) reads this list, so it is the one place web and mobile
 * agree on which failed request is a bug.
 *
 * **Client-contract** codes are ones a correct client, in a chapter whose
 * data is consistent, never sees. One reaching a client means the client sent
 * a request the API's contract rules out (no chapter context, a body its DTO
 * refuses), or the chapter's own rows are broken. Either way it is a bug, so
 * the reporter sends it at `error` level, which the production alert rule and
 * Beta Watch both act on.
 *
 * **Member-caused** codes are the API refusing something a member did or a
 * state the chapter is in: a module turned off, a lapsed subscription, a
 * chapter they left, a form missing its receipt, a cursor whose message was
 * deleted. A correct client meets these in normal use, so they stay at the
 * level their status class gets.
 *
 * A code in neither list is treated as member-caused. The API's
 * `api-error-codes.spec.ts` fails when a code the API throws is missing from
 * both, so a new code is classified on purpose, never by default. Codes on a
 * 5xx (`DEGRADED`) are not listed: a 5xx is reported as a server fault
 * whatever its code.
 */
export const CLIENT_CONTRACT_ERROR_CODES = [
  // The chapter guard: no `active_chapter_id` claim, no `x-chapter-id`
  // header, and more than one chapter to choose from. A client that has a
  // chapter selected always sends it (#4094).
  "chapter.context.required",
  // The global `ValidationPipe`: a body, query or path DTO the API refuses.
  // The shared Zod schemas validate a form before it is sent, so one of
  // these is a client sending what its own validation should have stopped,
  // or contract drift between a shipped build and the API.
  "request.validation_failed",
  // An invite with no role named, no default invite role configured, and no
  // seeded Member role: the chapter's rows are missing what every chapter is
  // created with.
  "invite.role_unresolved",
  // A config PATCH switching off an always-on module. Chapter settings draws
  // those locked and never sends it (#4073).
  "chapter.config.module_always_on",
  // Changes for one kind of suggestion sent to accept another kind. The
  // review screen sends a suggestion's edits under its own kind (#4309).
  "ai.suggestion.edits_kind",
] as const;

export const MEMBER_CAUSED_ERROR_CODES = [
  "chapter.context.invalid",
  // Header and JWT name different chapters: a chapter switched in another
  // tab while this one still sent the old header.
  "chapter.context.mismatch",
  "chapter.module.disabled",
  "chapter.subscription.required",
  "chapter.subscription.canceled",
  "chapter.subscription.write_locked",
  "chapter.subscription.invite_blocked",
  // The officer picked a role another officer deleted meanwhile.
  "chapter.config.invalid_default_invite_role",
  "chat.since_not_found",
  // An AI route while `AI_ENABLED` is off on the server (#4310, and
  // `AiEnabledGuard`, ADR-28). A state the deployment is in, and how a
  // client learns to hide its AI entry points.
  "ai.not_available",
  "legal.acceptance_required",
  "service_entry.receipt_required",
  // AI suggestions (#4309): one another officer decided first, one that
  // expired or whose source went away, a caller whose permission or access
  // changed since the list loaded, and a task accepted before its owner or
  // day was picked.
  "ai.suggestion.not_found",
  "ai.suggestion.forbidden",
  "ai.suggestion.expired",
  "ai.suggestion.decided",
  "ai.suggestion.accepting",
  "ai.suggestion.incomplete",
] as const;

export type ClientContractErrorCode =
  (typeof CLIENT_CONTRACT_ERROR_CODES)[number];

const CLIENT_CONTRACT: ReadonlySet<string> = new Set(
  CLIENT_CONTRACT_ERROR_CODES,
);

/** Whether `code` is one a correct client never sees: a bug when it does. */
export function isClientContractErrorCode(
  code: string | null | undefined,
): code is ClientContractErrorCode {
  return typeof code === "string" && CLIENT_CONTRACT.has(code);
}
