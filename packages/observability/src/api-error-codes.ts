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
 * deleted. A correct client meets these in normal use, so the reporter
 * leaves a 4xx carrying one out of Sentry altogether: the screen words it,
 * and there is nothing to fix. The exception is a code that also says the
 * server's setup is wrong (`STILL_REPORTED` below), which stays at `warning`. Usage questions about them belong in
 * analytics, not error tracking.
 *
 * A code in neither list is reported at `warning`, the level its status
 * class gets. The API's
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
  // A reason sent with a thumbs up on an Ask answer (#4902), which the
  // shared schema (`AskFeedbackRequestSchema`) refuses before it is sent.
  "ai.ask.feedback.reason_needs_down",
  // An invite with no role named, no default invite role configured, and no
  // seeded Everyone role (once Member): the chapter's rows are missing what every chapter is
  // created with.
  "invite.role_unresolved",
  // A config PATCH switching off an always-on module. Chapter settings draws
  // those locked and never sends it (#4073).
  "chapter.config.module_always_on",
  // Renaming the Everyone role or moving it out of its tier (#4191). Its role
  // page draws both locked and never sends a change.
  "role.everyone_fixed",
  // Changes for one kind of suggestion sent to accept another kind. The
  // review screen sends a suggestion's edits under its own kind (#4309).
  "ai.suggestion.edits_kind",
  // Catch me up asked for on a DM or an audit log (#3946). No client offers
  // it there.
  "ai.catch_up.not_a_channel",
  // Minutes typed Standards (#4312). No minutes screen offers the type, so
  // only a client that skipped its own type list sends it.
  "meeting.standards_refused",
  // A recording upload without the officer's "the room was told" (#712).
  // The upload step can't be submitted without it.
  "meeting.recording_notice_required",
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
  // An officer named a role so it reads as @everyone (#4191) or @here.
  "role.everyone_name",
  // A tier reorder that would lift New members or Alumni above Everyone
  // (#4548). The Roles page lets an officer drag tiers freely.
  "role_tier.below_everyone",
  // The New Member or Alumni role moved into a tier above Everyone's
  // (#4548). A role page's tier picker offers every tier below the officer.
  "role.below_everyone",
  "chat.since_not_found",
  // An AI route while `AI_ENABLED` is off on the server (#4310, and
  // `AiEnabledGuard`, ADR-28). A state the deployment is in, and how a
  // client learns to hide its AI entry points.
  "ai.not_available",
  // AI consent (#4308). The chapter has not turned the feature on, or the
  // member has not said yes on the AI sheet: states a member is in, which
  // the client answers with the sheet or by hiding the entry point.
  "ai.chapter_off",
  "ai.consent.required",
  // The AI sheet changed between being shown and being answered.
  "ai.consent.stale_sheet",
  // A member who is not the president tried an AI switch, as when the
  // presidency changed hands in another tab.
  "ai.settings.president_only",
  "legal.acceptance_required",
  "service_entry.receipt_required",
  // A task marked done without the proof its kind asks for (#4565, #4635).
  "task.proof_required",
  // A sent-back task marked done again with nothing new (#4635).
  "task.resubmit_needs_change",
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
  // The acting agent (#718): a member without `ai:act`, a points proposal
  // for more members than the chapter's hourly limit leaves, and one whose
  // members have all left the chapter.
  "ai.act.forbidden",
  "ai.suggestion.points.over_limit",
  "ai.suggestion.points.no_members",
  // A points proposal whose Confirm landed for some members and failed for
  // the rest. It is a 503, so its status reports it as a server fault
  // whatever this list says; it is here because every dotted code is listed.
  "ai.suggestion.points.partial",
  // Two officers started minutes for one event at once, or one saved over
  // the other's newer version (#4312).
  "meeting.already_started",
  "meeting.stale",
  // Ask's beta diagnostics window (#4315): it is already on, this chapter
  // is not the one it is offered to, or the caller is not the president.
  "ai.ask.diagnostics.already_on",
  "ai.ask.diagnostics.not_offered",
  "ai.ask.diagnostics.president_only",
  // A draft from notes asked for on minutes that were posted meanwhile.
  "meeting.draft_posted",
  // "Use the draft" on a draft that is no longer waiting.
  "meeting.draft_not_waiting",
  // A recording Frapp doesn't take (#712): the wrong kind of file, too
  // large, too short or too long. The upload step checks first, but the
  // server's limits follow the provider it is set up with.
  "meeting.recording_format",
  "meeting.recording_too_large",
  "meeting.recording_too_short",
  "meeting.recording_too_long",
  // No transcription provider is set up on this server.
  "meeting.recording_unavailable",
  // The upload was replaced or removed from another tab, or its file never
  // reached storage.
  "meeting.recording_replaced",
  "meeting.recording_incomplete",
  // Report this (#4315): the draft or suggestion is gone or out of the
  // member's sight since the button was drawn, the answer is past its 7 days,
  // or its receipt no longer opens (a rotated key, another member's answer).
  "ai.report.not_found",
  "ai.report.too_old",
  "ai.report.receipt_invalid",
  // A thumbs or a tap on an Ask answer (#4902) whose trace is gone: past its
  // 90 days, or the member answered No on the AI sheet since it was drawn.
  "ai.ask.feedback.not_found",
  // Start pressed away from the study zone, or on a zone an officer turned
  // off. The study screen says which.
  "study.outside_zone",
  "study.zone_inactive",
  // A check-in before the doors open or after they close, and a second scan
  // of one already counted.
  "attendance.check_in.window_closed",
  "attendance.already_checked_in",
] as const;

export type ClientContractErrorCode =
  (typeof CLIENT_CONTRACT_ERROR_CODES)[number];

const CLIENT_CONTRACT: ReadonlySet<string> = new Set(
  CLIENT_CONTRACT_ERROR_CODES,
);

type MemberCausedErrorCode = (typeof MEMBER_CAUSED_ERROR_CODES)[number];

const MEMBER_CAUSED: ReadonlySet<string> = new Set(MEMBER_CAUSED_ERROR_CODES);

/**
 * Member-caused codes that still say something is wrong with the server's
 * setup, so the reporter keeps them (at `warning`) even though a member is
 * the one who meets them.
 */
const STILL_REPORTED: ReadonlySet<string> = new Set([
  // No transcription provider set up: on production, a missing credential.
  "meeting.recording_unavailable",
]);

/**
 * Whether the reporter leaves a 4xx with this code out of Sentry: a refusal a
 * member meets in normal use, which the screen words and nobody needs to fix.
 */
export function isUnreportedRefusalCode(
  code: string | null | undefined,
): boolean {
  return isMemberCausedErrorCode(code) && !STILL_REPORTED.has(code);
}

/** Whether `code` is a refusal a member meets in normal use. */
function isMemberCausedErrorCode(
  code: string | null | undefined,
): code is MemberCausedErrorCode {
  return typeof code === "string" && MEMBER_CAUSED.has(code);
}

/** Whether `code` is one a correct client never sees: a bug when it does. */
export function isClientContractErrorCode(
  code: string | null | undefined,
): code is ClientContractErrorCode {
  return typeof code === "string" && CLIENT_CONTRACT.has(code);
}
