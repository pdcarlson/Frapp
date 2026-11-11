/**
 * Message flags on the client (#3921): what a row draws and who may change
 * it, decided once for web and mobile. The rule itself lives in
 * `@repo/validation` (`canChangeMessageFlag`), shared with the API; this adds
 * what only a client knows: the viewer's block list and the roster's names.
 * `spec/behavior/chat/README.md` § Message flags.
 */
import {
  CHAT_MESSAGE_FLAGS,
  CHAT_MESSAGE_FLAG_LABELS,
  canChangeMessageFlag,
  type ChatMessageFlag,
} from "@repo/validation";
import { isVisibleMember, type BlockState } from "./blocks";
import { canActOnMessage } from "./message-actions";
import type { ChatMessage } from "./types";

/** What a flagged row draws above its body. */
export interface MessageFlagView {
  flag: ChatMessageFlag;
  /** "Important", "Funny", … */
  label: string;
  /** Important tints the row; the lighter flags are only a caption. */
  important: boolean;
  /**
   * Who added it, for "· flagged by Name", or `null` when the caption names
   * no one: the sender flagged their own message, the flagger is someone the
   * viewer blocked (or the list can't vouch for them yet), the server
   * withheld them, or the roster has no name.
   */
  flaggedBy: string | null;
}

type FlagFields = Pick<
  ChatMessage,
  "flag" | "flagged_by" | "sender_id" | "is_deleted"
>;

/**
 * The flag a row draws, or `null` for none. A deleted message draws no flag,
 * whatever its row still carries.
 *
 * The flagger is checked against the viewer's own block list here because
 * the server withholds a blocked flagger only on the reads that mask: the
 * Realtime echo, and the answers to a pin or an edit, carry the raw id.
 */
export function messageFlagView(
  message: FlagFields,
  viewerId: string | null,
  blockState: BlockState,
  nameFor: (userId: string) => string | null,
): MessageFlagView | null {
  const flag = message.flag;
  if (!flag || message.is_deleted) return null;
  const by = message.flagged_by ?? null;
  let flaggedBy: string | null = null;
  if (by && by !== message.sender_id) {
    if (by === viewerId) flaggedBy = "you";
    else if (isVisibleMember(by, blockState)) flaggedBy = nameFor(by);
  }
  return {
    flag,
    label: CHAT_MESSAGE_FLAG_LABELS[flag],
    important: flag === "important",
    flaggedBy,
  };
}

/** The caption's text: "Important", or "Important · flagged by Marcus". */
export function messageFlagCaption(view: MessageFlagView): string {
  return view.flaggedBy
    ? `${view.label} · flagged by ${view.flaggedBy}`
    : view.label;
}

/**
 * Whether the viewer may open the flag menu on this row: a confirmed, live
 * message they can read (not a blocked member's tombstone, not a pending
 * send), and either it has no flag yet or they may change the one it has.
 * A viewer who can't change someone else's flag sees no control, rather than
 * a menu of choices that would all be refused.
 */
export function canFlagMessage(
  message: Pick<
    ChatMessage,
    | "_status"
    | "is_deleted"
    | "kind"
    | "sender_id"
    | "sender_blocked"
    | "flag"
    | "flagged_by"
  >,
  viewerId: string | null,
  canManageChannel: boolean,
): boolean {
  if (!viewerId || !canActOnMessage(message)) return false;
  if (message.sender_blocked || message.kind === "loading") return false;
  return canChangeMessageFlag(
    {
      sender_id: message.sender_id,
      flagged_by: message.flagged_by ?? null,
      flag: message.flag ?? null,
    },
    viewerId,
    canManageChannel,
  );
}

/** The menu's choices, Important first, as the API's fixed set orders them. */
export const MESSAGE_FLAG_OPTIONS: ReadonlyArray<{
  flag: ChatMessageFlag;
  label: string;
}> = CHAT_MESSAGE_FLAGS.map((flag) => ({
  flag,
  label: CHAT_MESSAGE_FLAG_LABELS[flag],
}));
