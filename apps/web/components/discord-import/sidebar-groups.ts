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

/** Channel names compare case-insensitively and ignoring a leading `#`. */
export function normaliseChannelName(name: string): string {
  return name.trim().replace(/^#+/, "").toLowerCase();
}

/** Group names compare trimmed and in any case (`channelGroupKey` in the API). */
function groupKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

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
type PreviewChoice = RowChoice & {
  newName?: string;
  visibility?: string;
  requiredPermissions?: string[];
};

/** One section of the preview, as the chat sidebar will head it. */
export interface PreviewSection {
  key: string;
  /** The group's name; null for the channels in none ("Channels"). */
  group: string | null;
  /** One of the chapter's own groups, which the import's channels join. */
  existing: boolean;
  channels: { name: string; locked: boolean }[];
}

/**
 * The channels the import makes, as the chat sidebar will list them, in the
 * order starting the import arranges them (`planChannelGroups` in the API).
 * The ones in no group come first (the sidebar's "Channels"). A kept
 * category named like one of the chapter's own groups (`chapterGroups`, in
 * the chapter's order) joins it, under the chapter's spelling, and those
 * come before every group the import creates. New groups follow, by the
 * lowest Discord category position among their channels, a group with none
 * after every positioned one, then by name; an upload's export carries no
 * positions, so its groups go A to Z. Inside a section, A to Z, the
 * sidebar's rule.
 *
 * Discord channels given the same new name (`normaliseChannelName`) and the
 * same readers are one row, as they land in one channel; ones whose readers
 * differ are two, which Needs attention asks about. A merge makes nothing,
 * so it isn't listed. A row is locked unless the whole chapter can read it,
 * as the sidebar marks a private channel.
 */
export function sidebarPreview(
  channels: readonly StagedChannel[],
  choices: Record<string, PreviewChoice>,
  groups: SidebarGroups,
  chapterGroups: readonly { name: string }[] = [],
): PreviewSection[] {
  const chapterOrder = new Map<string, { index: number; name: string }>();
  chapterGroups.forEach((group, index) => {
    const key = groupKey(group.name);
    // Two of the chapter's groups of one name: the first wins, as the API's.
    if (!chapterOrder.has(key))
      chapterOrder.set(key, { index, name: group.name });
  });

  type Building = {
    group: string | null;
    existing: number | null;
    position: number | null;
    rows: Map<string, { name: string; locked: boolean }>;
  };
  const sections = new Map<string, Building>();
  for (const channel of channels) {
    if (channel.readable === false) continue;
    const choice = choices[channel.channelId];
    if (choice?.action !== "create_new") continue;
    const name = choice.newName?.trim().replace(/^#+/, "").trim();
    if (!name) continue;
    const group = sidebarGroupFor(channel, choice, groups);
    const key = group === null ? "none" : `group:${groupKey(group)}`;
    const joins =
      group === null ? undefined : chapterOrder.get(groupKey(group));
    const section = sections.get(key) ?? {
      group: joins?.name ?? group,
      existing: joins?.index ?? null,
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
    const readers = [
      choice.visibility ?? "",
      ...[...(choice.requiredPermissions ?? [])].sort(),
    ].join(",");
    const rowKey = `${normaliseChannelName(name)}|${readers}`;
    if (!section.rows.has(rowKey)) {
      section.rows.set(rowKey, {
        name,
        locked: choice.visibility !== "chapter",
      });
    }
    sections.set(key, section);
  }
  const built = [...sections.entries()];
  const ungrouped = built.filter(([key]) => key === "none");
  const grouped = built.filter(([key]) => key !== "none");
  grouped.sort(([, left], [, right]) => {
    if (left.existing !== null || right.existing !== null) {
      if (left.existing === null) return 1;
      if (right.existing === null) return -1;
      return left.existing - right.existing;
    }
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
    existing: section.existing !== null,
    channels: [...section.rows.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en-US"),
    ),
  }));
}
