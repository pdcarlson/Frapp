import { isBlockableSender } from "@repo/chat-core/blocks";
import type { BlockListStatus } from "@repo/validation";

/**
 * The member sheet's Message action (#2773): start, or reopen, a 1:1 DM with
 * the member on screen. `POST /v1/channels/dm` is get-or-create, so a member
 * you already have a DM with gets that thread back, and opening it again is
 * also what brings back a DM you hid (`reopenHidden` on chat home relies on
 * the same route).
 */

/**
 * The member's id when they are another real member of the chapter, else
 * `null`. Both of the sheet's chat actions, Block and Message, are offered only
 * for such a member, and both read it from here so the two cannot drift.
 *
 * - **Never while the viewer is unknown**, so an unresolved viewer never reads
 *   as "someone else". The API refuses a self-block, but not a DM with
 *   yourself: two identical ids pass its "exactly 2 members" check and create
 *   a degenerate channel.
 * - **Never on your own profile or the system actor's.** `isBlockableSender`
 *   is the one list of senders that are not real members.
 */
export function otherRealMemberId(
  memberUserId: string | null,
  viewerUserId: string | null,
): string | null {
  if (!memberUserId || viewerUserId === null) return null;
  if (memberUserId === viewerUserId) return null;
  return isBlockableSender(memberUserId) ? memberUserId : null;
}

export interface MessageTargetInput {
  /** {@link otherRealMemberId} for the member on screen. */
  memberId: string | null;
  /** The viewer's block list, as `useBlockedUserIds` returns it. */
  blockList: { status: BlockListStatus; ids: ReadonlySet<string> };
}

/**
 * Whether the sheet offers Message.
 *
 * **Not for a member you blocked.** Their replies would never reach you
 * (spec/behavior/chat/README.md § Block), so the sheet offers Unblock instead.
 * It's the viewer's own block, so hiding the action reveals nothing; the member
 * you blocked still sees Message on your profile, since a block is enforced by
 * not delivering, never by refusing.
 *
 * **Only against a ready list.** `ids` is a floor, never a ceiling: while the
 * list is loading or unavailable it holds only the blocks this client confirmed
 * this session, so a block made earlier or on another device is missing from
 * it. Block can be offered off the floor, because the API treats a repeat block
 * as a no-op. Message cannot, because it would open a DM with that member.
 * Starting a DM needs the network anyway, so waiting for the list costs nothing.
 */
export function canMessageMember({
  memberId,
  blockList,
}: MessageTargetInput): boolean {
  if (memberId === null) return false;
  if (blockList.status !== "ready") return false;
  return !blockList.ids.has(memberId);
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
