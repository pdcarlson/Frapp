import { codeOf, statusOf } from "@repo/api-sdk";

/**
 * What chat says when the server refuses a signed-in member their chapter's
 * channel list because of their roles: one place, so mobile Chat home and the
 * web chat shell can't explain it two ways (`spec/ui/design-system/writing.md`
 * § Chat).
 *
 * On 2026-11-07 two testers who joined on a "Cabinet" invite (a role brought
 * over from Discord with only a channel permission) were refused every screen,
 * and chat told them it couldn't reach the server. The server now adds Member
 * beside such a role (`spec/behavior/onboarding.md`), so this copy is for the
 * cases still left, such as an officer removing a member's last role that
 * carries member access.
 */

/**
 * A 403 from the permissions check, which carries no machine code. A 403 with
 * a `chapter.*` code is the chapter guard instead: not a member of that
 * chapter, or a token that hasn't caught up with a chapter switch yet
 * (`chapter.context.mismatch`, which clears on its own). No role fixes those,
 * so they keep the generic copy.
 */
export function isRoleRefusal(error: unknown): boolean {
  if (statusOf(error) !== 403) return false;
  const code = codeOf(error);
  return !code?.startsWith("chapter.");
}

export const CHANNELS_ROLE_REFUSAL_TITLE = "Chat isn't open to you yet";

export function channelsRoleRefusalBody(chapterName: string | null): string {
  return `Your role in ${chapterName || "this chapter"} doesn't include chat. Ask an officer to give you the Member role.`;
}
