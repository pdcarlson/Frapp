/**
 * The mobile chat client's half of the block contract (#2257, #2315):
 * `spec/behavior/chat/README.md` § The masking contract.
 *
 * The server masks what it serves, but the Realtime `postgres_changes` echo
 * delivers the raw row with no viewer attached, so the thread applies the
 * viewer's own list on top. Two inputs decide what a row may show:
 *
 * - **Provenance** — `ChatMessage._blockEvaluated`, set by `@repo/chat-core`'s
 *   `normalizeRow` when the raw row carried `sender_blocked`, i.e. it came
 *   through a REST read the server ran the list over. The echo (INSERT and
 *   UPDATE) and the viewer's own send/edit responses are unevaluated.
 * - **The block list** — `useBlockedUserIds()`, tri-state. Its ids are a floor
 *   in every status: anyone on the last list read is known-blocked.
 *
 * **Nothing here reads `content`.** The server's masking sentinel is a
 * rendering detail of one code path, and a client that pattern-matches it
 * silently stops masking the day it changes. `blocks.spec.ts` pins that.
 *
 * **Nothing here reads `created_at` either.** A timestamp says when a row was
 * written, not how it reached the cache, and REST and Realtime serialize
 * `timestamptz` differently — the watermark design this replaced was a no-op
 * for exactly that reason (#2315).
 */

import type { ChatMessage } from "@repo/chat-core/types";
import type { BlockListStatus } from "@repo/hooks";
import { SYSTEM_SENDER_ID } from "@repo/validation";

export interface BlockState {
  status: BlockListStatus;
  /** A floor, never a ceiling — see `BlockedUserIds.ids` in `@repo/hooks`. */
  ids: ReadonlySet<string>;
}

/**
 * - `visible` renders normally.
 * - `tombstone` renders as "Message from a member you blocked", with nothing
 *   the sender wrote — no body, attachments, reactions or card.
 * - `held` does not render at all; the thread says messages are being held.
 */
export type MessageVisibility = "visible" | "tombstone" | "held";

type ClassifiedFields = Pick<
  ChatMessage,
  "sender_id" | "sender_blocked" | "_blockEvaluated"
>;

/**
 * Whether a sender can be on anyone's block list at all.
 *
 * `null` is an imported archive row (no Signet user behind it — blocks are
 * keyed on `users.id`), and the system actor is refused by the API: blocking it
 * would silently mask the welcome post, the audit bridge and invite DMs.
 */
export function isBlockableSender(senderId: string | null): senderId is string {
  return senderId !== null && senderId !== SYSTEM_SENDER_ID;
}

/**
 * What one message may show, given where it came from and the viewer's list.
 *
 * Order matters and each step is the narrowest safe claim:
 *
 * 1. The viewer's own message is always visible — you cannot block yourself.
 * 2. A row the server evaluated and masked is a tombstone whatever the list
 *    now says: its content was withheld, so there is nothing else to draw.
 * 3. A sender nobody can block (imported, system) cannot be hidden by a list.
 * 4. A sender on the list is a tombstone on **every** path — including a row
 *    the server cleared before the block was made.
 * 5. A row the server evaluated and cleared is visible.
 * 6. An unevaluated row is visible only against a list known to be current;
 *    loading or unavailable holds it (fail closed).
 */
export function classifyMessage(
  message: ClassifiedFields,
  blockState: BlockState,
  viewerId: string | null,
): MessageVisibility {
  const sender = message.sender_id;
  if (viewerId !== null && sender === viewerId) return "visible";
  if (message._blockEvaluated && message.sender_blocked) return "tombstone";
  if (!isBlockableSender(sender)) return "visible";
  if (blockState.ids.has(sender)) return "tombstone";
  if (message._blockEvaluated) return "visible";
  return blockState.status === "ready" ? "visible" : "held";
}

/**
 * Whether a tombstone should offer Unblock.
 *
 * Only a list known to be current can say the sender is *not* blocked — that is
 * the one case with nothing to undo: a server-masked copy left over from before
 * an unblock (the unblock re-reads each thread's newest page, not its whole
 * history). Everywhere else the control stays, because unblocking is
 * idempotent and harmless when the list merely failed to load.
 */
export function tombstoneCanUnblock(
  message: Pick<ChatMessage, "sender_id">,
  blockState: BlockState,
): boolean {
  if (!isBlockableSender(message.sender_id)) return false;
  if (blockState.ids.has(message.sender_id)) return true;
  return blockState.status !== "ready";
}

export interface ThreadRow {
  message: ChatMessage;
  visibility: Exclude<MessageVisibility, "held">;
}

export interface BlockedThread {
  /** What the list renders, in the input order. Held rows are absent. */
  rows: ThreadRow[];
  /** How many rows were held back, for the thread-level notice. */
  heldCount: number;
}

/** Classifies a whole thread in one pass. */
export function applyBlockList(
  messages: readonly ChatMessage[],
  blockState: BlockState,
  viewerId: string | null,
): BlockedThread {
  const rows: ThreadRow[] = [];
  let heldCount = 0;
  for (const message of messages) {
    const visibility = classifyMessage(message, blockState, viewerId);
    if (visibility === "held") heldCount += 1;
    else rows.push({ message, visibility });
  }
  return { rows, heldCount };
}

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

export interface MessageActions {
  /** Whether the long-press sheet opens at all. */
  canOpen: boolean;
  canReport: boolean;
  canBlock: boolean;
}

const NO_ACTIONS: MessageActions = {
  canOpen: false,
  canReport: false,
  canBlock: false,
};

/**
 * Which member-safety actions a message offers.
 *
 * - **Never on your own message.** There is nothing to report or block.
 * - **Confirmed rows only.** A pending or failed row carries a client id the
 *   API has never seen, so a report against it would 404.
 * - **Not on a deleted row.** Its content already reads `[message deleted]`,
 *   and the report would snapshot exactly that.
 * - **Block needs a blockable sender** — not the system actor, not an imported
 *   row. Report stays: an imported row names its author in `author_name`, which
 *   the API snapshots into the report for exactly that case.
 *
 * A tombstoned row never reaches this: the thread renders it without the sheet.
 */
export function messageActionsFor(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
): MessageActions {
  if (viewerId === null) return NO_ACTIONS;
  if (message.sender_id === viewerId) return NO_ACTIONS;
  if (message._status !== "confirmed" || message.is_deleted) return NO_ACTIONS;
  return {
    canOpen: true,
    canReport: true,
    canBlock: isBlockableSender(message.sender_id),
  };
}
