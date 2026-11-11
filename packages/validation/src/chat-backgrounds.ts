/**
 * Chat backgrounds (#3973): the keys a chapter default or a channel override
 * may hold. The database CHECK constraints in
 * `supabase/migrations/20261110235500_chat_backgrounds.sql` mirror this list.
 * How each one looks lives in `@repo/theme` (`chat-backgrounds.ts`); this is
 * only the contract the API validates against.
 */
import { isDirectChannel } from "./chat-notification-defaults";

export const CHAT_BACKGROUND_BUILT_INS = [
  "plain",
  "gold-glow",
  "midnight",
  "game-day",
  "letters",
] as const;
export type ChatBackgroundBuiltIn = (typeof CHAT_BACKGROUND_BUILT_INS)[number];

/** An uploaded chapter photo, stored beside the key as a `branding` path. */
export const CHAT_BACKGROUND_PHOTO = "photo" as const;

export const CHAT_BACKGROUND_KEYS = [
  ...CHAT_BACKGROUND_BUILT_INS,
  CHAT_BACKGROUND_PHOTO,
] as const;
export type ChatBackgroundKey = (typeof CHAT_BACKGROUND_KEYS)[number];

export const CHAT_BACKGROUND_LABELS: Record<ChatBackgroundKey, string> = {
  plain: "Plain",
  "gold-glow": "Gold glow",
  midnight: "Midnight",
  "game-day": "Game day",
  letters: "Letters",
  photo: "Photo",
};

/**
 * The line under every background picker, on web and mobile: why a photo is
 * safe to read over, and how it is answerable.
 */
export const CHAT_BACKGROUND_PHOTO_NOTE =
  "Photos are dimmed and blurred so messages stay readable. Setting one posts a line in chat that anyone can report.";

/** The inherit swatch's label: "(photo)" when the default is a photo it previews as plain. */
export function chatBackgroundDefaultLabel(
  chapterDefault: string | null | undefined,
): string {
  return chapterDefault === CHAT_BACKGROUND_PHOTO
    ? "Chapter default (photo)"
    : "Chapter default";
}

/**
 * Whether a channel can have its own background at all: never a DM or group
 * DM (always plain), the audit log (system-write only, #3909) or an archived
 * channel. The API refuses a set on any of them, and announces a photo
 * default only in a channel that passes; the clients offer the picker only
 * where it passes (`canSetChannelBackground` in `@repo/hooks`).
 */
export function channelTakesBackground(channel: {
  type?: string | null;
  is_audit_log?: boolean | null;
  archived_at?: string | null;
}): boolean {
  if (isDirectChannel({ type: channel.type ?? "" })) return false;
  return !channel.is_audit_log && !channel.archived_at;
}

export function isChatBackgroundKey(
  value: unknown,
): value is ChatBackgroundKey {
  return (
    typeof value === "string" &&
    (CHAT_BACKGROUND_KEYS as readonly string[]).includes(value)
  );
}
