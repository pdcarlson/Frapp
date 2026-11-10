/**
 * Chat backgrounds (#3973): the keys a chapter default or a channel override
 * may hold. The database CHECK constraints in
 * `supabase/migrations/20261110230000_chat_backgrounds.sql` mirror this list.
 * How each one looks lives in `@repo/theme` (`chat-backgrounds.ts`); this is
 * only the contract the API validates against.
 */
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

export function isChatBackgroundKey(
  value: unknown,
): value is ChatBackgroundKey {
  return (
    typeof value === "string" &&
    (CHAT_BACKGROUND_KEYS as readonly string[]).includes(value)
  );
}
