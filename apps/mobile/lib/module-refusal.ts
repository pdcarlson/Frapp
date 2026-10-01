/**
 * The module gate's refusal, recognised so a member never sees it verbatim.
 *
 * `ChapterGuard.enforceModule` refuses a write to a module an officer has
 * switched off, with a message addressed to that officer: "Re-enable it in
 * Settings → Modules to make changes." A member can't do that, so a member
 * surface that relays the server's 403 message has to catch this one first
 * and say it in the member's terms (`writing.md` § Module off (mobile,
 * cross-surface), which holds each surface's row and the two rules they obey).
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
 * Study's rows live with its other copy, as `MODULE_OFF_COPY` in
 * `lib/study/errors.ts`.
 *
 * Each names the module as Settings → Modules labels it (`MODULE_CATALOG` in
 * `@repo/org-archetypes`), because that is the switch the officer turns back
 * on: `hours` is "Service hours", and check-in belongs to "Events".
 */
export const MODULE_REFUSAL_COPY = {
  checkIn:
    "Check-in is turned off for your chapter right now. An officer can turn events back on.",
  /** `POST /v1/tasks` (s19), under the controller's `@RequireModule('tasks')`. */
  task: "Tasks are turned off for your chapter right now, so new tasks can't be saved. An officer can turn tasks back on.",
  /** `PATCH /v1/tasks/:id/status`, the s08 board's checkbox (#2710). */
  taskStatus:
    "Tasks are turned off for your chapter right now, so task updates can't be saved. An officer can turn tasks back on.",
  /** `POST /v1/service-entries` (s20), under `@RequireModule('hours')`. */
  serviceHours:
    "Service hours are turned off for your chapter right now, so new hours can't be logged. An officer can turn service hours back on.",
} as const;
