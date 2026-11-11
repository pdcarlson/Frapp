/**
 * Message flags (#3921): a label a member adds to a chat message after it is
 * sent. One flag per message. `important` draws the row in danger red and
 * raises the channel's "important message" strip; the rest are a quiet
 * caption. The set is fixed, not chapter-defined, and the CHECK constraint in
 * `supabase/migrations/20261111150000_chat_message_flags.sql` mirrors it.
 *
 * The flag is stored on the message itself, beside who added it and when, so
 * a later reader (Ask, in Paul's words of 2026-11-11, "pre-classification")
 * can tell a joke from reliable information without classifying it again.
 * A member's flag is a human judgement, not a verdict; `flagged_by` keeps whose.
 *
 * Who may set it is decided by `canChangeMessageFlag` below, which the API and
 * both clients share: spec/behavior/chat/README.md § Message flags.
 */
export const CHAT_MESSAGE_FLAGS = [
  "important",
  "funny",
  "interesting",
  "question",
  "hype",
  "fyi",
] as const;
export type ChatMessageFlag = (typeof CHAT_MESSAGE_FLAGS)[number];

/** What a flag reads as, on the row and in the menu. */
export const CHAT_MESSAGE_FLAG_LABELS: Record<ChatMessageFlag, string> = {
  important: "Important",
  funny: "Funny",
  interesting: "Interesting",
  question: "Question",
  hype: "Hype",
  fyi: "FYI",
};

export function isChatMessageFlag(value: unknown): value is ChatMessageFlag {
  return (
    typeof value === "string" &&
    (CHAT_MESSAGE_FLAGS as readonly string[]).includes(value)
  );
}

/**
 * Whether `viewerId` may change or remove the flag a message carries.
 *
 * Anyone who can read the channel may add a flag to a message that has none,
 * so this answers `true` for an unflagged message. Once flagged, only the
 * message's sender, whoever added the flag, or a member holding
 * `channels:manage` (an officer, the same permission pins use) may replace or
 * remove it. That keeps "anyone can flag" from turning into anyone undoing
 * anyone (Shawn's decision on #3921, 2026-11-11).
 */
export function canChangeMessageFlag(
  message: {
    sender_id: string | null;
    flagged_by: string | null;
    flag: string | null;
  },
  viewerId: string,
  viewerManagesChannels: boolean,
): boolean {
  if (message.flag == null) return true;
  return (
    viewerManagesChannels ||
    message.sender_id === viewerId ||
    message.flagged_by === viewerId
  );
}
