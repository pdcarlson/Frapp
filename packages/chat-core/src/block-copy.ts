import type { BlockListStatus } from "@repo/validation";

/**
 * The words every chat client says about a block, in one place so the mobile
 * thread and the web dashboard cannot explain one rule two ways
 * (`spec/behavior/chat/README.md` § Report and block,
 * `spec/ui/design-system/writing.md` § Report and block).
 *
 * Only what is true of every client lives here. Copy that names a control one
 * client has and another lacks (mobile's Block row, its directory sheet) stays
 * with that client. A block is scoped to one chapter and a member can belong
 * to several, so the copy says "this chapter" wherever it says what a block
 * hides, and nothing here says the blocked member finds out: blocking is
 * silent by contract.
 */

/** What a thread draws in place of a message from a member the viewer blocked. */
export const TOMBSTONE_TEXT = "Message from a member you blocked";

/**
 * A server-masked copy left over from before an unblock this client
 * confirmed: there is nothing left to unblock (`tombstoneCanUnblock`).
 */
export const TOMBSTONE_STALE_TEXT = "Hidden while you had this member blocked";

/**
 * What a reply quote draws for a parent held while the block list is loading
 * or unavailable. A blocked member's parent quotes as the tombstone's own words
 * instead (`hiddenQuoteText`).
 */
export const HELD_QUOTE_TEXT = "Message hidden";

/**
 * What a notice or list says in place of its Retry control while the list's
 * read is parked waiting for the network (`BlockedUserIds.isPaused`): a tap
 * could not run it any sooner, and it resumes by itself on reconnect.
 */
export const BLOCK_LIST_WAITING_FOR_NETWORK = "Retries when you're back online";

/**
 * The thread-level notice for a block list that is not `ready`, or `null`.
 *
 * Unavailable always says so, even with nothing held — the spec requires the
 * member to be told, and the ids the thread is still applying may be stale.
 * Loading stays quiet unless it is actually holding something, because the
 * first read usually lands before anything could arrive.
 */
export function blockListNotice(
  status: BlockListStatus,
  heldCount: number,
): { title: string; body: string; canRetry: boolean } | null {
  const held =
    heldCount === 1
      ? "1 new message is"
      : heldCount > 1
        ? `${heldCount} new messages are`
        : "New messages are";
  if (status === "unavailable") {
    return {
      title: "Couldn't load your block list",
      body: `${held} held until it loads, so nothing from a member you blocked shows by mistake.`,
      canRetry: true,
    };
  }
  if (status === "loading" && heldCount > 0) {
    return {
      title: "Checking your block list",
      body: `${held} held until it loads.`,
      canRetry: false,
    };
  }
  return null;
}

/** Used wherever the roster cannot name the member. */
export const UNNAMED_MEMBER = "this member";

export function unblockConfirmTitle(name: string): string {
  return `Unblock ${name}?`;
}

export const UNBLOCK_CONFIRM_BODY =
  "Their messages in this chapter's chat will show again. They won't be told.";

export function unblockFailedTitle(name: string): string {
  return `Couldn't unblock ${name}`;
}

/** A failed block or unblock: the server confirmed nothing, so nothing changed. */
export const BLOCK_FAILURE_BODY =
  "Nothing changed. Check your connection and try again.";

/** A stale tombstone's Reload, when the re-read it re-runs fails again. */
export const MASKED_RELOAD_FAILED_TITLE = "Couldn't reload these messages";
export const MASKED_RELOAD_FAILED_BODY = "Check your connection and try again.";

/**
 * The blocked-members list — the one place a block can always be undone
 * (`spec/behavior/chat/README.md` § Block). It says which chapter it lists, the
 * empty state included: "You haven't blocked anyone" would be false for a
 * member with blocks in another chapter. The empty state's body is each
 * client's own, because it names where that client offers Block.
 */
export const BLOCKED_MEMBERS_TITLE = "Blocked members";
export const BLOCKED_MEMBERS_SCOPE = "Blocks apply in this chapter only.";
export const BLOCKED_MEMBERS_EMPTY_TITLE =
  "You haven't blocked anyone in this chapter";
export const BLOCKED_MEMBERS_ERROR_TITLE = "Couldn't load your blocked members";
export const BLOCKED_MEMBERS_ERROR_BODY =
  "Check your connection and try again. Your blocks haven't changed.";
/** The first read is parked until the device is online; a tap cannot help. */
export const BLOCKED_MEMBERS_OFFLINE_BODY =
  "You're offline. This list loads when you're back online. Your blocks haven't changed.";
export const BLOCKED_MEMBERS_STALE =
  "Couldn't refresh this list. It may be missing a recent change.";
