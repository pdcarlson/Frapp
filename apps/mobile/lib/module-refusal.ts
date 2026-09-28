/**
 * The module gate's refusal, recognised so a member never sees it verbatim.
 *
 * `ChapterGuard.enforceModule` refuses a write to a module an officer has
 * switched off, with a message addressed to that officer: "Re-enable it in
 * Settings → Modules to make changes." A member can't do that, so a member
 * surface that relays the server's 403 message has to catch this one first
 * and say it in the member's terms (`writing.md` § Study, "Module off").
 *
 * The same two-condition shape as `subscriptionRefusalOf`, for the same
 * reasons:
 *
 * - **403.** Narrows the field, but is not the discriminator: these routes
 *   also 403 for permission denials and the `chapter.context.*` family, which
 *   keep their own copy and their retry.
 * - **The exact message.** `AllExceptionsFilter` drops the guard's
 *   `code: 'chapter.module.disabled'` (#1020), so `codeOf` is `null` on every
 *   real response. Study keyed on it until #2393, and the branch never fired.
 *   The guard builds its message with `moduleDisabledMessage` from
 *   `@repo/validation`, and the matcher lives beside it, so the two can't
 *   drift.
 */

import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { moduleRefusalFromServerMessage } from "@repo/validation";

/** The module this write was refused for, or `null` for any other failure. */
export function moduleRefusalOf(error: unknown): { moduleKey: string } | null {
  if (statusOf(error) !== 403) return null;
  return moduleRefusalFromServerMessage(serverMessageOf(error));
}
