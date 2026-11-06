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

/** The part of a row's choice the preview reads. */
type PreviewChoice = RowChoice & { newName?: string; visibility?: string };

/** One section of the preview, as the chat sidebar will head it. */
export interface PreviewSection {
  key: string;
  /** The group's name; null for the channels in none ("Channels"). */
  group: string | null;
  channels: { name: string; locked: boolean }[];
}

/**
 * The channels the import makes, as the chat sidebar will list them: the
 * ones in no group first (the sidebar's "Channels"), then each kept group in
 * the order starting the import creates them (`planChannelGroups` in the
 * API): by the lowest Discord category position among its channels, a group
 * with none after every positioned one, then by name. An upload's export
 * carries no positions, so its groups go A to Z. Inside a section,
 * A to Z, the sidebar's rule. Discord channels given the same new name are
 * one row, as they land in one channel. A merge makes nothing, so it isn't
 * listed. A row is locked unless the whole chapter can read it, as the
 * sidebar marks a private channel.
 */
export function sidebarPreview(
  channels: readonly StagedChannel[],
  choices: Record<string, PreviewChoice>,
  groups: SidebarGroups,
): PreviewSection[] {
  type Building = {
    group: string | null;
    position: number | null;
    rows: Map<string, { name: string; locked: boolean }>;
  };
  const sections = new Map<string, Building>();
  for (const channel of channels) {
    if (channel.readable === false) continue;
    const choice = choices[channel.channelId];
    if (choice?.action !== "create_new") continue;
    const name = choice.newName?.trim();
    if (!name) continue;
    const group = sidebarGroupFor(channel, choice, groups);
    const key =
      group === null ? "none" : `group:${group.toLocaleLowerCase("en-US")}`;
    const section = sections.get(key) ?? {
      group,
      position: null,
      rows: new Map(),
    };
    const position = channel.categoryPosition ?? null;
    if (
      position !== null &&
      (section.position === null || position < section.position)
    ) {
      section.position = position;
    }
    const rowKey = name.toLocaleLowerCase("en-US");
    const locked = choice.visibility !== "chapter";
    const existing = section.rows.get(rowKey);
    section.rows.set(rowKey, {
      name: existing?.name ?? name,
      locked: (existing?.locked ?? false) || locked,
    });
    sections.set(key, section);
  }
  const built = [...sections.entries()];
  const ungrouped = built.filter(([key]) => key === "none");
  const grouped = built.filter(([key]) => key !== "none");
  grouped.sort(([, left], [, right]) => {
    if (left.position !== right.position) {
      if (left.position === null) return 1;
      if (right.position === null) return -1;
      return left.position - right.position;
    }
    return (left.group ?? "").localeCompare(right.group ?? "", "en-US");
  });
  return [...ungrouped, ...grouped].map(([key, section]) => ({
    key,
    group: section.group,
    channels: [...section.rows.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en-US"),
    ),
  }));
}
