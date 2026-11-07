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
 *
 * Kept on the device rather than the account: a phone and a laptop have
 * different screens, and a member can want compact on one and cozy on the
 * other. Web keeps it in `localStorage`, mobile in AsyncStorage, under the
 * same key.
 */
export const CHAT_DENSITIES = ["cozy", "compact"] as const;

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
