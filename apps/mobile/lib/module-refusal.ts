/**
 * The module gate's refusal, recognised so a member never sees it verbatim.
 *
 * `ChapterGuard.enforceModule` refuses a write to a module an officer has
 * switched off, with a message addressed to that officer: "Re-enable it in
 * Settings → Modules to make changes." A member can't do that, so a member
 * surface that relays the server's 403 message has to catch this one first
 * and say it in the member's terms (`writing.md` § Study session (mobile,
 * s10), "Module off").
 *
 * The same two-condition shape as `subscriptionRefusalOf`, for the same
 * reasons:
 *
 * - **403.** Narrows the field, but is not the discriminator: these routes
 *   also 403 for permission denials and the `chapter.context.*` family, which
 *   keep their own copy and their retry.
 * - **The exact message.** Until #1020 `AllExceptionsFilter` dropped the
 *   guard's `code: 'chapter.module.disabled'`, so study's branch keyed on it
 *   never fired (#2393). The code arrives now, but only the message names the
 *   module; checking the code first is #2995. The guard builds its message
 *   with `moduleDisabledMessage` from `@repo/validation`, and the matcher lives
 *   beside it, so the two can't drift.
 */

import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { moduleRefusalFromServerMessage } from "@repo/validation";

/** The module this write was refused for, or `null` for any other failure. */
export function moduleRefusalOf(error: unknown): { moduleKey: string } | null {
  if (statusOf(error) !== 403) return null;
  return moduleRefusalFromServerMessage(serverMessageOf(error));
}

/**
 * Per-surface member copy (`writing.md` § Module off (mobile, cross-surface)).
 * Study's two rows live with its other copy, as `MODULE_OFF_COPY` in
 * `lib/study/errors.ts`.
 */
export const MODULE_REFUSAL_COPY = {
  checkIn:
    "Check-in is turned off for your chapter right now. An officer can turn events back on.",
  pollVote:
    "Voting is turned off for your chapter right now. An officer can turn polls back on.",
} as const;
