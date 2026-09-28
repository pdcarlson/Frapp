import { isBlockableSender } from "@repo/chat-core/blocks";

/**
 * The member sheet's Message action (#2773): start, or reopen, a 1:1 DM with
 * the member on screen. `POST /v1/channels/dm` is get-or-create, so a member
 * you already have a DM with gets that thread back, and opening it again is
 * also what brings back a DM you hid (`reopenHidden` on chat home relies on
 * the same route).
 */

export interface MessageTargetInput {
  /** The member the sheet shows, or `null` before their profile loads. */
  memberUserId: string | null;
  /** The viewer's `users.id`, or `null` until it resolves. */
  viewerUserId: string | null;
  /** Whether the viewer has this member on their block list. */
  isBlocked: boolean;
}

/**
 * Whether the sheet offers Message.
 *
 * - **Never while the viewer is unknown.** The API does not refuse a DM with
 *   yourself (two identical ids pass its "exactly 2 members" check and create
 *   a degenerate channel), so an unresolved viewer must not read as "someone
 *   else".
 * - **Never on your own profile or the system actor's.** The system actor has
 *   no inbox; `isBlockableSender` is the one list of senders that are not
 *   real members.
 * - **Not for a member you blocked.** Their replies would never reach you
 *   (spec/behavior/chat/README.md § Block), so the sheet offers Unblock
 *   instead. This is the viewer's own block, so hiding the action reveals
 *   nothing; the member you blocked still sees Message on your profile, since
 *   a block is enforced by not delivering, never by refusing.
 */
export function canMessageMember({
  memberUserId,
  viewerUserId,
  isBlocked,
}: MessageTargetInput): boolean {
  if (!memberUserId || viewerUserId === null) return false;
  if (memberUserId === viewerUserId) return false;
  if (!isBlockableSender(memberUserId)) return false;
  return !isBlocked;
}

/**
 * The channel id out of a `POST /v1/channels/dm` response, or `null` when the
 * body has none, so the caller reports a failure instead of navigating to a
 * thread with no id.
 */
export function dmChannelIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function startDmFailedTitle(name: string): string {
  return `Couldn't message ${name}`;
}

export const START_DM_FAILED_BODY =
  "The conversation couldn't be opened. Check your connection and try again.";
