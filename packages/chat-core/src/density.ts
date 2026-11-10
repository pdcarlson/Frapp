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

/**
 * The display an Always-formal channel draws for everyone (#3787): full-width
 * posts with the avatar, name and role line, which is cozy.
 */
export const FORMAL_CHAT_DENSITY: ChatDensity = "cozy";

/**
 * What a channel draws: the formal display when the channel is set to Always
 * formal, else its override on this device, else the default. The lock wins
 * over the member's own override, which is kept and comes back if the lock
 * is cleared.
 */
export function resolveChannelDensity(
  fallback: ChatDensity,
  map: ChannelDensityMap,
  channelId: string | null | undefined,
  locked = false,
): ChatDensity {
  if (locked) return FORMAL_CHAT_DENSITY;
  return (channelId ? map[channelId] : undefined) ?? fallback;
}

/**
 * Always formal (#3787) is a server fact, `chat_channels.display_locked`,
 * read off the channel list. Every row of a thread asks for its channel's
 * density by id alone, so the clients copy the locked ids here when the list
 * loads (`syncLockedChannels`) and their density hooks read it through
 * `useSyncExternalStore`, rather than every row reading the channel list.
 */
const NO_LOCKED_CHANNELS: ReadonlySet<string> = new Set();
let lockedChannels: ReadonlySet<string> = NO_LOCKED_CHANNELS;
const lockListeners = new Set<() => void>();

/** Replaces the locked set from a channel list. A list with the same locks notifies nobody. */
export function syncLockedChannels(
  channels: ReadonlyArray<{ id: string; display_locked?: boolean | null }>,
): void {
  const next = new Set<string>();
  for (const channel of channels) {
    if (channel.display_locked === true) next.add(channel.id);
  }
  if (
    next.size === lockedChannels.size &&
    [...next].every((id) => lockedChannels.has(id))
  ) {
    return;
  }
  lockedChannels = next.size === 0 ? NO_LOCKED_CHANNELS : next;
  for (const listener of lockListeners) listener();
}

/** Marks one channel locked or not, ahead of the list's refetch after a change. */
export function setChannelLocked(channelId: string, locked: boolean): void {
  if (lockedChannels.has(channelId) === locked) return;
  const next = new Set(lockedChannels);
  if (locked) next.add(channelId);
  else next.delete(channelId);
  lockedChannels = next;
  for (const listener of lockListeners) listener();
}

export function subscribeLockedChannels(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

export function getLockedChannels(): ReadonlySet<string> {
  return lockedChannels;
}

/** Test seam: forget every lock. */
export function resetLockedChannelsForTests(): void {
  lockedChannels = NO_LOCKED_CHANNELS;
}

/** What the Display view says in an Always-formal channel. */
export const CHANNEL_DISPLAY_LOCKED_NOTE =
  "Always formal: everyone sees this channel in the formal display.";

/** The switch's label and its detail, for the creator or an officer. */
export const ALWAYS_FORMAL_LABEL = "Always formal";
export const ALWAYS_FORMAL_DESCRIPTION =
  "Show this channel to everyone in the formal display. Members can't change it here.";
/** The create form's one-line switch label, matching its Read-only line. */
export const ALWAYS_FORMAL_LABEL_WITH_HINT =
  "Always formal (everyone sees it in the formal display)";

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

/** The channel menu row's state word: "Formal" when locked, else the override, or "Default". */
export function channelDensityDetail(
  override: ChatDensity | null,
  locked = false,
): string {
  if (locked) return "Formal";
  return override ? chatDensityLabel(override) : "Default";
}
