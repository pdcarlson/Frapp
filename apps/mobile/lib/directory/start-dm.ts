import { BLOCK_LIST_WAITING_FOR_NETWORK } from "@repo/chat-core/block-copy";
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
  blockList: {
    status: BlockListStatus;
    ids: ReadonlySet<string>;
    isPaused: boolean;
    /** A read of the list is in flight, a retry included. */
    isRetrying: boolean;
  };
}

/**
 * What the sheet's Message row shows. `spec/ui/mobile/screens.md` s13 owns the
 * rule; this implements it.
 *
 * - `hidden`: no other real member, or one the viewer blocked. Their replies
 *   would never reach you (spec/behavior/chat/README.md § Block), so the sheet
 *   offers Unblock instead. It's the viewer's own block, so hiding the action
 *   reveals nothing; the member you blocked still sees Message on your profile,
 *   since a block is enforced by not delivering, never by refusing. The ids
 *   count in every list state: anyone on them is blocked.
 * - `ready`: the list is ready and they aren't on it. Tapping starts the DM.
 * - `checking`, `waitingForNetwork`, `retry`: the list isn't ready, so the row
 *   stays and says why it can't start a DM yet. The ids are a floor, never a
 *   ceiling, so a block made earlier or on another device can be missing from
 *   them until the list is read. Block can act off the floor, because a repeat
 *   block is a no-op; Message cannot, because it would open a DM with that
 *   member. A read re-runs on its own on reconnect and when the app returns to
 *   the foreground, but nothing polls the list, so a server error while the
 *   member stays online and in the app would otherwise leave the action gone
 *   with no reason given; `retry` re-reads it. A read in flight, a retry
 *   included, shows as `checking`: a failed list keeps its `unavailable`
 *   status while it re-reads, and must not keep offering the tap.
 */
export type MessageRowState =
  | { kind: "hidden" }
  | { kind: "ready" }
  | { kind: "checking" }
  | { kind: "waitingForNetwork" }
  | { kind: "retry" };

export function messageRowState({
  memberId,
  blockList,
}: MessageTargetInput): MessageRowState {
  if (memberId === null || blockList.ids.has(memberId)) {
    return { kind: "hidden" };
  }
  if (blockList.status === "ready") return { kind: "ready" };
  if (blockList.isPaused) return { kind: "waitingForNetwork" };
  if (blockList.status === "loading" || blockList.isRetrying) {
    return { kind: "checking" };
  }
  return { kind: "retry" };
}

/** The Message row's second line while the block list isn't ready. */
export function messageRowDescription(state: MessageRowState): string | null {
  switch (state.kind) {
    case "checking":
      return MESSAGE_CHECKING_BLOCK_LIST;
    case "waitingForNetwork":
      return `${MESSAGE_BLOCK_LIST_UNCHECKED} ${BLOCK_LIST_WAITING_FOR_NETWORK}.`;
    case "retry":
      return `${MESSAGE_BLOCK_LIST_UNCHECKED} Tap to try again.`;
    default:
      return null;
  }
}

export const MESSAGE_CHECKING_BLOCK_LIST = "Checking your block list first.";
/** A read that failed, whether a retry can run now or waits for the network. */
export const MESSAGE_BLOCK_LIST_UNCHECKED = "Couldn't check your block list first.";

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
