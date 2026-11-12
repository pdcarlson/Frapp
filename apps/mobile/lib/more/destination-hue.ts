import { roleColor, type RoleColorKey } from "@repo/validation";

/**
 * The fixed hue each place on the You tab wears on its lead tile (Paul,
 * 2026-11-12, #4610 step 3; `spec/ui/design-system/foundations.md` §6, "A
 * place's hue").
 *
 * The You tab is a list of up to ten places a member opens by habit. A hue
 * per place lets them find Study hours or Documents without reading the
 * labels, as iOS Settings and Telegram's settings list do. The rule that
 * keeps it from becoming decoration: **a hue names a place, never a state.**
 * It is the same every day for every member, so it carries no news. Rows
 * that show a state (the Activity list, Chat home's Up next) keep a neutral
 * tile, because colour there already means something: the accent asks the
 * member to act and red is overdue.
 *
 * The hues are the role palette's (`ROLE_COLOR_PALETTE`), already checked
 * for contrast on every charcoal surface, and that palette leaves out gold
 * and red on purpose, so no tile can read as the accent or as a mention.
 * `LeadTile` draws the fill at 16% of the hue under the glyph at full
 * strength (`iconography.md` §1's emphasis fill).
 *
 * Settings and Chapter settings share slate: they are the same kind of
 * place, one the member's and one the chapter's, and draw the same gear.
 */
export type YouDestination =
  | "study"
  | "service"
  | "dues"
  | "documents"
  | "minutes"
  | "directory"
  | "settings"
  | "chapter"
  | "invite"
  | "hostCheckIn"
  | "chapterSettings";

export const YOU_DESTINATION_HUE_KEY: Record<YouDestination, RoleColorKey> = {
  study: "periwinkle",
  service: "rose",
  dues: "green",
  documents: "sky",
  minutes: "sand",
  directory: "violet",
  settings: "slate",
  chapter: "teal",
  invite: "lime",
  hostCheckIn: "orange",
  chapterSettings: "slate",
};

/** The hex a place's tile and glyph draw in. */
export function destinationHue(place: YouDestination): string {
  return roleColor(YOU_DESTINATION_HUE_KEY[place]);
}
