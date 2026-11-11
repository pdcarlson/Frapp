/**
 * The built-in default push level of a chat channel, shared by the API's push
 * worker and the web officer control that shows it (#2771).
 *
 * Shared because the web control has to say what "no officer default set"
 * currently means for a channel, and a second copy of this rule in the web app
 * would drift from the one that actually decides who gets pushed.
 *
 * The full chain, with kinds and a member's own preferences, lives in the
 * API's `push-rules.ts`. This file is only the channel part of it.
 */

/** A chat push level: every message, only `@`-mentions, or none. */
export const CHAT_NOTIFICATION_LEVELS = ["all", "mentions", "off"] as const;
export type ChatNotificationLevel = (typeof CHAT_NOTIFICATION_LEVELS)[number];

/**
 * A member's chapter-wide chat level (#3840), set in Settings → Notifications.
 *
 * - `all`: "All messages", each channel at its own default.
 * - `mentions`: "Mentions and DMs only". Every ordinary channel acts as
 *   `mentions` (a reply counts as a mention, #3844); DMs, group DMs and
 *   the announcements channel keep notifying. A level the member set on one
 *   channel still wins.
 *
 * No `off`: the owner dropped the switch that silenced all of chat on
 * 2026-11-06 (`notification-categories.ts` says why), and quiet hours are how
 * a member goes silent.
 */
export const CHAT_CHAPTER_LEVELS = ["all", "mentions"] as const;
export type ChatChapterLevel = (typeof CHAT_CHAPTER_LEVELS)[number];

/** The words both settings screens draw for each {@link ChatChapterLevel}. */
export const CHAT_CHAPTER_LEVEL_OPTIONS: readonly {
  level: ChatChapterLevel;
  label: string;
  description: string;
}[] = [
  {
    level: "all",
    label: "All messages",
    description:
      "Each channel notifies as it's set, #general for every message.",
  },
  {
    level: "mentions",
    label: "Mentions and DMs only",
    description:
      "Channels notify only when someone @mentions you or replies to you. DMs and announcements still notify.",
  },
];

/** The short name for a level, as a settings row's value. */
export function chatChapterLevelLabel(level: ChatChapterLevel): string {
  return (
    CHAT_CHAPTER_LEVEL_OPTIONS.find((option) => option.level === level)
      ?.label ?? level
  );
}

/** The channel fields the default reads. Structural, so any channel row fits. */
export interface NotificationDefaultChannel {
  name: string;
  /** `PUBLIC` / `PRIVATE` / `ROLE_GATED` / `DM` / `GROUP_DM`. */
  type: string;
  is_read_only: boolean | null;
}

/** A 1:1 or group DM. Every message there is addressed to its members. */
export function isDirectChannel(
  channel: Pick<NotificationDefaultChannel, "type">,
): boolean {
  return channel.type === "DM" || channel.type === "GROUP_DM";
}

/**
 * Whether a channel is the chapter's announcements channel, for its default
 * level and for the push's title, URGENT priority and category.
 *
 * A PUBLIC, read-only channel whose name contains `announcements`, the seeded
 * `#announcements` included. Everyone reads it and only `announcements:post`
 * holders write it, so a chapter-wide URGENT push, which skips quiet hours and
 * every category preference, is sound there and nowhere else.
 *
 * The shape is required of the exact name too. The push worker used to accept
 * any channel *named* `announcements`, so a group DM given that name, or the
 * seeded channel with read-only switched off, let any member send URGENT
 * pushes (#2771 review). A channel that fails the test gets ordinary channel
 * pushes at its ordinary default.
 *
 * Still name-keyed, and so one rename from changing; narrowing it is part of
 * #1323. The activity feed finds its announcements channel with this too.
 */
export function isAnnouncementChannel(
  channel: NotificationDefaultChannel,
): boolean {
  return (
    channel.type === "PUBLIC" &&
    channel.is_read_only === true &&
    channel.name.toLowerCase().includes("announcements")
  );
}

/**
 * The default a channel has when no officer has set one. This is what the
 * owner's decision on #2771 calls "seeded": `all` for DMs, the announcements
 * channel (see `isAnnouncementChannel`) and `#general`, `off` for `#chapter-audit`, `mentions` for the rest.
 *
 * Seeded by rule rather than by writing a value onto each row, so there is no
 * backfill and a chapter created tomorrow gets the same answer as one created
 * a year ago. The cost is that it follows the name: renaming `#general` drops
 * it to `mentions` unless an officer has set a default explicitly.
 */
export function builtInChannelDefault(
  channel: NotificationDefaultChannel,
): ChatNotificationLevel {
  if (isDirectChannel(channel)) return "all";
  if (isAnnouncementChannel(channel)) return "all";
  if (channel.name === "general") return "all";
  if (channel.name === "chapter-audit") return "off";
  return "mentions";
}
