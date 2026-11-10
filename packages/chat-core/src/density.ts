/**
 * Chat density: how tightly the thread draws its rows, a per-device display
 * preference each member picks in their settings (#2252,
 * `spec/ui/design-system/components.md` §11 § Density).
 *
 * - `cozy` is the layout every row was drawn in before the choice existed:
 *   the first row of a run draws a 32px avatar and an author line above the
 *   body, and a run starts 16 below the row above.
 * - `compact` drops the avatar and the author line. The time and name lead the
 *   body's first line (web holds the time in a fixed gutter, mobile writes it
 *   inline), and a run starts 4 below the row above.
 * - `bubbles` is the opt-in messenger layout (§11 § Bubbles, owner OK
 *   2026-11-10 on #3787): others' messages on the left, the viewer's on the
 *   right in the chapter accent, a run stacked with tucked corners, the name
 *   once above a stack and the avatar once below it.
 *
 * Cozy stays the default; bubbles is never picked for a member.
 *
 * Kept on the device rather than the account: a phone and a laptop have
 * different screens, and a member can want compact on one and cozy on the
 * other. Web keeps it in `localStorage`, mobile in AsyncStorage, under the
 * same key.
 */
export const CHAT_DENSITIES = ["cozy", "compact", "bubbles"] as const;

export type ChatDensity = (typeof CHAT_DENSITIES)[number];

export const DEFAULT_CHAT_DENSITY: ChatDensity = "cozy";

/** The storage key on both surfaces. Versioned so a future shape can't misread an old value. */
export const CHAT_DENSITY_STORAGE_KEY = "frapp.chat-density.v1";

/** What the settings control says about each option. */
export const CHAT_DENSITY_OPTIONS: ReadonlyArray<{
  value: ChatDensity;
  label: string;
  description: string;
}> = [
  {
    value: "cozy",
    label: "Cozy",
    description: "Profile pictures, with names on their own line.",
  },
  {
    value: "compact",
    label: "Compact",
    description: "More messages on screen, with names beside the text.",
  },
  {
    value: "bubbles",
    label: "Bubbles",
    description: "Messages in bubbles, with yours on the right.",
  },
];

/**
 * A stored value read back as a density. Anything unrecognised, including a
 * missing key or storage that threw, reads as the default rather than as an
 * error: a display preference is never worth a broken thread.
 */
export function parseChatDensity(raw: unknown): ChatDensity {
  return (CHAT_DENSITIES as readonly unknown[]).includes(raw)
    ? (raw as ChatDensity)
    : DEFAULT_CHAT_DENSITY;
}

export function chatDensityLabel(density: ChatDensity): string {
  return (
    CHAT_DENSITY_OPTIONS.find((option) => option.value === density)?.label ??
    "Cozy"
  );
}

/**
 * A member's per-channel display (#3787): a channel can follow the member's
 * default or be pinned to one density, on this device only, like the default.
 * Stored as one JSON map of channel id to density under its own key, so the
 * default's key and shape stay as they were.
 */
export const CHAT_CHANNEL_DENSITY_STORAGE_KEY =
  "frapp.chat-density.channels.v1";

export type ChannelDensityMap = Readonly<Record<string, ChatDensity>>;

/**
 * A stored map read back. Anything malformed reads as no overrides, and an
 * entry whose value is not a density is dropped rather than read as cozy: an
 * unreadable override should fall back to the member's default, not pin cozy.
 */
export function parseChannelDensityMap(raw: unknown): ChannelDensityMap {
  if (typeof raw !== "string" || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, ChatDensity> = {};
  for (const [channelId, value] of Object.entries(parsed)) {
    if ((CHAT_DENSITIES as readonly unknown[]).includes(value)) {
      out[channelId] = value as ChatDensity;
    }
  }
  return out;
}

/** The map with one channel set, or cleared back to the default with `null`. */
export function withChannelDensity(
  map: ChannelDensityMap,
  channelId: string,
  density: ChatDensity | null,
): ChannelDensityMap {
  const next: Record<string, ChatDensity> = { ...map };
  if (density === null) delete next[channelId];
  else next[channelId] = density;
  return next;
}

/** What a channel draws: its override on this device, else the default. */
export function resolveChannelDensity(
  fallback: ChatDensity,
  map: ChannelDensityMap,
  channelId: string | null | undefined,
): ChatDensity {
  return (channelId ? map[channelId] : undefined) ?? fallback;
}

/**
 * The per-channel picker's choices, shared by both clients' channel menus:
 * follow the member's default first, then each density "here".
 */
export function channelDensityChoices(
  fallback: ChatDensity,
): ReadonlyArray<{ value: ChatDensity | null; label: string }> {
  return [
    { value: null, label: `Your default (${chatDensityLabel(fallback)})` },
    ...CHAT_DENSITY_OPTIONS.map((option) => ({
      value: option.value,
      label: `${option.label} here`,
    })),
  ];
}

/** The channel menu row's state word: the override, or "Default". */
export function channelDensityDetail(override: ChatDensity | null): string {
  return override ? chatDensityLabel(override) : "Default";
}
