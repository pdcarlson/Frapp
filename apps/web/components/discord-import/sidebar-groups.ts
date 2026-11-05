import type { StagedChannel } from "./upload-step";

/**
 * The part of a row's choice this file reads. Kept structural, not imported
 * from `mapping-issues`, which imports this file.
 */
type RowChoice = { action: string };

/**
 * Whether a Discord import keeps the server's categories as channel groups,
 * the named sections of the chat sidebar (`chat_channel_categories`).
 *
 * Off by default: a chapter that already arranged its groups shouldn't find
 * new ones. With it on, every category is kept unless the admin drops it, and
 * each new channel goes into the group named after its category. Starting the
 * import joins a group the chapter already has by that name, compared trimmed
 * and in any case, and creates the rest. A merged channel stays where it is.
 */
export interface SidebarGroups {
  keep: boolean;
  /** Discord categories, by name, the admin chose not to keep. */
  dropped: ReadonlySet<string>;
}

export const NO_SIDEBAR_GROUPS: SidebarGroups = {
  keep: false,
  dropped: new Set(),
};

/** The group the channel this row creates goes into, or null for none. */
export function sidebarGroupFor(
  channel: StagedChannel,
  choice: RowChoice | undefined,
  groups: SidebarGroups,
): string | null {
  if (!groups.keep || choice?.action !== "create_new") return null;
  const name = channel.category?.trim();
  if (!name || groups.dropped.has(channel.category as string)) return null;
  return name;
}

/**
 * The groups the import will put channels into, in the order their channels
 * come, each once under the first spelling a channel uses.
 */
export function keptSidebarGroups(
  channels: readonly StagedChannel[],
  choices: Record<string, RowChoice>,
  groups: SidebarGroups,
): string[] {
  const seen = new Map<string, string>();
  for (const channel of channels) {
    const name = sidebarGroupFor(channel, choices[channel.channelId], groups);
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}
