/**
 * Where the officer tools live on web: inside Chapter settings, on the page
 * of the module each belongs to (#3837).
 *
 * Chat admin, Discord import, Study zones and Reports each had a full-width
 * route of their own, and opening one from Chapter settings dropped the rail
 * and brought chat back beside it (Paul, 2026-11-12: "I DO NOT WANT" that,
 * "phase those out"). Their old routes only redirect here now, so anything
 * that links to a tool links to one of these instead of bouncing through the
 * redirect, which would lose a `#reported-messages` anchor on the way.
 */

/** The Chat page: channels, categories, background and the report queue. */
export const CHAT_SETTINGS_PATH = "/settings?tab=chat";

/** One channel's own settings, opened in place of the Chat page. */
export function channelSettingsPath(channelId: string): string {
  return `${CHAT_SETTINGS_PATH}&channel=${encodeURIComponent(channelId)}`;
}

/** The anchor the report queue scrolls to when a notification opens it. */
export const CHAT_REPORTS_ANCHOR = "reported-messages";

/** The report queue, where a new-report notification lands. */
export const CHAT_REPORTS_SETTINGS_PATH = `${CHAT_SETTINGS_PATH}#${CHAT_REPORTS_ANCHOR}`;

/** `?tool=` value that opens Discord import in place of the Chat page. */
export const DISCORD_IMPORT_TOOL = "discord-import";

/** Discord import, opened in place of the Chat page. */
export const DISCORD_IMPORT_SETTINGS_PATH = `${CHAT_SETTINGS_PATH}&tool=${DISCORD_IMPORT_TOOL}`;

/** The Reports page, whose body is the export form. */
export const REPORTS_SETTINGS_PATH = "/settings?tab=reports";

/** The Study zones page, whose body is the zone list. */
export const STUDY_ZONES_SETTINGS_PATH = "/settings?tab=geofences";

/**
 * Search params that open a page inside a module page (a channel's settings,
 * Discord import). Switching rail rows drops them, so coming back to Chat
 * shows the Chat page rather than the sub-page last left open.
 */
export const SETTINGS_SUBPAGE_PARAMS = [
  "channel",
  "tool",
  // Discord's way back from its consent screen, and its one-time outcome.
  "wizard",
  "discord",
  "handshake",
  // Consumed once by the module page's switch focus (#492).
  "module",
] as const;

/**
 * Where an old tool route sends its visitor: `target` (a Chapter settings
 * address) with the visit's own search params carried over, so a channel id,
 * Discord's `?discord=` outcome or a store build's `?from=app` survives the
 * hop. `tab` is the target's; one in the old link would not be.
 */
export function settingsRedirectPath(
  target: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const [path, query = ""] = target.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab" || params.has(key)) continue;
    if (typeof value === "string") params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}

/** A page drawn in place of a module page of Chapter settings. */
export type SettingsSubpage =
  { kind: "channel"; channelId: string } | { kind: "discord-import" };

/**
 * Which page, if any, `?channel=` or `?tool=` opens in place of module page
 * `moduleKey`. Only for a viewer who holds the tool behind it (`holdsTool`
 * takes a `SETTINGS_TOOLS` id): anyone else gets the module page, as a link
 * to a tool they lack never opened it either.
 */
export function settingsSubpageFor(
  moduleKey: string,
  params: { channel: string | null; tool: string | null },
  holdsTool: (toolId: string) => boolean,
): SettingsSubpage | null {
  if (moduleKey !== "chat") return null;
  if (params.channel && holdsTool("chat-admin")) {
    return { kind: "channel", channelId: params.channel };
  }
  if (params.tool === DISCORD_IMPORT_TOOL && holdsTool("discord-import")) {
    return { kind: "discord-import" };
  }
  return null;
}
